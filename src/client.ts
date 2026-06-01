import { truncateErrorMessage } from '@chrischall/mcp-utils';
import type { Account } from './config.js';
import type { Tokens } from './auth-session-login.js';

export type { Tokens };
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface SkylightClientOpts {
  account: Account;
  tokens: Tokens;
  /** Called with the current refreshToken; must return fresh tokens. */
  refreshFn: (refreshToken: string) => Promise<Tokens>;
  /** HTTP transport for API calls. Defaults to global fetch. */
  httpFetch?: HttpFetch;
}

export interface RequestOpts {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** Refresh this many ms before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;

export class SkylightClient {
  private account: Account;
  private accessToken: string;
  private refreshToken: string;
  private expiresAt: number; // epoch ms
  private refreshFn: (refreshToken: string) => Promise<Tokens>;
  private httpFetch: HttpFetch;
  private frameId?: string;
  private refreshInFlight?: Promise<void>;

  constructor(opts: SkylightClientOpts) {
    this.account = opts.account;
    this.accessToken = opts.tokens.accessToken;
    this.refreshToken = opts.tokens.refreshToken;
    this.expiresAt = Date.now() + opts.tokens.expiresInMs;
    this.refreshFn = opts.refreshFn;
    this.httpFetch = opts.httpFetch ?? ((url, init) => fetch(url, init));
    this.frameId = opts.account.frameId;
  }

  private async refresh(): Promise<void> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = (async () => {
        const tok = await this.refreshFn(this.refreshToken);
        this.accessToken = tok.accessToken;
        if (tok.refreshToken) this.refreshToken = tok.refreshToken;
        this.expiresAt = Date.now() + tok.expiresInMs;
      })().finally(() => { this.refreshInFlight = undefined; });
    }
    return this.refreshInFlight;
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
    if (Date.now() >= this.expiresAt - REFRESH_SKEW_MS) {
      await this.refresh();
    }
    let res = await this.send(method, path, opts);
    if (res.status === 401) {
      await this.refresh();
      res = await this.send(method, path, opts);
    }
    if (res.status < 200 || res.status >= 300) {
      const text = await res.text().catch(() => '');
      // truncateErrorMessage redacts bearer tokens/JWTs then caps length, so an
      // upstream body that echoes the request can't leak credentials into a tool result.
      throw new Error(`Skylight API ${method} ${path} failed (HTTP ${res.status}): ${truncateErrorMessage(text, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private send(method: string, path: string, opts: RequestOpts): Promise<Response> {
    const url = new URL(this.account.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return this.httpFetch(url.toString(), init);
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
