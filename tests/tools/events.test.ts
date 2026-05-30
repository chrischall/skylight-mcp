import { describe, it, expect } from 'vitest';
import { registerEventTools } from '../../src/tools/events.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  const server = { tool: (n: string, _d: string, _s: any, cb: any) => { tools[n] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerEventTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('event tools', () => {
  // ── skylight_list_events ─────────────────────────────────────────────────

  it('list_events passes the date range, timezone, and include', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'calendar_event', attributes: { summary: 'Soccer' } }] });
    const out = await tools.skylight_list_events({ date_min: '2026-05-01', date_max: '2026-06-01', timezone: 'America/New_York' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/calendar_events', {
      query: { date_min: '2026-05-01', date_max: '2026-06-01', timezone: 'America/New_York', include: 'categories,calendar_account,event_notification_setting' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'calendar_event', summary: 'Soccer' }]);
  });

  it('list_events with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_events({ date_min: '2026-05-01', date_max: '2026-06-01', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/calendar_events', {
      query: { date_min: '2026-05-01', date_max: '2026-06-01', timezone: undefined, include: 'categories,calendar_account,event_notification_setting' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  it('list_events without timezone passes timezone as undefined', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_events({ date_min: '2026-05-01', date_max: '2026-06-01' });
    const callArgs = request.mock.calls[0];
    expect(callArgs[2].query.timezone).toBeUndefined();
  });

  // ── skylight_get_event ──────────────────────────────────────────────────

  it('get_event fetches by id with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'calendar_event', attributes: { summary: 'Dentist' } } });
    const out = await tools.skylight_get_event({ id: '7' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/calendar_events/7');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '7', type: 'calendar_event', summary: 'Dentist' });
  });

  it('get_event with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'calendar_event', attributes: {} } });
    await tools.skylight_get_event({ id: '7', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/calendar_events/7');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_create_event ───────────────────────────────────────────────

  it('create_event posts the calendar_event envelope', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar_event', attributes: { summary: 'Dentist' } } });
    await tools.skylight_create_event({ summary: 'Dentist', starts_at: '2026-06-02T15:00:00Z', ends_at: '2026-06-02T16:00:00Z' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/calendar_events', {
      body: { calendar_event: { summary: 'Dentist', starts_at: '2026-06-02T15:00:00Z', ends_at: '2026-06-02T16:00:00Z' } },
    });
  });

  it('create_event with all attrs sends them all (compact keeps defined values)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '6', type: 'calendar_event', attributes: {} } });
    await tools.skylight_create_event({
      summary: 'Soccer',
      starts_at: '2026-06-10T10:00:00Z',
      ends_at: '2026-06-10T11:00:00Z',
      all_day: false,
      description: 'Bring cleats',
      location: 'Park',
      timezone: 'America/Chicago',
      invited_emails: ['alice@example.com'],
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/calendar_events', {
      body: {
        calendar_event: {
          summary: 'Soccer',
          starts_at: '2026-06-10T10:00:00Z',
          ends_at: '2026-06-10T11:00:00Z',
          all_day: false,
          description: 'Bring cleats',
          location: 'Park',
          timezone: 'America/Chicago',
          invited_emails: ['alice@example.com'],
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
        },
      },
    });
  });

  it('create_event with only summary strips undefined attrs via compact()', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'calendar_event', attributes: { summary: 'Quick' } } });
    await tools.skylight_create_event({ summary: 'Quick' });
    const body = request.mock.calls[0][2].body;
    expect(body.calendar_event).toEqual({ summary: 'Quick' });
    expect('starts_at' in body.calendar_event).toBe(false);
    expect('ends_at' in body.calendar_event).toBe(false);
  });

  it('create_event with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'calendar_event', attributes: {} } });
    await tools.skylight_create_event({ summary: 'Test', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/calendar_events', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_event ───────────────────────────────────────────────

  it('update_event patches by id with only provided attrs', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar_event', attributes: {} } });
    await tools.skylight_update_event({ id: '5', location: 'Office' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/calendar_events/5', { body: { calendar_event: { location: 'Office' } } });
  });

  it('update_event with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar_event', attributes: {} } });
    await tools.skylight_update_event({ id: '5', summary: 'Updated', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/99/calendar_events/5', { body: { calendar_event: { summary: 'Updated' } } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  it('update_event with all attrs sends them all', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar_event', attributes: {} } });
    await tools.skylight_update_event({
      id: '5',
      summary: 'Updated Soccer',
      starts_at: '2026-06-10T10:00:00Z',
      ends_at: '2026-06-10T11:00:00Z',
      all_day: true,
      description: 'New desc',
      location: 'Stadium',
      timezone: 'America/Denver',
      invited_emails: ['bob@example.com'],
      rrule: 'FREQ=DAILY',
    });
    const body = request.mock.calls[0][2].body.calendar_event;
    expect(body.summary).toBe('Updated Soccer');
    expect(body.all_day).toBe(true);
    expect(body.description).toBe('New desc');
    expect(body.location).toBe('Stadium');
    expect(body.timezone).toBe('America/Denver');
    expect(body.invited_emails).toEqual(['bob@example.com']);
    expect(body.rrule).toBe('FREQ=DAILY');
  });

  // ── skylight_delete_event ───────────────────────────────────────────────

  it('delete_event deletes by id', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_event({ id: '5' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/calendar_events/5');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '5' });
  });

  it('delete_event with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_event({ id: '5', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/calendar_events/5');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_categories ────────────────────────────────────────────

  it('list_categories fetches categories with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'category', attributes: { name: 'School' } }] });
    const out = await tools.skylight_list_categories({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/categories');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'category', name: 'School' }]);
  });

  it('list_categories with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_categories({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/categories');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_source_calendars ──────────────────────────────────────

  it('list_source_calendars fetches source calendars with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '2', type: 'source_calendar', attributes: { name: 'Google' } }] });
    const out = await tools.skylight_list_source_calendars({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/source_calendars');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '2', type: 'source_calendar', name: 'Google' }]);
  });

  it('list_source_calendars with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_source_calendars({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/source_calendars');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
