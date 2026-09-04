import { describe, it, expect } from 'vitest';
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
import { makeClient } from './tools/_setup.js';

/**
 * CLAUDE.md's rule since the `registerTool` migration: every tool declares
 * `readOnlyHint`. That rule is only worth writing down if something checks it.
 *
 * The migration existed BECAUSE the old `server.tool(name, desc, schema, cb)`
 * signature carried no annotations at all, so nothing here declared which
 * tools were reads and which were writes. A new tool added with the annotation
 * omitted would quietly reintroduce exactly that state — and the failure is
 * invisible: an absent `readOnlyHint` is not "unknown" to a host that reads
 * annotations, it is indistinguishable from a tool nobody has classified.
 *
 * So this reads the REGISTERED config rather than a hand-kept list, the same
 * posture as `skill-gate-table.test.ts`.
 */
function registeredAnnotations(): Record<string, { readOnlyHint?: unknown } | undefined> {
  const seen: Record<string, { readOnlyHint?: unknown } | undefined> = {};
  const server = {
    registerTool: (name: string, cfg: { annotations?: { readOnlyHint?: unknown } }) => {
      seen[name] = cfg.annotations;
    },
  } as never;
  const { client } = makeClient();
  const get = async () => client;
  for (const register of [
    registerFrameTools,
    registerSettingsTools,
    registerCalendarTools,
    registerMemberTools,
    registerEventTools,
    registerListTools,
    registerChoreTools,
    registerMealTools,
    registerMessageTools,
    registerTaskTools,
    registerRewardTools,
    registerAiTools,
    registerPhotoTools,
  ]) {
    register(server, get as never);
  }
  return seen;
}

describe('every tool declares whether it is a read', () => {
  it('registers the full surface (guards against a registrar being dropped here)', () => {
    // A meta-test that silently stops covering half the tools is worse than no
    // meta-test, so the count is asserted before the property is.
    expect(Object.keys(registeredAnnotations())).toHaveLength(113);
  });

  it('sets an explicit boolean readOnlyHint on all of them', () => {
    const missing = Object.entries(registeredAnnotations())
      .filter(([, a]) => typeof a?.readOnlyHint !== 'boolean')
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});
