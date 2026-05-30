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
