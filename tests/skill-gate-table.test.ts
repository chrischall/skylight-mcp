import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { registerMealTools } from '../src/tools/meals.js';
import { registerChoreTools } from '../src/tools/chores.js';
import { makeClient } from './tools/_setup.js';

/**
 * The skill's gate table drifted from the schemas: it named `this_and_future`
 * for `skylight_delete_chore`, whose enum is `one|all` — a scope that tool
 * rejects outright. A reviewer caught it, not a test.
 *
 * The four tools deliberately do NOT share one vocabulary, so a hand-written
 * table is guaranteed to drift again. This reads the REGISTERED schemas and
 * holds the table to them.
 */
function registeredApplyToEnums(): Record<string, string[]> {
  const schemas: Record<string, any> = {};
  const server = {
    registerTool: (name: string, cfg: any) => {
      schemas[name] = cfg.inputSchema;
    },
  } as any;
  const { client } = makeClient();
  registerMealTools(server, async () => client);
  registerChoreTools(server, async () => client);

  const out: Record<string, string[]> = {};
  for (const [name, shape] of Object.entries(schemas)) {
    const field = (shape as Record<string, unknown>)?.apply_to;
    if (!field) continue;
    // Unwrap .optional() to reach the enum underneath.
    const inner = (field as any)._def?.innerType ?? field;
    const values = (inner as any)?._def?.values ?? (inner as any)?.options;
    if (Array.isArray(values)) out[name] = [...values];
  }
  return out;
}

/** Parse the SKILL table into { tool: {accepts, gates} }. */
function skillTable(): Record<string, { accepts: string[]; gates: string[] }> {
  const md = readFileSync(join(__dirname, '..', 'skills', 'skylight-mcp', 'SKILL.md'), 'utf8');
  const rows: Record<string, { accepts: string[]; gates: string[] }> = {};
  for (const raw of md.split('\n')) {
    if (!/^\|\s*`skylight_/.test(raw)) continue;
    // The `accepts` cell lists alternatives as markdown-ESCAPED pipes (`\|`),
    // which are not column separators. Mask them before splitting, or every
    // row parses as a single value and the guard silently checks nothing.
    const cells = raw.replace(/\\\|/g, '\u0000').split('|').map((c) => c.replace(/\u0000/g, '|'));
    const codes = (s: string) => [...s.matchAll(/`([a-z_]+)`/g)].map((x) => x[1]!);
    const tool = codes(cells[1] ?? '')[0];
    if (!tool) continue;
    rows[tool] = { accepts: codes(cells[2] ?? ''), gates: codes(cells[3] ?? '') };
  }
  return rows;
}

describe('SKILL.md gate table matches the registered schemas', () => {
  const enums = registeredApplyToEnums();
  const table = skillTable();

  it('documents every tool that takes apply_to, and no others', () => {
    expect(Object.keys(table).sort()).toEqual(Object.keys(enums).sort());
  });

  it.each(Object.keys(enums))('%s lists exactly the scopes its schema accepts', (tool) => {
    expect(table[tool]?.accepts.sort()).toEqual([...enums[tool]!].sort());
  });

  // The rule: gate when the scope reaches PAST the occurrence named.
  const MULTI = new Set(['future', 'this_and_future', 'all']);
  it.each(Object.keys(enums))('%s gates exactly its multi-occurrence scopes', (tool) => {
    const expected = enums[tool]!.filter((v) => MULTI.has(v)).sort();
    expect(table[tool]?.gates.sort()).toEqual(expected);
  });
});
