import { describe, it, expect, vi } from 'vitest';
import { registerRewardTools } from '../../src/tools/rewards.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  const server = { tool: (n: string, _d: string, _s: any, cb: any) => { tools[n] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerRewardTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('reward tools', () => {
  // ── skylight_get_reward ──────────────────────────────────────────────────

  it('get_reward GETs one reward (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'reward', attributes: { name: 'Ice cream' } } });
    const out = await tools.skylight_get_reward({ id: '7' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/rewards/7');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '7', type: 'reward', name: 'Ice cream' });
  });

  it('get_reward with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'reward', attributes: {} } });
    await tools.skylight_get_reward({ id: '7', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/rewards/7');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_create_reward ───────────────────────────────────────────────

  it('create_reward POSTs flat {name, point_value, category_ids}', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'reward', attributes: { name: 'Movie' } } });
    const out = await tools.skylight_create_reward({ name: 'Movie', point_value: 50, category_ids: ['1', 2] });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/rewards', {
      body: { name: 'Movie', point_value: 50, category_ids: ['1', 2] },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '8', type: 'reward', name: 'Movie' });
  });

  it('create_reward with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'reward', attributes: {} } });
    await tools.skylight_create_reward({ name: 'Movie', point_value: 50, category_ids: [1], frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/rewards', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_reward ───────────────────────────────────────────────

  it('update_reward PATCHes compacted body (drops undefined)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'reward', attributes: { name: 'Movie night' } } });
    const out = await tools.skylight_update_reward({ id: '8', name: 'Movie night' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/rewards/8', {
      body: { name: 'Movie night' },
    });
    const body = request.mock.calls[0][2].body;
    expect(body).not.toHaveProperty('point_value');
    expect(body).not.toHaveProperty('category_ids');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '8', type: 'reward', name: 'Movie night' });
  });

  it('update_reward includes all fields when provided', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'reward', attributes: {} } });
    await tools.skylight_update_reward({ id: '8', name: 'Movie', point_value: 75, category_ids: [3] });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/rewards/8', {
      body: { name: 'Movie', point_value: 75, category_ids: [3] },
    });
  });

  it('update_reward with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'reward', attributes: {} } });
    await tools.skylight_update_reward({ id: '8', name: 'X', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/99/rewards/8', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_reward ───────────────────────────────────────────────

  it('delete_reward DELETEs and returns { deleted: id } (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_reward({ id: '8' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/rewards/8');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '8' });
  });

  it('delete_reward with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_reward({ id: '8', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/rewards/8');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_redeem_reward ───────────────────────────────────────────────

  it('redeem_reward POSTs empty body and returns flattened doc when present', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'reward', attributes: { redeemed: true } } });
    const out = await tools.skylight_redeem_reward({ id: '8' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/rewards/8/redeem', { body: {} });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '8', type: 'reward', redeemed: true });
  });

  it('redeem_reward includes category_id when provided', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_redeem_reward({ id: '8', category_id: 42 });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/rewards/8/redeem', { body: { category_id: 42 } });
    expect(JSON.parse(out.content[0].text)).toEqual({ redeemed: '8' });
  });

  it('redeem_reward with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_redeem_reward({ id: '8', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/rewards/8/redeem', { body: {} });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_unredeem_reward ─────────────────────────────────────────────

  it('unredeem_reward POSTs empty body and returns flattened doc when present', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'reward', attributes: { redeemed: false } } });
    const out = await tools.skylight_unredeem_reward({ id: '8' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/rewards/8/unredeem', { body: {} });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '8', type: 'reward', redeemed: false });
  });

  it('unredeem_reward returns { unredeemed: id } when API returns no body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_unredeem_reward({ id: '8', category_id: '5' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/rewards/8/unredeem', { body: { category_id: '5' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ unredeemed: '8' });
  });

  it('unredeem_reward with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_unredeem_reward({ id: '8', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/rewards/8/unredeem', { body: {} });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_add_reward_points ───────────────────────────────────────────

  it('add_reward_points POSTs {category_ids, points} (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'reward_point', attributes: { points: 10 } } });
    const out = await tools.skylight_add_reward_points({ category_ids: ['1', 2], points: 10 });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/reward_points', {
      body: { category_ids: ['1', 2], points: 10 },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'reward_point', points: 10 });
  });

  it('add_reward_points supports negative points and explicit frameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'reward_point', attributes: {} } });
    await tools.skylight_add_reward_points({ category_ids: [3], points: -5, frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/reward_points', {
      body: { category_ids: [3], points: -5 },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
