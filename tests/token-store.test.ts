import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { tokenStorePath, createTokenPersistence } from '../src/token-store.js';

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
    ['a non-finite expiresAt', { accessToken: 'AT', expiresAt: null }],
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
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['accessToken', 'expiresAt', 'refreshToken']);
  });
});
