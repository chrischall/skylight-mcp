import { describe, it, expect, vi } from 'vitest';
import { login, refresh, type HttpFetch } from '../src/auth-session-login.js';

const AUTH_BASE = 'https://app.ourskylight.com';

// ---------------------------------------------------------------------------
// Helpers for building mock responses
// ---------------------------------------------------------------------------

function htmlResponse(html: string, cookies: string[] = []): Response {
  return {
    status: 200,
    ok: true,
    headers: {
      get: (key: string) => key.toLowerCase() === 'location' ? null : null,
      getSetCookie: () => cookies,
    },
    text: async () => html,
    json: async () => { throw new Error('not JSON'); },
  } as unknown as Response;
}

function redirectResponse(location: string, cookies: string[] = []): Response {
  return {
    status: 302,
    ok: false,
    headers: {
      get: (key: string) => key.toLowerCase() === 'location' ? location : null,
      getSetCookie: () => cookies,
    },
    text: async () => '',
    json: async () => { throw new Error('not JSON'); },
  } as unknown as Response;
}

function jsonResponse(status: number, body: unknown, cookies: string[] = []): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (key: string) => key.toLowerCase() === 'location' ? null : null,
      getSetCookie: () => cookies,
    },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const TOKEN_BODY = { access_token: 'AT', refresh_token: 'RT', expires_in: 604800, token_type: 'Bearer', created_at: 0 };

// ---------------------------------------------------------------------------
// The happy-path 4-step mock sequence
// ---------------------------------------------------------------------------
function makeHappyFetch(opts: {
  authTokenInHtml?: string;
  step2Location?: string;
  step3Location?: string;
  cookies?: string[];
}): HttpFetch {
  const {
    authTokenInHtml = 'CSRF123',
    step2Location = `${AUTH_BASE}/auth/session/success`,
    step3Location = 'https://ourskylight.com/welcome?code=MYCODE',
    cookies = ['_skylight_cloud_session=abc123; Path=/; HttpOnly'],
  } = opts;

  const html = `<input name="authenticity_token" value="${authTokenInHtml}">`;
  let callIndex = 0;
  return vi.fn().mockImplementation(async (url: string) => {
    callIndex++;
    if (callIndex === 1) {
      // Step 1: GET /auth/session/new
      expect(url).toContain('/auth/session/new');
      return htmlResponse(html, cookies);
    }
    if (callIndex === 2) {
      // Step 2: POST /auth/session
      expect(url).toContain('/auth/session');
      return redirectResponse(step2Location, []);
    }
    if (callIndex === 3) {
      // Step 3: GET /oauth/authorize
      expect(url).toContain('/oauth/authorize');
      return redirectResponse(step3Location, []);
    }
    // Step 4: POST /oauth/token
    expect(url).toContain('/oauth/token');
    return jsonResponse(200, TOKEN_BODY);
  });
}

// ---------------------------------------------------------------------------
// login() tests
// ---------------------------------------------------------------------------

describe('login', () => {
  it('returns tokens on the happy path', async () => {
    const httpFetch = makeHappyFetch({});
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    expect(tokens.accessToken).toBe('AT');
    expect(tokens.refreshToken).toBe('RT');
    expect(tokens.expiresInMs).toBe(604800 * 1000);
    expect(httpFetch).toHaveBeenCalledTimes(4);
  });

  it('accepts a custom deviceFingerprint', async () => {
    const httpFetch = makeHappyFetch({});
    const tokens = await login(
      { authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw', deviceFingerprint: 'MY-UUID' },
      httpFetch,
    );
    expect(tokens.accessToken).toBe('AT');
    // Verify step 4 body included the fingerprint — check httpFetch call args
    const calls = (httpFetch as ReturnType<typeof vi.fn>).mock.calls;
    const step4 = calls[3]; // 0-indexed 4th call
    const body = step4[1]?.body as string;
    expect(body).toContain('MY-UUID');
  });

  it('generates a UUID fingerprint when not supplied', async () => {
    const httpFetch = makeHappyFetch({});
    await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    const calls = (httpFetch as ReturnType<typeof vi.fn>).mock.calls;
    const step4Body = calls[3][1]?.body as string;
    expect(step4Body).toContain('skylight_api_client_device_fingerprint=');
    // The fingerprint should be a UUID-like value (non-empty)
    const params = new URLSearchParams(step4Body);
    const fp = params.get('skylight_api_client_device_fingerprint');
    expect(fp).toBeTruthy();
    expect(fp!.length).toBeGreaterThan(10);
  });

  it('includes correct step-2 body fields', async () => {
    const httpFetch = makeHappyFetch({});
    await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'my-secret' }, httpFetch);
    const calls = (httpFetch as ReturnType<typeof vi.fn>).mock.calls;
    const step2 = calls[1];
    const params = new URLSearchParams(step2[1]?.body as string);
    expect(params.get('authenticity_token')).toBe('CSRF123');
    expect(params.get('email')).toBe('a@b.com');
    expect(params.get('password')).toBe('my-secret');
  });

  it('includes correct step-4 body fields', async () => {
    const httpFetch = makeHappyFetch({});
    await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    const calls = (httpFetch as ReturnType<typeof vi.fn>).mock.calls;
    const step4 = calls[3];
    const params = new URLSearchParams(step4[1]?.body as string);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('client_id')).toBe('skylight-mobile');
    expect(params.get('scope')).toBe('everything');
    expect(params.get('redirect_uri')).toBe('https://ourskylight.com/welcome');
    expect(params.get('code')).toBe('MYCODE');
    expect(params.get('skylight_api_client_device_platform')).toBe('web');
    expect(params.get('skylight_api_client_device_name')).toBe('unknown');
    expect(params.get('skylight_api_client_device_os_version')).toBe('10.15.7');
    expect(params.get('skylight_api_client_device_app_version')).toBe('unknown');
    expect(params.get('skylight_api_client_device_hardware')).toBe('Macintosh');
    expect(params.get('source')).toBe('js-mobile');
  });

  it('sends cookies in step-2 (cookie jar flows)', async () => {
    const httpFetch = makeHappyFetch({ cookies: ['_skylight_cloud_session=SESS1; Path=/'] });
    await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    const calls = (httpFetch as ReturnType<typeof vi.fn>).mock.calls;
    // Step 2 should have Cookie header with session from step 1
    const step2Headers = calls[1][1]?.headers as Record<string, string>;
    expect(step2Headers?.Cookie).toContain('_skylight_cloud_session=SESS1');
  });

  it('sends correct Origin and Referer on step 2', async () => {
    const httpFetch = makeHappyFetch({});
    await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    const calls = (httpFetch as ReturnType<typeof vi.fn>).mock.calls;
    const step2Headers = calls[1][1]?.headers as Record<string, string>;
    expect(step2Headers?.Origin).toBe(AUTH_BASE);
    expect(step2Headers?.Referer).toBe(`${AUTH_BASE}/auth/session/new`);
  });

  it('step-3 uses redirect:manual', async () => {
    const httpFetch = makeHappyFetch({});
    await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    const calls = (httpFetch as ReturnType<typeof vi.fn>).mock.calls;
    const step3Init = calls[2][1] as RequestInit;
    expect(step3Init.redirect).toBe('manual');
  });

  it('step-2 uses redirect:manual', async () => {
    const httpFetch = makeHappyFetch({});
    await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    const calls = (httpFetch as ReturnType<typeof vi.fn>).mock.calls;
    const step2Init = calls[1][1] as RequestInit;
    expect(step2Init.redirect).toBe('manual');
  });

  it('throws an actionable error when step-2 redirects to /auth/session/new (bad creds)', async () => {
    const httpFetch = makeHappyFetch({
      step2Location: `${AUTH_BASE}/auth/session/new?error=1`,
    });
    await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'wrong' }, httpFetch))
      .rejects.toThrow(/Skylight login failed.*SKYLIGHT_EMAIL.*SKYLIGHT_PASSWORD/i);
  });

  it('throws an actionable error when authenticity_token is missing from HTML', async () => {
    const noTokenFetch: HttpFetch = vi.fn().mockResolvedValue(
      htmlResponse('<html>no token here</html>', []),
    );
    await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, noTokenFetch))
      .rejects.toThrow(/authenticity_token/);
  });

  it('handles Set-Cookie absent (getSetCookie returns empty array)', async () => {
    // Step 1 returns no cookies — the jar should still be empty and login should proceed
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          status: 200,
          headers: {
            get: () => null,
            getSetCookie: () => [], // no cookies
          },
          text: async () => '<input name="authenticity_token" value="CSRF">',
          json: async () => { throw new Error('no'); },
        } as unknown as Response;
      }
      if (callIndex === 2) {
        return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      }
      if (callIndex === 3) {
        return redirectResponse('https://ourskylight.com/welcome?code=CODE1');
      }
      return jsonResponse(200, TOKEN_BODY);
    });
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    expect(tokens.accessToken).toBe('AT');
  });

  it('skips malformed cookies with no = sign (covers eqIdx < 0 branch)', async () => {
    // A cookie without '=' should be silently skipped
    const malformedCookieFetch: HttpFetch = vi.fn().mockImplementation(async (_url: string, _init?: RequestInit) => {
      const calls = (malformedCookieFetch as ReturnType<typeof vi.fn>).mock.calls.length;
      if (calls === 1) {
        return {
          status: 200,
          headers: {
            get: () => null,
            getSetCookie: () => ['malformed-no-equals; Path=/', '_skylight_cloud_session=GOOD; Path=/'],
          },
          text: async () => '<input name="authenticity_token" value="T">',
          json: async () => { throw new Error('no'); },
        } as unknown as Response;
      }
      if (calls === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      if (calls === 3) return redirectResponse('https://ourskylight.com/welcome?code=MC');
      return jsonResponse(200, TOKEN_BODY);
    });
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, malformedCookieFetch);
    expect(tokens.accessToken).toBe('AT');
    // The good cookie should still be in the jar and used in step-2
    const step2Headers = (malformedCookieFetch as ReturnType<typeof vi.fn>).mock.calls[1][1]?.headers as Record<string, string>;
    expect(step2Headers?.Cookie).toContain('_skylight_cloud_session=GOOD');
  });

  it('handles multiple cookies in Set-Cookie header', async () => {
    const multiCookieFetch: HttpFetch = vi.fn().mockImplementation(async (_url: string, _init?: RequestInit) => {
      const calls = (multiCookieFetch as ReturnType<typeof vi.fn>).mock.calls.length;
      if (calls === 1) {
        return {
          status: 200,
          headers: {
            get: () => null,
            getSetCookie: () => ['session=SESS; Path=/', 'csrf=CSRF2; Path=/'],
          },
          text: async () => '<input name="authenticity_token" value="TOKEN1">',
          json: async () => { throw new Error('no'); },
        } as unknown as Response;
      }
      if (calls === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      if (calls === 3) return redirectResponse('https://ourskylight.com/welcome?code=C2');
      return jsonResponse(200, TOKEN_BODY);
    });
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, multiCookieFetch);
    expect(tokens.accessToken).toBe('AT');
    // Step 2 Cookie header should include both cookies
    const step2Headers = (multiCookieFetch as ReturnType<typeof vi.fn>).mock.calls[1][1]?.headers as Record<string, string>;
    expect(step2Headers?.Cookie).toContain('session=SESS');
    expect(step2Headers?.Cookie).toContain('csrf=CSRF2');
  });

  it('follows up to 3 redirects to find the code in step 3', async () => {
    // First redirect goes to an intermediate URL without code, then final has code
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return htmlResponse('<input name="authenticity_token" value="T">');
      if (callIndex === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      if (callIndex === 3) return redirectResponse('https://ourskylight.com/intermediate'); // no code
      if (callIndex === 4) return redirectResponse('https://ourskylight.com/welcome?code=HOPCODE'); // has code
      return jsonResponse(200, TOKEN_BODY);
    });
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    expect(tokens.accessToken).toBe('AT');
    // Verify the code was extracted from the intermediate hop
    const step5 = (httpFetch as ReturnType<typeof vi.fn>).mock.calls[4];
    const params = new URLSearchParams(step5[1]?.body as string);
    expect(params.get('code')).toBe('HOPCODE');
  });

  it('uses default global fetch when httpFetch not provided (validates default param)', async () => {
    // We stub global fetch to simulate all 4 steps
    const globalFetch = vi.fn();
    const realFetch = global.fetch;
    const html = '<input name="authenticity_token" value="GF_CSRF">';
    let idx = 0;
    globalFetch.mockImplementation(async () => {
      idx++;
      if (idx === 1) return htmlResponse(html, []);
      if (idx === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      if (idx === 3) return redirectResponse('https://ourskylight.com/welcome?code=GF_CODE');
      return jsonResponse(200, TOKEN_BODY);
    });
    global.fetch = globalFetch as typeof fetch;
    try {
      const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' });
      expect(tokens.accessToken).toBe('AT');
    } finally {
      global.fetch = realFetch;
    }
  });

  it('throws when no authorization code is found after exhausting redirect hops', async () => {
    // Step 3 returns a redirect to a URL with no code, and keeps returning no-code redirects
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return htmlResponse('<input name="authenticity_token" value="T">');
      if (callIndex === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      // All step-3+ redirects go to a URL without a code param
      return redirectResponse('https://ourskylight.com/no-code-here');
    });
    await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch))
      .rejects.toThrow(/could not extract authorization code/);
  });

  it('handles step-3 response with no Location header (covers loc || null branch)', async () => {
    // When step-3 response has no Location header, loc is '', loc || null → null → loop exits
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return htmlResponse('<input name="authenticity_token" value="T">');
      if (callIndex === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      // Step 3: 302 with no Location header — get('location') returns null → loc = ''
      return {
        status: 302,
        ok: false,
        headers: {
          get: () => null, // no Location header
          getSetCookie: () => [],
        },
        text: async () => '',
        json: async () => { throw new Error('no'); },
      } as unknown as Response;
    });
    // Loop exits because loc is '' → nextUrl = null → no code found → throws
    await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch))
      .rejects.toThrow(/could not extract authorization code/);
  });

  it('handles step-2 response with no Location header (covers ?? "" branch on line 142)', async () => {
    // When step-2 has no Location header, location ?? '' gives '', which doesn't contain /auth/session/new
    // so the flow continues to step 3
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return htmlResponse('<input name="authenticity_token" value="T">');
      if (callIndex === 2) {
        // Step 2 with no Location header → null → '' via ??
        return {
          status: 302,
          ok: false,
          headers: {
            get: () => null, // no Location header
            getSetCookie: () => [],
          },
          text: async () => '',
          json: async () => { throw new Error('no'); },
        } as unknown as Response;
      }
      if (callIndex === 3) return redirectResponse('https://ourskylight.com/welcome?code=C3');
      return jsonResponse(200, TOKEN_BODY);
    });
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    expect(tokens.accessToken).toBe('AT');
  });

  it('handles response without getSetCookie method (covers optional chain branch)', async () => {
    // Simulate a Response object missing getSetCookie — the ?. optional chain should handle it
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        // Step 1: headers has no getSetCookie method
        return {
          status: 200,
          headers: {
            get: () => null,
            // getSetCookie is intentionally absent
          },
          text: async () => '<input name="authenticity_token" value="CSRFX">',
          json: async () => { throw new Error('no'); },
        } as unknown as Response;
      }
      if (callIndex === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      if (callIndex === 3) return redirectResponse('https://ourskylight.com/welcome?code=XC');
      return jsonResponse(200, TOKEN_BODY);
    });
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    expect(tokens.accessToken).toBe('AT');
  });

  it('throws when step-4 token response is missing access_token', async () => {
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return htmlResponse('<input name="authenticity_token" value="T">');
      if (callIndex === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      if (callIndex === 3) return redirectResponse('https://ourskylight.com/welcome?code=C');
      return jsonResponse(200, { refresh_token: 'RT', expires_in: 604800 }); // no access_token
    });
    await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch))
      .rejects.toThrow(/no access_token/);
  });

  it('uses default expires_in of 604800 when missing from token response', async () => {
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return htmlResponse('<input name="authenticity_token" value="T">');
      if (callIndex === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      if (callIndex === 3) return redirectResponse('https://ourskylight.com/welcome?code=C');
      return jsonResponse(200, { access_token: 'AT', refresh_token: 'RT' }); // no expires_in
    });
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    expect(tokens.expiresInMs).toBe(604800 * 1000);
  });

  it('uses empty string for refreshToken when absent from token response', async () => {
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return htmlResponse('<input name="authenticity_token" value="T">');
      if (callIndex === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      if (callIndex === 3) return redirectResponse('https://ourskylight.com/welcome?code=C');
      return jsonResponse(200, { access_token: 'AT', expires_in: 600 }); // no refresh_token
    });
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    expect(tokens.refreshToken).toBe('');
  });
});

// ---------------------------------------------------------------------------
// refresh() tests
// ---------------------------------------------------------------------------

describe('refresh', () => {
  it('POSTs a refresh_token grant and returns tokens', async () => {
    const httpFetch: HttpFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 604800 }),
    );
    const tokens = await refresh({ authBaseUrl: AUTH_BASE, refreshToken: 'RT' }, httpFetch);
    expect(tokens.accessToken).toBe('AT2');
    expect(tokens.refreshToken).toBe('RT2');
    expect(tokens.expiresInMs).toBe(604800 * 1000);

    const calls = (httpFetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(`${AUTH_BASE}/oauth/token`);
    const params = new URLSearchParams(init.body as string);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('client_id')).toBe('skylight-mobile');
    expect(params.get('refresh_token')).toBe('RT');
  });

  it('throws on non-2xx response', async () => {
    const httpFetch: HttpFetch = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: 'invalid_token' }),
    );
    await expect(refresh({ authBaseUrl: AUTH_BASE, refreshToken: 'BAD' }, httpFetch))
      .rejects.toThrow(/401/);
  });

  it('throws when access_token is missing in refresh response', async () => {
    const httpFetch: HttpFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, { refresh_token: 'RT2', expires_in: 600 }),
    );
    await expect(refresh({ authBaseUrl: AUTH_BASE, refreshToken: 'RT' }, httpFetch))
      .rejects.toThrow(/no access_token/);
  });

  it('uses default global fetch when httpFetch not provided', async () => {
    const globalFetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 600 }),
    );
    const realFetch = global.fetch;
    global.fetch = globalFetchMock as typeof fetch;
    try {
      const tokens = await refresh({ authBaseUrl: AUTH_BASE, refreshToken: 'RT' });
      expect(tokens.accessToken).toBe('AT2');
      expect(globalFetchMock).toHaveBeenCalledOnce();
    } finally {
      global.fetch = realFetch;
    }
  });
});
