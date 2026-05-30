import { loadAccount, NO_ENV_CONFIG_MARKER, type Account } from './config.js';
import { oauthPasswordGrant, type TokenPoster, type Tokens } from './auth-session-login.js';
import { SkylightClient, type HttpFetch } from './client.js';
import pkg from '../package.json' with { type: 'json' };

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

  let account: Account;
  try {
    account = loadAccount();
  } catch (e) {
    if (!(e as Error).message.startsWith(NO_ENV_CONFIG_MARKER)) throw e;
    if (fetchproxyDisabled()) throw e;
    throw e;
  }

  const directPoster = nodePoster(httpFetch);
  try {
    const tokens = await oauthPasswordGrant(account, directPoster);
    return { client: makeClient(account, tokens, directPoster, httpFetch), source: 'env' };
  } catch (e) {
    if (fetchproxyDisabled() || !looksLikeBotWall(e)) throw e;
    const { poster: fpPoster } = await makeFetchproxyPoster();
    const tokens = await oauthPasswordGrant(account, fpPoster);
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

async function makeFetchproxyPoster(): Promise<{ poster: TokenPoster }> {
  const { FetchproxyServer } = await import('@fetchproxy/server');
  // TODO(Task 11): reconcile with @fetchproxy/server types — FetchInit requires `tabUrl`
  // which this call doesn't supply. Casting to `any` so `tsc` passes until Task 11
  // audits the full FetchproxyServer usage surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = new FetchproxyServer({
    serverName: pkg.name,
    version: pkg.version,
    domains: ['ourskylight.com'],
    capabilities: [],
  });
  const poster: TokenPoster = async (url, formBody) => {
    // TODO(Task 11): FetchInit requires `tabUrl`; add it once the token endpoint's
    // expected tab origin is confirmed. Using `as any` to pass tsc for now.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await server.fetch({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formBody,
    } as any);
    let json: unknown = {};
    try { json = JSON.parse((res as { body?: string }).body ?? '{}'); } catch { /* keep {} */ }
    return { status: (res as { status: number }).status, json };
  };
  return { poster };
}
