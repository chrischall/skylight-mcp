import { loadAccount } from './config.js';
import { login, refresh } from './auth-session-login.js';
import { SkylightClient, type HttpFetch } from './client.js';
import { createTokenPersistence } from './token-store.js';
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

  const client = new SkylightClient({
    account,
    // Lazy: the four-step login runs on first use, and only when the token cache
    // has nothing usable. Skylight's login endpoint rate-limits, so a cold start
    // that can reuse a token should not spend one.
    tokens: () =>
      login(
        { authBaseUrl: account.authBaseUrl, email: account.email, password: account.password },
        httpFetch,
      ),
    persistence: opts.persistence !== undefined ? opts.persistence : createTokenPersistence(),
    refreshFn: (refreshToken) => refresh({ authBaseUrl: account.authBaseUrl, refreshToken }, httpFetch),
    httpFetch,
  });

  return { client, source: 'env' };
}
