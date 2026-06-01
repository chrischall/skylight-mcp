import { describe, it, expect } from 'vitest';
import { registerCalendarTools } from '../../src/tools/calendars.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const server = { tool: (name: string, _desc: string, _schema: any, cb: any) => { tools[name] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerCalendarTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('calendar tools', () => {
  // ── skylight_list_calendars ──────────────────────────────────────────────

  it('list_calendars fetches calendars with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'calendar', attributes: { name: 'Google' } }] });
    const out = await tools.skylight_list_calendars({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/calendars');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'calendar', name: 'Google' }]);
  });

  it('list_calendars with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_calendars({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/calendars');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_get_calendar ────────────────────────────────────────────────

  it('get_calendar fetches one calendar account with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar', attributes: { name: 'Google' } } });
    const out = await tools.skylight_get_calendar({ id: '5' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/calendars/5');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'calendar', name: 'Google' });
  });

  it('get_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar', attributes: {} } });
    await tools.skylight_get_calendar({ id: '5', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/calendars/5');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_nudges ─────────────────────────────────────────────────

  it('list_nudges passes after/before query with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'nudge', attributes: { summary: 'Reminder' } }] });
    const out = await tools.skylight_list_nudges({ after: '2026-01-01', before: '2026-01-31' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/nudges', {
      query: { after: '2026-01-01', before: '2026-01-31' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'nudge', summary: 'Reminder' }]);
  });

  it('list_nudges with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_nudges({ after: '2026-01-01', before: '2026-01-31', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/nudges', {
      query: { after: '2026-01-01', before: '2026-01-31' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_add_webcal ──────────────────────────────────────────────────

  it('add_webcal POSTs sync_url with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'webcal_account', attributes: { sync_url: 'webcal://x' } } });
    const out = await tools.skylight_add_webcal({ sync_url: 'webcal://x' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/webcal_accounts', { body: { sync_url: 'webcal://x' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'webcal_account', sync_url: 'webcal://x' });
  });

  it('add_webcal with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'webcal_account', attributes: {} } });
    await tools.skylight_add_webcal({ sync_url: 'https://x.ics', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/webcal_accounts', { body: { sync_url: 'https://x.ics' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_calendar ─────────────────────────────────────────────

  it('update_calendar PUTs active_calendars with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar', attributes: { name: 'Google' } } });
    const out = await tools.skylight_update_calendar({ id: '5', active_calendars: ['a', 2] });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/calendars/5', { body: { active_calendars: ['a', 2] } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'calendar', name: 'Google' });
  });

  it('update_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar', attributes: {} } });
    await tools.skylight_update_calendar({ id: '5', active_calendars: [1], frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/calendars/5', { body: { active_calendars: [1] } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_source_calendar ──────────────────────────────────────

  it('delete_source_calendar deletes by id and returns deleted id', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_source_calendar({ id: '7' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/source_calendars/7');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '7' });
  });

  it('delete_source_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_source_calendar({ id: '7', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/source_calendars/7');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_set_default_calendar ────────────────────────────────────────

  it('set_default_calendar POSTs id and flattens a returned doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'source_calendar', attributes: { is_default: true } } });
    const out = await tools.skylight_set_default_calendar({ id: '7' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/source_calendars/set_default_for_new_events', { body: { id: '7' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '7', type: 'source_calendar', is_default: true });
  });

  it('set_default_calendar returns {default:id} when no doc is returned', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_set_default_calendar({ id: 7 });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/source_calendars/set_default_for_new_events', { body: { id: 7 } });
    expect(JSON.parse(out.content[0].text)).toEqual({ default: 7 });
  });

  it('set_default_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_set_default_calendar({ id: '7', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/source_calendars/set_default_for_new_events', { body: { id: '7' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
