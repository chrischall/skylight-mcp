import { createApiClient, type ApiClient, type RequestOptions } from '@chrischall/mcp-utils';
import {
  TokenManager,
  type BearerTokens,
  type StatePersistence,
} from '@chrischall/mcp-utils/session';
import type { Account } from './config.js';
import type { Tokens } from './auth-session-login.js';

export type { Tokens };
export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SkylightClientOpts {
  account: Account;
  /**
   * The starting tokens, or a function that mints them (the four-step login).
   *
   * Prefer the function form: with {@link SkylightClientOpts.persistence} set it
   * runs ONLY when no usable token was restored, so a restart that finds a live
   * token never touches Skylight's rate-limited login endpoint at all.
   */
  tokens: Tokens | (() => Promise<Tokens>);
  /**
   * Where to cache the token pair between processes. Omit (or pass `null`) to
   * keep tokens in memory for the life of the process, as before.
   */
  persistence?: StatePersistence<BearerTokens> | null;
  /** Called with the current refreshToken; must return fresh tokens. */
  refreshFn: (refreshToken: string) => Promise<Tokens>;
  /** HTTP transport for API calls. Defaults to global fetch. */
  httpFetch?: HttpFetch;
}

/** Per-request options forwarded to the shared client (query, JSON body, or multipart). */
export type RequestOpts = Pick<RequestOptions, 'query' | 'body' | 'formData'>;

/** Refresh this many ms before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;
/** Mobile-app API version header — gates version-locked features. */
const API_VERSION = '2026-05-01';
/** Per-attempt request timeout so a hung upstream can't stall a tool call forever. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Thin Skylight wrapper over the shared `createApiClient` (429-retry, 401 mapping,
 * redacted error formatting) wired to the fleet `TokenManager` (proactive skew
 * refresh + reactive 401-replay + single-flight). Skylight-specific bits: the
 * `skylight-api-version` header and frame auto-discovery.
 */
export class SkylightClient {
  private readonly api: ApiClient;
  private frameId?: string;

  constructor(opts: SkylightClientOpts) {
    // TokenManager owns the bearer-token lifecycle. Skylight's refreshFn returns a
    // RELATIVE `expiresInMs`; adapt it to TokenManager's absolute `expiresAt` —
    // absolute is also what gets persisted, so a cached token's remaining life is
    // read correctly by the next process rather than restarting its clock.
    const toBearer = (t: Tokens): BearerTokens => ({
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: Date.now() + t.expiresInMs,
    });
    const mint = opts.tokens;
    const tokens = new TokenManager({
      initial: typeof mint === 'function' ? async () => toBearer(await mint()) : toBearer(mint),
      persistence: opts.persistence ?? undefined,
      refresh: async (refreshToken) => {
        const tok = await opts.refreshFn(refreshToken);
        return {
          accessToken: tok.accessToken,
          // Omit an empty refresh token so TokenManager keeps the prior one.
          refreshToken: tok.refreshToken || undefined,
          expiresAt: Date.now() + tok.expiresInMs,
        };
      },
      skewMs: REFRESH_SKEW_MS,
    });
    // Adapt the (url: string, init) transport to the `typeof fetch` shape;
    // omitting it (undefined) lets createApiClient fall back to global fetch.
    const transport = opts.httpFetch;
    this.api = createApiClient({
      baseUrl: opts.account.baseUrl,
      serviceName: 'Skylight',
      baseHeaders: { 'skylight-api-version': API_VERSION },
      tokenManager: tokens,
      fetchImpl: transport ? (input, init) => transport(String(input), init) : undefined,
      timeout: REQUEST_TIMEOUT_MS,
    });
    this.frameId = opts.account.frameId;
  }

  /** Authenticated JSON request → parsed body (or `undefined` for 204/empty). */
  request<T = unknown>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
    return this.api.fetchJson<T>(method, path, opts);
  }

  async resolveFrameId(): Promise<string> {
    if (this.frameId) return this.frameId;
    const res = await this.request<{ data: Array<{ id: string; attributes?: { name?: string } }> }>('GET', '/frames');
    const frames = res.data ?? [];
    if (frames.length === 0) throw new Error('No Skylight frames found on this account.');
    if (frames.length === 1) { this.frameId = frames[0].id; return this.frameId; }
    const list = frames.map((f) => `${f.id} (${f.attributes?.name ?? '?'})`).join(', ');
    throw new Error(`Account has multiple frames — set SKYLIGHT_FRAME_ID to one of: ${list}`);
  }
}
