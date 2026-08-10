// Invariant: the documented tool surface matches the registered tool surface.
//
// Why this exists: README.md's tool table drifted seven tools behind the
// server (issue #99) — it advertised 103 tools and had 103 self-consistent
// rows while `src/tools/` registered 110, so nothing was internally
// inconsistent enough to notice. Avatar, category, photo-upload and
// auto-creation tools shipped with no README row at all.
//
// Rather than grep the sources for `skylight_*` string literals (which also
// matches prose and doc comments), this registers every tool module against a
// stub server and reads the names the server actually receives. That is the
// same set an MCP host sees from `tools/list`.
//
// If you add, remove, rename or move a tool, this test tells you exactly which
// doc rows and headline counts to update.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFrameTools } from '../src/tools/frames.js';
import { registerSettingsTools } from '../src/tools/settings.js';
import { registerCalendarTools } from '../src/tools/calendars.js';
import { registerMemberTools } from '../src/tools/members.js';
import { registerEventTools } from '../src/tools/events.js';
import { registerListTools } from '../src/tools/lists.js';
import { registerChoreTools } from '../src/tools/chores.js';
import { registerMealTools } from '../src/tools/meals.js';
import { registerMessageTools } from '../src/tools/messages.js';
import { registerTaskTools } from '../src/tools/tasks.js';
import { registerRewardTools } from '../src/tools/rewards.js';
import { registerAiTools } from '../src/tools/ai.js';
import { registerPhotoTools } from '../src/tools/photos.js';
import type { GetClient } from '../src/tools/_shared.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const CLAUDE_MD = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
const SKILL_MD = readFileSync(join(ROOT, 'skills/skylight-mcp/SKILL.md'), 'utf8');

// Mirrors src/index.ts's `tools:` list. A new module must be added here too —
// otherwise its tools count as undocumented in both directions and the set
// comparisons below fail loudly rather than silently skipping the module.
const MODULES: Array<[file: string, register: (s: McpServer, g: GetClient) => void]> = [
  ['frames.ts', registerFrameTools],
  ['settings.ts', registerSettingsTools],
  ['calendars.ts', registerCalendarTools],
  ['members.ts', registerMemberTools],
  ['events.ts', registerEventTools],
  ['lists.ts', registerListTools],
  ['chores.ts', registerChoreTools],
  ['meals.ts', registerMealTools],
  ['messages.ts', registerMessageTools],
  ['tasks.ts', registerTaskTools],
  ['rewards.ts', registerRewardTools],
  ['ai.ts', registerAiTools],
  ['photos.ts', registerPhotoTools],
];

/** Register every module against a stub server; return file → tool names. */
function registeredByModule(): Map<string, string[]> {
  const getClient = (async () => {
    throw new Error('docs-sync never invokes a tool handler');
  }) as unknown as GetClient;
  return new Map(MODULES.map(([file, register]) => {
    const names: string[] = [];
    register({ tool: (n: string) => { names.push(n); } } as unknown as McpServer, getClient);
    return [file, names];
  }));
}

const BY_MODULE = registeredByModule();
const REGISTERED = [...BY_MODULE.values()].flat();

/** Tool names in a Markdown table, one per row: `| … | \`skylight_x\` | … |`. */
function tableRowTools(md: string): string[] {
  return [...md.matchAll(/^\|[^|\n]*\|\s*`(skylight_[a-z_]+)`\s*\|/gm)].map((m) => m[1]);
}

/** The single number in a "— N tools across …" headline. */
function headlineCount(md: string): number {
  const m = /(\d+) tools across/.exec(md);
  if (!m) throw new Error('no "N tools across" headline found');
  return Number(m[1]);
}

describe('docs sync', () => {
  it('registers a unique name for every tool', () => {
    const dupes = REGISTERED.filter((n, i) => REGISTERED.indexOf(n) !== i);
    expect(dupes, `duplicate tool registrations: ${dupes.join(', ')}`).toEqual([]);
  });

  it("README's tool table lists exactly the registered tools", () => {
    const documented = tableRowTools(README);
    const dupes = documented.filter((n, i) => documented.indexOf(n) !== i);
    expect(dupes, `duplicate README rows: ${dupes.join(', ')}`).toEqual([]);
    expect(missing(REGISTERED, documented), 'missing from README').toEqual([]);
    expect(missing(documented, REGISTERED), 'in README but not registered').toEqual([]);
  });

  it("README's headline count matches the registered tool count", () => {
    expect(headlineCount(README)).toBe(REGISTERED.length);
  });

  it("CLAUDE.md's module table lists each tool under the file that registers it", () => {
    // Rows look like: | meals.ts | `skylight_list_recipes`, `skylight_plan_meal` |
    const documented = new Map(
      [...CLAUDE_MD.matchAll(/^\| ([a-z]+\.ts) \|(.*)\|$/gm)].map(
        ([, file, cell]) => [file, [...cell.matchAll(/`(skylight_[a-z_]+)`/g)].map((m) => m[1])],
      ),
    );
    // Order within a row is presentational, so compare as sets.
    for (const [file, names] of BY_MODULE) {
      expect([...(documented.get(file) ?? [])].sort(), `CLAUDE.md row for ${file}`)
        .toEqual([...names].sort());
    }
    expect([...documented.keys()].sort()).toEqual([...BY_MODULE.keys()].sort());
  });

  it("the skill's headline count matches the registered tool count", () => {
    // SKILL.md's own tool table is a deliberate curated subset, so only the
    // headline is comparable — but that headline is a claim about the surface,
    // and it had drifted (PR #87 review, finding 3) alongside a flat assertion
    // that meals were unsupported while eight meal tools shipped.
    expect(headlineCount(SKILL_MD)).toBe(REGISTERED.length);
  });

  it("SKILL.md names only tools that exist", () => {
    const named = [...SKILL_MD.matchAll(/`(skylight_[a-z_]+)`/g)].map((m) => m[1]);
    expect(missing(named, REGISTERED), 'named in SKILL.md but not registered').toEqual([]);
  });

  it("CLAUDE.md's headline and total counts match the registered tool count", () => {
    expect(headlineCount(CLAUDE_MD)).toBe(REGISTERED.length);
    const total = /^(\d+) tools total\./m.exec(CLAUDE_MD);
    expect(total, 'no "N tools total." sentence found').not.toBeNull();
    expect(Number(total![1])).toBe(REGISTERED.length);
  });
});

/** Names present in `a` but absent from `b`, sorted for a readable diff. */
function missing(a: string[], b: string[]): string[] {
  const have = new Set(b);
  return a.filter((n) => !have.has(n)).sort();
}
