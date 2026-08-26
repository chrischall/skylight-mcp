import { loadAccount } from './config.js';

/** Unreachable via `loadAccount`; kept so the type narrowing is honest. */
const NO_LOGIN_PAIR =
  'Skylight has no login configured — set SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD, or SKYLIGHT_REFRESH_TOKEN.';
import { login, refresh } from './auth-session-login.js';
import { SkylightClient, type HttpFetch } from './client.js';
import { createTokenPersistence, reportCacheWriteFailure } from './token-store.js';
import type { BearerTokens, StatePersistence } from '@chrischall/mcp-utils/session';

export interface ResolvedAuth {
  client: SkylightClient;
  source: 'env';
}

function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

export async function resolveAuth(
  opts: {
    httpFetch?: HttpFetch;
    /** Override the token cache (tests inject a fake; `null` disables it). */
    persistence?: StatePersistence<BearerTokens> | null;
  } = {},
): Promise<ResolvedAuth> {
  const httpFetch: HttpFetch = opts.httpFetch ?? defaultFetch;

  // Eager on purpose: a missing SKYLIGHT_EMAIL/PASSWORD must still surface as
  // the permanent config error `makeGetClient` caches, not as a per-request one.
  const account = loadAccount();

  // The login pair, when there is one. `loadAccount` guarantees it whenever no
  // refresh token was supplied, so this is non-null on every path that needs it.
  const loginPair =
    account.email && account.password ? { email: account.email, password: account.password } : null;

  const doLogin = () => {
    /* istanbul ignore next — loadAccount rejects this combination up front. */
    if (!loginPair) throw new Error(NO_LOGIN_PAIR);
    return login({ authBaseUrl: account.authBaseUrl, ...loginPair }, httpFetch);
  };

  /**
   * Mint a token pair, preferring the credential the consumer actually supplied.
   *
   * A supplied refresh token is the narrow credential: scoped, revocable, and —
   * because the refresh grant is not the rate-limited login endpoint — free to
   * spend on a cold start. If it is stale, what happens next depends on whether
   * a login pair exists: with one, recover silently; without one, say the token
   * is stale rather than reporting it as missing configuration, which is the
   * failure mode untappd-mcp#140 fixed for the same shape of credential.
   */
  const mintTokens = async () => {
    if (!account.refreshToken) return doLogin();
    try {
      return await refresh({ authBaseUrl: account.authBaseUrl, refreshToken: account.refreshToken }, httpFetch);
    } catch (err) {
      if (loginPair) return doLogin();
      throw new Error(
        'Skylight rejected the supplied refresh token — SKYLIGHT_REFRESH_TOKEN has expired or been revoked. ' +
          'Supply a fresh token, or set SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD so a new one can be minted automatically. ' +
          `(upstream: ${err instanceof Error ? err.message : String(err)})`,
      );
    }
  };

  const client = new SkylightClient({
    account,
    // Lazy: the four-step login runs on first use, and only when the token cache
    // has nothing usable. Skylight's login endpoint rate-limits, so a cold start
    // that can reuse a token should not spend one.
    tokens: mintTokens,
    persistence:
      opts.persistence !== undefined
        ? opts.persistence
        : createTokenPersistence(
            process.env,
            // Bind the cache to whichever credential actually minted the pair,
            // so replacing that credential discards the cache instead of
            // letting a token from the old one keep working.
            account.refreshToken
              ? { refreshToken: account.refreshToken }
              : { email: account.email!, password: account.password! },
          ),
    // Report rather than throw: the tokens are re-mintable from the environment,
    // so a lost write costs the next start a login, not access.
    onPersistError: reportCacheWriteFailure,
    refreshFn: (refreshToken) => refresh({ authBaseUrl: account.authBaseUrl, refreshToken }, httpFetch),
    httpFetch,
  });

  return { client, source: 'env' };
}
