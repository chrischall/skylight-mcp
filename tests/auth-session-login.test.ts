import { describe, it, expect } from 'vitest';
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

  it('throws when access_token is missing from a 200 response', async () => {
    const noToken: TokenPoster = async () => ({ status: 200, json: { refresh_token: 'RT', expires_in: 3600 } });
    await expect(oauthPasswordGrant({ baseUrl: 'https://app.ourskylight.com/api', email: 'a@b.com', password: 'pw' }, noToken))
      .rejects.toThrow(/no access_token/);
  });

  it('uses default expires_in of 604800 when not present in response', async () => {
    const noExpiry: TokenPoster = async () => ({ status: 200, json: { access_token: 'AT', refresh_token: 'RT' } });
    const tok = await oauthPasswordGrant({ baseUrl: 'https://app.ourskylight.com/api', email: 'a@b.com', password: 'pw' }, noExpiry);
    expect(tok.expiresInMs).toBe(604800 * 1000);
  });

  it('uses empty string for refreshToken when not present in response', async () => {
    const noRefresh: TokenPoster = async () => ({ status: 200, json: { access_token: 'AT', expires_in: 3600 } });
    const tok = await oauthPasswordGrant({ baseUrl: 'https://app.ourskylight.com/api', email: 'a@b.com', password: 'pw' }, noRefresh);
    expect(tok.refreshToken).toBe('');
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
