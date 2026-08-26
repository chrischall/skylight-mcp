import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock auth-session-login at the module boundary.
// vi.mock is hoisted — use vi.fn() inside the factory so the mocks are
// created at hoist time, not at variable declaration time.
vi.mock('../src/auth-session-login.js', () => ({
  login: vi.fn(),
  refresh: vi.fn(),
}));

// Import the mocks AFTER vi.mock so we get the mocked versions.
import { login as mockLoginImport, refresh as mockRefreshImport } from '../src/auth-session-login.js';
import { resolveAuth } from '../src/auth.js';

const mockLogin = mockLoginImport as ReturnType<typeof vi.fn>;
const mockRefresh = mockRefreshImport as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(process.env)) if (k.startsWith('SKYLIGHT_')) delete process.env[k];
  delete process.env.MCP_DATA_DIR;
});

const GOOD_TOKENS = { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 600_000 };

/** A minimal 200 JSON response, enough to drive one client.request(). */
function okResponse(): Response {
  return {
    status: 200,
    ok: true,
    headers: { get: () => 'application/json' },
    text: async () => '{"ok":true}',
    json: async () => ({ ok: true }),
  } as unknown as Response;
}

// Every resolveAuth() here passes `persistence: null`. Two reasons: the default
// would read and write the developer's real ~/.skylight-mcp/tokens.json, making
// the suite non-hermetic and order-dependent; and these cases are about WHEN the
// login runs, which the token cache would otherwise skip entirely. The cache
// itself is covered in its own describe block below and in token-store.test.ts.
const noCache = { persistence: null } as const;

describe('resolveAuth', () => {
  it('returns a client with source=env when login succeeds', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    const { client, source } = await resolveAuth({ ...noCache, httpFetch });
    expect(source).toBe('env');
    expect(client).toBeDefined();
    // The login is LAZY now — constructing the client must not spend one against
    // an endpoint that rate-limits.
    expect(mockLogin).not.toHaveBeenCalled();

    await client.request('GET', '/frames');
    expect(mockLogin).toHaveBeenCalledOnce();
    expect(mockLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.com', password: 'pw' }),
      expect.anything(),
    );
  });

  it('mints from a supplied refresh token and never touches the login endpoint', async () => {
    // The point of path 1: a consumer who holds a token should not have to give
    // up a password, AND the rate-limited login endpoint stays untouched on a
    // cold start — which on a scale-to-zero host is every start.
    process.env.SKYLIGHT_REFRESH_TOKEN = 'SUPPLIED_RT';
    mockRefresh.mockResolvedValue(GOOD_TOKENS);

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    const { client } = await resolveAuth({ ...noCache, httpFetch });
    await client.request('GET', '/frames');

    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'SUPPLIED_RT' }),
      expect.anything(),
    );
  });

  it('tells a token-only deployment the token is stale, not that it is unconfigured', async () => {
    // The lesson from untappd-mcp#140: a SUPPLIED credential that goes stale
    // must not be reported as a missing one. There is no login pair here, so
    // nothing can recover it automatically — say so, and name the variable.
    process.env.SKYLIGHT_REFRESH_TOKEN = 'STALE_RT';
    mockRefresh.mockRejectedValue(new Error('invalid_grant'));

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    const { client } = await resolveAuth({ ...noCache, httpFetch });
    const err = await client.request('GET', '/frames').catch((e: Error) => e);

    expect(String(err)).toMatch(/SKYLIGHT_REFRESH_TOKEN/);
    expect(String(err)).toMatch(/expired|revoked|no longer/i);
    expect(String(err)).not.toMatch(/Missing Skylight auth config/);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('falls back to the login when a supplied token is stale AND a password exists', async () => {
    // Both configured means the operator asked for recovery: use the narrow
    // credential first, fall back to the broad one rather than failing.
    process.env.SKYLIGHT_REFRESH_TOKEN = 'STALE_RT';
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockRefresh.mockRejectedValue(new Error('invalid_grant'));
    mockLogin.mockResolvedValue(GOOD_TOKENS);

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    const { client } = await resolveAuth({ ...noCache, httpFetch });
    await client.request('GET', '/frames');

    expect(mockRefresh).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledOnce();
  });

  it('logs in once for a burst of concurrent first requests', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    const { client } = await resolveAuth({ ...noCache, httpFetch });
    await Promise.all([
      client.request('GET', '/a'),
      client.request('GET', '/b'),
      client.request('GET', '/c'),
    ]);
    expect(mockLogin).toHaveBeenCalledOnce();
  });

  it('passes the injected httpFetch to login', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    const { client } = await resolveAuth({ ...noCache, httpFetch });
    await client.request('GET', '/frames');
    expect(mockLogin).toHaveBeenCalledWith(
      expect.anything(),
      httpFetch,
    );
  });

  it('throws when login fails with an actionable error', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockRejectedValue(
      new Error('Skylight login failed — check SKYLIGHT_EMAIL/SKYLIGHT_PASSWORD'),
    );

    // Deferred with the login itself: resolveAuth no longer performs it, so the
    // actionable error arrives on the first request instead of at construction.
    const { client } = await resolveAuth(noCache);
    await expect(client.request('GET', '/frames')).rejects.toThrow(/Skylight login failed/);
  });

  it('throws when no credentials are configured', async () => {
    await expect(resolveAuth(noCache)).rejects.toThrow(/Missing Skylight auth config/);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('throws on partial config (email only)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    await expect(resolveAuth(noCache)).rejects.toThrow(/SKYLIGHT_PASSWORD/);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('uses global fetch as default httpFetch — invokes it via the client', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);

    const globalFetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: [] }),
      text: async () => '{"data":[]}',
    });
    vi.stubGlobal('fetch', globalFetchMock);
    try {
      const { source, client } = await resolveAuth(noCache); // no httpFetch → uses defaultFetch
      expect(source).toBe('env');
      // Actually invoke the client so defaultFetch body is exercised
      await client.request('GET', '/frames');
      expect(globalFetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('constructs the client with refreshFn that calls refresh()', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    // Token expires immediately so first request triggers proactive refresh
    mockLogin.mockResolvedValue({ accessToken: 'AT', refreshToken: 'RT', expiresInMs: 0 });
    mockRefresh.mockResolvedValue({ accessToken: 'AT2', refreshToken: 'RT2', expiresInMs: 600_000 });

    const apiResponse = {
      status: 200,
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => '{"ok":true}',
      json: async () => ({ ok: true }),
    } as unknown as Response;

    const httpFetch = vi.fn().mockResolvedValue(apiResponse);
    const { client } = await resolveAuth({ ...noCache, httpFetch });

    // Trigger a request — expired token → proactive refresh → then API call
    const result = await client.request('GET', '/x');
    expect(result).toEqual({ ok: true });
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(mockRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'RT' }),
      httpFetch,
    );
  });

  it('includes authBaseUrl in the login call', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    const { client } = await resolveAuth({ ...noCache, httpFetch });
    await client.request('GET', '/frames');
    expect(mockLogin).toHaveBeenCalledWith(
      expect.objectContaining({ authBaseUrl: 'https://app.ourskylight.com' }),
      expect.anything(),
    );
  });
});

describe('resolveAuth token cache', () => {
  function fakeStore(seed: unknown = null) {
    const api = {
      value: seed,
      load: () => api.value,
      save: (v: unknown) => {
        api.value = v;
      },
      clear: () => {
        api.value = null;
      },
    };
    return api;
  }

  it('reports a failed write to stderr without failing the request', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const httpFetch = vi.fn().mockResolvedValue(okResponse());
      const { client } = await resolveAuth({
        httpFetch,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        persistence: {
          load: () => null,
          save: () => {
            throw new Error('EROFS');
          },
        } as any,
      });
      // The token is valid in this process; only the next start pays for it.
      await expect(client.request('GET', '/frames')).resolves.toBeDefined();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not cache/i));
    } finally {
      warn.mockRestore();
    }
  });

  it('uses the on-disk cache by default, under MCP_DATA_DIR', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);
    // Point the default store at a temp dir. This is the ONE case that exercises
    // the real createTokenPersistence() wiring end-to-end; every other case
    // passes persistence explicitly so the suite never touches the real $HOME.
    const dir = mkdtempSync(join(tmpdir(), 'skylight-auth-'));
    process.env.MCP_DATA_DIR = dir;
    try {
      const httpFetch = vi.fn().mockResolvedValue(okResponse());
      const { client } = await resolveAuth({ httpFetch }); // no persistence override
      await client.request('GET', '/frames');

      const file = join(dir, '.skylight-mcp', 'tokens.json');
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8')).state).toEqual(
        expect.objectContaining({ accessToken: 'AT', refreshToken: 'RT' }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.MCP_DATA_DIR;
    }
  });

  it('binds the default on-disk cache to a supplied refresh token', async () => {
    // The token arm of the same default-persistence wiring: with no login pair
    // there is no email/password to bind to, so the binding must come from the
    // supplied token instead.
    process.env.SKYLIGHT_REFRESH_TOKEN = 'SUPPLIED_RT';
    mockRefresh.mockResolvedValue(GOOD_TOKENS);
    const dir = mkdtempSync(join(tmpdir(), 'skylight-auth-rt-'));
    process.env.MCP_DATA_DIR = dir;
    try {
      const httpFetch = vi.fn().mockResolvedValue(okResponse());
      const { client } = await resolveAuth({ httpFetch }); // no persistence override
      await client.request('GET', '/frames');

      const file = join(dir, '.skylight-mcp', 'tokens.json');
      expect(existsSync(file)).toBe(true);
      // The supplied token is the BINDING, never the payload — it must not
      // reach the file.
      expect(readFileSync(file, 'utf8')).not.toContain('SUPPLIED_RT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.MCP_DATA_DIR;
    }
  });

  it('reports a non-Error rejection from the refresh grant without losing it', async () => {
    // Nothing guarantees a rejection is an Error. Stringifying whatever came
    // back keeps the upstream detail in the message instead of "[object
    // Object]" or a silently empty cause.
    process.env.SKYLIGHT_REFRESH_TOKEN = 'STALE_RT';
    mockRefresh.mockRejectedValue('invalid_grant: token revoked');

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    const { client } = await resolveAuth({ ...noCache, httpFetch });
    const err = await client.request('GET', '/frames').catch((e: Error) => e);

    expect(String(err)).toMatch(/SKYLIGHT_REFRESH_TOKEN/);
    expect(String(err)).toMatch(/invalid_grant: token revoked/);
  });

  it('skips the login entirely when a cached token is still valid', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    const store = fakeStore({ accessToken: 'CACHED', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 });

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { client } = await resolveAuth({ httpFetch, persistence: store as any });
    await client.request('GET', '/frames');

    expect(mockLogin).not.toHaveBeenCalled();
    const [, init] = httpFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer CACHED');
  });

  it('persists the tokens a fresh login mints', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);
    const store = fakeStore(null);

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { client } = await resolveAuth({ httpFetch, persistence: store as any });
    await client.request('GET', '/frames');

    expect(store.value).toEqual(
      expect.objectContaining({ accessToken: 'AT', refreshToken: 'RT' }),
    );
    // Absolute, not the relative expiresInMs — the next process must be able to
    // tell how much life is actually left.
    expect((store.value as { expiresAt: number }).expiresAt).toBeGreaterThan(Date.now());
  });

  it('falls back to a login when the cached token is expired and unrefreshable', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);
    const store = fakeStore({ accessToken: 'OLD', expiresAt: Date.now() - 1 }); // no refreshToken

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { client } = await resolveAuth({ httpFetch, persistence: store as any });
    await client.request('GET', '/frames');

    expect(mockLogin).toHaveBeenCalledOnce();
  });

  it('refreshes an expired cached token instead of logging in again', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockRefresh.mockResolvedValue({ accessToken: 'AT2', refreshToken: 'RT2', expiresInMs: 600_000 });
    const store = fakeStore({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: Date.now() - 1 });

    const httpFetch = vi.fn().mockResolvedValue(okResponse());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { client } = await resolveAuth({ httpFetch, persistence: store as any });
    await client.request('GET', '/frames');

    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(mockLogin).not.toHaveBeenCalled(); // a refresh is cheap; a login is not
    expect(store.value).toEqual(expect.objectContaining({ accessToken: 'AT2' }));
  });
});
