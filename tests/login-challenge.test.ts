import { describe, it, expect, vi } from 'vitest';
import {
  login,
  InvalidVerificationCodeError,
  VerificationCodeRequiredError,
  VERIFICATION_CODE_MARKER,
  type HttpFetch,
  type LoginChallenge,
  type Tokens,
} from '../src/auth-session-login.js';
import { PendingLogin } from '../src/login-challenge.js';

const AUTH = 'https://app.ourskylight.com';
const CREDS = { authBaseUrl: AUTH, email: 'a@b.com', password: 'pw' };
const TOKEN_BODY = { access_token: 'AT', refresh_token: 'RT', expires_in: 86400 };

function res(status: number, opts: { location?: string; body?: string; cookies?: string[] } = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'location' ? opts.location ?? null : null),
      getSetCookie: () => opts.cookies ?? [],
    },
    text: async () => opts.body ?? '',
    clone() { return this; },
  } as unknown as Response;
}
const form = (token: string) => res(200, { body: `<form action="/auth/mfa_challenge"><input type="hidden" name="authenticity_token" value="${token}" /><input name="code"></form>` });
const redirect = (location: string) => res(302, { location });

type Route = (url: URL, init: RequestInit) => Response | undefined;

/**
 * The live shape (2026-11-11, #276): password → /auth/mfa_challenge/start
 * (mails the code) → /auth/mfa_challenge/new (the form) → POST code →
 * /auth/session/success → the usual authorize + token exchange.
 */
function mfaFetch(overrides: Route = () => undefined, validCode = '123456') {
  let formToken = 0;
  const fn = vi.fn(async (raw: string, init: RequestInit) => {
    const url = new URL(raw);
    const hit = overrides(url, init);
    if (hit) return hit;
    switch (url.pathname) {
      case '/auth/session/new': return res(200, { body: '<input name="authenticity_token" value="LOGIN">', cookies: ['_skylight_cloud_session=s1; Path=/'] });
      case '/auth/session': return redirect(`${AUTH}/auth/mfa_challenge/start`);
      case '/auth/mfa_challenge/start': return redirect(`${AUTH}/auth/mfa_challenge/new`);
      case '/auth/mfa_challenge/new': return form(`MFA${++formToken}`);
      case '/auth/mfa_challenge': {
        const code = new URLSearchParams(init.body as string).get('code');
        return redirect(code === validCode ? `${AUTH}/auth/session/success` : `${AUTH}/auth/mfa_challenge/new`);
      }
      case '/oauth/authorize': return redirect('https://ourskylight.com/welcome?code=AUTHCODE');
      case '/oauth/token': return res(200, { body: JSON.stringify(TOKEN_BODY) });
    }
    throw new Error(`unexpected ${url.pathname}`);
  });
  return fn as unknown as HttpFetch & typeof fn;
}

const calls = (f: ReturnType<typeof mfaFetch>) => f.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${new URL(u).pathname}${new URL(u).search}`);

async function challengeFrom(f: HttpFetch): Promise<LoginChallenge> {
  const err = await login(CREDS, f).catch((e) => e);
  expect(err).toBeInstanceOf(VerificationCodeRequiredError);
  return (err as VerificationCodeRequiredError).challenge;
}

describe('login() — step 2 outcomes (#276)', () => {
  it('raises VerificationCodeRequiredError when Skylight emails a code, stopping before /oauth/authorize', async () => {
    const f = mfaFetch();
    const err = await login(CREDS, f).catch((e) => e);
    expect(err).toBeInstanceOf(VerificationCodeRequiredError);
    expect(err.message).toContain(VERIFICATION_CODE_MARKER);
    expect(err.message).toContain('skylight_submit_login_code');
    expect(calls(f)).toEqual([
      'GET /auth/session/new',
      'POST /auth/session',
      'GET /auth/mfa_challenge/start',
      'GET /auth/mfa_challenge/new',
    ]);
  });

  it('reports a re-rendered sign-in form as a rejected credential', async () => {
    const f = mfaFetch((u) => (u.pathname === '/auth/session' ? res(422, { body: '<input type="password" name="password">' }) : undefined));
    await expect(login(CREDS, f)).rejects.toThrow(/check SKYLIGHT_EMAIL\/SKYLIGHT_PASSWORD/);
  });

  it('reports any other 200 as an unrecognised password step, not an OAuth contract change', async () => {
    const f = mfaFetch((u) => (u.pathname === '/auth/session' ? res(200, { body: '<p>Something new</p>' }) : undefined));
    await expect(login(CREDS, f)).rejects.toThrow('did not complete at the password step (HTTP 200)');
    expect(calls(f)).not.toContain('GET /oauth/authorize');
  });

  it('names the path, never the query, of an unexpected same-origin redirect', async () => {
    const f = mfaFetch((u) => (u.pathname === '/auth/session' ? redirect(`${AUTH}/auth/other?secret=x`) : undefined));
    const err = await login(CREDS, f).catch((e) => e);
    expect(err.message).toContain('HTTP 302 redirect to /auth/other)');
    expect(err.message).not.toContain('secret');
  });

  it.each([
    ['an off-origin redirect', 'https://evil.example/auth/session/success'],
    ['a redirect carrying URL credentials', 'https://u:p@app.ourskylight.com/auth/session/success'],
    ['an unparseable redirect', 'http://['],
  ])('refuses %s at step 2', async (_, location) => {
    const f = mfaFetch((u) => (u.pathname === '/auth/session' ? redirect(location) : undefined));
    await expect(login(CREDS, f)).rejects.toThrow('unsafe redirect');
  });

  it('resolves a relative success redirect', async () => {
    const f = mfaFetch((u) => (u.pathname === '/auth/session' ? redirect('/auth/session/success') : undefined));
    await expect(login(CREDS, f)).resolves.toMatchObject({ accessToken: 'AT' });
  });
});

describe('LoginChallenge', () => {
  it('finishes the login with the emailed code, carrying the session cookie and the form token', async () => {
    const f = mfaFetch();
    const challenge = await challengeFrom(f);
    const tokens = await challenge.submit('123456');
    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresInMs: 86400_000 });
    const post = f.mock.calls.find(([u, i]) => new URL(u).pathname === '/auth/mfa_challenge' && i.method === 'POST')!;
    expect(new URLSearchParams(post[1].body as string).get('authenticity_token')).toBe('MFA1');
    expect((post[1].headers as Record<string, string>).Cookie).toContain('_skylight_cloud_session=s1');
    expect(calls(f).slice(-2).map((c) => c.split('?')[0])).toEqual(['GET /oauth/authorize', 'POST /oauth/token']);
  });

  it('accepts a code typed with spaces', async () => {
    const challenge = await challengeFrom(mfaFetch());
    await expect(challenge.submit(' 123 456 ')).resolves.toMatchObject({ accessToken: 'AT' });
  });

  it('rejects a malformed code without contacting Skylight', async () => {
    const f = mfaFetch();
    const challenge = await challengeFrom(f);
    const before = f.mock.calls.length;
    await expect(challenge.submit('12345')).rejects.toBeInstanceOf(InvalidVerificationCodeError);
    expect(f.mock.calls.length).toBe(before);
  });

  it('keeps the challenge open after a wrong code, using the re-served form token for the retry', async () => {
    const f = mfaFetch();
    const challenge = await challengeFrom(f);
    await expect(challenge.submit('000000')).rejects.toBeInstanceOf(InvalidVerificationCodeError);
    await expect(challenge.submit('123456')).resolves.toMatchObject({ accessToken: 'AT' });
    const posts = f.mock.calls.filter(([u, i]) => new URL(u).pathname === '/auth/mfa_challenge' && i.method === 'POST');
    expect(posts.map(([, i]) => new URLSearchParams(i.body as string).get('authenticity_token'))).toEqual(['MFA1', 'MFA2']);
  });

  it('says the sign-in ended when Skylight sends the code back to the password form', async () => {
    const f = mfaFetch((u, i) => (u.pathname === '/auth/mfa_challenge' && i.method === 'POST' ? redirect(`${AUTH}/auth/session/new`) : undefined));
    const challenge = await challengeFrom(f);
    await expect(challenge.submit('123456')).rejects.toThrow(/ended the sign-in before the code was accepted/);
  });

  it('names the status of an unrecognised code-step answer', async () => {
    const f = mfaFetch((u, i) => (u.pathname === '/auth/mfa_challenge' && i.method === 'POST' ? res(403, { body: 'nope' }) : undefined));
    const challenge = await challengeFrom(f);
    await expect(challenge.submit('123456')).rejects.toThrow('verification-code step (HTTP 403)');
  });

  it('resends the code through /auth/mfa_challenge/start?resend=true and adopts the new form token', async () => {
    const f = mfaFetch();
    const challenge = await challengeFrom(f);
    await challenge.resend();
    expect(calls(f)).toContain('GET /auth/mfa_challenge/start?resend=true');
    await challenge.submit('123456');
    const post = f.mock.calls.find(([u, i]) => new URL(u).pathname === '/auth/mfa_challenge' && i.method === 'POST')!;
    expect(new URLSearchParams(post[1].body as string).get('authenticity_token')).toBe('MFA2');
  });

  it('says the session expired when the form redirects to the sign-in page', async () => {
    let first = true;
    const f = mfaFetch((u) => {
      if (u.pathname !== '/auth/mfa_challenge/new') return undefined;
      if (first) { first = false; return undefined; }
      return redirect(`${AUTH}/auth/session/new`);
    });
    const challenge = await challengeFrom(f);
    await expect(challenge.resend()).rejects.toThrow(/session expired/);
  });

  it('gives up on a redirect loop loading the form', async () => {
    const f = mfaFetch((u) => (u.pathname === '/auth/mfa_challenge/start' ? redirect(`${AUTH}/auth/mfa_challenge/start`) : undefined));
    await expect(login(CREDS, f)).rejects.toThrow(/too many redirects/);
  });

  it('names the code form when it carries no CSRF token', async () => {
    const f = mfaFetch((u) => (u.pathname === '/auth/mfa_challenge/new' ? res(200, { body: '<p>no form</p>' }) : undefined));
    await expect(login(CREDS, f)).rejects.toThrow('authenticity_token in /auth/mfa_challenge/new');
  });
});

describe('PendingLogin', () => {
  const TOKENS: Tokens = { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 1000 };
  function fakeChallenge(submit: LoginChallenge['submit'] = async () => TOKENS, resend: LoginChallenge['resend'] = async () => {}) {
    return { submit: vi.fn(submit), resend: vi.fn(resend) };
  }

  it('holds a raised challenge and re-reports it without logging in again', async () => {
    const pending = new PendingLogin();
    const challenge = fakeChallenge();
    const doLogin = vi.fn(async () => { throw new VerificationCodeRequiredError(challenge); });
    await expect(pending.login(doLogin)).rejects.toBeInstanceOf(VerificationCodeRequiredError);
    expect(pending.pending).toBe(true);
    await expect(pending.login(doLogin)).rejects.toThrow(VERIFICATION_CODE_MARKER);
    expect(doLogin).toHaveBeenCalledTimes(1);
  });

  it('passes other login failures through without holding anything', async () => {
    const pending = new PendingLogin();
    await expect(pending.login(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(pending.pending).toBe(false);
    await expect(pending.login(async () => TOKENS)).resolves.toBe(TOKENS);
  });

  it('hands the tokens a submitted code minted to the next login, once', async () => {
    const pending = new PendingLogin();
    const challenge = fakeChallenge();
    await pending.login(async () => { throw new VerificationCodeRequiredError(challenge); }).catch(() => {});
    await pending.submit('123456');
    expect(challenge.submit).toHaveBeenCalledWith('123456');
    expect(pending.pending).toBe(false);
    const doLogin = vi.fn(async () => ({ ...TOKENS, accessToken: 'OTHER' }));
    await expect(pending.login(doLogin)).resolves.toBe(TOKENS);
    expect(doLogin).not.toHaveBeenCalled();
    expect(pending.take()).toBeUndefined();
  });

  it('refuses submit and resend when no code is awaited', async () => {
    const pending = new PendingLogin();
    await expect(pending.submit('123456')).rejects.toThrow(/No Skylight login is waiting/);
    await expect(pending.resend()).rejects.toThrow(/No Skylight login is waiting/);
  });

  it('keeps the challenge after a wrong code but drops it after any other failure', async () => {
    const pending = new PendingLogin();
    let fail: Error = new InvalidVerificationCodeError();
    const challenge = fakeChallenge(async () => { throw fail; });
    await pending.login(async () => { throw new VerificationCodeRequiredError(challenge); }).catch(() => {});
    await expect(pending.submit('000000')).rejects.toBeInstanceOf(InvalidVerificationCodeError);
    expect(pending.pending).toBe(true);
    fail = new Error('session expired');
    await expect(pending.submit('123456')).rejects.toThrow('session expired');
    expect(pending.pending).toBe(false);
  });

  it('resends through the open challenge, dropping it if that fails', async () => {
    const pending = new PendingLogin();
    let ok = true;
    const challenge = fakeChallenge(undefined, async () => { if (!ok) throw new Error('expired'); });
    await pending.login(async () => { throw new VerificationCodeRequiredError(challenge); }).catch(() => {});
    await pending.resend();
    expect(challenge.resend).toHaveBeenCalledTimes(1);
    expect(pending.pending).toBe(true);
    ok = false;
    await expect(pending.resend()).rejects.toThrow('expired');
    expect(pending.pending).toBe(false);
  });
});
