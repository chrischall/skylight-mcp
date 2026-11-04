import { z } from 'zod';
import { UNTRUSTED_CONTENT_RULE, untrustedEnvelope } from '@chrischall/mcp-utils';
import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * Context-group hints, published on each tool as `_meta.mint` (mcp-host's
 * `mintHintSchema`, the context-groups contract). Inert data: a host that does
 * not read them sees an extra `_meta` key and nothing else. The shape is fixed
 * by the host's contract, so it is restated here rather than imported — this
 * server takes no dependency on mcp-host.
 *
 * `subject` and `when` name THIS tool's own argument names (the host fills
 * them), never values; `aliases` are lowercase, at most 8, each at most 40
 * chars. Skylight has no `subject`: its event and chore reads cannot be
 * filtered by family member, and the frame is the whole household.
 */
export type MintIntent =
  | 'whats-new' | 'whats-due' | 'whats-on' | 'lookup' | 'turn-on-off' | 'send' | 'change' | 'other';

export interface MintHint {
  domain: 'family';
  intent: MintIntent;
  canonical?: true;
  subject?: string;
  when?: { start: string; end: string };
  aliases?: string[];
}

/** `_meta` for a Skylight tool: every tool here is in the `family` group. */
export function familyMeta(
  intent: MintIntent,
  extra: Omit<MintHint, 'domain' | 'intent'> = {},
): { mint: MintHint } {
  return { mint: { domain: 'family', intent, ...extra } };
}

/** A read that is not a group answer. */
export const LOOKUP = familyMeta('lookup');
/** A write that edits the frame's own data. */
export const CHANGE = familyMeta('change');
/** A write that reaches another person (an invite, a comment, a posted photo). */
export const SEND = familyMeta('send');

/** The `view` argument a canonical read takes. */
export const viewParam = z.enum(['full', 'brief']).optional();

const BRIEF_MAX = 120;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * One brief line, `title — <ISO date | no date> — <status>`, at most 120
 * characters: the title is shortened first, and a tail that alone would
 * overflow is cut with an ellipsis. A title starting with `-- ` (a note's
 * prefix) or `\` is escaped with one leading `\`, which the gateway strips
 * after its note check, so an item can never masquerade as a note.
 */
export function briefLine(title: unknown, date: unknown, status: string): string {
  const tail = ` — ${str(date) ?? 'no date'} — ${status}`;
  const raw = str(title) ?? '(untitled)';
  const name = raw.startsWith('-- ') || raw.startsWith('\\') ? `\\${raw}` : raw;
  const room = BRIEF_MAX - tail.length;
  if (room >= 2) return `${name.length > room ? `${name.slice(0, room - 1)}…` : name}${tail}`;
  return `${name.slice(0, 1)}${tail}`.slice(0, BRIEF_MAX - 1) + '…';
}

/**
 * The brief answer, inside the fleet's untrusted-data envelope: the lines
 * carry text other people wrote (event titles from subscribed feeds, chore
 * titles from anyone on the frame). `-- none` is the empty-result note.
 */
export function briefResponse(lines: string[], whoWrote: string): CallToolResult {
  const payload = untrustedEnvelope(lines.length ? lines : ['-- none'], { note: `${whoWrote} ${UNTRUSTED_CONTENT_RULE}` });
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
