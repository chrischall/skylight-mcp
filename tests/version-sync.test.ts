// Invariant: every `// x-release-please-version` annotation in src/
// must hold a version string that matches package.json's `version`.
// Also asserts that manifest.json and server.json carry the same version.
//
// Why this exists: a recurring class of bug where a VERSION constant
// (used as the MCP server's self-reported version) drifts from package.json
// because release-please's `extra-files` registration lacks the marker —
// so release-please silently skips bumping it on each release.
//
// This test catches it at CI time. If a future contributor registers
// a new version-bearing constant, just add the `x-release-please-version`
// comment to the line — this test starts asserting it automatically.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionSyncTest } from '@chrischall/mcp-utils/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf8')
) as { version: string };

describe('version sync', () => {
  it('every `x-release-please-version` annotation matches package.json', () => {
    // versionSyncTest walks src/ for `x-release-please-version` markers and
    // returns the list of literals that drift from package.json. The
    // manifest.json/server.json checks below stay local — they're skylight's
    // release-please extra-files, not part of the shared src-walk.
    const mismatches = versionSyncTest({
      srcDir: join(ROOT, 'src'),
      pkgPath: join(ROOT, 'package.json'),
    });
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });

  it('manifest.json version matches package.json', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'manifest.json'), 'utf8')
    ) as { version: string };
    expect(manifest.version).toBe(pkg.version);
  });

  it('server.json version matches package.json', () => {
    const server = JSON.parse(
      readFileSync(join(ROOT, 'server.json'), 'utf8')
    ) as { version: string; packages: Array<{ version: string }> };
    expect(server.version).toBe(pkg.version);
    for (const pkg2 of server.packages) {
      expect(pkg2.version).toBe(pkg.version);
    }
  });
});
