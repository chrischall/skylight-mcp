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
function registeredAnnotations(): Record<string, Ann | undefined> {
  const seen: Record<string, Ann | undefined> = {};
  const server = {
    registerTool: (name: string, cfg: { annotations?: Ann }) => {
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

interface Ann { readOnlyHint?: unknown; destructiveHint?: unknown; openWorldHint?: unknown }

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

  // The readOnlyHint check above cannot see the other half. `destructiveHint`
  // DEFAULTS TO TRUE whenever readOnlyHint is false, so a new write tool that
  // forgets to declare it is published as destructive and nothing fails — a
  // considered `false` and a forgotten one leave identical annotations.
  //
  // The whole point of #190 was that a client which alarms on every write has
  // said nothing, so the invariant worth pinning is that each write CHOOSES.
  it('sets an explicit boolean destructiveHint on every write', () => {
    const undeclared = Object.entries(registeredAnnotations())
      .filter(([, a]) => a?.readOnlyHint === false && typeof a?.destructiveHint !== 'boolean')
      .map(([name]) => name);
    expect(undeclared).toEqual([]);
  });

  it('never lets a read claim to be destructive', () => {
    // The cheap direction to get wrong, and invisible without asking.
    const contradictory = Object.entries(registeredAnnotations())
      .filter(([, a]) => a?.readOnlyHint === true && a?.destructiveHint === true)
      .map(([name]) => name);
    expect(contradictory).toEqual([]);
  });

  it('holds the destructive set at its measured size', () => {
    // Counted off the built server, not derived — an earlier version of this
    // test reasoned "16 DELETEs plus the three that reach a person" and
    // asserted 20, which is wrong. A tripwire, in the same spirit as the 113
    // above: growing this set should be a decision somebody makes, not a
    // side effect of adding a tool.
    const destructive = Object.entries(registeredAnnotations())
      .filter(([, a]) => a?.readOnlyHint === false && a?.destructiveHint === true);
    expect(destructive).toHaveLength(29);
  });

  it('declares every tool open-world (each one calls the Skylight API)', () => {
    // openWorldHint defaults to TRUE, so an omitted one reads the same as a
    // considered one — but the fleet lint (audit-annotations --strict) treats
    // silence as unclassified. Nothing here is local-only.
    const notOpen = Object.entries(registeredAnnotations())
      .filter(([, a]) => a?.openWorldHint !== true)
      .map(([name]) => name);
    expect(notOpen).toEqual([]);
  });

  it('marks the state-discarding writes destructive (fleet-audit#731)', () => {
    // An AI intent and its drafts are thrown away with nothing here to bring
    // them back, so a host that auto-approves non-destructive writes must not
    // run it unprompted.
    const ann = registeredAnnotations();
    expect(ann.skylight_undo_auto_creation).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  });

  it('applies the inverse test: a write with an inverse here is not destructive', () => {
    // destructive:false means a later call in THIS tool set restores the prior
    // state. Album membership comes back with skylight_add_to_album, and a like
    // with skylight_like_message, so neither removal is destructive.
    const ann = registeredAnnotations();
    for (const name of ['skylight_remove_from_album', 'skylight_unlike_message']) {
      expect(ann[name], name).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    }
  });

  it('marks writes with no inverse destructive even when they look additive', () => {
    // A comment reaches the frame's other members and nothing here deletes it;
    // open_to_public widens who can reach the frame (an access reduction, like
    // an unlock); linking iCloud hands Skylight an Apple credential no tool
    // here can take back; create/update_event send invitations to the
    // addresses in invited_emails, and deleting the event later does not
    // un-send an invite that already went out.
    const ann = registeredAnnotations();
    for (const name of [
      'skylight_add_message_comment',
      'skylight_update_frame',
      'skylight_link_apple_calendar',
      'skylight_create_event',
      'skylight_update_event',
    ]) {
      expect(ann[name], name).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    }
  });
});
