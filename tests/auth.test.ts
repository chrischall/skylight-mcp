import { describe, it, expect, vi, beforeEach } from 'vitest';

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
});

const GOOD_TOKENS = { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 600_000 };

describe('resolveAuth', () => {
  it('returns a client with source=env when login succeeds', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);

    const { client, source } = await resolveAuth();
    expect(source).toBe('env');
    expect(client).toBeDefined();
    expect(mockLogin).toHaveBeenCalledOnce();
    expect(mockLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.com', password: 'pw' }),
      expect.anything(),
    );
  });

  it('passes the injected httpFetch to login', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    mockLogin.mockResolvedValue(GOOD_TOKENS);

    const httpFetch = vi.fn();
    await resolveAuth({ httpFetch });
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

    await expect(resolveAuth()).rejects.toThrow(/Skylight login failed/);
  });

  it('throws when no credentials are configured', async () => {
    await expect(resolveAuth()).rejects.toThrow(/Missing Skylight auth config/);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('throws on partial config (email only)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    await expect(resolveAuth()).rejects.toThrow(/SKYLIGHT_PASSWORD/);
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
      const { source, client } = await resolveAuth(); // no httpFetch → uses defaultFetch
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
    const { client } = await resolveAuth({ httpFetch });

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

    await resolveAuth();
    expect(mockLogin).toHaveBeenCalledWith(
      expect.objectContaining({ authBaseUrl: 'https://app.ourskylight.com' }),
      expect.anything(),
    );
  });
});
