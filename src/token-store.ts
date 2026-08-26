import { join } from 'node:path';
import {
  createFileStatePersistence,
  resolveStateDir,
  type BearerTokens,
  type StatePersistence,
} from '@chrischall/mcp-utils/session';
import { parseBoolEnv } from '@chrischall/mcp-utils';

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
  return join(resolveStateDir({ env, subdir: '.skylight-mcp' }), 'tokens.json');
}

/** Only the token pair is ever stored — never the email or password. */
function isTokens(raw: unknown): raw is BearerTokens {
  if (raw === null || typeof raw !== 'object') return false;
  const t = raw as Partial<BearerTokens>;
  if (typeof t.accessToken !== 'string' || t.accessToken === '') return false;
  if (typeof t.expiresAt !== 'number' || !Number.isFinite(t.expiresAt)) return false;
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
): StatePersistence<BearerTokens> | null {
  if (!parseBoolEnv('SKYLIGHT_TOKEN_CACHE', { env, default: true })) return null;
  return createFileStatePersistence<BearerTokens>({
    filePath: tokenStorePath(env),
    validate: (raw) => (isTokens(raw) ? raw : null),
  });
}
