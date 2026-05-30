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
});
