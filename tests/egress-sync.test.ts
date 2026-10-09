// Invariant: mint.yaml's egress allow list names only hosts the server
// process actually fetches. The OAuth redirect_uri host (ourskylight.com) is
// never dialled — login() reads the code off the Location header, refuses to
// follow a code-less callback, and rejects any off-origin hop as an unsafe
// authorization redirect — so admitting it only widens the fence
// (fleet-audit#899).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mint = readFileSync(join(root, 'mint.yaml'), 'utf8');

function egressAllow(yaml: string): string[] {
  const block = /^egress:\n {2}allow:\n((?: {4}.*\n|\s*\n)*)/m.exec(yaml);
  if (!block) throw new Error('mint.yaml has no egress.allow block');
  return [...block[1].matchAll(/^ {4}- ['"]?([^'"\s#]+)['"]?/gm)].map((m) => m[1]);
}

describe('mint.yaml egress', () => {
  it('admits exactly the hosts the server dials', () => {
    expect(egressAllow(mint)).toEqual(['app.ourskylight.com', '*.amazonaws.com']);
  });
});
