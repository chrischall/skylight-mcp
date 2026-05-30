import { loadAccount, type Account } from './config.js';
import { oauthPasswordGrant, type TokenPoster, type Tokens } from './auth-session-login.js';
import { SkylightClient, type HttpFetch } from './client.js';
import pkg from '../package.json' with { type: 'json' };
import type { FetchInit } from '@fetchproxy/protocol';
import type { FetchResult, FetchResultError } from '@fetchproxy/server';

export interface ResolvedAuth {
  client: SkylightClient;
  source: 'env' | 'fetchproxy';
}

function readEnv(key: string): string | undefined {
  const raw = process.env[key];
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (!t || t === 'undefined' || t === 'null' || /^\$\{[^}]*\}$/.test(t)) return undefined;
  return t;
}

function fetchproxyDisabled(): boolean {
  const raw = readEnv('SKYLIGHT_DISABLE_FETCHPROXY');
  return raw !== undefined && ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** A TokenPoster backed by Node's global fetch (or an injected one for tests). */
function nodePoster(httpFetch: HttpFetch): TokenPoster {
  return async (url, formBody) => {
    const res = await httpFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formBody,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
}

export async function resolveAuth(opts: { httpFetch?: HttpFetch } = {}): Promise<ResolvedAuth> {
  const httpFetch: HttpFetch = opts.httpFetch ?? ((u, i) => fetch(u, i));

  // Credentials are always required (email+password). Any loadAccount error —
  // missing config or partial config — must surface; fetchproxy can't log in
  // without a password, so there is no no-creds fallthrough.
  const account: Account = loadAccount();

  const directPoster = nodePoster(httpFetch);
  try {
    const tokens = await oauthPasswordGrant(account, directPoster);
    return { client: makeClient(account, tokens, directPoster, httpFetch), source: 'env' };
  } catch (e) {
    if (fetchproxyDisabled() || !looksLikeBotWall(e)) throw e;
    // The login-proxy server is closed after login. If the access token later
    // expires, the fetchproxy-backed refresh will fail and the user must
    // restart — acceptable because this path only exists to get past a
    // login-time bot wall (Option B: one-shot login proxy, no long-lived handle).
    const { poster: fpPoster, close } = await makeFetchproxyPoster();
    let tokens;
    try {
      try {
        tokens = await oauthPasswordGrant(account, fpPoster);
      } catch (fpErr) {
        throw new Error(
          `Skylight login failed via the direct path and the fetchproxy fallback also failed: ${fpErr instanceof Error ? fpErr.message : String(fpErr)}`,
        );
      }
    } finally {
      await close();
    }
    return { client: makeClient(account, tokens, fpPoster, httpFetch), source: 'fetchproxy' };
  }
}

function makeClient(account: Account, tokens: Tokens, tokenPoster: TokenPoster, httpFetch: HttpFetch): SkylightClient {
  return new SkylightClient({ account, tokens, tokenPoster, httpFetch });
}

function looksLikeBotWall(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /HTTP 403|HTTP 429|challenge|captcha|cloudflare|akamai/i.test(msg);
}

async function makeFetchproxyPoster(): Promise<{ poster: TokenPoster; close: () => Promise<void> }> {
  const { FetchproxyServer } = await import('@fetchproxy/server');
  // FetchproxyServerOpts: { serverName, version, domains, capabilities?, ... }
  // All fields here match the declared type exactly — no cast needed.
  const server = new FetchproxyServer({
    serverName: pkg.name,
    version: pkg.version,
    domains: ['ourskylight.com'],
    capabilities: [],
  });
  const poster: TokenPoster = async (url, formBody) => {
    // FetchInit requires `tabUrl: string` — the token endpoint is issued from
    // the Skylight app origin. Supplying it here satisfies the type and tells
    // the browser extension which signed-in tab to route the request through.
    const init: FetchInit = {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formBody,
      tabUrl: 'https://app.ourskylight.com',
    };
    const res: FetchResult | FetchResultError = await server.fetch(init);
    // FetchResult (ok:true) carries { status, url, body }.
    // FetchResultError (ok:false) means the bridge itself failed — surface as a
    // transport error so oauthPasswordGrant can throw and the caller can decide
    // whether to retry (or rethrow). We use status 503 as a sentinel.
    if (!res.ok) {
      throw new Error(`fetchproxy bridge error: ${res.error}`);
    }
    let json: unknown = {};
    try { json = JSON.parse(res.body ?? '{}'); } catch { /* keep {} */ }
    return { status: res.status, json };
  };
  return { poster, close: () => server.close() };
}
