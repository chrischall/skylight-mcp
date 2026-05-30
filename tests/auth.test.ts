import { describe, it, expect, vi, beforeEach } from 'vitest';

const fpFetch = vi.fn();
const fpClose = vi.fn().mockResolvedValue(undefined);

// FetchproxyServer must be a proper class/constructor to work with `new`.
class MockFetchproxyServer {
  fetch = fpFetch;
  close = fpClose;
}

vi.mock('@fetchproxy/server', () => ({
  FetchproxyServer: MockFetchproxyServer,
}));

import { resolveAuth } from '../src/auth.js';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(process.env)) if (k.startsWith('SKYLIGHT_')) delete process.env[k];
});

// Helpers
const GOOD_TOKENS = { access_token: 'AT', refresh_token: 'RT', expires_in: 600 };
const GOOD_200 = { status: 200, json: async () => GOOD_TOKENS, text: async () => '' };
const BAD_403 = { status: 403, json: async () => ({ error: 'forbidden' }), text: async () => 'forbidden' };
const BAD_401 = { status: 401, json: async () => ({ error: 'invalid_grant' }), text: async () => 'invalid_grant' };

describe('resolveAuth', () => {
  // --- Base tests from the plan scaffold ---

  it('uses the Node-direct password grant when creds are set', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    const httpPost = vi.fn().mockResolvedValue(GOOD_200);
    const { client, source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('env');
    expect(client).toBeDefined();
    expect(fpFetch).not.toHaveBeenCalled();
  });

  it('throws when no creds and fetchproxy disabled', async () => {
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = '1';
    await expect(resolveAuth()).rejects.toThrow(/Missing Skylight auth config/);
  });

  // --- Coverage expansion tests ---

  // Test 1: Bot-wall fallback to fetchproxy (Path 2 + makeFetchproxyPoster + looksLikeBotWall true)
  it('falls back to fetchproxy poster when direct login returns HTTP 403 (bot-wall)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    // Direct POST returns 403 → oauthPasswordGrant throws "Skylight login failed (HTTP 403)"
    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    // FetchproxyServer.fetch returns a successful token response
    fpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(GOOD_TOKENS),
      url: 'https://app.ourskylight.com/api/oauth/token',
    });

    const { client, source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('fetchproxy');
    expect(client).toBeDefined();
    expect(fpFetch).toHaveBeenCalled();
    // Fix 1: close() must be called after a successful fetchproxy login
    expect(fpClose).toHaveBeenCalledTimes(1);
  });

  // Test 1b: fetchproxy grant throws → close() must still be called (finally branch)
  it('calls close() on the fetchproxy server even when the fetchproxy grant fails', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    // Direct POST returns 403 → triggers bot-wall fallback
    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    // fpFetch returns 403 → oauthPasswordGrant inside makeFetchproxyPoster throws
    fpFetch.mockResolvedValue({
      ok: true,
      status: 403,
      body: JSON.stringify({ error: 'forbidden' }),
      url: 'https://app.ourskylight.com/api/oauth/token',
    });

    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/fetchproxy fallback also failed/);
    // close() must be called even when the grant threw
    expect(fpClose).toHaveBeenCalledTimes(1);
  });

  // Test 2: Bot-wall but fetchproxy disabled → should throw HTTP 403, NOT call fpFetch
  it('throws bot-wall error when fetchproxy is disabled (SKYLIGHT_DISABLE_FETCHPROXY=1)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = '1';

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/HTTP 403/);
    expect(fpFetch).not.toHaveBeenCalled();
  });

  // Test 3: Non-bot-wall login failure → throw original error, fetchproxy NOT used
  it('throws non-bot-wall login error without falling back to fetchproxy', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    const httpPost = vi.fn().mockResolvedValue(BAD_401);
    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/HTTP 401/);
    expect(fpFetch).not.toHaveBeenCalled();
  });

  // Test 4: Partial-config error (only SKYLIGHT_EMAIL set) → should throw with SKYLIGHT_PASSWORD
  it('throws with SKYLIGHT_PASSWORD info when only email is set (partial config)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    // SKYLIGHT_PASSWORD intentionally not set
    await expect(resolveAuth()).rejects.toThrow(/SKYLIGHT_PASSWORD/);
  });

  // Test 5: No creds at all, fetchproxy NOT disabled → throws Missing Skylight auth config
  // (loadAccount throws before fetchproxy is even considered — credentials are always required)
  it('throws missing-config error when no creds and fetchproxy is not disabled', async () => {
    // No SKYLIGHT_EMAIL, no SKYLIGHT_PASSWORD, no SKYLIGHT_DISABLE_FETCHPROXY
    await expect(resolveAuth()).rejects.toThrow(/Missing Skylight auth config/);
    expect(fpFetch).not.toHaveBeenCalled();
  });

  // Test 6: JSON.parse catch in makeFetchproxyPoster — fpFetch returns non-JSON body
  it('surfaces login failure when fetchproxy poster receives non-JSON body', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    // Direct POST returns 403 to trigger bot-wall fallback
    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    // fpFetch returns non-JSON body → JSON.parse catch branch fires → json stays {}
    // oauthPasswordGrant then throws because there's no access_token
    fpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: 'not-valid-json!!!',
      url: 'https://app.ourskylight.com/api/oauth/token',
    });

    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/no access_token/);
    expect(fpFetch).toHaveBeenCalled();
  });

  // Test 7a: readEnv placeholder branch — must call fetchproxyDisabled() to exercise line 15
  // Use 403 to trigger the catch block where fetchproxyDisabled() is evaluated
  it('treats SKYLIGHT_DISABLE_FETCHPROXY placeholder value as not-disabled (falls back to fetchproxy on 403)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = '${SKYLIGHT_DISABLE_FETCHPROXY}';

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    fpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(GOOD_TOKENS),
      url: 'https://app.ourskylight.com/api/oauth/token',
    });
    // Placeholder treated as absent → not disabled → fetchproxy fallback used
    const { source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('fetchproxy');
  });

  // Test 7b: SKYLIGHT_DISABLE_FETCHPROXY='true' (word form) + creds + 403 bot-wall →
  // should throw HTTP 403 and NOT fall back to fetchproxy (exercises the
  // `fetchproxyDisabled()` short-circuit WITH credentials present)
  it('treats SKYLIGHT_DISABLE_FETCHPROXY=true as disabled (creds+403, no fetchproxy fallback)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = 'true';

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/HTTP 403/);
    expect(fpFetch).not.toHaveBeenCalled();
  });

  // Test 7c: SKYLIGHT_DISABLE_FETCHPROXY='yes' is treated as disabled
  it('treats SKYLIGHT_DISABLE_FETCHPROXY=yes as disabled', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = 'yes';

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/HTTP 403/);
    expect(fpFetch).not.toHaveBeenCalled();
  });

  // Test 7d: SKYLIGHT_DISABLE_FETCHPROXY='on' is treated as disabled
  it('treats SKYLIGHT_DISABLE_FETCHPROXY=on as disabled', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = 'on';

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/HTTP 403/);
    expect(fpFetch).not.toHaveBeenCalled();
  });

  // Test 7e: readEnv 'null' branch — must reach fetchproxyDisabled() (via 403 bot-wall)
  // so that readEnv actually evaluates line 15 with t='null'
  it('treats SKYLIGHT_DISABLE_FETCHPROXY=null as not-disabled (falls back to fetchproxy on 403)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = 'null'; // treated as unset → not-disabled

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    fpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(GOOD_TOKENS),
      url: 'https://app.ourskylight.com/api/oauth/token',
    });
    // 'null' → readEnv returns undefined → fetchproxyDisabled() returns false → fallback to fetchproxy
    const { source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('fetchproxy');
  });

  // Test 7f: readEnv 'undefined' branch — same setup, t='undefined' triggers the condition
  it('treats SKYLIGHT_DISABLE_FETCHPROXY=undefined as not-disabled (falls back to fetchproxy on 403)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = 'undefined'; // treated as unset → not-disabled

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    fpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(GOOD_TOKENS),
      url: 'https://app.ourskylight.com/api/oauth/token',
    });
    // 'undefined' → readEnv returns undefined → fetchproxyDisabled() returns false → fallback
    const { source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('fetchproxy');
  });

  // Test for looksLikeBotWall with HTTP 429 Error (covers Error instance branch of looksLikeBotWall)
  it('looksLikeBotWall recognizes HTTP 429 via an Error instance — falls back to fetchproxy', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    // Make the poster throw a plain string (non-Error) containing "HTTP 429"
    // by making httpFetch resolve with a 429 status — oauthPasswordGrant throws an Error
    // Alternatively, verify via the 429 path:
    const httpPost = vi.fn().mockResolvedValue({
      status: 429,
      json: async () => ({ error: 'rate_limited' }),
      text: async () => 'rate limited',
    });
    fpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(GOOD_TOKENS),
      url: 'https://app.ourskylight.com/api/oauth/token',
    });

    const { source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('fetchproxy');
  });

  // Test for nodePoster res.json() rejection (covers the .catch(() => ({})) branch)
  it('handles json() rejection in nodePoster by falling back to empty object', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    // Return a response where .json() throws — the catch returns {}
    // Then oauthPasswordGrant sees status=200 but empty json → throws "no access_token"
    const httpPost = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => { throw new Error('not JSON'); },
      text: async () => '',
    });
    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/no access_token/);
  });

  // Test for looksLikeBotWall with a non-Error thrown value (covers String(e) branch)
  it('looksLikeBotWall handles non-Error thrown value via String(e)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    // Make httpFetch throw a non-Error object (plain string with bot-wall keyword)
    // nodePoster doesn't catch, so oauthPasswordGrant propagates the throw.
    // looksLikeBotWall then calls String(e) since it's not an Error instance.
    const httpPost = vi.fn().mockRejectedValue('HTTP 403 forbidden');
    fpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(GOOD_TOKENS),
      url: 'https://app.ourskylight.com/api/oauth/token',
    });
    const { source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('fetchproxy');
    expect(fpFetch).toHaveBeenCalled();
  });

  // readEnv with empty-string value: !t branch (t = '' after trim → !t is true)
  // Must trigger fetchproxyDisabled() via 403 so readEnv is actually called
  it('treats SKYLIGHT_DISABLE_FETCHPROXY="" (empty) as not-disabled (falls back to fetchproxy on 403)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = '';

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    fpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(GOOD_TOKENS),
      url: 'https://app.ourskylight.com/api/oauth/token',
    });
    // empty string → readEnv returns undefined → not disabled → fetchproxy fallback
    const { source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('fetchproxy');
  });

  // makeFetchproxyPoster body ?? '{}' branch: fpFetch returns no body field
  it('handles undefined body in fetchproxy response (body ?? "{}" branch)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    // Return a response with no body field → body ?? '{}' → JSON.parse('{}') → {} → no access_token
    fpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://app.ourskylight.com/api/oauth/token',
      // body intentionally absent
    });
    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/no access_token/);
    expect(fpFetch).toHaveBeenCalled();
  });

  // Test for fetchproxy bridge ok:false path — exercises line 95 throw in makeFetchproxyPoster
  it('throws fetchproxy bridge error when fpFetch returns ok:false', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    // Simulate a bridge-level failure (no signed-in tab, extension offline, etc.)
    fpFetch.mockResolvedValue({ ok: false, error: 'no signed-in tab', kind: 'bridge_down' });

    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/fetchproxy bridge error/);
    expect(fpFetch).toHaveBeenCalled();
  });

  // Fix 3.1: Refresh-channel identity — prove the env-path client's tokenPoster
  // is the NODE poster (httpFetch), not fpFetch.
  // Strategy: login returns expires_in:0 → expiresInMs=0 → token is immediately
  // near-expiry → first client.request() triggers a refresh through tokenPoster.
  // Assert the refresh went via httpFetch (node channel), NOT fpFetch.
  it('env-path client refreshes tokens through the Node poster, not fetchproxy', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    let callIndex = 0;
    const httpPost = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      callIndex++;
      const body = typeof init.body === 'string' ? init.body : '';
      if (callIndex === 1) {
        // Call 1: password grant login — return expires_in:0 so token is immediately stale
        return {
          status: 200,
          json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 0 }),
          text: async () => '',
        };
      }
      if (body.includes('grant_type=refresh_token')) {
        // Call 2: refresh grant — return a fresh token
        return {
          status: 200,
          json: async () => ({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 600 }),
          text: async () => '',
        };
      }
      // Call 3: API GET /x — return success
      return {
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '{"ok":true}',
      };
    });

    const { client, source } = await resolveAuth({ httpFetch: httpPost });
    expect(source).toBe('env');

    // Force a refresh by triggering an API call — expires_in:0 makes the token stale immediately
    const result = await client.request('GET', '/x');
    expect(result).toEqual({ ok: true });

    // The refresh went through httpPost (node channel), NOT fpFetch
    expect(fpFetch).not.toHaveBeenCalled();
    // At least the login + refresh calls happened via httpPost
    expect(httpPost.mock.calls.length).toBeGreaterThanOrEqual(2);
    // The second call (after login) must have been a refresh_token grant
    const refreshCallBody = httpPost.mock.calls.find(([, i]) =>
      typeof (i as RequestInit).body === 'string' &&
      ((i as RequestInit).body as string).includes('grant_type=refresh_token'),
    );
    expect(refreshCallBody).toBeDefined();
  });

  // Fix 3a: Combined error message when both direct and fetchproxy paths fail (Error instance branch)
  it('wraps fetchproxy-path Error failure with a combined context message (Error instance branch)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    // Direct POST returns 403 → bot-wall fallback triggered
    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    // fpFetch also returns 403 → oauthPasswordGrant throws "Skylight login failed (HTTP 403)"
    fpFetch.mockResolvedValue({
      ok: true,
      status: 403,
      body: JSON.stringify({ error: 'forbidden' }),
      url: 'https://app.ourskylight.com/api/oauth/token',
    });

    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(
      /Skylight login failed via the direct path and the fetchproxy fallback also failed/,
    );
  });

  // Fix 3b: Combined error message — non-Error thrown by fetchproxy (covers String(fpErr) branch)
  it('wraps fetchproxy-path non-Error failure with String(fpErr) in the combined context message', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    // Direct POST returns 403 → bot-wall fallback triggered
    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    // fpFetch throws a plain string (non-Error), bypassing the poster's typed path
    fpFetch.mockRejectedValue('extension offline');

    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(
      /fetchproxy fallback also failed: extension offline/,
    );
    // close() must still have been called in the finally block
    expect(fpClose).toHaveBeenCalledTimes(1);
  });

  // Fix 4: Cross-module error-format coupling — verify 403 from oauthPasswordGrant
  // matches the /HTTP 403/ pattern that looksLikeBotWall relies on.
  // A future format change in normalize() will break this test before silently
  // disabling the bot-wall fallback.
  it('oauthPasswordGrant rejects with a message matching /HTTP 403/ on a 403 response (looksLikeBotWall coupling)', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';
    process.env.SKYLIGHT_DISABLE_FETCHPROXY = '1';

    const httpPost = vi.fn().mockResolvedValue(BAD_403);
    // With fetchproxy disabled, the 403 error propagates directly
    await expect(resolveAuth({ httpFetch: httpPost })).rejects.toThrow(/HTTP 403/);
  });

  // Test 8: Default httpFetch fallback via vi.stubGlobal (covers the ?? branch)
  it('uses global fetch as the default httpFetch when none is provided', async () => {
    process.env.SKYLIGHT_EMAIL = 'a@b.com';
    process.env.SKYLIGHT_PASSWORD = 'pw';

    const globalFetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => GOOD_TOKENS,
      text: async () => '',
    });
    vi.stubGlobal('fetch', globalFetchMock);
    try {
      const { source } = await resolveAuth(); // no httpFetch → uses global fetch
      expect(source).toBe('env');
      expect(globalFetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
