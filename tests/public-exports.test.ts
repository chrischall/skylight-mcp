import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The package's public library surface: `skylight-mcp/auth` exposes the
// session login/refresh helpers so a separate program (for example a
// calendar-sync job) can reuse Skylight authentication without vendoring
// src/. These tests run against the BUILT package (`npm test` builds first)
// and resolve it the way a consumer would — by package name, through the
// `exports` map — rather than importing src/ directly.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string;
  exports?: Record<string, unknown>;
  files?: string[];
  bin?: Record<string, string>;
};

describe('public exports', () => {
  it('maps skylight-mcp/auth to built JS and type declarations', () => {
    const entry = pkg.exports?.['./auth'] as { types?: string; import?: string } | undefined;
    expect(entry).toBeDefined();
    expect(entry?.import).toBe('./dist/auth-session-login.js');
    expect(entry?.types).toBe('./dist/auth-session-login.d.ts');
    expect(existsSync(join(root, entry!.import!))).toBe(true);
    expect(existsSync(join(root, entry!.types!))).toBe(true);
  });

  it('keeps the CLI bin and ships dist', () => {
    expect(pkg.bin?.['skylight-mcp']).toBe('dist/index.js');
    expect(pkg.files).toContain('dist');
  });

  it('resolves by package name and exposes login and refresh as functions', () => {
    // Self-reference by name only works through the exports map, so this is
    // exactly what `import { login } from 'skylight-mcp/auth'` does for a
    // consumer. A child process keeps the check independent of vitest's own
    // module resolution.
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import('${pkg.name}/auth'); console.log(JSON.stringify({ login: typeof m.login, refresh: typeof m.refresh }));`,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    expect(JSON.parse(out.trim())).toEqual({ login: 'function', refresh: 'function' });
  });

  it('does not start the MCP server when the auth entry is imported', () => {
    // Importing the library entry must have no side effects: no stdio
    // transport, no env reads that exit. The process ends on its own.
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `await import('${pkg.name}/auth'); console.log('imported');`],
      { cwd: root, encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH ?? '' } },
    );
    expect(out.trim()).toBe('imported');
  });
});
