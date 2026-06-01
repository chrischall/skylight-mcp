import { describe, it, expect } from 'vitest';
import { registerMessageTools } from '../../src/tools/messages.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  const server = { tool: (n: string, _d: string, _s: any, cb: any) => { tools[n] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerMessageTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('message tools', () => {
  // ── skylight_list_messages ──────────────────────────────────────────────

  it('list_messages fetches messages with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{ id: '1', type: 'message', attributes: { body: 'Hi' } }],
    });
    const out = await tools.skylight_list_messages({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/messages');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'message', body: 'Hi' }]);
  });

  it('list_messages with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_messages({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/messages');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_albums ────────────────────────────────────────────────

  it('list_albums fetches albums with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{ id: '2', type: 'album', attributes: { name: 'Vacation' } }],
    });
    const out = await tools.skylight_list_albums({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/albums');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '2', type: 'album', name: 'Vacation' }]);
  });

  it('list_albums with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_albums({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/albums');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_get_message ────────────────────────────────────────────────

  it('get_message fetches one message with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'message', attributes: { body: 'Hi' } } });
    const out = await tools.skylight_get_message({ id: '1' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/messages/1');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'message', body: 'Hi' });
  });

  it('get_message with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'message', attributes: {} } });
    await tools.skylight_get_message({ id: '1', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/messages/1');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
