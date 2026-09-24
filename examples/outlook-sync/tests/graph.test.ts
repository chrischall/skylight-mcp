import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Graph, interval, owns, payload } from '../src/graph.js';
import { configSchema } from '../src/model.js';
const c = configSchema.parse({
  syncId: randomUUID(),
  frameId: '1',
  account: 'owner@example.com',
  calendarId: 'calendar',
  excludedCategoryIds: ['self'],
  excludedCalendarAccountIds: ['outlook'],
});
const auth = { token: async () => 'synthetic-token' };
describe('Graph boundaries', () => {
  it('follows pagination only on Graph without leaking a bearer token', async () => {
    const http = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ value: [], '@odata.nextLink': 'https://attacker.invalid/steal' }),
        ),
    );
    await expect(new Graph(auth, c, http).list('2026-01-01', '2026-02-01')).rejects.toThrow(
      'DESTINATION_INVALID',
    );
    expect(http).toHaveBeenCalledOnce();
  });
  it('pins the account before writing', async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({ mail: 'wrong@example.com' })));
    await expect(new Graph(auth, c, http).verifyAccount()).rejects.toThrow('WRONG_MICROSOFT');
  });
  it('does not retry ambiguous writes', async () => {
    const http = vi.fn(async () => {
      throw new Error('network');
    });
    await expect(new Graph(auth, c, http).create({})).rejects.toThrow('UNCERTAIN');
    expect(http).toHaveBeenCalledOnce();
  });
  it('sends immutable-ID, timezone and ETag protections', async () => {
    const http = vi.fn(async () => new Response(null, { status: 204 }));
    await new Graph(auth, c, http).update('id/with/slash', { subject: 'synthetic' }, 'version1');
    const [url, init] = http.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toContain('id%2Fwith%2Fslash');
    expect(init.headers).toMatchObject({
      'If-Match': 'version1',
      Prefer: expect.stringContaining('ImmutableId'),
    });
    expect(init.redirect).toBe('error');
  });
  it('converts all-day UTC responses to local dates across DST', () => {
    const g: any = {
      subject: 'All-day',
      isAllDay: true,
      start: { dateTime: '2026-11-01T04:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-11-02T05:00:00.0000000', timeZone: 'UTC' },
    };
    expect(interval(g, c)).toEqual({ title: 'All-day', start: '2026-11-01', end: '2026-11-02' });
  });
  it('only recognizes a provenance marker at the start of the body', () => {
    const e = {
      key: 'k',
      sourceId: 's',
      title: 'x',
      start: '2026-10-01T10:00:00Z',
      end: '2026-10-01T11:00:00Z',
      allDay: false,
      description: '',
      location: '',
    };
    const b = payload(e, c).body;
    expect(owns({ body: b } as any, c, 'k')).toBe(true);
    expect(owns({ body: { content: 'Quoted text ' + b.content } } as any, c, 'k')).toBe(false);
  });
});
