import {
  createFileStatePersistence,
  resolveStateFile,
  type BearerTokens,
  type StatePersistence,
} from '@chrischall/mcp-utils/session';
import { parseBoolEnv } from '@chrischall/mcp-utils';

/** The credentials a cached token was minted from. */
/**
 * What the cached token pair is bound to — whichever credential minted it.
 * A password pair, or a refresh token the consumer supplied. Replacing that
 * credential must invalidate the cache; binding to the wrong one would let a
 * token from a replaced credential keep working.
 */
export type CacheBinding = { email: string; password: string } | { refreshToken: string };

/**
 * Where the OAuth token pair is cached between runs.
 *
 * Skylight's login is the four-step authorization-code flow in
 * `auth-session-login.ts`, and its endpoint rate-limits — `CLAUDE.md` records
 * hitting that during testing, which is why the refresh grant went
 * live-unverified. Re-running it on every process start is therefore not a
 * free retry, and on a scale-to-zero host (children idle out after ten minutes)
 * every start is a cold one.
 *
 * `resolveStateDir` prefers `MCP_DATA_DIR`, the variable mcp-host injects for a
 * registration with `state.dataDir: true` — which this repo's `mint.yaml`
 * already declares — then `HOME`. Both are read through the hardened
 * `readEnvVar`, so a blank, `'null'`/`'undefined'` or unexpanded `${...}` value
 * cannot turn into a relative path under the process cwd.
 */
export function tokenStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveStateFile({
    env,
    envVar: 'SKYLIGHT_TOKEN_FILE',
    subdir: '.skylight-mcp',
    fileName: 'tokens.json',
  });
}

/** Only the token pair is ever stored — never the email or password. */
function isTokens(raw: unknown): raw is BearerTokens {
  if (raw === null || typeof raw !== 'object') return false;
  const t = raw as Partial<BearerTokens>;
  if (typeof t.accessToken !== 'string' || t.accessToken === '') return false;
  // `typeof === 'number'` is sufficient here and !Number.isFinite() would be
  // dead: this only ever validates a JSON.parse result, and JSON has no
  // NaN/Infinity literal (JSON.stringify emits null for both), so a number that
  // reaches this line is always finite.
  if (typeof t.expiresAt !== 'number') return false;
  return t.refreshToken === undefined || typeof t.refreshToken === 'string';
}

/**
 * The token cache, or `null` when the operator has turned it off with
 * `SKYLIGHT_TOKEN_CACHE=false`. A `null` persistence is passed straight through
 * to `TokenManager`, which then behaves exactly as it did before: tokens live
 * for the life of the process and every start logs in.
 *
 * The file is `0600` and holds `{ accessToken, refreshToken, expiresAt }` and
 * nothing else — the credentials that minted it stay in the environment.
 */
export function createTokenPersistence(
  env: NodeJS.ProcessEnv = process.env,
  binding?: CacheBinding,
): StatePersistence<BearerTokens> | null {
  if (!parseBoolEnv('SKYLIGHT_TOKEN_CACHE', { env, default: true })) return null;
  return createFileStatePersistence<BearerTokens>({
    filePath: tokenStorePath(env),
    validate: (raw) => (isTokens(raw) ? raw : null),
    // Bound to the credentials that minted the token, so rotating the password
    // — or pointing the server at a different account — discards the cache
    // instead of letting a token from the old one keep working. Only a salted
    // HMAC digest is written; neither value reaches the file.
    ...(binding !== undefined
      ? {
          boundTo:
            'refreshToken' in binding
              ? `refresh\u0000${binding.refreshToken}`
              : `${binding.email.trim().toLowerCase()}\u0000${binding.password}`,
        }
      : {}),
  });
}

/**
 * Report a cache write that failed. Deliberately not fatal — the tokens already
 * in memory are valid, so failing the request would cost access now to save it
 * later. How bad the lost write is depends on the credential:
 *
 * - With a login pair, the next start simply logs in again.
 * - With ONLY `SKYLIGHT_REFRESH_TOKEN` (`refreshTokenOnly`), it is a lockout in
 *   waiting: Skylight rotates the refresh token on every refresh grant, so the
 *   env token was spent minting this pair and the rotated one existed only in
 *   the write that just failed. The next start re-presents the spent token and
 *   gets "rejected the supplied refresh token" (fleet-audit#245). Say that,
 *   loudly — the password-path wording ("re-run the login") is false here.
 *
 * stderr only; stdout is the JSON-RPC channel.
 */
export function reportCacheWriteFailure(err: unknown, opts: { refreshTokenOnly?: boolean } = {}): void {
  const detail = err instanceof Error ? err.message : String(err);
  const where = `[skylight-mcp] could not cache the OAuth tokens at ${tokenStorePath()} (${detail})`;
  if (opts.refreshTokenOnly) {
    console.error(
      `${where}. WARNING: Skylight rotated SKYLIGHT_REFRESH_TOKEN when it minted this session, so the env token is now spent ` +
        'and the rotated one was not saved. This process keeps working, but the next start will fail with ' +
        '"rejected the supplied refresh token". Fix the token cache location (MCP_DATA_DIR / SKYLIGHT_TOKEN_FILE), ' +
        'or set SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD so a new token can be minted.',
    );
    return;
  }
  console.error(`${where}; continuing without the cache — every restart will re-run the login until this is fixed.`);
}
