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

  it('create_chore posts chore envelope with name', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '2', type: 'chore', attributes: { name: 'Dishes' } } });
    const out = await tools.skylight_create_chore({ name: 'Dishes' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/chores', {
      body: { chore: { name: 'Dishes' } },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '2', type: 'chore', name: 'Dishes' });
  });

  it('create_chore with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'chore', attributes: {} } });
    await tools.skylight_create_chore({ name: 'Vacuuming', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/chores', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_complete_chore ──────────────────────────────────────────────

  it('complete_chore returns flattened doc when API returns a resource', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { status: 'complete' } } });
    const out = await tools.skylight_complete_chore({ id: '5' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/chores/5/complete');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'chore', status: 'complete' });
  });

  it('complete_chore returns { completed: id } when API returns no body (204)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_complete_chore({ id: '5' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/chores/5/complete');
    expect(JSON.parse(out.content[0].text)).toEqual({ completed: '5' });
  });

  it('complete_chore with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_complete_chore({ id: '5', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/chores/5/complete');
    expect(resolveFrameId).not.toHaveBeenCalled();
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
