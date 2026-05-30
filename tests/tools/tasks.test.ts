import { describe, it, expect } from 'vitest';
import { registerTaskTools } from '../../src/tools/tasks.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  const server = { tool: (n: string, _d: string, _s: any, cb: any) => { tools[n] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerTaskTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('task tools', () => {
  // ── skylight_list_tasks ─────────────────────────────────────────────────

  it('list_tasks fetches task_box items with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{ id: '1', type: 'task_box_item', attributes: { summary: 'Walk dog', emoji_icon: '🐕', routine: false, reward_points: 5 } }],
    });
    const out = await tools.skylight_list_tasks({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/task_box/items');
    expect(JSON.parse(out.content[0].text)).toEqual([
      { id: '1', type: 'task_box_item', summary: 'Walk dog', emoji_icon: '🐕', routine: false, reward_points: 5 },
    ]);
  });

  it('list_tasks with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_tasks({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/task_box/items');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_create_task ────────────────────────────────────────────────

  it('create_task posts all attrs flat with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'task_box_item', attributes: { summary: 'Dishes', emoji_icon: '🍽️', reward_points: 10, routine: true } } });
    const out = await tools.skylight_create_task({ summary: 'Dishes', emoji_icon: '🍽️', reward_points: 10, routine: true });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/task_box/items', {
      body: { summary: 'Dishes', emoji_icon: '🍽️', reward_points: 10, routine: true },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'task_box_item', summary: 'Dishes', emoji_icon: '🍽️', reward_points: 10, routine: true });
  });

  it('create_task drops undefined optional attrs (minimal summary only)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '6', type: 'task_box_item', attributes: { summary: 'Minimal' } } });
    await tools.skylight_create_task({ summary: 'Minimal' });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ summary: 'Minimal' });
    expect('emoji_icon' in body).toBe(false);
    expect('reward_points' in body).toBe(false);
    expect('routine' in body).toBe(false);
  });

  it('create_task with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'task_box_item', attributes: {} } });
    await tools.skylight_create_task({ summary: 'Task', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/task_box/items', {
      body: { summary: 'Task' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_task ────────────────────────────────────────────────

  it('update_task patches with partial attrs flat with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'task_box_item', attributes: { summary: 'Renamed' } } });
    const out = await tools.skylight_update_task({ id: '5', summary: 'Renamed' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/task_box/items/5', {
      body: { summary: 'Renamed' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'task_box_item', summary: 'Renamed' });
  });

  it('update_task drops undefined optional attrs (only changed field sent)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'task_box_item', attributes: {} } });
    await tools.skylight_update_task({ id: '5', reward_points: 3 });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ reward_points: 3 });
    expect('summary' in body).toBe(false);
  });

  it('update_task with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'task_box_item', attributes: {} } });
    await tools.skylight_update_task({ id: '5', routine: true, emoji_icon: '✅', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/99/task_box/items/5', {
      body: { emoji_icon: '✅', routine: true },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_task ────────────────────────────────────────────────

  it('delete_task deletes by id with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_task({ id: '5' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/task_box/items/5');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '5' });
  });

  it('delete_task with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_task({ id: '5', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/task_box/items/5');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
