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

  it('create_list posts all attrs (label+color+kind)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '10', type: 'list', attributes: { label: 'Groceries', color: 'green', kind: 'grocery' } } });
    const out = await tools.skylight_create_list({ label: 'Groceries', color: 'green', kind: 'grocery' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/lists', {
      body: { list: { label: 'Groceries', color: 'green', kind: 'grocery' } },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '10', type: 'list', label: 'Groceries', color: 'green', kind: 'grocery' });
  });

  it('create_list with only label drops undefined color/kind via compact()', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '11', type: 'list', attributes: { label: 'Todos' } } });
    await tools.skylight_create_list({ label: 'Todos' });
    const body = request.mock.calls[0][2].body;
    expect(body.list).toEqual({ label: 'Todos' });
    expect('color' in body.list).toBe(false);
    expect('kind' in body.list).toBe(false);
  });

  it('create_list with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '12', type: 'list', attributes: {} } });
    await tools.skylight_create_list({ label: 'Test', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/lists', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_add_list_item ──────────────────────────────────────────────

  it('add_list_item posts to the correct list path with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Eggs' } } });
    const out = await tools.skylight_add_list_item({ listId: '7', label: 'Eggs' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/lists/7/list_items', {
      body: { list_item: { label: 'Eggs' } },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '55', type: 'list_item', label: 'Eggs' });
  });

  it('add_list_item with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '56', type: 'list_item', attributes: { label: 'Butter' } } });
    await tools.skylight_add_list_item({ listId: '7', label: 'Butter', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/lists/7/list_items', {
      body: { list_item: { label: 'Butter' } },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_list_item ───────────────────────────────────────────

  it('update_list_item patches with only checked (drops label)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Eggs', checked: true } } });
    const out = await tools.skylight_update_list_item({ listId: '7', itemId: '55', checked: true });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/lists/7/list_items/55', {
      body: { list_item: { checked: true } },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '55', type: 'list_item', label: 'Eggs', checked: true });
  });

  it('update_list_item patches with only label (drops checked)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Dozen Eggs', checked: false } } });
    await tools.skylight_update_list_item({ listId: '7', itemId: '55', label: 'Dozen Eggs' });
    const body = request.mock.calls[0][2].body;
    expect(body.list_item).toEqual({ label: 'Dozen Eggs' });
    expect('checked' in body.list_item).toBe(false);
  });

  it('update_list_item patches with both label and checked', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: { label: 'Cheese', checked: true } } });
    await tools.skylight_update_list_item({ listId: '7', itemId: '55', label: 'Cheese', checked: true });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/lists/7/list_items/55', {
      body: { list_item: { label: 'Cheese', checked: true } },
    });
  });

  it('update_list_item with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '55', type: 'list_item', attributes: {} } });
    await tools.skylight_update_list_item({ listId: '7', itemId: '55', checked: false, frameId: '99' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/99/lists/7/list_items/55', {
      body: { list_item: { checked: false } },
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
});
