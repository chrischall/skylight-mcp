import { afterEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
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
import { registerHealthcheckTools } from '../src/tools/health.js';
import { registerLoginTools } from '../src/tools/login.js';
import { makeClient } from './tools/_setup.js';

/**
 * `_meta.mint` — the mcp-host context-groups contract — asserted against the
 * SERVED tool list (every registrar `src/index.ts` passes, over the real MCP
 * client), so a tool added without a hint fails here rather than silently
 * dropping out of the family group.
 */

type Listed = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema: { properties?: Record<string, any>; required?: string[] };
  _meta?: { mint?: Record<string, any> };
};

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

let h: TestHarness | undefined;
afterEach(async () => { await h?.close(); h = undefined; });

async function open(respond: (method: string, path: string) => unknown = () => ({ data: [] })) {
  const made = makeClient();
  made.request.mockImplementation(async (method: string, path: string) => respond(method, path));
  const getClient = async () => made.client;
  h = await createTestHarness((server) => {
    for (const register of [
      registerFrameTools, registerSettingsTools, registerCalendarTools, registerMemberTools,
      registerEventTools, registerListTools, registerChoreTools, registerMealTools,
      registerMessageTools, registerTaskTools, registerRewardTools, registerAiTools, registerPhotoTools, registerLoginTools,
    ]) register(server, getClient);
    registerHealthcheckTools(server, getClient, () => ({ refreshToken: 'x' }) as never);
  });
  return { h, request: made.request };
}

async function served(): Promise<Listed[]> {
  const { h } = await open();
  return (await h.client.listTools()).tools as Listed[];
}

const tool = (tools: Listed[], name: string) => {
  const t = tools.find((x) => x.name === name);
  expect(t, name).toBeDefined();
  return t!;
};

describe('_meta.mint hints on the served tool list', () => {
  it('every tool except the healthcheck carries domain "family" and a valid intent, in the contract shape', async () => {
    const tools = await served();
    expect(tools.length).toBe(116);
    for (const t of tools) {
      if (t.name === 'skylight_healthcheck') continue; // registered by mcp-utils, which takes no _meta
      const m = t._meta?.mint;
      expect(m, t.name).toBeDefined();
      expect(Object.keys(m!).filter((k) => !KEYS.includes(k)), t.name).toEqual([]);
      expect(DOMAINS).toContain(m!.domain);
      expect(m!.domain, t.name).toBe('family');
      expect(INTENTS, t.name).toContain(m!.intent);
    }
  });

  it('canonical only on read-only whats-new/due/on tools, at most one per intent', async () => {
    const tools = await served();
    const seen: Record<string, string[]> = {};
    for (const t of tools) {
      const m = t._meta?.mint;
      if (!m?.canonical) continue;
      expect(m.canonical, t.name).toBe(true);
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(CANONICAL_INTENTS, t.name).toContain(m.intent);
      (seen[m.intent] ??= []).push(t.name);
    }
    for (const [intent, names] of Object.entries(seen)) expect(names.length, intent).toBe(1);
    expect(seen).toEqual({ 'whats-on': ['skylight_list_events'], 'whats-due': ['skylight_list_chores'] });
  });

  it('aliases are ≤ 8, lowercase, ≤ 40 chars; subject and when name real arguments', async () => {
    for (const t of await served()) {
      const m = t._meta?.mint;
      if (!m) continue;
      const props = t.inputSchema.properties ?? {};
      if (m.aliases) {
        expect(Array.isArray(m.aliases), t.name).toBe(true);
        expect(m.aliases.length, t.name).toBeLessThanOrEqual(8);
        for (const a of m.aliases) {
          expect(a.length, `${t.name}: ${a}`).toBeLessThanOrEqual(40);
          expect(a, t.name).toBe(a.toLowerCase());
        }
      }
      if (m.subject !== undefined) expect(props, t.name).toHaveProperty(m.subject);
      if (m.when !== undefined) {
        expect(Object.keys(m.when).sort(), t.name).toEqual(['end', 'start']);
        expect(props, t.name).toHaveProperty(m.when.start);
        expect(props, t.name).toHaveProperty(m.when.end);
      }
    }
  });

  it('the canonical reads take their date range as `when`, offer view: brief, and name no subject', async () => {
    const tools = await served();
    const events = tool(tools, 'skylight_list_events');
    expect(events._meta?.mint).toMatchObject({ intent: 'whats-on', canonical: true, when: { start: 'date_min', end: 'date_max' } });
    const chores = tool(tools, 'skylight_list_chores');
    expect(chores._meta?.mint).toMatchObject({ intent: 'whats-due', canonical: true, when: { start: 'after', end: 'before' } });
    for (const t of [events, chores]) {
      // Skylight cannot filter events or chores by family member, so there is
      // no listable subject to publish — the frame is the whole household.
      expect(t._meta?.mint?.subject, t.name).toBeUndefined();
      expect(t.inputSchema.properties?.view?.enum, t.name).toEqual(['full', 'brief']);
    }
  });

  it('classifies writes by what they do', async () => {
    const tools = await served();
    const intent = (n: string) => tool(tools, n)._meta?.mint?.intent;
    for (const n of ['skylight_invite_user', 'skylight_add_message_comment', 'skylight_upload_photo']) expect(intent(n), n).toBe('send');
    for (const n of ['skylight_create_event', 'skylight_complete_chore', 'skylight_add_list_item', 'skylight_delete_messages', 'skylight_plan_meal', 'skylight_copy_messages_to_frames']) expect(intent(n), n).toBe('change');
    for (const n of ['skylight_generate_meal_plan', 'skylight_generate_activity_ideas']) expect(intent(n), n).toBe('other');
    for (const t of tools) {
      if (t.name === 'skylight_healthcheck') continue;
      const m = t._meta!.mint!;
      if (t.annotations?.readOnlyHint === true && !m.canonical) expect(m.intent, t.name).toBe('lookup');
      if (t.annotations?.readOnlyHint !== true) expect(['send', 'change', 'other'], t.name).toContain(m.intent);
    }
  });
});

const LINE = /^.+ — (\d{4}-\d{2}-\d{2}\S*|no date) — .+$/;

function envelope(result: any): { untrusted_content: boolean; note: string; data: string[] } {
  expect(result.isError, JSON.stringify(result)).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

describe('view: brief on the canonical reads', () => {
  it('skylight_list_events answers one enveloped line per event: title — date — members', async () => {
    const { h, request } = await open(() => ({
      data: [
        { id: '1', type: 'calendar_event', attributes: { summary: 'Soccer', starts_at: '2026-11-05T17:00:00.000-05:00' },
          relationships: { categories: { data: [{ id: '20', type: 'category' }, { id: '21', type: 'category' }] } } },
        { id: '2', type: 'calendar_event', attributes: { summary: 'Holiday', all_day: true, starts_at: '2026-11-06' },
          relationships: { categories: { data: [] } } },
        { id: '3', type: 'calendar_event', attributes: { summary: 'x'.repeat(200) } },
        { id: '4', type: 'calendar_event', attributes: {} },
      ],
      included: [
        { id: '20', type: 'category', attributes: { label: 'Alex' } },
        { id: '21', type: 'category', attributes: { label: 'Sam' } },
      ],
    }));
    const out = envelope(await h.callTool('skylight_list_events', { date_min: '2026-11-05', date_max: '2026-11-06', view: 'brief' }));
    expect(out.untrusted_content).toBe(true);
    expect(out.note).toMatch(/calendar/i);
    expect(out.data).toEqual([
      'Soccer — 2026-11-05T17:00:00.000-05:00 — Alex, Sam',
      'Holiday — 2026-11-06 — all day, unassigned',
      expect.stringMatching(/^x+… — no date — unassigned$/),
      '(untitled) — no date — unassigned',
    ]);
    for (const line of out.data) {
      expect(line.length).toBeLessThanOrEqual(120);
      expect(line).toMatch(LINE);
    }
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/calendar_events', expect.objectContaining({ query: expect.objectContaining({ date_min: '2026-11-05' }) }));
  });

  it('skylight_list_chores answers one enveloped line per chore: title — date — status (assignee)', async () => {
    const { h } = await open(() => ({
      data: [
        { id: '1', type: 'chore', attributes: { summary: 'Dishes', start: '2026-11-05', status: 'pending' } },
        { id: '2', type: 'chore', attributes: { summary: 'Trash', start: '2026-11-05', start_time: '17:00', status: 'complete' } },
        { id: '3', type: 'chore', attributes: { summary: 'Sweep' } },
      ],
    }));
    const out = envelope(await h.callTool('skylight_list_chores', { after: '2026-11-05', before: '2026-11-06', view: 'brief' }));
    expect(out.untrusted_content).toBe(true);
    expect(out.note).toMatch(/chore/i);
    expect(out.data).toEqual([
      'Dishes — 2026-11-05 — pending',
      'Trash — 2026-11-05T17:00 — complete',
      'Sweep — no date — no status',
    ]);
    for (const line of out.data) expect(line).toMatch(LINE);
  });

  it('an empty range answers the "-- none" note, inside the envelope', async () => {
    const { h } = await open(() => ({ data: [] }));
    expect(envelope(await h.callTool('skylight_list_events', { date_min: '2026-11-05', date_max: '2026-11-06', view: 'brief' })).data).toEqual(['-- none']);
    expect(envelope(await h.callTool('skylight_list_chores', { after: '2026-11-05', before: '2026-11-06', view: 'brief' })).data).toEqual(['-- none']);
  });

  it('an empty chores response body also answers "-- none"', async () => {
    const { h } = await open(() => undefined);
    expect(envelope(await h.callTool('skylight_list_chores', { after: '2026-11-05', before: '2026-11-06', view: 'brief' })).data).toEqual(['-- none']);
  });

  it('without view: brief the reads answer exactly as before', async () => {
    const { h } = await open(() => ({ data: [{ id: '1', type: 'chore', attributes: { summary: 'Dishes', status: 'pending' } }] }));
    const full = await h.callTool('skylight_list_chores', { after: '2026-11-05', before: '2026-11-06', view: 'full' });
    expect(JSON.parse((full.content as any)[0].text)).toEqual([{ summary: 'Dishes', status: 'pending', id: '1', type: 'chore' }]);
  });
});

describe('brief edge cases', () => {
  it('names an unlabelled member by id', async () => {
    const { h } = await open(() => ({
      data: [{ id: '1', type: 'calendar_event', attributes: { summary: 'Dentist', starts_at: '2026-11-05' },
        relationships: { categories: { data: [{ id: '99', type: 'category' }] } } }],
    }));
    expect(envelope(await h.callTool('skylight_list_events', { date_min: '2026-11-05', date_max: '2026-11-06', view: 'brief' })).data)
      .toEqual(['Dentist — 2026-11-05 — member 99']);
  });

  it('reports an unrecognised chores envelope as an error note, never as "-- none"', async () => {
    const { h } = await open(() => ({ data: { id: '1', type: 'chore', attributes: {} } }));
    const data = envelope(await h.callTool('skylight_list_chores', { after: '2026-11-05', before: '2026-11-06', view: 'brief' })).data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatch(/^-- error: /);
  });

  it('escapes an item whose title starts with "-- " or "\\" with one leading backslash, so it never reads as a note', async () => {
    const { h } = await open(() => ({
      data: [
        { id: '1', type: 'chore', attributes: { summary: '-- none', start: '2026-11-05', status: 'pending' } },
        { id: '2', type: 'chore', attributes: { summary: '\\server', start: '2026-11-05', status: 'pending' } },
        { id: '3', type: 'chore', attributes: { summary: '--no space', start: '2026-11-05', status: 'pending' } },
      ],
    }));
    expect(envelope(await h.callTool('skylight_list_chores', { after: '2026-11-05', before: '2026-11-06', view: 'brief' })).data).toEqual([
      '\\-- none — 2026-11-05 — pending',
      '\\\\server — 2026-11-05 — pending',
      '--no space — 2026-11-05 — pending',
    ]);
    const { h: ev } = await open(() => ({ data: [{ id: '1', type: 'calendar_event', attributes: { summary: '-- 1 of 9 shown', starts_at: '2026-11-05' } }] }));
    expect(envelope(await ev.callTool('skylight_list_events', { date_min: '2026-11-05', date_max: '2026-11-06', view: 'brief' })).data)
      .toEqual(['\\-- 1 of 9 shown — 2026-11-05 — unassigned']);
  });

  it('cuts an escaped title as part of the whole line, keeping the line within 120 chars', async () => {
    const { briefLine } = await import('../src/tools/hints.js');
    const line = briefLine(`-- ${'z'.repeat(200)}`, '2026-11-05', 'pending');
    expect(line.length).toBe(120);
    expect(line.startsWith('\\-- z')).toBe(true);
    expect(line.endsWith('… — 2026-11-05 — pending')).toBe(true);
  });

  it('keeps a line within 120 chars even when the tail alone would overflow', async () => {
    const { briefLine } = await import('../src/tools/hints.js');
    const line = briefLine('Carpool', '2026-11-05', 'y'.repeat(200));
    expect(line.length).toBe(120);
    expect(line.endsWith('…')).toBe(true);
    expect(briefLine('Carpool', undefined, 'pending')).toBe('Carpool — no date — pending');
  });
});
