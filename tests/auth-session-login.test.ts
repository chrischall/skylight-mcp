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
    statusText: status === 401 ? 'Unauthorized' : status === 200 ? 'OK' : '',
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
  /** Full step-1 page body, when a test needs specific markup. */
  html?: string;
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

  const html = opts.html ?? `<input name="authenticity_token" value="${authTokenInHtml}">`;
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

  // -------------------------------------------------------------------------
  // CSRF token discovery (#88)
  // -------------------------------------------------------------------------
  //
  // Step 1 scraped the login page with one rigid regex that assumed
  // `name` precedes `value` and that both use double quotes. Any markup
  // change — or a body that never arrived at all — surfaced as the same
  // opaque "the login page may have changed", which is what #88 reported
  // and what made it un-triageable from the report alone.

  describe('authenticity_token discovery', () => {
    // Attribute order is a Rails/markup detail, not a contract. The live
    // page currently emits `type` first, then `name`, then `value`.
    const variants: Array<[string, string]> = [
      ['live markup (type, name, value; self-closing)',
       '<input type="hidden" name="authenticity_token" value="TK" />'],
      ['value before name',
       '<input value="TK" name="authenticity_token" />'],
      ['single-quoted attributes',
       "<input name='authenticity_token' value='TK' />"],
      ['extra attributes between name and value',
       '<input name="authenticity_token" autocomplete="off" value="TK" />'],
      ['newline between attributes',
       '<input name="authenticity_token"\n      value="TK" />'],
    ];

    for (const [label, markup] of variants) {
      it(`finds the token in ${label}`, async () => {
        const httpFetch = makeHappyFetch({ html: markup });
        await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
        const step2 = (httpFetch as ReturnType<typeof vi.fn>).mock.calls[1];
        expect(new URLSearchParams(step2[1].body).get('authenticity_token')).toBe('TK');
      });
    }

    it('falls back to the csrf-token meta tag when no hidden input is present', async () => {
      // The login page serves both; if Rails ever drops the hidden input
      // for a fetch-based submit, the meta tag still carries the token.
      const httpFetch = makeHappyFetch({
        html: '<meta name="csrf-param" content="authenticity_token" />\n<meta name="csrf-token" content="TK" />',
      });
      await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
      const step2 = (httpFetch as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(new URLSearchParams(step2[1].body).get('authenticity_token')).toBe('TK');
    });

    it('finds the token in a csrf-token meta tag with content before name', async () => {
      // Symmetric to the 'value before name' case on the hidden input:
      // attribute order is markup detail. Without this the reversed-order
      // meta regex could be malformed and every other test would still pass
      // — it only ever ran as a null-returning fallback.
      const httpFetch = makeHappyFetch({
        html: '<meta content="TK" name="csrf-token" />',
      });
      await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
      const step2 = (httpFetch as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(new URLSearchParams(step2[1].body).get('authenticity_token')).toBe('TK');
    });

    it('prefers the hidden input over the meta tag when both are present', async () => {
      // They are distinct values on the live page; the form token is the
      // one the POST is validated against.
      const httpFetch = makeHappyFetch({
        html: '<meta name="csrf-token" content="META" />\n<input type="hidden" name="authenticity_token" value="FORM" />',
      });
      await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
      const step2 = (httpFetch as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(new URLSearchParams(step2[1].body).get('authenticity_token')).toBe('FORM');
    });
  });

  describe('authenticity_token discovery failures are diagnosable (#88)', () => {
    it('reports the HTTP status when step 1 is not a 2xx', async () => {
      const fetch503: HttpFetch = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'down' }));
      await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, fetch503))
        .rejects.toThrow(/HTTP 503/);
    });

    it('names the redirect target when step 1 redirects', async () => {
      // `redirect: "manual"` yields an EMPTY body on a 3xx, so a newly
      // introduced interstitial or region redirect previously looked
      // identical to "markup changed".
      const fetchRedirect: HttpFetch = vi.fn().mockResolvedValue(
        redirectResponse('https://app.ourskylight.com/maintenance'),
      );
      await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, fetchRedirect))
        .rejects.toThrow(/redirect.*\/maintenance/is);
    });

    it('reports a 1xx status rather than treating it as a served page', async () => {
      const info = {
        status: 100,
        ok: false,
        headers: { get: () => null, getSetCookie: () => [] },
        text: async () => '',
      } as unknown as Response;
      const httpFetch: HttpFetch = vi.fn().mockResolvedValue(info);
      await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch))
        .rejects.toThrow(/HTTP 100/);
    });

    it('handles a redirect with no Location header', async () => {
      // A 3xx whose Location was stripped (proxy, or a Rails `head :found`)
      // still has to name the redirect rather than fall through to a
      // markup-change claim.
      const noLocation = {
        status: 302,
        ok: false,
        headers: { get: () => null, getSetCookie: () => [] },
        text: async () => '',
      } as unknown as Response;
      const httpFetch: HttpFetch = vi.fn().mockResolvedValue(noLocation);
      await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch))
        .rejects.toThrow(/HTTP 302 redirect to \(no Location header\)/);
    });

    it('says the body was empty rather than blaming the markup', async () => {
      const fetchEmpty: HttpFetch = vi.fn().mockResolvedValue(htmlResponse(''));
      await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, fetchEmpty))
        .rejects.toThrow(/empty/i);
    });

    it('reports the body size when the page parsed but held no token', async () => {
      const fetchNoToken: HttpFetch = vi.fn().mockResolvedValue(
        htmlResponse('<html><body>' + 'x'.repeat(500) + '</body></html>'),
      );
      await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, fetchNoToken))
        .rejects.toThrow(/51[0-9] bytes|5[0-9][0-9] bytes/);
    });

    it('counts real bytes, not UTF-16 code units, in the size diagnostic', async () => {
      // The label says "bytes", so it must survive multibyte content: an
      // emoji is 1 JS string char per surrogate pair (length 2) but 4 UTF-8
      // bytes. Getting this wrong understates a truncated page.
      const body = '<html>' + '\u{1F600}'.repeat(10) + '</html>'; // 13 + 20 = 33 UTF-16 units
      const expectedBytes = new TextEncoder().encode(body).length;   // 13 + 40 = 53 bytes
      expect(expectedBytes).toBeGreaterThan(body.length);
      const httpFetch: HttpFetch = vi.fn().mockResolvedValue(htmlResponse(body));
      await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch))
        .rejects.toThrow(new RegExp(`${expectedBytes} bytes`));
    });

    it('never echoes the page body into the error', async () => {
      // Step 1 sets a session cookie; the body can carry tokens. The error
      // is surfaced through MCP tool results, so it must stay opaque.
      const secret = 'SUPER_SECRET_VALUE_9d8f7';
      const fetchSecret: HttpFetch = vi.fn().mockResolvedValue(
        htmlResponse(`<html><script>var t="${secret}"</script></html>`),
      );
      await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, fetchSecret))
        .rejects.toThrow(/authenticity_token/);
      await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, fetchSecret))
        .rejects.not.toThrow(new RegExp(secret));
    });
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

  it('drops a cookie when a later Set-Cookie carries a deletion marker (stateful jar)', async () => {
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          status: 200,
          headers: {
            get: () => null,
            getSetCookie: () => ['session=SESS; Path=/', 'tmp=GONE_SOON; Path=/'],
          },
          text: async () => '<input name="authenticity_token" value="T">',
          json: async () => { throw new Error('no'); },
        } as unknown as Response;
      }
      if (callIndex === 2) {
        // Step 2 deletes `tmp` via Max-Age=0
        return redirectResponse(`${AUTH_BASE}/auth/session/success`, ['tmp=; Max-Age=0; Path=/']);
      }
      if (callIndex === 3) return redirectResponse('https://ourskylight.com/welcome?code=DEL1');
      return jsonResponse(200, TOKEN_BODY);
    });
    const tokens = await login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch);
    expect(tokens.accessToken).toBe('AT');
    // Step 3 Cookie header keeps `session` but not the deleted `tmp`
    const step3Headers = (httpFetch as ReturnType<typeof vi.fn>).mock.calls[2][1]?.headers as Record<string, string>;
    expect(step3Headers?.Cookie).toContain('session=SESS');
    expect(step3Headers?.Cookie).not.toContain('tmp=');
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

  it('throws with the HTTP status (and a redacted body) when step-4 returns non-2xx', async () => {
    let callIndex = 0;
    const httpFetch: HttpFetch = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return htmlResponse('<input name="authenticity_token" value="T">');
      if (callIndex === 2) return redirectResponse(`${AUTH_BASE}/auth/session/success`);
      if (callIndex === 3) return redirectResponse('https://ourskylight.com/welcome?code=C');
      return jsonResponse(401, { error: 'invalid_grant' });
    });
    await expect(login({ authBaseUrl: AUTH_BASE, email: 'a@b.com', password: 'pw' }, httpFetch))
      .rejects.toThrow(/HTTP 401/);
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

  it('throws on non-2xx response, including the HTTP status', async () => {
    const httpFetch: HttpFetch = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: 'invalid_token' }),
    );
    await expect(refresh({ authBaseUrl: AUTH_BASE, refreshToken: 'BAD' }, httpFetch))
      .rejects.toThrow(/401/);
  });

  it('redacts bearer tokens echoed in a token-endpoint error body (no regression vs truncateErrorMessage)', async () => {
    const leakedJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsZWFrIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
    const httpFetch: HttpFetch = vi.fn().mockResolvedValue(
      jsonResponse(400, { error: 'invalid_grant', echo: `Bearer ${leakedJwt}` }),
    );
    let thrown: Error | undefined;
    try {
      await refresh({ authBaseUrl: AUTH_BASE, refreshToken: 'RT' }, httpFetch);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/400/);
    expect(thrown!.message).not.toContain(leakedJwt);
  });

  it('caps an oversized token-endpoint error body', async () => {
    const httpFetch: HttpFetch = vi.fn().mockResolvedValue(
      jsonResponse(500, { error: 'boom', detail: 'x'.repeat(5000) }),
    );
    let thrown: Error | undefined;
    try {
      await refresh({ authBaseUrl: AUTH_BASE, refreshToken: 'RT' }, httpFetch);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message.length).toBeLessThan(1000);
  });

  it('throws when access_token is missing in refresh response', async () => {
    const httpFetch: HttpFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, { refresh_token: 'RT2', expires_in: 600 }),
    );
    await expect(refresh({ authBaseUrl: AUTH_BASE, refreshToken: 'RT' }, httpFetch))
      .rejects.toThrow(/no access_token/);
  });

  it('defaults expires_in to 7 days and refreshToken to empty when absent', async () => {
    const httpFetch: HttpFetch = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: 'AT3' }),
    );
    const tokens = await refresh({ authBaseUrl: AUTH_BASE, refreshToken: 'RT' }, httpFetch);
    expect(tokens.accessToken).toBe('AT3');
    expect(tokens.refreshToken).toBe('');
    expect(tokens.expiresInMs).toBe(604800 * 1000);
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
