import { loadAccount } from './config.js';
import { login, refresh } from './auth-session-login.js';
import { SkylightClient, type HttpFetch } from './client.js';

export interface ResolvedAuth {
  client: SkylightClient;
  source: 'env';
}

function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

export async function resolveAuth(opts: { httpFetch?: HttpFetch } = {}): Promise<ResolvedAuth> {
  const httpFetch: HttpFetch = opts.httpFetch ?? defaultFetch;

  const account = loadAccount();

  const tokens = await login(
    { authBaseUrl: account.authBaseUrl, email: account.email, password: account.password },
    httpFetch,
  );

  const client = new SkylightClient({
    account,
    tokens,
    refreshFn: (refreshToken) => refresh({ authBaseUrl: account.authBaseUrl, refreshToken }, httpFetch),
    httpFetch,
  });

  return { client, source: 'env' };
}
