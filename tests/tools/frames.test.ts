import { describe, it, expect } from 'vitest';
import { registerFrameTools } from '../../src/tools/frames.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const server = { tool: (name: string, _desc: string, _schema: any, cb: any) => { tools[name] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerFrameTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('frame tools', () => {
  it('list_frames flattens the frames doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '3435252', type: 'approved_viewer_frame', attributes: { name: 'home' } }] });
    const out = await tools.skylight_list_frames({});
    expect(request).toHaveBeenCalledWith('GET', '/frames');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '3435252', type: 'approved_viewer_frame', name: 'home' }]);
  });

  it('list_frame_members resolves the frame id then queries users', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '9', type: 'frame_user', attributes: { status: 'active', is_owner: true } }] });
    await tools.skylight_list_frame_members({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/users');
  });

  it('list_frame_members uses explicit frameId and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_frame_members({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/users');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  it('get_frame without frameId uses resolveFrameId', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3435252', type: 'approved_viewer_frame', attributes: { name: 'home' } } });
    const out = await tools.skylight_get_frame({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '3435252', type: 'approved_viewer_frame', name: 'home' });
  });

  it('get_frame with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '99', type: 'approved_viewer_frame', attributes: { name: 'alt' } } });
    const out = await tools.skylight_get_frame({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '99', type: 'approved_viewer_frame', name: 'alt' });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  it('list_devices without frameId uses resolveFrameId', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_devices({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/devices');
  });

  it('list_devices with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_devices({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/devices');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_get_plus_access ─────────────────────────────────────────────

  it('get_plus_access fetches /plus_access without resolving a frame', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'plus_access', attributes: { active: true } } });
    const out = await tools.skylight_get_plus_access({});
    expect(request).toHaveBeenCalledWith('GET', '/plus_access');
    expect(resolveFrameId).not.toHaveBeenCalled();
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'plus_access', active: true });
  });

  // ── skylight_get_reward_points ───────────────────────────────────────────

  it('get_reward_points fetches reward_points with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'reward_point', attributes: { balance: 50, lifetime_earned: 120 } }] });
    const out = await tools.skylight_get_reward_points({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/reward_points');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'reward_point', balance: 50, lifetime_earned: 120 }]);
  });

  it('get_reward_points with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_get_reward_points({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/reward_points');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_get_household_config ────────────────────────────────────────

  it('get_household_config fetches household_config with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'household_config', attributes: { timezone: 'America/New_York' } } });
    const out = await tools.skylight_get_household_config({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/household_config');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'household_config', timezone: 'America/New_York' });
  });

  it('get_household_config with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'household_config', attributes: {} } });
    await tools.skylight_get_household_config({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/household_config');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

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

  // ── skylight_get_event_notification_settings ─────────────────────────────

  it('get_event_notification_settings fetches settings with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'event_notification_setting', attributes: { enabled: true } } });
    const out = await tools.skylight_get_event_notification_settings({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/event_notification_settings');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'event_notification_setting', enabled: true });
  });

  it('get_event_notification_settings with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'event_notification_setting', attributes: {} } });
    await tools.skylight_get_event_notification_settings({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/event_notification_settings');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_resolve_member ──────────────────────────────────────────────

  it('resolve_member returns only categories whose label matches (case-insensitive)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [
        { id: '1', type: 'category', attributes: { label: 'Mom' } },
        { id: '2', type: 'category', attributes: { label: 'Dad' } },
        { id: '3', type: 'category', attributes: { label: 'Emma' } },
      ],
    });
    const out = await tools.skylight_resolve_member({ name: 'mo' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/categories');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', label: 'Mom' }]);
  });

  it('resolve_member returns all categories when none match', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [
        { id: '1', type: 'category', attributes: { label: 'Mom' } },
        { id: '2', type: 'category', attributes: { label: 'Dad' } },
        { id: '3', type: 'category' },
      ],
    });
    const out = await tools.skylight_resolve_member({ name: 'zzz' });
    expect(JSON.parse(out.content[0].text)).toEqual([
      { id: '1', label: 'Mom' },
      { id: '2', label: 'Dad' },
      { id: '3' },
    ]);
  });

  it('resolve_member with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'category', attributes: { label: 'Mom' } }] });
    await tools.skylight_resolve_member({ name: 'mom', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/categories');
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
});
