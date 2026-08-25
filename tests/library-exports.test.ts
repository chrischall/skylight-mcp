// Invariant: the package's importable surface (`src/lib.ts`) stays in sync with
// the tool modules the server actually registers, and the `exports` map keeps
// pointing at the library entry rather than the executable.
//
// Why this exists: `src/index.ts` has a top-level `await runMcp(...)`, so
// importing it starts a stdio MCP server. It can never be the library entry —
// `exports["."]` must resolve to `dist/lib.js`. Pointing it at `dist/index.js`
// would look correct in review and then hang the importing process at runtime,
// which is a hard failure to diagnose from the consumer's side.
//
// The second half is the drift guard: adding a fourteenth tool module to
// `src/index.ts` without re-exporting its registrar from `src/lib.ts` silently
// drops those tools for every library consumer while the stdio server keeps
// working — nothing internally inconsistent enough to notice, which is the same
// failure mode docs-sync.test.ts was written for.
//
// `src/index.ts` is read as text rather than imported, precisely because
// importing it is the side effect this file exists to prevent.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../src/lib.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
};
const INDEX_SRC = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8');

/** Registrar names `src/index.ts` imports — the set the stdio server exposes. */
function registrarsUsedByServer(): string[] {
  return [...INDEX_SRC.matchAll(/\bregister[A-Za-z]+Tools\b/g)]
    .map((m) => m[0])
    .filter((n, i, a) => a.indexOf(n) === i)
    .sort();
}

describe('library exports', () => {
  it('exports["."] resolves to the library entry, never the executable', () => {
    const dot = pkg.exports?.['.'] as { types?: string; import?: string } | undefined;
    expect(dot).toBeDefined();
    expect(dot?.import).toBe('./dist/lib.js');
    expect(dot?.types).toBe('./dist/lib.d.ts');
    // The bin stays the executable; the two must not converge.
    expect(pkg.bin?.['skylight-mcp']).toBe('dist/index.js');
    expect(dot?.import).not.toContain('index.js');
  });

  it('main and types agree with the exports map', () => {
    expect(pkg.main).toBe('./dist/lib.js');
    expect(pkg.types).toBe('./dist/lib.d.ts');
  });

  it('ships dist, so the exported paths exist in the published tarball', () => {
    expect(pkg.files).toContain('dist');
  });

  it('re-exports every tool registrar the server registers', () => {
    const used = registrarsUsedByServer();
    // Guard the guard: if the regex ever stops matching, fail loudly rather
    // than passing vacuously against an empty set.
    expect(used.length).toBeGreaterThanOrEqual(13);

    const exported = Object.keys(lib).filter((k) => /^register[A-Za-z]+Tools$/.test(k)).sort();
    expect(exported).toEqual(used);
  });

  it('exports the client and auth seams a custom host needs', () => {
    // A host embedding these tools in another transport needs to build a client
    // its own way — makeGetClient takes a custom resolver, and SkylightClient's
    // constructor accepts stored tokens directly.
    for (const name of ['SkylightClient', 'makeGetClient', 'resolveAuth', 'login', 'refresh', 'loadAccount']) {
      expect(typeof (lib as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('importing the library has no side effects', async () => {
    // If lib.ts ever pulled in ./index.js, that module's top-level `await
    // runMcp(...)` would connect a StdioServerTransport on import.
    expect(readFileSync(join(ROOT, 'src', 'lib.ts'), 'utf8')).not.toMatch(/from\s+'\.\/index\.js'/);
    // And the import at the top of this file already proves it in practice:
    // a connected stdio server would have taken over this process's stdio.
    expect(Object.keys(lib).length).toBeGreaterThan(0);
  });
});
