import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerChoreTools } from '../../src/tools/chores.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  const server = { tool: (n: string, _d: string, _s: any, cb: any) => { tools[n] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerChoreTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('chore tools', () => {
  // ── skylight_list_chores ─────────────────────────────────────────────────

  it('list_chores passes required after/before query params', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'chore', attributes: { name: 'Dishes' } }] });
    const out = await tools.skylight_list_chores({ after: '2026-05-01', before: '2026-06-01' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/chores', {
      query: { after: '2026-05-01', before: '2026-06-01' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'chore', name: 'Dishes' }]);
  });

  it('list_chores with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_chores({ after: '2026-05-01', before: '2026-06-01', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/chores', {
      query: { after: '2026-05-01', before: '2026-06-01' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_create_chore ────────────────────────────────────────────────

  it('create_chore posts flat {summary, category_id} (no wrapper)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '2', type: 'chore', attributes: { summary: 'Dishes' } } });
    const out = await tools.skylight_create_chore({ summary: 'Dishes', category_id: '10901869' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/chores', {
      body: { summary: 'Dishes', category_id: '10901869' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '2', type: 'chore', summary: 'Dishes' });
  });

  it('create_chore includes optional fields when provided', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'chore', attributes: { summary: 'Vacuuming' } } });
    await tools.skylight_create_chore({
      summary: 'Vacuuming',
      category_id: '10901869',
      start: '2026-06-01',
      description: 'All rooms',
      reward_points: 5,
    });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/chores', {
      body: { summary: 'Vacuuming', category_id: '10901869', start: '2026-06-01', description: 'All rooms', reward_points: 5 },
    });
  });

  it('create_chore omits undefined optional fields (compact)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '4', type: 'chore', attributes: {} } });
    await tools.skylight_create_chore({ summary: 'Walk dog', category_id: 42 });
    const callBody = request.mock.calls[0][2].body;
    expect(callBody).not.toHaveProperty('start');
    expect(callBody).not.toHaveProperty('description');
    expect(callBody).not.toHaveProperty('reward_points');
  });

  it('create_chore with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'chore', attributes: {} } });
    await tools.skylight_create_chore({ summary: 'Vacuuming', category_id: '10901869', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/chores', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_complete_chore ──────────────────────────────────────────────

  it('complete_chore PUTs {status:complete} to the completions endpoint (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { status: 'complete' } } });
    const out = await tools.skylight_complete_chore({ id: '5' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/chores/5/completions', {
      body: { status: 'complete' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'chore', status: 'complete' });
  });

  it('complete_chore with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { status: 'complete' } } });
    await tools.skylight_complete_chore({ id: '5', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/chores/5/completions', {
      body: { status: 'complete' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  it('complete_chore returns { completed: id } when API returns no body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_complete_chore({ id: '5' });
    expect(JSON.parse(out.content[0].text)).toEqual({ completed: '5' });
  });

  // ── skylight_update_chore ────────────────────────────────────────────────

  it('update_chore PUTs compacted body (drops undefined)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { summary: 'Dishes done' } } });
    const out = await tools.skylight_update_chore({ id: '5', summary: 'Dishes done' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/chores/5', {
      body: { summary: 'Dishes done' },
    });
    const body = request.mock.calls[0][2].body;
    expect(body).not.toHaveProperty('category_id');
    expect(body).not.toHaveProperty('start');
    expect(body).not.toHaveProperty('apply_to');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'chore', summary: 'Dishes done' });
  });

  it('update_chore passes apply_to and all fields through', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: {} } });
    await tools.skylight_update_chore({
      id: '5',
      summary: 'Vacuum',
      category_id: 42,
      start: '2026-06-01',
      description: 'All rooms',
      reward_points: 3,
      apply_to: 'this_and_future',
    });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/chores/5', {
      body: { summary: 'Vacuum', category_id: 42, start: '2026-06-01', description: 'All rooms', reward_points: 3, apply_to: 'this_and_future' },
    });
  });

  it('update_chore with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: {} } });
    await tools.skylight_update_chore({ id: '5', summary: 'X', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/chores/5', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_complete_chore_instance ─────────────────────────────────────

  it('complete_chore_instance PUTs {status, instance_date, category_id} and returns flattened doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { status: 'completed' } } });
    const out = await tools.skylight_complete_chore_instance({ id: '5', instance_date: '2026-06-01', category_id: '42' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/chores/5/completions', {
      body: { status: 'completed', instance_date: '2026-06-01', category_id: '42' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'chore', status: 'completed' });
  });

  it('complete_chore_instance returns { completed, instance_date } when API returns no body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_complete_chore_instance({ id: '5', instance_date: '2026-06-01', category_id: 42 });
    expect(JSON.parse(out.content[0].text)).toEqual({ completed: '5', instance_date: '2026-06-01' });
  });

  it('complete_chore_instance with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_complete_chore_instance({ id: '5', instance_date: '2026-06-01', category_id: '42', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/chores/5/completions', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_uncomplete_chore ────────────────────────────────────────────

  it('uncomplete_chore PUTs {status:pending} to the completions endpoint (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { status: 'pending' } } });
    const out = await tools.skylight_uncomplete_chore({ id: '5' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/chores/5/completions', {
      body: { status: 'pending' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'chore', status: 'pending' });
  });

  it('uncomplete_chore with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { status: 'pending' } } });
    await tools.skylight_uncomplete_chore({ id: '5', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/chores/5/completions', {
      body: { status: 'pending' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  it('uncomplete_chore returns { uncompleted: id } when API returns no body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_uncomplete_chore({ id: '5' });
    expect(JSON.parse(out.content[0].text)).toEqual({ uncompleted: '5' });
  });

  // ── skylight_list_rewards ────────────────────────────────────────────────

  it('list_rewards passes explicit redeemed_at_min/max directly', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '10', type: 'reward', attributes: { name: 'Star' } }] });
    const out = await tools.skylight_list_rewards({
      redeemed_at_min: '2026-04-01T00:00:00.000Z',
      redeemed_at_max: '2026-05-01T00:00:00.000Z',
    });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/rewards', {
      query: {
        redeemed_at_min: '2026-04-01T00:00:00.000Z',
        redeemed_at_max: '2026-05-01T00:00:00.000Z',
      },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '10', type: 'reward', name: 'Star' }]);
  });

  it('list_rewards defaults to last 30 days when no min/max provided', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T00:00:00.000Z'));

    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_rewards({});

    const callArgs = request.mock.calls[0];
    expect(callArgs[2].query.redeemed_at_max).toBe('2026-05-30T00:00:00.000Z');
    expect(callArgs[2].query.redeemed_at_min).toBe('2026-04-30T00:00:00.000Z');

    vi.useRealTimers();
  });

  it('list_rewards with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_rewards({
      redeemed_at_min: '2026-04-01T00:00:00.000Z',
      redeemed_at_max: '2026-05-01T00:00:00.000Z',
      frameId: '99',
    });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/rewards', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
