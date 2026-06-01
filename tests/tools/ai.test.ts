import { describe, it, expect } from 'vitest';
import { registerAiTools } from '../../src/tools/ai.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  const server = { tool: (n: string, _d: string, _s: any, cb: any) => { tools[n] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerAiTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('ai auto-creation tools', () => {
  // ── skylight_generate_meal_plan ─────────────────────────────────────────

  it('generate_meal_plan posts the meal_sittings_generator intent with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '10', type: 'auto_creation_intent', attributes: { status: 'pending' } } });
    const out = await tools.skylight_generate_meal_plan({
      meal_category_id: '2',
      dates: ['2026-06-02', '2026-06-03'],
      mouths_to_feed: 4,
      add_to_grocery_list: true,
    });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/auto_creation_intents', {
      body: {
        engine: 'meal_sittings_generator',
        text: '',
        meal_category_id: '2',
        created_via: 'app_form',
        engine_inputs: {
          meal_sitting_dates: ['2026-06-02', '2026-06-03'],
          meal_recipe_source: 'generate',
          meal_mouths_to_feed: 4,
          add_to_grocery_list: true,
        },
      },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '10', type: 'auto_creation_intent', status: 'pending' });
  });

  it('generate_meal_plan honors an explicit recipe_source and drops absent optional inputs', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '10', type: 'auto_creation_intent', attributes: {} } });
    await tools.skylight_generate_meal_plan({
      meal_category_id: 2,
      dates: ['2026-06-02'],
      recipe_source: 'recipe_box',
    });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({
      engine: 'meal_sittings_generator',
      text: '',
      meal_category_id: 2,
      created_via: 'app_form',
      engine_inputs: {
        meal_sitting_dates: ['2026-06-02'],
        meal_recipe_source: 'recipe_box',
      },
    });
    expect('meal_mouths_to_feed' in body.engine_inputs).toBe(false);
    expect('add_to_grocery_list' in body.engine_inputs).toBe(false);
  });

  it('generate_meal_plan with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '10', type: 'auto_creation_intent', attributes: {} } });
    await tools.skylight_generate_meal_plan({ meal_category_id: '2', dates: ['2026-06-02'], frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/auto_creation_intents', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_generate_activity_ideas ────────────────────────────────────

  it('generate_activity_ideas posts the activity_ideas_generator intent with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '11', type: 'auto_creation_intent', attributes: { status: 'pending' } } });
    const out = await tools.skylight_generate_activity_ideas({
      category_ids: ['5', '6'],
      physical_location: 'Charlotte, NC, USA',
      activity_kind: 'local_event',
      budget: '$50',
      datetime_range_start: '2026-06-07T09:00:00Z',
      datetime_range_end: '2026-06-07T17:00:00Z',
    });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/auto_creation_intents', {
      body: {
        engine: 'activity_ideas_generator',
        text: '',
        category_ids: ['5', '6'],
        created_via: 'app_form',
        draft_first: true,
        engine_inputs: {
          physical_location: 'Charlotte, NC, USA',
          activity_kind: 'local_event',
          budget: '$50',
          datetime_range_start: '2026-06-07T09:00:00Z',
          datetime_range_end: '2026-06-07T17:00:00Z',
        },
      },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '11', type: 'auto_creation_intent', status: 'pending' });
  });

  it('generate_activity_ideas drops absent optional inputs', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '11', type: 'auto_creation_intent', attributes: {} } });
    await tools.skylight_generate_activity_ideas({
      category_ids: [5],
      physical_location: 'Charlotte, NC, USA',
      datetime_range_start: '2026-06-07T09:00:00Z',
      datetime_range_end: '2026-06-07T17:00:00Z',
    });
    const body = request.mock.calls[0][2].body;
    expect(body.engine_inputs).toEqual({
      physical_location: 'Charlotte, NC, USA',
      datetime_range_start: '2026-06-07T09:00:00Z',
      datetime_range_end: '2026-06-07T17:00:00Z',
    });
    expect('activity_kind' in body.engine_inputs).toBe(false);
    expect('budget' in body.engine_inputs).toBe(false);
  });

  it('generate_activity_ideas with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '11', type: 'auto_creation_intent', attributes: {} } });
    await tools.skylight_generate_activity_ideas({
      category_ids: ['5'],
      physical_location: 'Charlotte, NC, USA',
      datetime_range_start: '2026-06-07T09:00:00Z',
      datetime_range_end: '2026-06-07T17:00:00Z',
      frameId: '99',
    });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/auto_creation_intents', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_get_auto_creation_intent ───────────────────────────────────

  it('get_auto_creation_intent fetches one intent with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '10', type: 'auto_creation_intent', attributes: { status: 'complete' } } });
    const out = await tools.skylight_get_auto_creation_intent({ id: '10' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/auto_creation_intents/10');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '10', type: 'auto_creation_intent', status: 'complete' });
  });

  it('get_auto_creation_intent with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '10', type: 'auto_creation_intent', attributes: {} } });
    await tools.skylight_get_auto_creation_intent({ id: '10', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/auto_creation_intents/10');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_auto_creation_drafts ──────────────────────────────────

  it('list_auto_creation_drafts fetches the drafted events with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '90', type: 'calendar_event', attributes: { summary: 'Park day' } }] });
    const out = await tools.skylight_list_auto_creation_drafts({ id: '10' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/auto_creation_intents/10/created_events');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '90', type: 'calendar_event', summary: 'Park day' }]);
  });

  it('list_auto_creation_drafts with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_auto_creation_drafts({ id: '10', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/auto_creation_intents/10/created_events');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_auto_creation_intents ─────────────────────────────────

  it('list_auto_creation_intents fetches all intents with the default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '16', type: 'auto_creation_intent', attributes: { status: 'pending', engine: 'meal_sittings_generator' } }] });
    const out = await tools.skylight_list_auto_creation_intents({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/auto_creation_intents');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '16', type: 'auto_creation_intent', status: 'pending', engine: 'meal_sittings_generator' }]);
  });

  it('list_auto_creation_intents with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_auto_creation_intents({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/auto_creation_intents');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_auto_creation_items ───────────────────────────────────

  it('list_auto_creation_items fetches created_items (meal/activity drafts) with the default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '77', type: 'created_item', attributes: { summary: 'Tacos' } }] });
    const out = await tools.skylight_list_auto_creation_items({ id: '16' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/auto_creation_intents/16/created_items');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '77', type: 'created_item', summary: 'Tacos' }]);
  });

  it('list_auto_creation_items with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_auto_creation_items({ id: '16', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/auto_creation_intents/16/created_items');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_approve_auto_creation ──────────────────────────────────────

  it('approve_auto_creation bulk-approves drafts and returns flattened doc when present', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '90', type: 'calendar_event', attributes: { summary: 'Park day' } }] });
    const out = await tools.skylight_approve_auto_creation({ id: '10', ids: ['90', '91'] });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/auto_creation_intents/10/created_events/bulk_approve', {
      body: { ids: ['90', '91'] },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '90', type: 'calendar_event', summary: 'Park day' }]);
  });

  it('approve_auto_creation falls back to an approved count on an empty body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_approve_auto_creation({ id: '10', ids: ['90', '91'] });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/auto_creation_intents/10/created_events/bulk_approve', {
      body: { ids: ['90', '91'] },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ approved: 2 });
  });

  it('approve_auto_creation with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_approve_auto_creation({ id: '10', ids: [90], frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/auto_creation_intents/10/created_events/bulk_approve', {
      body: { ids: [90] },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_undo_auto_creation ─────────────────────────────────────────

  it('undo_auto_creation posts undo and returns flattened doc when present', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '10', type: 'auto_creation_intent', attributes: { status: 'undone' } } });
    const out = await tools.skylight_undo_auto_creation({ id: '10' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/auto_creation_intents/10/undo');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '10', type: 'auto_creation_intent', status: 'undone' });
  });

  it('undo_auto_creation falls back to an undone id on an empty body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_undo_auto_creation({ id: '10' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/auto_creation_intents/10/undo');
    expect(JSON.parse(out.content[0].text)).toEqual({ undone: '10' });
  });

  it('undo_auto_creation with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_undo_auto_creation({ id: '10', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/auto_creation_intents/10/undo');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
