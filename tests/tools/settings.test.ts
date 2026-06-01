import { describe, it, expect } from 'vitest';
import { registerSettingsTools } from '../../src/tools/settings.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const server = { tool: (name: string, _desc: string, _schema: any, cb: any) => { tools[name] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerSettingsTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('settings tools', () => {
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

  // ── skylight_set_reminder_profile ────────────────────────────────────────

  it('set_reminder_profile PUTs /reminder_profile with no frame resolution', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'reminder_profile', attributes: { interval_weeks: 2 } } });
    const out = await tools.skylight_set_reminder_profile({ interval_weeks: 2 });
    expect(request).toHaveBeenCalledWith('PUT', '/reminder_profile', { body: { interval_weeks: 2 } });
    expect(resolveFrameId).not.toHaveBeenCalled();
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'reminder_profile', interval_weeks: 2 });
  });
});
