// Invariant: every environment variable the desktop bundle passes to the
// server (manifest.json → server.mcp_config.env) is also declared in
// server.json, the MCP Registry listing. Registry clients build their
// config form from server.json, so a variable missing there cannot be set
// by anyone installing from the registry.
//
// Why this exists: SKYLIGHT_UPLOAD_DIR (#207) was added to manifest.json and
// the README but not server.json (follow-up #208). The reverse direction is
// intentionally not enforced: server.json may declare advanced variables
// (SKYLIGHT_BASE_URL, SKYLIGHT_TOKEN_FILE, …) that the desktop form leaves out.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
  server: { mcp_config: { env?: Record<string, string> } };
};
const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8')) as {
  packages: { environmentVariables?: { name: string; description?: string }[] }[];
};

describe('env sync', () => {
  const manifestEnv = Object.keys(manifest.server.mcp_config.env ?? {}).sort();
  const declared = new Map(
    server.packages.flatMap((p) => p.environmentVariables ?? []).map((e) => [e.name, e]),
  );

  it('declares in server.json every env var manifest.json passes to the server', () => {
    expect(manifestEnv.filter((name) => !declared.has(name))).toEqual([]);
  });

  it('gives every declared env var a description', () => {
    const undocumented = [...declared.values()].filter((e) => !e.description?.trim()).map((e) => e.name);
    expect(undocumented).toEqual([]);
  });
});
