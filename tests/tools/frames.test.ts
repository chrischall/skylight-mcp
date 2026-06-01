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

  // ── skylight_update_frame ────────────────────────────────────────────────

  it('update_frame PUTs compacted settings body with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3435252', type: 'frame', attributes: { brightness: 50 } } });
    const out = await tools.skylight_update_frame({
      brightness: 50,
      slideshow_speed: 10,
      slideshow_style: 'fit',
      sleeps_at: '22:00',
      wakes_at: '07:00',
      show_caption: true,
      show_heart: false,
      blur_effect: true,
      side_by_side: false,
      open_to_public: true,
    });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252', {
      body: {
        brightness: 50,
        slideshow_speed: 10,
        slideshow_style: 'fit',
        sleeps_at: '22:00',
        wakes_at: '07:00',
        show_caption: true,
        show_heart: false,
        blur_effect: true,
        side_by_side: false,
        open_to_public: true,
      },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '3435252', type: 'frame', brightness: 50 });
  });

  it('update_frame compacts undefined settings', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3435252', type: 'frame', attributes: {} } });
    await tools.skylight_update_frame({ brightness: 75 });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ brightness: 75 });
    expect('sleeps_at' in body).toBe(false);
  });

  it('update_frame with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '99', type: 'frame', attributes: {} } });
    await tools.skylight_update_frame({ wakes_at: '06:30', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99', { body: { wakes_at: '06:30' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_rename_frame ────────────────────────────────────────────────

  it('rename_frame PUTs name with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3435252', type: 'frame', attributes: { name: 'Kitchen' } } });
    const out = await tools.skylight_rename_frame({ name: 'Kitchen' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/rename', { body: { name: 'Kitchen' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '3435252', type: 'frame', name: 'Kitchen' });
  });

  it('rename_frame with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '99', type: 'frame', attributes: {} } });
    await tools.skylight_rename_frame({ name: 'Den', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/rename', { body: { name: 'Den' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_profile ──────────────────────────────────────────────

  it('update_profile PUTs compacted profile with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3435252', type: 'frame', attributes: { name: 'Emma' } } });
    const out = await tools.skylight_update_profile({ name: 'Emma', birthday: '2015-03-04' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/profile', { body: { name: 'Emma', birthday: '2015-03-04' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '3435252', type: 'frame', name: 'Emma' });
  });

  it('update_profile compacts undefined fields', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3435252', type: 'frame', attributes: {} } });
    await tools.skylight_update_profile({ name: 'Emma' });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ name: 'Emma' });
    expect('birthday' in body).toBe(false);
  });

  it('update_profile with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '99', type: 'frame', attributes: {} } });
    await tools.skylight_update_profile({ birthday: '2010-01-01', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/profile', { body: { birthday: '2010-01-01' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_household_config ─────────────────────────────────────

  it('update_household_config PATCHes compacted config with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'household_config', attributes: { disney_screensaver: true } } });
    const out = await tools.skylight_update_household_config({ disney_profile_pictures: false, disney_screensaver: true });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/household_config', {
      body: { disney_profile_pictures: false, disney_screensaver: true },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'household_config', disney_screensaver: true });
  });

  it('update_household_config compacts undefined fields', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'household_config', attributes: {} } });
    await tools.skylight_update_household_config({ disney_screensaver: true });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ disney_screensaver: true });
    expect('disney_profile_pictures' in body).toBe(false);
  });

  it('update_household_config with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'household_config', attributes: {} } });
    await tools.skylight_update_household_config({ disney_profile_pictures: true, frameId: '99' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/99/household_config', { body: { disney_profile_pictures: true } });
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
