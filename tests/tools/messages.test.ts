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

  // ── skylight_create_album ───────────────────────────────────────────────

  it('create_album POSTs title with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '2', type: 'album', attributes: { title: 'Vacation' } } });
    const out = await tools.skylight_create_album({ title: 'Vacation' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/albums', { body: { title: 'Vacation' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '2', type: 'album', title: 'Vacation' });
  });

  it('create_album with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '2', type: 'album', attributes: {} } });
    await tools.skylight_create_album({ title: 'Trip', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/albums', { body: { title: 'Trip' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_album ───────────────────────────────────────────────

  it('delete_album deletes by id and returns deleted id', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_album({ id: '5' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/albums/5');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '5' });
  });

  it('delete_album with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_album({ id: 5, frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/albums/5');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_add_to_album ───────────────────────────────────────────────

  it('add_to_album POSTs album_ids/message_ids with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'album', attributes: {} } });
    const out = await tools.skylight_add_to_album({ album_ids: ['1', 2], message_ids: [3, '4'] });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/albums/add_to', {
      body: { album_ids: ['1', 2], message_ids: [3, '4'] },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'album' });
  });

  it('add_to_album with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'album', attributes: {} } });
    await tools.skylight_add_to_album({ album_ids: [1], message_ids: [2], frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/albums/add_to', {
      body: { album_ids: [1], message_ids: [2] },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_remove_from_album ──────────────────────────────────────────

  it('remove_from_album POSTs album_ids/message_ids with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'album', attributes: {} } });
    const out = await tools.skylight_remove_from_album({ album_ids: ['1'], message_ids: ['3'] });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/albums/remove_from', {
      body: { album_ids: ['1'], message_ids: ['3'] },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'album' });
  });

  it('remove_from_album with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'album', attributes: {} } });
    await tools.skylight_remove_from_album({ album_ids: [1], message_ids: [2], frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/albums/remove_from', {
      body: { album_ids: [1], message_ids: [2] },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_add_message_comment ────────────────────────────────────────

  it('add_message_comment POSTs body with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'comment', attributes: { body: 'Nice!' } } });
    const out = await tools.skylight_add_message_comment({ id: '1', body: 'Nice!' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/messages/1/comments', { body: { body: 'Nice!' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '8', type: 'comment', body: 'Nice!' });
  });

  it('add_message_comment with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'comment', attributes: {} } });
    await tools.skylight_add_message_comment({ id: '1', body: 'Hi', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/messages/1/comments', { body: { body: 'Hi' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_set_message_caption ────────────────────────────────────────

  it('set_message_caption PUTs caption with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'message', attributes: { caption: 'Beach' } } });
    const out = await tools.skylight_set_message_caption({ id: '1', caption: 'Beach' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/messages/1/caption', { body: { caption: 'Beach' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'message', caption: 'Beach' });
  });

  it('set_message_caption with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'message', attributes: {} } });
    await tools.skylight_set_message_caption({ id: '1', caption: 'Sky', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/messages/1/caption', { body: { caption: 'Sky' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_like_message ───────────────────────────────────────────────

  it('like_message POSTs and flattens a returned doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'like', attributes: { count: 1 } } });
    const out = await tools.skylight_like_message({ id: '1' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/messages/1/likes');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '9', type: 'like', count: 1 });
  });

  it('like_message returns {liked:id} when no doc is returned', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_like_message({ id: '1' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/messages/1/likes');
    expect(JSON.parse(out.content[0].text)).toEqual({ liked: '1' });
  });

  it('like_message with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_like_message({ id: '1', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/messages/1/likes');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_unlike_message ─────────────────────────────────────────────

  it('unlike_message deletes and returns unliked id', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_unlike_message({ id: '1' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/messages/1/likes');
    expect(JSON.parse(out.content[0].text)).toEqual({ unliked: '1' });
  });

  it('unlike_message with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_unlike_message({ id: 1, frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/messages/1/likes');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_message ─────────────────────────────────────────────

  it('delete_message deletes by id and returns deleted id', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_message({ id: '1' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/messages/1');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '1' });
  });

  it('delete_message with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_message({ id: 1, frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/messages/1');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
