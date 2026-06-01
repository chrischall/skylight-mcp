import { describe, it, expect } from 'vitest';
import { registerListTools } from '../../src/tools/lists.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  const server = { tool: (n: string, _d: string, _s: any, cb: any) => { tools[n] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerListTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('list tools', () => {
  // ── skylight_list_lists ─────────────────────────────────────────────────

  it('list_lists fetches all lists with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{ id: '7', type: 'list', attributes: { label: 'Groceries', color: 'red', kind: 'grocery' } }],
    });
    const out = await tools.skylight_list_lists({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/lists');
    expect(JSON.parse(out.content[0].text)).toEqual([
      { id: '7', type: 'list', label: 'Groceries', color: 'red', kind: 'grocery' },
    ]);
  });

  it('list_lists with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_lists({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/lists');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_get_list_items ─────────────────────────────────────────────

  it('get_list_items fetches items for a list with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{ id: '42', type: 'list_item', attributes: { label: 'Milk', checked: false } }],
    });
    const out = await tools.skylight_get_list_items({ listId: '7' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/lists/7/list_items');
    expect(JSON.parse(out.content[0].text)).toEqual([
      { id: '42', type: 'list_item', label: 'Milk', checked: false },
    ]);
  });

  it('get_list_items with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_get_list_items({ listId: '7', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/lists/7/list_items');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_create_list ────────────────────────────────────────────────

  it('create_list posts all attrs flat (label+color+kind, no wrapper)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '10', type: 'list', attributes: { label: 'Groceries', color: '#42D792', kind: 'shopping' } } });
    const out = await tools.skylight_create_list({ label: 'Groceries', color: '#42D792', kind: 'shopping' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/lists', {
      body: { label: 'Groceries', color: '#42D792', kind: 'shopping' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '10', type: 'list', label: 'Groceries', color: '#42D792', kind: 'shopping' });
  });

  it('create_list with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '12', type: 'list', attributes: {} } });
    await tools.skylight_create_list({ label: 'Test', color: '#000000', kind: 'to_do', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/lists', {
      body: { label: 'Test', color: '#000000', kind: 'to_do' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_add_list_item ──────────────────────────────────────────────

  it('add_list_item posts to the correct list path flat (no wrapper)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Eggs' } } });
    const out = await tools.skylight_add_list_item({ listId: '7', label: 'Eggs' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/lists/7/list_items', {
      body: { label: 'Eggs' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '55', type: 'list_item', label: 'Eggs' });
  });

  it('add_list_item with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '56', type: 'list_item', attributes: { label: 'Butter' } } });
    await tools.skylight_add_list_item({ listId: '7', label: 'Butter', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/lists/7/list_items', {
      body: { label: 'Butter' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_list_item ───────────────────────────────────────────

  it('update_list_item maps checked:true to status completed (drops label)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Eggs', status: 'completed' } } });
    const out = await tools.skylight_update_list_item({ listId: '7', itemId: '55', checked: true });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/lists/7/list_items/55', {
      body: { status: 'completed' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '55', type: 'list_item', label: 'Eggs', status: 'completed' });
  });

  it('update_list_item maps checked:false to status pending', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Eggs', status: 'pending' } } });
    await tools.skylight_update_list_item({ listId: '7', itemId: '55', checked: false });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/lists/7/list_items/55', {
      body: { status: 'pending' },
    });
  });

  it('update_list_item patches with only label flat (drops status when checked undefined)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Dozen Eggs', status: 'pending' } } });
    await tools.skylight_update_list_item({ listId: '7', itemId: '55', label: 'Dozen Eggs' });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ label: 'Dozen Eggs' });
    expect('status' in body).toBe(false);
  });

  it('update_list_item patches with both label and status flat', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Cheese', status: 'completed' } } });
    await tools.skylight_update_list_item({ listId: '7', itemId: '55', label: 'Cheese', checked: true });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/lists/7/list_items/55', {
      body: { label: 'Cheese', status: 'completed' },
    });
  });

  it('update_list_item with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: {} } });
    await tools.skylight_update_list_item({ listId: '7', itemId: '55', checked: false, frameId: '99' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/99/lists/7/list_items/55', {
      body: { status: 'pending' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_list_item ───────────────────────────────────────────

  it('delete_list_item deletes by listId+itemId with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_list_item({ listId: '7', itemId: '55' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/lists/7/list_items/55');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '55' });
  });

  it('delete_list_item with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_list_item({ listId: '7', itemId: '55', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/lists/7/list_items/55');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_list ────────────────────────────────────────────────

  it('update_list puts with only provided attrs flat with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'list', attributes: { label: 'Renamed' } } });
    const out = await tools.skylight_update_list({ listId: '7', label: 'Renamed' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/lists/7', {
      body: { label: 'Renamed' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '7', type: 'list', label: 'Renamed' });
  });

  it('update_list puts all attrs flat (label+color+kind)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'list', attributes: {} } });
    await tools.skylight_update_list({ listId: '7', label: 'Shop', color: '#42D792', kind: 'shopping' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/lists/7', {
      body: { label: 'Shop', color: '#42D792', kind: 'shopping' },
    });
  });

  it('update_list with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'list', attributes: {} } });
    await tools.skylight_update_list({ listId: '7', kind: 'to_do', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/lists/7', {
      body: { kind: 'to_do' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_list ────────────────────────────────────────────────

  it('delete_list deletes by listId with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_list({ listId: '7' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/lists/7');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '7' });
  });

  it('delete_list with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_list({ listId: '7', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/lists/7');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_move_list_item ─────────────────────────────────────────────

  it('move_list_item posts after_item_id and returns flattened doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Eggs' } } });
    const out = await tools.skylight_move_list_item({ listId: '7', itemId: '55', afterItemId: '42' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/lists/7/list_items/55/move', {
      body: { after_item_id: '42' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '55', type: 'list_item', label: 'Eggs' });
  });

  it('move_list_item sends after_item_id null when afterItemId omitted (move to top)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_move_list_item({ listId: '7', itemId: '55' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/lists/7/list_items/55/move', {
      body: { after_item_id: null },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ moved: '55' });
  });

  it('move_list_item with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: {} } });
    await tools.skylight_move_list_item({ listId: '7', itemId: '55', afterItemId: '42', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/lists/7/list_items/55/move', {
      body: { after_item_id: '42' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_clear_list ─────────────────────────────────────────────────

  it('clear_list bulk-destroys all items with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_clear_list({ listId: '7' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/lists/7/list_items/bulk_destroy');
    expect(JSON.parse(out.content[0].text)).toEqual({ cleared: '7' });
  });

  it('clear_list with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_clear_list({ listId: '7', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/lists/7/list_items/bulk_destroy');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
