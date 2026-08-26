import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  tokenStorePath,
  createTokenPersistence,
  reportCacheWriteFailure,
} from '../src/token-store.js';

let dir: string;
const SAVED = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skylight-tokens-'));
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('SKYLIGHT_') || k === 'MCP_DATA_DIR') delete process.env[k];
  }
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...SAVED };
});

describe('tokenStorePath', () => {
  it('lands under MCP_DATA_DIR when the host provides one', () => {
    expect(tokenStorePath({ MCP_DATA_DIR: '/data' })).toBe('/data/.skylight-mcp/tokens.json');
  });

  it('falls back to HOME', () => {
    expect(tokenStorePath({ HOME: '/home/u' })).toBe('/home/u/.skylight-mcp/tokens.json');
  });

  it('ignores an unexpanded placeholder or sentinel MCP_DATA_DIR', () => {
    // A relative "./null" would park the tokens under the process cwd.
    expect(tokenStorePath({ MCP_DATA_DIR: 'null', HOME: '/home/u' })).toBe(
      '/home/u/.skylight-mcp/tokens.json',
    );
    expect(tokenStorePath({ MCP_DATA_DIR: '${MCP_DATA_DIR}', HOME: '/home/u' })).toBe(
      '/home/u/.skylight-mcp/tokens.json',
    );
  });
});

describe('createTokenPersistence', () => {
  it('round-trips tokens through a 0600 file', () => {
    const p = createTokenPersistence({ MCP_DATA_DIR: dir });
    expect(p).not.toBeNull();
    p!.save({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 123 });
    const file = join(dir, '.skylight-mcp', 'tokens.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(createTokenPersistence({ MCP_DATA_DIR: dir })!.load()).toEqual({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 123,
    });
  });

  it('rejects a stored record that is not a token pair', () => {
    const p = createTokenPersistence({ MCP_DATA_DIR: dir })!;
    p.save({ accessToken: 'AT', expiresAt: 1 });
    const file = join(dir, '.skylight-mcp', 'tokens.json');
    // Simulate a hand-edited / half-migrated file.
    writeFileSync(file, JSON.stringify({ accessToken: 42 }), { mode: 0o600 });
    expect(createTokenPersistence({ MCP_DATA_DIR: dir })!.load()).toBeNull();
  });

  it('is disabled by SKYLIGHT_TOKEN_CACHE=false', () => {
    const p = createTokenPersistence({ MCP_DATA_DIR: dir, SKYLIGHT_TOKEN_CACHE: 'false' });
    expect(p).toBeNull();
    // Nothing is written when the cache is off.
    expect(existsSync(join(dir, '.skylight-mcp'))).toBe(false);
  });

  it('stays enabled for any other value of the flag', () => {
    expect(createTokenPersistence({ MCP_DATA_DIR: dir, SKYLIGHT_TOKEN_CACHE: 'true' })).not.toBeNull();
    expect(createTokenPersistence({ MCP_DATA_DIR: dir })).not.toBeNull();
  });

  it.each([
    ['null', null],
    ['a primitive', 'nope'],
    ['an array', []],
    ['a missing accessToken', { expiresAt: 1 }],
    ['an empty accessToken', { accessToken: '', expiresAt: 1 }],
    ['a non-numeric expiresAt', { accessToken: 'AT', expiresAt: 'soon' }],
    // JSON has no NaN/Infinity literal — JSON.stringify turns both into null —
    // so a non-finite number cannot survive a round-trip through the store file.
    // `null` is the only shape this reaches the guard as.
    ['a null expiresAt', { accessToken: 'AT', expiresAt: null }],
    ['a non-string refreshToken', { accessToken: 'AT', refreshToken: 7, expiresAt: 1 }],
  ])('rejects %s rather than feeding it to the token manager', (_label, body) => {
    const p = createTokenPersistence({ MCP_DATA_DIR: dir })!;
    p.save({ accessToken: 'seed', expiresAt: 1 });
    writeFileSync(join(dir, '.skylight-mcp', 'tokens.json'), JSON.stringify(body), { mode: 0o600 });
    expect(createTokenPersistence({ MCP_DATA_DIR: dir })!.load()).toBeNull();
  });

  it('accepts a token pair with no refreshToken', () => {
    const p = createTokenPersistence({ MCP_DATA_DIR: dir })!;
    p.save({ accessToken: 'AT', expiresAt: 42 });
    expect(createTokenPersistence({ MCP_DATA_DIR: dir })!.load()).toEqual({
      accessToken: 'AT',
      expiresAt: 42,
    });
  });

  it('never writes the password — only the token pair', () => {
    const p = createTokenPersistence({ MCP_DATA_DIR: dir })!;
    p.save({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1 });
    const body = readFileSync(join(dir, '.skylight-mcp', 'tokens.json'), 'utf8');
    expect(body).not.toContain('password');
    // The record itself, through the envelope mcp-utils writes — asserted via
    // the parsed state rather than the file's top-level keys, which are the
    // library's business and changed under us once already.
    expect(Object.keys(JSON.parse(body).state).sort()).toEqual([
      'accessToken',
      'expiresAt',
      'refreshToken',
    ]);
    expect(p.load()).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1 });
  });
});

describe('reportCacheWriteFailure', () => {
  it.each([
    ['an Error', new Error('EROFS'), 'EROFS'],
    // A rejected non-Error (a string, a fetch-shaped object) must still name
    // something rather than rendering as [object Object].
    ['a non-Error', 'disk gone', 'disk gone'],
  ])('names the cause for %s', (_label, thrown, expected) => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      reportCacheWriteFailure(thrown);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(expected as string));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('credential binding', () => {
  const creds = { email: 'a@b.com', password: 'pw1' };

  it('reuses the cache while the credentials are unchanged', () => {
    const p = createTokenPersistence({ MCP_DATA_DIR: dir }, creds)!;
    p.save({ accessToken: 'AT', expiresAt: 1 });
    expect(createTokenPersistence({ MCP_DATA_DIR: dir }, creds)!.load()).toEqual({
      accessToken: 'AT',
      expiresAt: 1,
    });
  });

  it('discards the cache when the password is rotated', () => {
    createTokenPersistence({ MCP_DATA_DIR: dir }, creds)!.save({ accessToken: 'AT', expiresAt: 1 });
    // Rotating the password should not leave a token minted from the old one in
    // play — the operator may have rotated it precisely to end that session.
    const after = createTokenPersistence({ MCP_DATA_DIR: dir }, { ...creds, password: 'pw2' })!;
    expect(after.load()).toBeNull();
  });

  it('discards the cache when the account changes', () => {
    createTokenPersistence({ MCP_DATA_DIR: dir }, creds)!.save({ accessToken: 'AT', expiresAt: 1 });
    const other = createTokenPersistence({ MCP_DATA_DIR: dir }, { ...creds, email: 'c@d.com' })!;
    expect(other.load()).toBeNull();
  });

  it('reuses the cache while a supplied refresh token is unchanged', () => {
    // The other arm of CacheBinding: a deployment configured with
    // SKYLIGHT_REFRESH_TOKEN binds the cache to that token instead of a
    // password pair.
    const bind = { refreshToken: 'RT1' };
    createTokenPersistence({ MCP_DATA_DIR: dir }, bind)!.save({ accessToken: 'AT', expiresAt: 1 });
    expect(createTokenPersistence({ MCP_DATA_DIR: dir }, bind)!.load()).toEqual({
      accessToken: 'AT',
      expiresAt: 1,
    });
  });

  it('discards the cache when the supplied refresh token is replaced', () => {
    createTokenPersistence({ MCP_DATA_DIR: dir }, { refreshToken: 'RT1' })!.save({ accessToken: 'AT', expiresAt: 1 });
    // Replacing the token is the token-path equivalent of rotating a password:
    // a pair minted from the old one must not stay in play.
    const after = createTokenPersistence({ MCP_DATA_DIR: dir }, { refreshToken: 'RT2' })!;
    expect(after.load()).toBeNull();
  });

  it('does not let a password pair and a refresh token collide in the cache', () => {
    // Different binding SHAPES must not hash to the same key — otherwise a
    // token cached under one credential would be served to the other.
    createTokenPersistence({ MCP_DATA_DIR: dir }, creds)!.save({ accessToken: 'AT', expiresAt: 1 });
    expect(createTokenPersistence({ MCP_DATA_DIR: dir }, { refreshToken: 'pw1' })!.load()).toBeNull();
  });

  it('never writes a supplied refresh token to disk', () => {
    createTokenPersistence({ MCP_DATA_DIR: dir }, { refreshToken: 'RT-SECRET' })!.save({ accessToken: 'AT', expiresAt: 1 });
    const body = readFileSync(join(dir, '.skylight-mcp', 'tokens.json'), 'utf8');
    expect(body).not.toContain('RT-SECRET');
  });

  it('never writes the password or the email to disk', () => {
    createTokenPersistence({ MCP_DATA_DIR: dir }, creds)!.save({ accessToken: 'AT', expiresAt: 1 });
    const body = readFileSync(join(dir, '.skylight-mcp', 'tokens.json'), 'utf8');
    expect(body).not.toContain('pw1');
    expect(body).not.toContain('a@b.com');
  });
});
