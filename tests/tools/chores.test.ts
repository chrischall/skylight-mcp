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

  // ── skylight_create_recurring_chore ──────────────────────────────────────

  it('create_recurring_chore POSTs create_multiple with recurrence_set array body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '20', type: 'chore', attributes: { summary: 'Dishes', recurring: true } }] });
    const out = await tools.skylight_create_recurring_chore({
      summary: 'Dishes',
      recurrence: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR',
      category_ids: ['10901869'],
      start: '2026-06-02',
    });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/chores/create_multiple', {
      body: {
        summary: 'Dishes',
        category_ids: ['10901869'],
        recurrence_set: ['RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR'],
        start: '2026-06-02',
      },
    });
    // Response is { data: [...] } (array) — flattened to an array.
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '20', type: 'chore', summary: 'Dishes', recurring: true }]);
  });

  it('create_recurring_chore passes all optional fields (routine, up_for_grabs, etc.) through compact', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '21', type: 'chore', attributes: {} }] });
    await tools.skylight_create_recurring_chore({
      summary: 'Brush teeth',
      recurrence: 'FREQ=DAILY;INTERVAL=1;BYHOUR=8',
      start: '2026-06-02',
      start_time: '08:00',
      recurring_until: '2026-12-31T23:59:59.999Z',
      reward_points: 2,
      emoji_icon: '🪥',
      description: 'Morning routine',
      routine: true,
      up_for_grabs: true,
    });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/chores/create_multiple', {
      body: {
        summary: 'Brush teeth',
        recurrence_set: ['RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=8'],
        start: '2026-06-02',
        start_time: '08:00',
        recurring_until: '2026-12-31T23:59:59.999Z',
        reward_points: 2,
        emoji_icon: '🪥',
        description: 'Morning routine',
        routine: true,
        up_for_grabs: true,
      },
    });
  });

  it('create_recurring_chore omits undefined optional fields (compact)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '22', type: 'chore', attributes: {} }] });
    await tools.skylight_create_recurring_chore({ summary: 'X', recurrence: 'FREQ=DAILY', start: '2026-06-02' });
    const body = request.mock.calls[0][2].body;
    expect(body).not.toHaveProperty('category_ids');
    expect(body).not.toHaveProperty('start_time');
    expect(body).not.toHaveProperty('routine');
    expect(body).not.toHaveProperty('up_for_grabs');
    expect(body.recurrence_set).toEqual(['RRULE:FREQ=DAILY']);
  });

  it('create_recurring_chore with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [{ id: '23', type: 'chore', attributes: {} }] });
    await tools.skylight_create_recurring_chore({ summary: 'X', recurrence: 'FREQ=DAILY', start: '2026-06-02', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/chores/create_multiple', expect.any(Object));
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

  it('update_chore maps recurrence to recurrence_set array and passes new fields through', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: {} } });
    await tools.skylight_update_chore({
      id: '5',
      summary: 'Dishes',
      recurrence: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
      start: '2026-06-02',
      start_time: '17:00',
      recurring_until: '2026-12-31T23:59:59.999Z',
      emoji_icon: '🍽️',
    });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/chores/5', {
      body: {
        summary: 'Dishes',
        start: '2026-06-02',
        start_time: '17:00',
        emoji_icon: '🍽️',
        recurrence_set: ['RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU'],
        recurring_until: '2026-12-31T23:59:59.999Z',
      },
    });
  });

  it('update_chore omits recurrence_set when recurrence is not provided', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: {} } });
    await tools.skylight_update_chore({ id: '5', summary: 'Dishes' });
    const body = request.mock.calls[0][2].body;
    expect(body).not.toHaveProperty('recurrence_set');
    expect(body).not.toHaveProperty('recurring_until');
  });

  it('update_chore with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: {} } });
    await tools.skylight_update_chore({ id: '5', summary: 'X', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/chores/5', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_complete_chore_instance ─────────────────────────────────────

  it('complete_chore_instance PUTs {status:complete, instance_date} with NO category_id by default', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { status: 'complete' } } });
    const out = await tools.skylight_complete_chore_instance({ id: '5', instance_date: '2026-06-01' });
    // status is 'complete' (live-verified), and category_id is omitted — sending it 422s
    // ("category_id must be blank") for a normally-assigned chore.
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/chores/5/completions', {
      body: { status: 'complete', instance_date: '2026-06-01' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'chore', status: 'complete' });
  });

  it('complete_chore_instance includes category_id only when given (up-for-grabs chore)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: {} } });
    await tools.skylight_complete_chore_instance({ id: '5', instance_date: '2026-06-01', category_id: 42 });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/chores/5/completions', {
      body: { status: 'complete', instance_date: '2026-06-01', category_id: 42 },
    });
  });

  it('complete_chore_instance includes instance_time for a time-of-day routine occurrence', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: {} } });
    await tools.skylight_complete_chore_instance({ id: '5', instance_date: '2026-06-01', instance_time: '14:00' });
    expect(request.mock.calls[0][2].body).toEqual({ status: 'complete', instance_date: '2026-06-01', instance_time: '14:00' });
  });

  it('complete_chore_instance returns { completed, instance_date } when API returns no body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_complete_chore_instance({ id: '5', instance_date: '2026-06-01' });
    expect(JSON.parse(out.content[0].text)).toEqual({ completed: '5', instance_date: '2026-06-01' });
  });

  it('complete_chore_instance with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_complete_chore_instance({ id: '5', instance_date: '2026-06-01', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/chores/5/completions', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_uncomplete_chore ────────────────────────────────────────────

  it('uncomplete_chore PUTs {status:pending} to the completions endpoint (whole chore)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { status: 'pending' } } });
    const out = await tools.skylight_uncomplete_chore({ id: '5' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/chores/5/completions', {
      body: { status: 'pending' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'chore', status: 'pending' });
  });

  it('uncomplete_chore reopens a specific occurrence when instance_date/instance_time given', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: {} } });
    await tools.skylight_uncomplete_chore({ id: '5', instance_date: '2026-06-01', instance_time: '14:00' });
    expect(request.mock.calls[0][2].body).toEqual({ status: 'pending', instance_date: '2026-06-01', instance_time: '14:00' });
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

  it('uncomplete_chore no-body fallback keeps instance_date when reopening an occurrence', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_uncomplete_chore({ id: '5', instance_date: '2026-06-01' });
    expect(JSON.parse(out.content[0].text)).toEqual({ uncompleted: '5', instance_date: '2026-06-01' });
  });

  // ── skylight_delete_chore ────────────────────────────────────────────────

  it('delete_chore DELETEs without query when apply_to is omitted', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_chore({ id: '5' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/chores/5', {});
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '5' });
  });

  it('delete_chore passes apply_to as a query param when provided', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_chore({ id: '5', apply_to: 'all' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/chores/5', { query: { apply_to: 'all' } });
  });

  it('delete_chore flattens a returned body when the API provides one', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'chore', attributes: { status: 'deleted' } } });
    const out = await tools.skylight_delete_chore({ id: '5', apply_to: 'one' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/chores/5', { query: { apply_to: 'one' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'chore', status: 'deleted' });
  });

  it('delete_chore with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_chore({ id: '5', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/chores/5', {});
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_search_chores ───────────────────────────────────────────────

  it('search_chores GETs the search endpoint with just search_query by default', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '30', type: 'chore', attributes: { summary: 'Dishes' } }] });
    const out = await tools.skylight_search_chores({ search_query: 'dish' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/chores/search', {
      query: { search_query: 'dish' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '30', type: 'chore', summary: 'Dishes' }]);
  });

  it('search_chores passes booleans and numbers through (incl. false / 0)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_search_chores({
      search_query: 'dish',
      include_up_for_grabs: false,
      limit: 0,
      ended_chore_lookback_days: 30,
    });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/chores/search', {
      query: { search_query: 'dish', include_up_for_grabs: 'false', limit: 0, ended_chore_lookback_days: 30 },
    });
  });

  it('search_chores includes include_up_for_grabs true', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_search_chores({ search_query: 'dish', include_up_for_grabs: true, limit: 5 });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/chores/search', {
      query: { search_query: 'dish', include_up_for_grabs: 'true', limit: 5 },
    });
  });

  it('search_chores omits undefined query keys', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_search_chores({ search_query: 'dish' });
    const query = request.mock.calls[0][2].query;
    expect(query).not.toHaveProperty('include_up_for_grabs');
    expect(query).not.toHaveProperty('limit');
    expect(query).not.toHaveProperty('ended_chore_lookback_days');
  });

  it('search_chores with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_search_chores({ search_query: 'dish', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/chores/search', expect.any(Object));
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
