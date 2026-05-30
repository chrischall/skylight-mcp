# skylight-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server for Skylight Calendar (ourskylight.com) exposing read+write tools for calendar events, chores/rewards, and shared lists for a family "frame", authed via OAuth2 password grant (Node-direct) with a fetchproxy login-proxy fallback.

**Architecture:** Clone the canonical **Pattern A** family shape (`signupgenius-mcp`, `infinitecampus-mcp`). `resolveAuth()` picks an auth path (password → fetchproxy login-proxy). `SkylightClient` owns the bearer token, refreshes it, resolves the frame id once, and is the single `request()` chokepoint. One tool file per domain. All HTTP responses are JSON:API and get flattened to friendly objects in `_shared`.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk`, `zod` v4, `@fetchproxy/server`, `vitest` (100% coverage gate on `src/**`), `esbuild`, release-please.

**Reference template:** `/Users/chris/git/signupgenius-mcp` (read its files when a task says "clone from the template"). Sibling `infinitecampus-mcp` is the closest auth analog (single credential pair, no key mode).

---

## Confirmed API facts (from live recon — treat as ground truth)

- **Base URL:** `https://app.ourskylight.com/api`
- **Auth header:** `Authorization: Bearer <accessToken>`; requests use no cookies. Cookies alone → 401.
- **Token endpoint:** `POST https://app.ourskylight.com/api/oauth/token`, `Content-Type: application/x-www-form-urlencoded`.
  - Login body: `grant_type=password`, `username=<email>`, `password=<password>`, `client_id=skylight-mobile` (public PKCE client; **no client_secret** — confirm live in Task 12).
  - Refresh body: `grant_type=refresh_token`, `refresh_token=<token>`, `client_id=skylight-mobile`.
  - Response (OAuth2 JSON): `{ access_token, refresh_token, expires_in (seconds) | token_type, ... }`. Exact field names confirmed live in Task 12.
- **Frames:** `GET /api/frames` → JSON:API `{ data: [{ id, type:"approved_viewer_frame", attributes:{ name, timezone, household_name, apps, plus, access, feature_bundle, ... } }] }`. `attributes.apps` lists enabled apps per frame (used to gate meals). The account in recon had exactly 1 frame.
- **Calendar events:** `GET /api/frames/{frame}/calendar_events?date_min=YYYY-MM-DD&date_max=YYYY-MM-DD&timezone=<tz>&include=categories,calendar_account,event_notification_setting`. Type `calendar_event`. Attributes: `uid, summary, invited_emails, status, all_day, timezone, starts_at, ends_at, recurring, recurring_config, rrule, master_event_id, description, location, lat, lng, source, kind, editable, countdown_enabled, owner_email, calendar_id`.
- **Lists:** `GET /api/frames/{frame}/lists` → type `list`, attrs `label, color, kind, hide_on_device, default_grocery_list`. Items: `GET /api/frames/{frame}/lists/{listId}/list_items`.
- **Chores:** `GET /api/frames/{frame}/chores?after=YYYY-MM-DD&before=YYYY-MM-DD` (**both `after` and `before` required** — 422 `{"errors":{"after":["can't be blank"],"before":["can't be blank"]}}` otherwise).
- **Rewards:** `GET /api/frames/{frame}/rewards?redeemed_at_min=<iso>&redeemed_at_max=<iso>`.
- **Frame users:** `GET /api/frames/{frame}/users` → type `frame_user`, attrs `status, is_owner`.
- **Categories:** `GET /api/frames/{frame}/categories`. **Source calendars:** `GET /api/frames/{frame}/source_calendars`. **Devices:** `GET /api/frames/{frame}/devices`.
- **No bot wall observed** on the API (plain Node fetch with bearer works).

## File structure

```
src/
  index.ts                  # entry: McpServer, resolveAuth(), wire tool modules, stdio transport, configError defer
  config.ts                 # loadAccount(env) → Account | throws
  auth-session-login.ts     # oauthPasswordGrant() + oauthRefresh() — form-urlencoded POST to oauth/token (Node-direct + via fetchproxy)
  auth.ts                   # resolveAuth(): password → fetchproxy login-proxy
  client.ts                 # SkylightClient: bearer, refresh, 401-retry, frame resolution, request() chokepoint
  tools/
    _shared.ts              # textContent(), flattenJsonApi(), resolveFrameId(), isoDate(), toolError()
    frames.ts               # list_frames, get_frame, list_frame_members, list_devices
    events.ts               # list_events, get_event, create_event, update_event, delete_event, list_categories, list_source_calendars
    lists.ts                # list_lists, get_list_items, create_list, add_list_item, update_list_item, delete_list_item
    chores.ts               # list_chores, create_chore, complete_chore, list_rewards
    meals.ts                # (conditional — only if Task 13 confirms an endpoint)
tests/
  config.test.ts
  auth-session-login.test.ts
  auth.test.ts
  client.test.ts
  version-sync.test.ts
  tools/
    _setup.ts               # makeClient() mock helper
    _shared.test.ts
    frames.test.ts
    events.test.ts
    lists.test.ts
    chores.test.ts
```

---

## Task 0: Scaffold the repo from the template

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `.prettierrc`
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `manifest.json`, `server.json`
- Create: `.github/` (copy `release.yml`, `dependabot.yml`, workflows), `release-please-config.json`, `.release-please-manifest.json`

- [ ] **Step 1: Copy infra files from the template and rename**

```bash
cd /Users/chris/git/skylight-mcp
T=/Users/chris/git/signupgenius-mcp
cp $T/tsconfig.json $T/vitest.config.ts $T/.prettierrc .
cp -r $T/.github .
cp $T/release-please-config.json .
mkdir -p .claude-plugin src/tools tests/tools
cp $T/.claude-plugin/plugin.json .claude-plugin/plugin.json
cp $T/.claude-plugin/marketplace.json .claude-plugin/marketplace.json
```

- [ ] **Step 2: Write `package.json`** (version 0.1.0, deps on `@fetchproxy/server` not `bootstrap`)

```json
{
  "name": "skylight-mcp",
  "version": "0.1.0",
  "mcpName": "io.github.chrischall/skylight-mcp",
  "description": "Skylight Calendar MCP — read/write family calendar events, chores, rewards, and shared lists.",
  "author": "Claude Code (AI) <https://www.anthropic.com/claude>",
  "repository": { "type": "git", "url": "git+https://github.com/chrischall/skylight-mcp.git" },
  "license": "MIT",
  "keywords": ["mcp", "model-context-protocol", "claude", "ai", "skylight", "calendar", "chores", "family"],
  "type": "module",
  "bin": { "skylight-mcp": "dist/index.js" },
  "files": ["dist", ".claude-plugin", "skills", ".mcp.json", "server.json"],
  "scripts": {
    "build": "tsc && npm run bundle",
    "bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --external:dotenv --banner:js='import { createRequire as __createRequire } from \"module\"; const require = __createRequire(import.meta.url);' --outfile=dist/bundle.js",
    "dev": "node --env-file=.env dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fetchproxy/server": "^0.11.1",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "dotenv": "^17.4.2",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "@vitest/coverage-v8": "^4.1.7",
    "esbuild": "^0.28.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.7"
  }
}
```

- [ ] **Step 3: Write `.release-please-manifest.json`**

```json
{ ".": "0.1.0" }
```

- [ ] **Step 4: Write `.env.example`**

```bash
# Skylight MCP — auth. Primary: email + password (OAuth2 password grant).
SKYLIGHT_EMAIL=you@example.com
SKYLIGHT_PASSWORD=your-password

# Optional: pick a frame when your account has more than one (see skylight_list_frames).
# SKYLIGHT_FRAME_ID=3435252

# Optional friendly name shown in diagnostics. Defaults to the email.
# SKYLIGHT_NAME=The Halls

# Optional: skip the fetchproxy login-proxy fallback (headless CI).
# SKYLIGHT_DISABLE_FETCHPROXY=1
```

- [ ] **Step 5: Edit `manifest.json`, `server.json`, `.claude-plugin/*`** — replace every `signupgenius` string with `skylight`, set version `0.1.0`, set `server.json.description` to ≤100 chars (verify: `jq -r '.description|length' server.json` ≤ 100). Set env-var config blocks to `SKYLIGHT_EMAIL` / `SKYLIGHT_PASSWORD` (both optional, like infinitecampus). Tools list can be filled at the end (Task 14).

- [ ] **Step 6: `npm install`, then commit**

```bash
npm install
git add -A && git commit -m "chore: scaffold skylight-mcp from template (v0.1.0)"
```

---

## Task 1: `config.ts` — `loadAccount()`

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

Single credential pair (email+password). No key mode. `readVar` sanitization copied verbatim from the template (handles `""`, `"undefined"`, `"null"`, `${...}` placeholders).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { loadAccount } from '../src/config.js';

describe('loadAccount', () => {
  it('returns a session account from email+password', () => {
    const acc = loadAccount({ SKYLIGHT_EMAIL: 'a@b.com', SKYLIGHT_PASSWORD: 'pw' });
    expect(acc).toEqual({
      mode: 'session',
      name: 'a@b.com',
      baseUrl: 'https://app.ourskylight.com/api',
      email: 'a@b.com',
      password: 'pw',
      frameId: undefined,
    });
  });

  it('uses SKYLIGHT_NAME and SKYLIGHT_FRAME_ID when set', () => {
    const acc = loadAccount({ SKYLIGHT_EMAIL: 'a@b.com', SKYLIGHT_PASSWORD: 'pw', SKYLIGHT_NAME: 'Home', SKYLIGHT_FRAME_ID: '42' });
    expect(acc.name).toBe('Home');
    expect(acc.frameId).toBe('42');
  });

  it('throws the no-config marker when nothing is set', () => {
    expect(() => loadAccount({})).toThrow(/Missing Skylight auth config/);
  });

  it('throws on partial config (email only)', () => {
    expect(() => loadAccount({ SKYLIGHT_EMAIL: 'a@b.com' })).toThrow(/SKYLIGHT_PASSWORD/);
  });

  it('throws on partial config (password only)', () => {
    expect(() => loadAccount({ SKYLIGHT_PASSWORD: 'pw' })).toThrow(/SKYLIGHT_EMAIL/);
  });

  it('treats placeholder/blank values as unset', () => {
    expect(() => loadAccount({ SKYLIGHT_EMAIL: '  ', SKYLIGHT_PASSWORD: '${user.pw}' })).toThrow(/Missing Skylight auth config/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot find `../src/config.js`.

- [ ] **Step 3: Write `src/config.ts`**

```typescript
export interface SessionAccount {
  mode: 'session';
  name: string;
  baseUrl: string;
  email: string;
  password: string;
  /** Optional explicit frame id; when unset the client discovers it. */
  frameId?: string;
}

export type Account = SessionAccount;

const DEFAULT_BASE_URL = 'https://app.ourskylight.com/api';
const NO_CONFIG = 'Missing Skylight auth config. Set SKYLIGHT_EMAIL + SKYLIGHT_PASSWORD.';

function readVar(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (t.length === 0 || t === 'undefined' || t === 'null') return undefined;
  if (/^\$\{[^}]*\}$/.test(t)) return undefined;
  return t;
}

export const NO_ENV_CONFIG_MARKER = NO_CONFIG;

export function loadAccount(env: Record<string, string | undefined> = process.env): Account {
  const email = readVar(env, 'SKYLIGHT_EMAIL');
  const password = readVar(env, 'SKYLIGHT_PASSWORD');

  if (!email && !password) throw new Error(NO_CONFIG);
  if (!email || !password) {
    const missing = email ? 'SKYLIGHT_PASSWORD' : 'SKYLIGHT_EMAIL';
    throw new Error(`Incomplete Skylight config — missing: ${missing}. Set both SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD.`);
  }

  const baseUrl = (readVar(env, 'SKYLIGHT_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  return {
    mode: 'session',
    name: readVar(env, 'SKYLIGHT_NAME') ?? email,
    baseUrl,
    email,
    password,
    frameId: readVar(env, 'SKYLIGHT_FRAME_ID'),
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/config.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts && git commit -m "feat: loadAccount env resolver"
```

---

## Task 2: `auth-session-login.ts` — OAuth2 password + refresh grants

**Files:**
- Create: `src/auth-session-login.ts`
- Test: `tests/auth-session-login.test.ts`

Two pure functions that build and POST the form-urlencoded `oauth/token` request. A `poster` callback abstracts *how* the POST goes out so the same code serves Node-direct and the fetchproxy login-proxy (the poster is injected by `auth.ts`/`client.ts`). This keeps fetchproxy out of this file (testable without mocking the bridge).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { oauthPasswordGrant, oauthRefresh, type TokenPoster } from '../src/auth-session-login.js';

const TOKEN_URL = 'https://app.ourskylight.com/api/oauth/token';

function poster(captured: any[]): TokenPoster {
  return async (url, body) => {
    captured.push({ url, body });
    return { status: 200, json: { access_token: 'AT', refresh_token: 'RT', expires_in: 604800 } };
  };
}

describe('oauthPasswordGrant', () => {
  it('POSTs a password grant and returns normalized tokens', async () => {
    const cap: any[] = [];
    const tok = await oauthPasswordGrant({ baseUrl: 'https://app.ourskylight.com/api', email: 'a@b.com', password: 'pw' }, poster(cap));
    expect(cap[0].url).toBe(TOKEN_URL);
    const params = new URLSearchParams(cap[0].body);
    expect(params.get('grant_type')).toBe('password');
    expect(params.get('username')).toBe('a@b.com');
    expect(params.get('password')).toBe('pw');
    expect(params.get('client_id')).toBe('skylight-mobile');
    expect(tok.accessToken).toBe('AT');
    expect(tok.refreshToken).toBe('RT');
    expect(tok.expiresInMs).toBe(604800 * 1000);
  });

  it('throws an actionable error on non-200', async () => {
    const failing: TokenPoster = async () => ({ status: 401, json: { error: 'invalid_grant' } });
    await expect(oauthPasswordGrant({ baseUrl: 'https://app.ourskylight.com/api', email: 'a@b.com', password: 'bad' }, failing))
      .rejects.toThrow(/Skylight login failed.*401.*invalid_grant/s);
  });
});

describe('oauthRefresh', () => {
  it('POSTs a refresh_token grant', async () => {
    const cap: any[] = [];
    const tok = await oauthRefresh({ baseUrl: 'https://app.ourskylight.com/api', refreshToken: 'RT' }, poster(cap));
    const params = new URLSearchParams(cap[0].body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('RT');
    expect(params.get('client_id')).toBe('skylight-mobile');
    expect(tok.accessToken).toBe('AT');
  });
});
```

- [ ] **Step 2: Run test, verify it fails** (`npx vitest run tests/auth-session-login.test.ts`) — module missing.

- [ ] **Step 3: Write `src/auth-session-login.ts`**

```typescript
const CLIENT_ID = 'skylight-mobile';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** ms until the access token expires (relative). */
  expiresInMs: number;
}

/** Abstracts the POST so Node-direct and fetchproxy share this builder. */
export type TokenPoster = (
  url: string,
  formBody: string,
) => Promise<{ status: number; json: unknown }>;

function tokenUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/oauth/token`;
}

function normalize(status: number, json: unknown): Tokens {
  if (status < 200 || status >= 300) {
    throw new Error(`Skylight login failed (HTTP ${status}): ${JSON.stringify(json)}`);
  }
  const j = json as Record<string, unknown>;
  const accessToken = j.access_token as string | undefined;
  const refreshToken = j.refresh_token as string | undefined;
  if (!accessToken) throw new Error(`Skylight login failed: no access_token in response ${JSON.stringify(json)}`);
  const expiresInSec = typeof j.expires_in === 'number' ? j.expires_in : 604800;
  return { accessToken, refreshToken: refreshToken ?? '', expiresInMs: expiresInSec * 1000 };
}

export async function oauthPasswordGrant(
  opts: { baseUrl: string; email: string; password: string },
  post: TokenPoster,
): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'password',
    username: opts.email,
    password: opts.password,
    client_id: CLIENT_ID,
  }).toString();
  const { status, json } = await post(tokenUrl(opts.baseUrl), body);
  return normalize(status, json);
}

export async function oauthRefresh(
  opts: { baseUrl: string; refreshToken: string },
  post: TokenPoster,
): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: CLIENT_ID,
  }).toString();
  const { status, json } = await post(tokenUrl(opts.baseUrl), body);
  return normalize(status, json);
}
```

- [ ] **Step 4: Run test, verify it passes.**

- [ ] **Step 5: Commit** (`git commit -m "feat: oauth password + refresh grant builders"`)

---

## Task 3: `client.ts` — SkylightClient (token lifecycle, frame resolution, request chokepoint)

**Files:**
- Create: `src/client.ts`
- Test: `tests/client.test.ts`

The client receives an `account`, an initial token set, and two posters: a `tokenPoster` (for refresh) and the HTTP transport for API calls (`httpFetch`, defaults to global `fetch`, injectable for tests). It exposes `request(method, path, opts)` and `resolveFrameId()`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SkylightClient } from '../src/client.js';
import type { SessionAccount } from '../src/config.js';

const account: SessionAccount = {
  mode: 'session', name: 'x', baseUrl: 'https://app.ourskylight.com/api', email: 'a@b.com', password: 'pw',
};

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe('SkylightClient.request', () => {
  it('attaches the bearer token and returns parsed JSON', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: '1' }] }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster: vi.fn() });
    const out = await c.request('GET', '/frames/3/lists');
    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe('https://app.ourskylight.com/api/frames/3/lists');
    expect((init.headers as Record<string,string>).Authorization).toBe('Bearer AT');
    expect(out).toEqual({ data: [{ id: '1' }] });
  });

  it('refreshes once on a 401 then retries', async () => {
    const httpFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: 'ok' }));
    const tokenPoster = vi.fn().mockResolvedValue({ status: 200, json: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 600 } });
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster });
    const out = await c.request('GET', '/frames/3/lists');
    expect(tokenPoster).toHaveBeenCalledOnce();
    expect((httpFetch.mock.calls[1][1].headers as Record<string,string>).Authorization).toBe('Bearer AT2');
    expect(out).toEqual({ data: 'ok' });
  });

  it('throws after a second 401', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'nope' }));
    const tokenPoster = vi.fn().mockResolvedValue({ status: 200, json: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 600 } });
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster });
    await expect(c.request('GET', '/x')).rejects.toThrow(/401/);
  });

  it('proactively refreshes when the token is near expiry', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const tokenPoster = vi.fn().mockResolvedValue({ status: 200, json: { access_token: 'FRESH', refresh_token: 'RT2', expires_in: 600 } });
    const c = new SkylightClient({ account, tokens: { accessToken: 'OLD', refreshToken: 'RT', expiresInMs: -1 }, httpFetch, tokenPoster });
    await c.request('GET', '/x');
    expect(tokenPoster).toHaveBeenCalledOnce();
    expect((httpFetch.mock.calls[0][1].headers as Record<string,string>).Authorization).toBe('Bearer FRESH');
  });
});

describe('SkylightClient.resolveFrameId', () => {
  it('returns the configured frame id without a network call', async () => {
    const httpFetch = vi.fn();
    const c = new SkylightClient({ account: { ...account, frameId: '77' }, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 9e9 }, httpFetch, tokenPoster: vi.fn() });
    expect(await c.resolveFrameId()).toBe('77');
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it('discovers the only frame from GET /frames', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: '3435252', type: 'approved_viewer_frame', attributes: { name: 'home', timezone: 'America/New_York' } }] }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 9e9 }, httpFetch, tokenPoster: vi.fn() });
    expect(await c.resolveFrameId()).toBe('3435252');
    // cached: second call makes no further request
    await c.resolveFrameId();
    expect(httpFetch).toHaveBeenCalledOnce();
  });

  it('throws listing frames when multiple and none chosen', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { data: [
      { id: '1', attributes: { name: 'A' } }, { id: '2', attributes: { name: 'B' } },
    ] }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 9e9 }, httpFetch, tokenPoster: vi.fn() });
    await expect(c.resolveFrameId()).rejects.toThrow(/multiple frames.*1 \(A\).*2 \(B\)/s);
  });
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Write `src/client.ts`**

```typescript
import type { Account } from './config.js';
import { oauthRefresh, type Tokens, type TokenPoster } from './auth-session-login.js';

export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface SkylightClientOpts {
  account: Account;
  tokens: Tokens;
  /** POST transport for the refresh grant (Node-direct or fetchproxy). */
  tokenPoster: TokenPoster;
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
  private tokenPoster: TokenPoster;
  private httpFetch: HttpFetch;
  private frameId?: string;
  private refreshInFlight?: Promise<void>;

  constructor(opts: SkylightClientOpts) {
    this.account = opts.account;
    this.accessToken = opts.tokens.accessToken;
    this.refreshToken = opts.tokens.refreshToken;
    this.expiresAt = Date.now() + opts.tokens.expiresInMs;
    this.tokenPoster = opts.tokenPoster;
    this.httpFetch = opts.httpFetch ?? ((url, init) => fetch(url, init));
    this.frameId = opts.account.frameId;
  }

  private async refresh(): Promise<void> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = (async () => {
        const tok = await oauthRefresh(
          { baseUrl: this.account.baseUrl, refreshToken: this.refreshToken },
          this.tokenPoster,
        );
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
      throw new Error(`Skylight API ${method} ${path} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
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
```

- [ ] **Step 4: Run test, verify it passes.**

- [ ] **Step 5: Commit** (`git commit -m "feat: SkylightClient token lifecycle + frame resolution"`)

---

## Task 4: `auth.ts` — resolveAuth (password → fetchproxy login-proxy)

**Files:**
- Create: `src/auth.ts`
- Test: `tests/auth.test.ts` (mocks `@fetchproxy/server` at the module boundary)

`resolveAuth()` returns `{ client, source }`. Path 1: `loadAccount()` + Node-direct `oauthPasswordGrant` with a `fetch`-based poster; if the login response looks bot-walled and fetchproxy isn't disabled, fall through to Path 2. Path 2: build a poster backed by `FetchproxyServer.postJson`/`fetch` and re-run the password grant through the browser. Both paths construct a `SkylightClient` with the chosen poster as `tokenPoster` so refreshes reuse the same channel.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const postJson = vi.fn();
const fpFetch = vi.fn();
vi.mock('@fetchproxy/server', () => ({
  FetchproxyServer: vi.fn().mockImplementation(() => ({ postJson, fetch: fpFetch, close: vi.fn() })),
  classifyBotWall: vi.fn().mockReturnValue({ isBotWall: false }),
}));

import { resolveAuth } from '../src/auth.js';

beforeEach(() => { vi.clearAllMocks(); for (const k of Object.keys(process.env)) if (k.startsWith('SKYLIGHT_')) delete process.env[k]; });

describe('resolveAuth', () => {
  it('uses the Node-direct password grant when creds are set', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    const httpPost = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 600 }), text: async () => '' });
    const { client, source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('env');
    expect(client).toBeDefined();
    expect(postJson).not.toHaveBeenCalled();
  });

  it('throws when no creds and fetchproxy disabled', async () => {
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = '1';
    await expect(resolveAuth()).rejects.toThrow(/Missing Skylight auth config/);
  });
});
```

(Add a third test for the bot-wall → fetchproxy fallback once Task 12 confirms the wall signal; stub `classifyBotWall` to return `{ isBotWall: true }` and assert `postJson` is used and `source === 'fetchproxy'`.)

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Write `src/auth.ts`**

```typescript
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
    // Partial-config errors must surface; only "nothing set" may fall through.
    if (!(e as Error).message.startsWith(NO_ENV_CONFIG_MARKER)) throw e;
    if (fetchproxyDisabled()) throw e;
    // No creds at all + fetchproxy enabled: we still need a password to log in,
    // so there is nothing fetchproxy can do without credentials. Re-throw.
    throw e;
  }

  const directPoster = nodePoster(httpFetch);
  try {
    const tokens = await oauthPasswordGrant(account, directPoster);
    return { client: makeClient(account, tokens, directPoster, httpFetch), source: 'env' };
  } catch (e) {
    if (fetchproxyDisabled() || !looksLikeBotWall(e)) throw e;
    // Escalate: route the login POST through the signed-in browser tab.
    const { poster: fpPoster } = await makeFetchproxyPoster();
    const tokens = await oauthPasswordGrant(account, fpPoster);
    return { client: makeClient(account, tokens, fpPoster, httpFetch), source: 'fetchproxy' };
  }
}

function makeClient(account: Account, tokens: Tokens, tokenPoster: TokenPoster, httpFetch: HttpFetch): SkylightClient {
  return new SkylightClient({ account, tokens, tokenPoster, httpFetch });
}

function looksLikeBotWall(e: unknown): boolean {
  // Heuristic until Task 12 confirms the real signal: 403/429/HTML challenge.
  const msg = e instanceof Error ? e.message : String(e);
  return /HTTP 403|HTTP 429|challenge|captcha|cloudflare|akamai/i.test(msg);
}

async function makeFetchproxyPoster(): Promise<{ poster: TokenPoster }> {
  const { FetchproxyServer } = await import('@fetchproxy/server');
  const server = new FetchproxyServer({
    serverName: pkg.name,
    version: pkg.version,
    domains: ['ourskylight.com'],
    capabilities: [],
  });
  const poster: TokenPoster = async (url, formBody) => {
    const res = await server.fetch({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formBody,
    });
    let json: unknown = {};
    try { json = JSON.parse((res as { body?: string }).body ?? '{}'); } catch { /* keep {} */ }
    return { status: (res as { status: number }).status, json };
  };
  return { poster };
}
```

> Note: the exact `FetchproxyServer` constructor opts and `fetch()` result shape must be reconciled against `@fetchproxy/server`'s `.d.ts` during implementation (Task 11). The poster boundary is what's mocked in tests, so the surrounding tasks don't depend on getting this exactly right first try.

- [ ] **Step 4: Run test, verify it passes.**

- [ ] **Step 5: Commit** (`git commit -m "feat: resolveAuth password grant + fetchproxy login-proxy"`)

---

## Task 5: `tools/_shared.ts` — helpers

**Files:**
- Create: `src/tools/_shared.ts`
- Test: `tests/tools/_shared.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { textContent, flattenJsonApi, isoDate } from '../../src/tools/_shared.js';

describe('_shared', () => {
  it('textContent wraps JSON', () => {
    expect(textContent({ a: 1 })).toEqual({ content: [{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }] });
  });

  it('flattenJsonApi merges id+type+attributes', () => {
    const out = flattenJsonApi({ data: [{ id: '7', type: 'list', attributes: { label: 'Groceries', color: 'red' } }] });
    expect(out).toEqual([{ id: '7', type: 'list', label: 'Groceries', color: 'red' }]);
  });

  it('flattenJsonApi handles a single resource', () => {
    expect(flattenJsonApi({ data: { id: '1', type: 'frame', attributes: { name: 'x' } } }))
      .toEqual({ id: '1', type: 'frame', name: 'x' });
  });

  it('isoDate formats a Date as YYYY-MM-DD', () => {
    expect(isoDate(new Date('2026-05-30T12:00:00Z'))).toBe('2026-05-30');
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Write `src/tools/_shared.ts`**

```typescript
export function textContent(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

interface JsonApiResource { id: string; type: string; attributes?: Record<string, unknown>; }
interface JsonApiDoc { data: JsonApiResource | JsonApiResource[]; }

function flattenOne(r: JsonApiResource) {
  return { id: r.id, type: r.type, ...(r.attributes ?? {}) };
}

export function flattenJsonApi(doc: JsonApiDoc): unknown {
  return Array.isArray(doc.data) ? doc.data.map(flattenOne) : flattenOne(doc.data);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** (`git commit -m "feat: tool shared helpers"`)

---

## Task 6: `tests/tools/_setup.ts` + `index.ts` wiring

**Files:**
- Create: `tests/tools/_setup.ts`, `src/index.ts`

- [ ] **Step 1: Write `tests/tools/_setup.ts`** (a factory the tool tests reuse)

```typescript
import { vi } from 'vitest';
import type { SkylightClient } from '../../src/client.js';

export function makeClient(overrides: Partial<Record<keyof SkylightClient, unknown>> = {}) {
  const request = vi.fn();
  const resolveFrameId = vi.fn().mockResolvedValue('3435252');
  return { client: { request, resolveFrameId, ...overrides } as unknown as SkylightClient, request, resolveFrameId };
}
```

- [ ] **Step 2: Write `src/index.ts`** (defers `resolveAuth` errors to tool-call time)

```typescript
#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveAuth } from './auth.js';
import type { SkylightClient } from './client.js';
import { registerFrameTools } from './tools/frames.js';
import { registerEventTools } from './tools/events.js';
import { registerListTools } from './tools/lists.js';
import { registerChoreTools } from './tools/chores.js';

async function main() {
  const server = new McpServer({ name: 'skylight-mcp', version: '0.1.0' });

  let client: SkylightClient | undefined;
  let configError: string | undefined;
  const getClient = async (): Promise<SkylightClient> => {
    if (client) return client;
    if (configError) throw new Error(configError);
    try {
      ({ client } = await resolveAuth());
      return client!;
    } catch (e) {
      configError = e instanceof Error ? e.message : String(e);
      throw new Error(configError);
    }
  };

  registerFrameTools(server, getClient);
  registerEventTools(server, getClient);
  registerListTools(server, getClient);
  registerChoreTools(server, getClient);

  await server.connect(new StdioServerTransport());
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Build to typecheck** (`npm run build`) — fails until tool modules exist; that's fine, return after Task 10. Do NOT commit a broken build; commit `_setup.ts` only now.

```bash
git add tests/tools/_setup.ts && git commit -m "test: tool client mock factory"
```

---

## Task 7: `tools/frames.ts`

**Files:** Create `src/tools/frames.ts`; Test `tests/tools/frames.test.ts`.

Tools and their contracts (all GET, all flatten JSON:API):

| Tool | Request |
|---|---|
| `skylight_list_frames` | `GET /frames` |
| `skylight_get_frame` | `GET /frames/{frameId}` (frameId optional → resolveFrameId) |
| `skylight_list_frame_members` | `GET /frames/{frameId}/users` |
| `skylight_list_devices` | `GET /frames/{frameId}/devices` |

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { registerFrameTools } from '../../src/tools/frames.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const server = { tool: (name: string, _desc: string, _schema: any, cb: any) => { tools[name] = cb; } } as any;
  const { client, request } = makeClient();
  registerFrameTools(server, async () => client);
  return { tools, request };
}

describe('frame tools', () => {
  it('list_frames flattens the frames doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '3435252', type: 'approved_viewer_frame', attributes: { name: 'home' } }] });
    const out = await tools.skylight_list_frames({});
    expect(request).toHaveBeenCalledWith('GET', '/frames');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '3435252', type: 'approved_viewer_frame', name: 'home' }]);
  });

  it('list_frame_members resolves the frame id then queries users', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '9', type: 'frame_user', attributes: { status: 'active', is_owner: true } }] });
    await tools.skylight_list_frame_members({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/users');
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Write `src/tools/frames.ts`**

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

export function registerFrameTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_frames', 'List Skylight frames (family hubs) on this account.', {}, async () => {
    const c = await getClient();
    return textContent(flattenJsonApi(await c.request('GET', '/frames')));
  });

  server.tool('skylight_get_frame', 'Get one Skylight frame and its settings.',
    { frameId: z.string().optional().describe('Frame id; defaults to the resolved frame.') },
    async ({ frameId }) => {
      const c = await getClient();
      const id = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${id}`)));
    });

  server.tool('skylight_list_frame_members', 'List members (frame_users) of a Skylight frame.',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const id = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${id}/users`)));
    });

  server.tool('skylight_list_devices', 'List physical devices attached to a Skylight frame.',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const id = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${id}/devices`)));
    });
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** (`git commit -m "feat: frame tools"`)

---

## Task 8: `tools/events.ts` (read + write)

**Files:** Create `src/tools/events.ts`; Test `tests/tools/events.test.ts`.

| Tool | Request |
|---|---|
| `skylight_list_events` | `GET /frames/{frame}/calendar_events?date_min&date_max&timezone&include=categories,calendar_account,event_notification_setting` |
| `skylight_get_event` | `GET /frames/{frame}/calendar_events/{id}` |
| `skylight_create_event` | `POST /frames/{frame}/calendar_events` body `{ calendar_event: {...attrs} }` (**exact envelope confirmed in Task 13**) |
| `skylight_update_event` | `PATCH /frames/{frame}/calendar_events/{id}` body `{ calendar_event: {...attrs} }` |
| `skylight_delete_event` | `DELETE /frames/{frame}/calendar_events/{id}` |
| `skylight_list_categories` | `GET /frames/{frame}/categories` |
| `skylight_list_source_calendars` | `GET /frames/{frame}/source_calendars` |

Write-tool input schema (zod): `summary` (required), `starts_at`, `ends_at` (ISO), `all_day` (bool), `description`, `location`, `timezone`, `invited_emails` (string[]), `rrule`. `update_event` adds required `id` and makes all attrs optional.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { registerEventTools } from '../../src/tools/events.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  const server = { tool: (n: string, _d: string, _s: any, cb: any) => { tools[n] = cb; } } as any;
  const { client, request } = makeClient();
  registerEventTools(server, async () => client);
  return { tools, request };
}

describe('event tools', () => {
  it('list_events passes the date range, timezone, and include', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'calendar_event', attributes: { summary: 'Soccer' } }] });
    const out = await tools.skylight_list_events({ date_min: '2026-05-01', date_max: '2026-06-01', timezone: 'America/New_York' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/calendar_events', {
      query: { date_min: '2026-05-01', date_max: '2026-06-01', timezone: 'America/New_York', include: 'categories,calendar_account,event_notification_setting' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'calendar_event', summary: 'Soccer' }]);
  });

  it('create_event posts the calendar_event envelope', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar_event', attributes: { summary: 'Dentist' } } });
    await tools.skylight_create_event({ summary: 'Dentist', starts_at: '2026-06-02T15:00:00Z', ends_at: '2026-06-02T16:00:00Z' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/calendar_events', {
      body: { calendar_event: { summary: 'Dentist', starts_at: '2026-06-02T15:00:00Z', ends_at: '2026-06-02T16:00:00Z' } },
    });
  });

  it('update_event patches by id with only provided attrs', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar_event', attributes: {} } });
    await tools.skylight_update_event({ id: '5', location: 'Office' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/calendar_events/5', { body: { calendar_event: { location: 'Office' } } });
  });

  it('delete_event deletes by id', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_event({ id: '5' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/calendar_events/5');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '5' });
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Write `src/tools/events.ts`**

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;
const INCLUDE = 'categories,calendar_account,event_notification_setting';

const eventAttrs = {
  summary: z.string().describe('Event title.'),
  starts_at: z.string().optional().describe('ISO 8601 start.'),
  ends_at: z.string().optional().describe('ISO 8601 end.'),
  all_day: z.boolean().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  timezone: z.string().optional(),
  invited_emails: z.array(z.string()).optional(),
  rrule: z.string().optional().describe('iCalendar RRULE for recurrence.'),
};

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function registerEventTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_events', 'List calendar events in a date range for a Skylight frame.', {
    date_min: z.string().describe('YYYY-MM-DD inclusive lower bound.'),
    date_max: z.string().describe('YYYY-MM-DD inclusive upper bound.'),
    timezone: z.string().optional().describe('IANA tz; defaults to the frame timezone.'),
    frameId: z.string().optional(),
  }, async ({ date_min, date_max, timezone, frameId }) => {
    const c = await getClient();
    const id = frameId ?? (await c.resolveFrameId());
    const doc = await c.request('GET', `/frames/${id}/calendar_events`, {
      query: { date_min, date_max, timezone, include: INCLUDE },
    });
    return textContent(flattenJsonApi(doc as any));
  });

  server.tool('skylight_get_event', 'Get one calendar event by id.', {
    id: z.string(), frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/calendar_events/${id}`) as any));
  });

  server.tool('skylight_create_event', 'Create a calendar event on a Skylight frame.',
    { ...eventAttrs, frameId: z.string().optional() },
    async ({ frameId, ...attrs }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('POST', `/frames/${f}/calendar_events`, { body: { calendar_event: compact(attrs) } });
      return textContent(flattenJsonApi(doc as any));
    });

  server.tool('skylight_update_event', 'Update a calendar event by id.',
    { id: z.string(), ...Object.fromEntries(Object.entries(eventAttrs).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])), frameId: z.string().optional() },
    async ({ id, frameId, ...attrs }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('PATCH', `/frames/${f}/calendar_events/${id}`, { body: { calendar_event: compact(attrs) } });
      return textContent(flattenJsonApi(doc as any));
    });

  server.tool('skylight_delete_event', 'Delete a calendar event by id.',
    { id: z.string(), frameId: z.string().optional() },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      await c.request('DELETE', `/frames/${f}/calendar_events/${id}`);
      return textContent({ deleted: id });
    });

  server.tool('skylight_list_categories', 'List calendar/chore categories for a Skylight frame.',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/categories`) as any));
    });

  server.tool('skylight_list_source_calendars', 'List linked source calendars (Google, etc.) for a frame.',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/source_calendars`) as any));
    });
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** (`git commit -m "feat: calendar event tools (read+write)"`)

---

## Task 9: `tools/lists.ts` (read + write)

**Files:** Create `src/tools/lists.ts`; Test `tests/tools/lists.test.ts`.

| Tool | Request |
|---|---|
| `skylight_list_lists` | `GET /frames/{frame}/lists` |
| `skylight_get_list_items` | `GET /frames/{frame}/lists/{listId}/list_items` |
| `skylight_create_list` | `POST /frames/{frame}/lists` body `{ list: { label, color?, kind? } }` |
| `skylight_add_list_item` | `POST /frames/{frame}/lists/{listId}/list_items` body `{ list_item: { label } }` |
| `skylight_update_list_item` | `PATCH /frames/{frame}/lists/{listId}/list_items/{itemId}` body `{ list_item: { label?, checked? } }` |
| `skylight_delete_list_item` | `DELETE /frames/{frame}/lists/{listId}/list_items/{itemId}` |

Follow the exact structure of Task 8: zod input schema, `resolveFrameId` default, `flattenJsonApi` on reads, `{ deleted }` on delete. Write the test first (mirror the events test: assert method + path + body envelope for each tool), run-fail, implement, run-pass, commit `feat: list tools (read+write)`. **Exact write envelopes (`{ list: ... }` vs `{ data: { type, attributes } }`) confirmed in Task 13.**

---

## Task 10: `tools/chores.ts` (read + write)

**Files:** Create `src/tools/chores.ts`; Test `tests/tools/chores.test.ts`.

| Tool | Request |
|---|---|
| `skylight_list_chores` | `GET /frames/{frame}/chores?after=YYYY-MM-DD&before=YYYY-MM-DD` (**both required** — schema makes `after`/`before` required strings) |
| `skylight_create_chore` | `POST /frames/{frame}/chores` body `{ chore: {...} }` (**fields + envelope confirmed in Task 13**) |
| `skylight_complete_chore` | `POST /frames/{frame}/chores/{id}/complete` OR `PATCH .../chores/{id}` `{ chore: { status: 'complete' } }` (**confirmed in Task 13**) |
| `skylight_list_rewards` | `GET /frames/{frame}/rewards?redeemed_at_min=<iso>&redeemed_at_max=<iso>` (default range: last 30 days via `isoDate`) |

Test-first as in Task 8. The `list_chores` test must assert the `after`/`before` query params are passed. Commit `feat: chore + reward tools`.

---

## Task 11: Wire `index.ts` end-to-end + build green

- [ ] **Step 1: Ensure all four `register*Tools` imports resolve.** Run `npm run build`.
Expected: `tsc` passes, `dist/bundle.js` emitted.

- [ ] **Step 2: Reconcile the `@fetchproxy/server` poster** in `auth.ts` against the real `.d.ts`:

```bash
sed -n '1,60p' node_modules/@fetchproxy/server/dist/index.d.ts | grep -iE 'class FetchproxyServer|constructor|fetch\(|FetchInit|FetchResult|classifyBotWall'
```
Adjust `makeFetchproxyPoster()` constructor opts and the `fetch()`/`postJson()` result-field access to match. Re-run `npx vitest run tests/auth.test.ts`.

- [ ] **Step 3: Full test + coverage.** Run `npm test`. Expected: all green, 100% on `src/**` (excl. `src/index.ts`). Add tests for any uncovered branch (e.g. `toolError`, `get_frame` with explicit `frameId`).

- [ ] **Step 4: Commit** (`git commit -m "feat: wire tools into index + build green"`)

---

## Task 12: Live-verify the OAuth login wire format

**Goal:** confirm the password-grant request shape against the real endpoint using the user's `.env` credentials (the only step that needs real creds). Until now everything was mocked.

- [ ] **Step 1:** Ask the user to create `.env` with `SKYLIGHT_EMAIL` and `SKYLIGHT_PASSWORD` (never paste creds into chat or commit `.env` — it's gitignored).

- [ ] **Step 2:** Run a throwaway login probe (Node, not committed):

```bash
node --env-file=.env -e '
const b=new URLSearchParams({grant_type:"password",username:process.env.SKYLIGHT_EMAIL,password:process.env.SKYLIGHT_PASSWORD,client_id:"skylight-mobile"});
fetch("https://app.ourskylight.com/api/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:b})
 .then(async r=>console.log(r.status, JSON.stringify(Object.keys(await r.json()))));'
```
Expected: `200 ["access_token","refresh_token","expires_in",...]`. If `401 invalid_client` → a `client_secret` IS required: extract it from the bundle (`grep -oE "client_secret:'[^']*'" /tmp/sky-all.js`) or capture a real login request, then add `client_secret` to `oauthPasswordGrant`/`oauthRefresh` and the `CLIENT_ID` constants. If `400` with a different field name (`email` vs `username`), adjust the body key. Update `tests/auth-session-login.test.ts` to match, keep it green.

- [ ] **Step 3:** Add the bot-wall fallback test now that the real signal is known (update `looksLikeBotWall` if the probe revealed the actual challenge shape). Commit any wire-format fixes (`fix: align oauth login body with live API`).

---

## Task 13: Live-verify write payloads (events, lists, chores)

**Goal:** confirm the request envelopes for create/update/complete by observing the web app's own POST/PATCH traffic (read-only inspection — do not invent payloads).

- [ ] **Step 1:** In the signed-in browser tab (`tabId` from `tabs_context_mcp`), instrument `fetch`/XHR to capture the next create request body, then create one event / one list item / complete one chore *in the Skylight web UI* and read back the captured `{method, url, body}`. (This is user-driven UI action + passive capture; the MCP itself performs no speculative writes.)

- [ ] **Step 2:** Reconcile each write tool's body envelope (`{ calendar_event: ... }`, `{ list: ... }`, `{ list_item: ... }`, `{ chore: ... }`) and the chore-complete verb/path against what was captured. Fix the tool + its test. Re-run `npm test`.

- [ ] **Step 3:** Determine the `chores` create field set and whether `complete` is a sub-route or a PATCH. Update `tools/chores.ts` + test. Commit (`fix: align write payloads with live Skylight API`).

---

## Task 14: Meals (conditional) + metadata + docs

- [ ] **Step 1: Meals probe.** Check the frame's `attributes.apps` (from `GET /frames`) and probe likely endpoints (`/frames/{frame}/meals`, `/meal_plans`, `/menus`) with the bearer. If a 200 endpoint exists, add `src/tools/meals.ts` (`skylight_list_meals` + writes) following Task 9's pattern with a test; register it in `index.ts`. If all 404, **omit meals** and note it in the README. Commit accordingly.

- [ ] **Step 2: `version-sync.test.ts`** — copy from the template and adapt to assert `0.1.0` across `package.json`, `src/index.ts` (`McpServer` version), `manifest.json`, `server.json`.

```bash
cp /Users/chris/git/signupgenius-mcp/tests/version-sync.test.ts tests/version-sync.test.ts
# edit paths/names, run:
npx vitest run tests/version-sync.test.ts
```

- [ ] **Step 3: Fill `manifest.json` tools list + `server.json`** with the final tool names. Verify `jq -r '.description|length' server.json` ≤ 100.

- [ ] **Step 4: Write `README.md` and `CLAUDE.md`** modeled on the template: TL;DR, the two auth paths (password primary, fetchproxy login-proxy fallback, no token mode), the frame model, the tool table, the "no env vars → clean start" guarantee, and the PR/release conventions. Note meals' status (implemented or omitted).

- [ ] **Step 5: Final build + test.** `npm run build && npm test` — green, 100% coverage. Commit (`docs: README + CLAUDE.md; chore: finalize metadata`).

---

## Task 15: Open the PR

- [ ] **Step 1:** Create the GitHub repo `chrischall/skylight-mcp` (the user does this, or `gh repo create`). Push `main` with the scaffold, then do feature work on a branch.

> Per the family conventions and the user's standing instruction: **do not self-merge.** Open the PR with one release-notes label (`enhancement`); auto-review arms `ready-to-merge`. If the verdict is `warn`/`fail`, surface findings and ask before overriding.

- [ ] **Step 2:** `gh pr create --label enhancement --title "feat: Skylight Calendar MCP (events, chores, lists)"` once tests pass and live verification (Tasks 12–13) is green.

---

## Self-review notes (spec coverage)

- All four spec surfaces covered: events (Task 8), chores+rewards (Task 10), lists (Task 9), meals (Task 14, conditional per spec).
- Auth: password primary + fetchproxy login-proxy + no-token (Tasks 2–4, 12); `SKYLIGHT_DISABLE_FETCHPROXY` honored; deferred `configError` start (Task 6).
- Token lifecycle: proactive + reactive refresh, de-dup (Task 3).
- Frame resolution incl. multi-frame error (Task 3, 7).
- TDD + 100% coverage gate enforced throughout; writes need no CSRF (bearer API).
- Live-recon open items from the spec are resolved in Tasks 12–14 (login format, chore params already known = `after`/`before`, write payloads, meals existence, frames shape already known).
