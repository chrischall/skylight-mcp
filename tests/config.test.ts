import { describe, it, expect } from 'vitest';
import { loadAccount, NO_ENV_CONFIG_MARKER } from '../src/config.js';

describe('loadAccount', () => {
  it('returns a session account from email+password', () => {
    const acc = loadAccount({ SKYLIGHT_EMAIL: 'a@b.com', SKYLIGHT_PASSWORD: 'pw' });
    expect(acc).toEqual({
      mode: 'session',
      name: 'a@b.com',
      baseUrl: 'https://app.ourskylight.com/api',
      authBaseUrl: 'https://app.ourskylight.com',
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

  it('derives authBaseUrl as the origin of baseUrl', () => {
    const acc = loadAccount({
      SKYLIGHT_EMAIL: 'a@b.com',
      SKYLIGHT_PASSWORD: 'pw',
      SKYLIGHT_BASE_URL: 'https://app.ourskylight.com/api',
    });
    expect(acc.authBaseUrl).toBe('https://app.ourskylight.com');
  });

  it('derives authBaseUrl from a custom SKYLIGHT_BASE_URL', () => {
    const acc = loadAccount({
      SKYLIGHT_EMAIL: 'a@b.com',
      SKYLIGHT_PASSWORD: 'pw',
      SKYLIGHT_BASE_URL: 'https://staging.ourskylight.com/api/v2',
    });
    expect(acc.authBaseUrl).toBe('https://staging.ourskylight.com');
  });

  it('accepts a supplied refresh token with no email or password', () => {
    // Path 1 of the ladder: the narrowest credential a consumer can give. A
    // refresh token is scoped and revocable; the password that mints one is
    // neither, and until now it was the only thing this server would accept.
    const acc = loadAccount({ SKYLIGHT_REFRESH_TOKEN: 'RT' });
    expect(acc.refreshToken).toBe('RT');
    expect(acc.email).toBeUndefined();
    expect(acc.password).toBeUndefined();
    expect(acc.authBaseUrl).toBe('https://app.ourskylight.com');
  });

  it('keeps email+password alongside a refresh token, so a stale one can re-login', () => {
    const acc = loadAccount({ SKYLIGHT_REFRESH_TOKEN: 'RT', SKYLIGHT_EMAIL: 'a@b.com', SKYLIGHT_PASSWORD: 'pw' });
    expect(acc.refreshToken).toBe('RT');
    expect(acc.email).toBe('a@b.com');
    expect(acc.password).toBe('pw');
  });

  it('names the refresh-token route in the no-config error, not just the password one', () => {
    // The message is what a host shows; a route documented only in prose is a
    // route nobody configures.
    expect(() => loadAccount({})).toThrow(/SKYLIGHT_REFRESH_TOKEN/);
  });

  it('still rejects a half-configured password pair when no token is supplied', () => {
    expect(() => loadAccount({ SKYLIGHT_EMAIL: 'a@b.com' })).toThrow(/SKYLIGHT_PASSWORD/);
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

  it('partial-config errors carry the no-config marker so they cache as config errors', () => {
    expect(() => loadAccount({ SKYLIGHT_EMAIL: 'a@b.com' })).toThrow(NO_ENV_CONFIG_MARKER);
    expect(() => loadAccount({ SKYLIGHT_PASSWORD: 'pw' })).toThrow(NO_ENV_CONFIG_MARKER);
  });

  it('treats placeholder/blank values as unset', () => {
    expect(() => loadAccount({ SKYLIGHT_EMAIL: '  ', SKYLIGHT_PASSWORD: '${user.pw}' })).toThrow(/Missing Skylight auth config/);
  });
});
