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

  // ── skylight_set_device_album ────────────────────────────────────────────

  it('set_device_album PUTs current_album_id to the device (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '12', type: 'device', attributes: { current_album_id: '88' } } });
    const out = await tools.skylight_set_device_album({ id: '12', current_album_id: '88' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/devices/12', {
      body: { current_album_id: '88' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '12', type: 'device', current_album_id: '88' });
  });

  it('set_device_album with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '12', type: 'device', attributes: {} } });
    await tools.skylight_set_device_album({ id: 12, current_album_id: 88, frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/devices/12', {
      body: { current_album_id: 88 },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_rename_device ───────────────────────────────────────────────

  it('rename_device PUTs name to the device (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '12', type: 'device', attributes: { name: 'Kitchen Frame' } } });
    const out = await tools.skylight_rename_device({ id: '12', name: 'Kitchen Frame' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/devices/12', { body: { name: 'Kitchen Frame' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '12', type: 'device', name: 'Kitchen Frame' });
  });

  it('rename_device with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '12', type: 'device', attributes: {} } });
    await tools.skylight_rename_device({ id: 12, name: 'Den', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/devices/12', { body: { name: 'Den' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
