import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sync } from '../src/engine.js';
import {
  configSchema,
  binding,
  daytime,
  horizon,
  fingerprint,
  type Event,
  type State,
} from '../src/model.js';
import { payload, type OutlookEvent } from '../src/graph.js';
import { encrypt, decrypt, GitHubStore } from '../src/store.js';
import { normalize, listData } from '../src/source.js';
import { MicrosoftAuth } from '../src/auth.js';
const c = configSchema.parse({
  syncId: randomUUID(),
  frameId: '123',
  account: 'owner@example.com',
  calendarId: 'cal',
  excludedCategoryIds: ['self'],
  excludedCalendarAccountIds: ['outlook'],
  sourceContractVerified: true,
  allowDeletes: true,
});
const range = { from: '2026-09-24', to: '2027-09-25' },
  now = new Date('2026-09-24T14:00Z');
function event(key = 'one'): Event {
  return {
    key,
    sourceId: key,
    title: 'Synthetic appointment',
    start: '2026-10-01T19:00:00.000Z',
    end: '2026-10-01T20:00:00.000Z',
    allDay: false,
    description: 'Synthetic only',
    location: '',
  };
}
function state(): State {
  return { version: 1, binding: binding(c), mappings: {}, legacy: [] };
}
function setup(events = [event()]) {
  const db = new Map<string, OutlookEvent>();
  const source = {
    snapshot: vi.fn(async () => ({
      events,
      seen: new Set(events.map((e) => e.key)),
      complete: true,
    })),
    confirmMissing: vi.fn(async () => true),
  };
  const toGraph = (b: any, id: string): OutlookEvent => ({
    ...b,
    id,
    type: 'singleInstance',
    attendees: [],
    isAllDay: b.isAllDay,
    '@odata.etag': 'test-etag',
  });
  const dest = {
    list: vi.fn(async () => [...db.values()]),
    get: vi.fn(async (id: string) => db.get(id)),
    create: vi.fn(async (b: any) => {
      const same = [...db.values()].find((x) => x.transactionId === b.transactionId);
      if (same) return same;
      const g = toGraph(b, randomUUID());
      db.set(g.id, g);
      return g;
    }),
    update: vi.fn(async (id: string, b: any) => {
      db.set(id, { ...db.get(id)!, ...b });
    }),
    remove: vi.fn(async (id: string) => {
      db.delete(id);
    }),
  };
  const s = state(),
    save = vi.fn(async () => {});
  return { db, source, dest, s, save };
}
describe('cloud reconciliation', () => {
  it('dry run is read-only, creates once, then remains unchanged', async () => {
    const f = setup();
    const before = JSON.stringify(f.s);
    expect((await sync(c, f.s, f.source, f.dest, f.save, range)).added).toBe(1);
    expect(JSON.stringify(f.s)).toBe(before);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.dest.create).not.toHaveBeenCalled();
    await sync(c, f.s, f.source, f.dest, f.save, range, true);
    await sync(c, f.s, f.source, f.dest, f.save, range, true);
    expect(f.dest.create).toHaveBeenCalledTimes(1);
  });
  it('recovers a lost create response without creating again', async () => {
    const f = setup();
    f.dest.create.mockImplementationOnce(async (b: any) => {
      const g = { ...b, id: 'saved', type: 'singleInstance', attendees: [] };
      f.db.set('saved', g);
      throw new Error('lost response');
    });
    await expect(sync(c, f.s, f.source, f.dest, f.save, range, true)).rejects.toThrow();
    expect(f.s.mappings.one.pending).toBe('create');
    await sync(c, f.s, f.source, f.dest, f.save, range, true);
    expect(f.dest.create).toHaveBeenCalledTimes(1);
    expect(f.s.mappings.one.destinationId).toBe('saved');
  });
  it('does not write if the checkpoint fails', async () => {
    const f = setup();
    f.save.mockRejectedValue(new Error('state failure'));
    await expect(sync(c, f.s, f.source, f.dest, f.save, range, true)).rejects.toThrow();
    expect(f.dest.create).not.toHaveBeenCalled();
  });
  it('updates title and time without invitations', async () => {
    const f = setup();
    await sync(c, f.s, f.source, f.dest, f.save, range, true);
    const next = {
      ...event(),
      title: 'Changed',
      start: '2026-10-01T21:00:00.000Z',
      end: '2026-10-01T22:00:00.000Z',
    };
    f.source.snapshot.mockResolvedValue({ events: [next], seen: new Set(['one']), complete: true });
    const r = await sync(c, f.s, f.source, f.dest, f.save, range, true);
    expect(r.updated).toBe(1);
    expect(f.dest.update.mock.calls[0][1]).not.toHaveProperty('attendees');
  });
  it('adopts an existing import instead of duplicating it', async () => {
    const f = setup();
    const e = event();
    f.s.legacy = [{ ...e, uid: 'legacy' }];
    f.db.set('legacy', {
      ...payload(e, c),
      id: 'legacy',
      type: 'singleInstance',
      attendees: [],
      body: { contentType: 'text', content: 'One-time copy from Skylight export.' },
    });
    const r = await sync(c, f.s, f.source, f.dest, f.save, range, true);
    expect(r.adopted).toBe(1);
    expect(f.dest.create).not.toHaveBeenCalled();
    expect(f.s.legacy).toHaveLength(0);
  });
  it('recovers adoption interrupted before Outlook write', async () => {
    const f = setup();
    const e = event();
    f.s.legacy = [{ ...e, uid: 'legacy' }];
    f.db.set('legacy', {
      ...payload(e, c),
      id: 'legacy',
      type: 'singleInstance',
      attendees: [],
      body: { contentType: 'text', content: 'One-time copy from Skylight export.' },
    });
    f.dest.update.mockRejectedValueOnce(new Error('network'));
    await expect(sync(c, f.s, f.source, f.dest, f.save, range, true)).rejects.toThrow();
    expect((await sync(c, f.s, f.source, f.dest, f.save, range, true)).adopted).toBe(1);
    expect(f.dest.create).not.toHaveBeenCalled();
  });
  it('fails closed when a legacy source changed before migration', async () => {
    const f = setup();
    f.s.legacy = [{ ...event(), title: 'Old title', uid: 'legacy' }];
    await expect(sync(c, f.s, f.source, f.dest, f.save, range, true)).rejects.toThrow(
      'LEGACY_SOURCE_CHANGED',
    );
    expect(f.dest.create).not.toHaveBeenCalled();
  });
  it('ignores unrelated appointments and rejects changed provenance', async () => {
    const f = setup();
    await sync(c, f.s, f.source, f.dest, f.save, range, true);
    const id = f.s.mappings.one.destinationId!;
    f.db.get(id)!.body.content = 'Personal event';
    await expect(sync(c, f.s, f.source, f.dest, f.save, range, true)).rejects.toThrow('PROVENANCE');
    expect(f.dest.remove).not.toHaveBeenCalled();
  });
  it('never edits managed appointments with attendees', async () => {
    const f = setup();
    await sync(c, f.s, f.source, f.dest, f.save, range, true);
    f.db.get(f.s.mappings.one.destinationId!)!.attendees = [{}];
    await expect(sync(c, f.s, f.source, f.dest, f.save, range, true)).rejects.toThrow('UNSAFE');
  });
  it('requires two separated missing observations and a focused recheck', async () => {
    const f = setup([event(), event('two')]);
    await sync(c, f.s, f.source, f.dest, f.save, range, true, now);
    f.source.snapshot.mockResolvedValue({
      events: [event('two')],
      seen: new Set(['two']),
      complete: true,
    });
    await sync(c, f.s, f.source, f.dest, f.save, range, true, now);
    expect(f.dest.remove).not.toHaveBeenCalled();
    await sync(c, f.s, f.source, f.dest, f.save, range, true, new Date(now.valueOf() + 3599000));
    expect(f.dest.remove).not.toHaveBeenCalled();
    await sync(c, f.s, f.source, f.dest, f.save, range, true, new Date(now.valueOf() + 3600000));
    expect(f.dest.remove).toHaveBeenCalledTimes(1);
    expect(f.source.confirmMissing).toHaveBeenCalledTimes(1);
  });
  it('never infers deletions from incomplete or empty snapshots', async () => {
    const f = setup();
    await sync(c, f.s, f.source, f.dest, f.save, range, true);
    f.source.snapshot.mockResolvedValue({ events: [], seen: new Set(), complete: false });
    await expect(sync(c, f.s, f.source, f.dest, f.save, range, true)).rejects.toThrow('CONTRACT');
    f.source.snapshot.mockResolvedValue({ events: [], seen: new Set(), complete: true });
    await expect(sync(c, f.s, f.source, f.dest, f.save, range, true)).rejects.toThrow('EMPTY');
    expect(f.dest.remove).not.toHaveBeenCalled();
  });
  it('does not delete events simply because they became past', async () => {
    const f = setup();
    await sync(c, f.s, f.source, f.dest, f.save, range, true);
    f.source.snapshot.mockResolvedValue({ events: [], seen: new Set(), complete: true });
    await sync(c, f.s, f.source, f.dest, f.save, { from: '2026-11-01', to: range.to }, true);
    expect(f.dest.remove).not.toHaveBeenCalled();
  });
  it('stops before writes when a change limit is exceeded', async () => {
    const f = setup([event(), event('two')]);
    await expect(
      sync({ ...c, maxChanges: 1 }, f.s, f.source, f.dest, f.save, range, true),
    ).rejects.toThrow('CHANGE_LIMIT');
    expect(f.dest.create).not.toHaveBeenCalled();
  });
  it('rejects account/calendar binding changes', async () => {
    const f = setup();
    await expect(
      sync({ ...c, calendarId: 'other' }, f.s, f.source, f.dest, f.save, range, true),
    ).rejects.toThrow('BINDING');
  });
});
describe('data boundaries', () => {
  it('excludes Outlook-origin events even if their profile changes', () => {
    const e = {
      id: 'a',
      attributes: { summary: 'Copy', kind: 'standard', all_day: false },
      relationships: { categories: { data: [] }, calendar_account: { data: { id: 'outlook' } } },
    };
    expect(normalize(e, c).event).toBeUndefined();
  });
  it('fails closed on unknown pagination and missing category data', () => {
    expect(() => listData({ data: [], links: { next: 'https://example.invalid' } })).toThrow(
      'PAGINATION',
    );
    expect(() =>
      normalize({ id: 'a', attributes: { summary: 'x', kind: 'standard', all_day: false } }, c),
    ).toThrow('CATEGORIES');
  });
  it('preserves expanded recurring occurrence IDs and explicit offsets', () => {
    const e = {
      id: 'master-12345',
      attributes: {
        summary: 'x',
        kind: 'standard',
        all_day: false,
        starts_at: '2026-11-06T15:30:00-05:00',
        ends_at: '2026-11-06T16:30:00-05:00',
      },
      relationships: { categories: { data: [] }, calendar_account: { data: null } },
    };
    expect(normalize(e, c).event?.start).toBe('2026-11-06T20:30:00.000Z');
    expect(normalize(e, c).event?.sourceId).toBe('master-12345');
  });
  it('keeps all-day local dates and writes with the configured Outlook timezone', () => {
    const e = { ...event(), allDay: true, start: '2026-11-06', end: '2026-11-07' };
    expect(payload(e, c).start).toEqual({
      dateTime: '2026-11-06T00:00:00',
      timeZone: 'Eastern Standard Time',
    });
  });
  it('honors daytime across daylight saving and a rolling leap-year horizon', () => {
    expect(daytime(new Date('2026-11-06T12:59Z'), c)).toBe(false);
    expect(daytime(new Date('2026-11-06T13:00Z'), c)).toBe(true);
    expect(daytime(new Date('2026-09-24T12:00Z'), c)).toBe(true);
    expect(horizon(new Date('2028-02-29T15:00Z'), c.timezone).to).toBe('2029-03-01');
  });
  it('authenticated encryption detects tampering and wrong keys', () => {
    const s = state(),
      key = 'aa'.repeat(32),
      enc = encrypt(s, key);
    expect(decrypt(enc, key)).toEqual(s);
    expect(enc).not.toContain('mappings');
    expect(() => decrypt(enc, 'bb'.repeat(32))).toThrow('DECRYPT');
    const x = JSON.parse(enc);
    x.data = 'A' + x.data.slice(1);
    expect(() => decrypt(JSON.stringify(x), key)).toThrow('DECRYPT');
  });
  it('refuses state storage in a public repository', async () => {
    const http = vi.fn(
      async () => new Response(JSON.stringify({ private: false }), { status: 200 }),
    );
    await expect(
      new GitHubStore('owner/repo', 'token', 'aa'.repeat(32), http).load(),
    ).rejects.toThrow('PRIVATE');
  });
  it('persists a rotated Microsoft token before returning it', async () => {
    const s = state();
    s.microsoft = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 0 };
    const save = vi.fn(async () => {});
    const http = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }),
          { status: 200 },
        ),
    );
    expect(await new MicrosoftAuth('client', s, save, http).token()).toBe('new');
    expect(s.microsoft.refreshToken).toBe('rotated');
    expect(save).toHaveBeenCalledOnce();
  });
  it('never returns a refreshed token if its checkpoint failed', async () => {
    const s = state();
    s.microsoft = { accessToken: 'old', refreshToken: 'r', expiresAt: 0 };
    const http = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }),
          { status: 200 },
        ),
    );
    await expect(
      new MicrosoftAuth(
        'client',
        s,
        async () => {
          throw new Error('checkpoint');
        },
        http,
      ).token(),
    ).rejects.toThrow('checkpoint');
  });
});
