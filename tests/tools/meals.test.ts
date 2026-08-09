import { describe, it, expect } from 'vitest';
import { registerMealTools } from '../../src/tools/meals.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  const server = { tool: (n: string, _d: string, _s: any, cb: any) => { tools[n] = cb; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerMealTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('meal tools', () => {
  // ── skylight_list_recipes ───────────────────────────────────────────────

  it('list_recipes fetches recipes with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{ id: '1', type: 'recipe', attributes: { summary: 'Tacos', description: 'Yum', draft: false } }],
    });
    const out = await tools.skylight_list_recipes({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/meals/recipes');
    expect(JSON.parse(out.content[0].text)).toEqual([
      { id: '1', type: 'recipe', summary: 'Tacos', description: 'Yum', draft: false },
    ]);
  });

  it('list_recipes with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_recipes({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/meals/recipes');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_meal_categories ───────────────────────────────────────

  it('list_meal_categories fetches categories with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{ id: '2', type: 'meal_category', attributes: { color: '#fff', label: 'Dinner', enabled: true, position: 1 } }],
    });
    const out = await tools.skylight_list_meal_categories({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/meals/categories');
    expect(JSON.parse(out.content[0].text)).toEqual([
      { id: '2', type: 'meal_category', color: '#fff', label: 'Dinner', enabled: true, position: 1 },
    ]);
  });

  it('list_meal_categories with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_meal_categories({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/meals/categories');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_get_recipe ─────────────────────────────────────────────────

  it('get_recipe fetches one recipe with meal_category include and default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'recipe', attributes: { summary: 'Tacos' } } });
    const out = await tools.skylight_get_recipe({ id: '1' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/meals/recipes/1?include=meal_category');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'recipe', summary: 'Tacos' });
  });

  it('get_recipe with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'recipe', attributes: {} } });
    await tools.skylight_get_recipe({ id: '1', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/meals/recipes/1?include=meal_category');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_create_recipe ──────────────────────────────────────────────

  it('create_recipe posts flat body with default frame and meal_category include', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'recipe', attributes: { summary: 'Tacos', description: 'Yum' } } });
    const out = await tools.skylight_create_recipe({ meal_category_id: '2', summary: 'Tacos', description: 'Yum' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/meals/recipes?include=meal_category', {
      body: { meal_category_id: '2', summary: 'Tacos', description: 'Yum' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'recipe', summary: 'Tacos', description: 'Yum' });
  });

  it('create_recipe accepts a numeric meal_category_id', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'recipe', attributes: {} } });
    await tools.skylight_create_recipe({ meal_category_id: 2, summary: 'Tacos' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/meals/recipes?include=meal_category', {
      body: { meal_category_id: 2, summary: 'Tacos' },
    });
  });

  it('create_recipe drops description when absent via compact()', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'recipe', attributes: {} } });
    await tools.skylight_create_recipe({ meal_category_id: '2', summary: 'Tacos' });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ meal_category_id: '2', summary: 'Tacos' });
    expect('description' in body).toBe(false);
  });

  it('create_recipe with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'recipe', attributes: {} } });
    await tools.skylight_create_recipe({ meal_category_id: '2', summary: 'Tacos', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/meals/recipes?include=meal_category', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_recipe ──────────────────────────────────────────────

  it('update_recipe patches by id with only provided attrs and include', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'recipe', attributes: { summary: 'New' } } });
    const out = await tools.skylight_update_recipe({ id: '1', summary: 'New' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/meals/recipes/1?include=meal_category', {
      body: { summary: 'New' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'recipe', summary: 'New' });
  });

  it('update_recipe sends all provided attrs flat', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'recipe', attributes: {} } });
    await tools.skylight_update_recipe({ id: '1', meal_category_id: 3, summary: 'New', description: 'Desc' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/meals/recipes/1?include=meal_category', {
      body: { meal_category_id: 3, summary: 'New', description: 'Desc' },
    });
  });

  it('update_recipe with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'recipe', attributes: {} } });
    await tools.skylight_update_recipe({ id: '1', summary: 'New', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/99/meals/recipes/1?include=meal_category', { body: { summary: 'New' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_recipe ──────────────────────────────────────────────

  it('delete_recipe deletes by id with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_recipe({ id: '1' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/meals/recipes/1');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '1' });
  });

  it('delete_recipe with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_recipe({ id: '1', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/meals/recipes/1');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_add_recipe_to_grocery_list ─────────────────────────────────

  it('add_recipe_to_grocery_list posts with list_id and returns flattened doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '50', type: 'list_item', attributes: { name: 'Cheese' } } });
    const out = await tools.skylight_add_recipe_to_grocery_list({ id: '1', list_id: 7 });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/meals/recipes/1/add_to_grocery_list', {
      body: { list_id: 7 },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '50', type: 'list_item', name: 'Cheese' });
  });

  it('add_recipe_to_grocery_list omits list_id when absent and falls back to added text', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_add_recipe_to_grocery_list({ id: '1' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/meals/recipes/1/add_to_grocery_list', { body: {} });
    expect(JSON.parse(out.content[0].text)).toEqual({ added: '1' });
  });

  it('add_recipe_to_grocery_list with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_add_recipe_to_grocery_list({ id: '1', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/meals/recipes/1/add_to_grocery_list', { body: {} });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_plan_meal ──────────────────────────────────────────────────

  it('plan_meal POSTs a sitting with compacted body and default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'meal_sitting', attributes: { summary: 'Tacos', date: '2026-06-02' } } });
    const out = await tools.skylight_plan_meal({ meal_category_id: '2', date: '2026-06-02', summary: 'Tacos' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/meals/sittings', {
      body: { meal_category_id: '2', date: '2026-06-02', summary: 'Tacos' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '7', type: 'meal_sitting', summary: 'Tacos', date: '2026-06-02' });
  });

  it('plan_meal sends all provided fields including a plain rrule string', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'meal_sitting', attributes: {} } });
    await tools.skylight_plan_meal({
      meal_category_id: 2,
      date: '2026-06-02',
      summary: 'Tacos',
      description: 'Beef, tortillas',
      meal_recipe_id: '5',
      rrule: 'FREQ=DAILY;INTERVAL=1;UNTIL=20260626T235959Z',
      note: 'family fav',
      add_to_grocery_list: true,
      saveToRecipeBox: false,
    });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/meals/sittings', {
      body: {
        meal_recipe_id: '5',
        meal_category_id: 2,
        date: '2026-06-02',
        rrule: 'FREQ=DAILY;INTERVAL=1;UNTIL=20260626T235959Z',
        summary: 'Tacos',
        description: 'Beef, tortillas',
        note: 'family fav',
        add_to_grocery_list: true,
        saveToRecipeBox: false,
      },
    });
  });

  it('plan_meal drops undefined optionals via compact()', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'meal_sitting', attributes: {} } });
    await tools.skylight_plan_meal({ meal_category_id: '2', date: '2026-06-02', summary: 'Tacos' });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ meal_category_id: '2', date: '2026-06-02', summary: 'Tacos' });
    expect('rrule' in body).toBe(false);
    expect('meal_recipe_id' in body).toBe(false);
  });

  it('plan_meal with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'meal_sitting', attributes: {} } });
    await tools.skylight_plan_meal({ meal_category_id: '2', date: '2026-06-02', summary: 'Tacos', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/meals/sittings', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_meal_sittings ─────────────────────────────────────────

  // The API validates `include` server-side: an unknown relationship name
  // deterministically 500s (probed live with `bogus_relationship` and the
  // near-miss `profiless`), while all three of the sitting's real
  // relationships are accepted. `profiles` answers "who is this meal for?" —
  // without it those come back as bare `{ id, type }` links with no names.
  it('list_meal_sittings sideloads all three sitting relationships, profiles included', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_meal_sittings({ date_min: '2026-06-01', date_max: '2026-06-07' });
    const include = (request.mock.calls[0][2] as { query: { include: string } }).query.include;
    expect(include.split(',')).toEqual(['meal_category', 'meal_recipe', 'profiles']);
  });

  it('list_meal_sittings GETs the date range with all three includes and the default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    const out = await tools.skylight_list_meal_sittings({ date_min: '2026-06-01', date_max: '2026-06-07' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/meals/sittings', {
      query: { date_min: '2026-06-01', date_max: '2026-06-07', include: 'meal_category,meal_recipe,profiles' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([]);
  });

  it('list_meal_sittings resolves sideloaded meal_category + meal_recipe and keeps instances', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{
        id: '7',
        type: 'meal_sitting',
        attributes: { summary: 'Tacos', instances: ['2026-06-02'], draft: false },
        relationships: {
          meal_category: { data: { id: '2', type: 'meal_category' } },
          meal_recipe: { data: { id: '5', type: 'meal_recipe' } },
        },
      }],
      included: [
        { id: '2', type: 'meal_category', attributes: { label: 'Dinner', color: '#fff' } },
        { id: '5', type: 'meal_recipe', attributes: { summary: 'Tacos', description: 'Beef, tortillas' } },
      ],
    });
    const out = await tools.skylight_list_meal_sittings({ date_min: '2026-06-01', date_max: '2026-06-07' });
    expect(JSON.parse(out.content[0].text)).toEqual([{
      id: '7',
      type: 'meal_sitting',
      summary: 'Tacos',
      instances: ['2026-06-02'],
      draft: false,
      meal_category: { id: '2', type: 'meal_category', label: 'Dinner', color: '#fff' },
      meal_recipe: { id: '5', type: 'meal_recipe', summary: 'Tacos', description: 'Beef, tortillas' },
    }]);
  });

  it('list_meal_sittings falls back to the bare link when a relationship is not sideloaded', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{
        id: '7',
        type: 'meal_sitting',
        attributes: { summary: 'Tacos', instances: ['2026-06-02'] },
        relationships: { meal_recipe: { data: { id: '5', type: 'meal_recipe' } } },
      }],
      included: [{ id: '2', type: 'meal_category', attributes: { label: 'Dinner' } }],
    });
    const out = await tools.skylight_list_meal_sittings({ date_min: '2026-06-01', date_max: '2026-06-07' });
    expect(JSON.parse(out.content[0].text)).toEqual([{
      id: '7', type: 'meal_sitting', summary: 'Tacos', instances: ['2026-06-02'],
      meal_recipe: { id: '5', type: 'meal_recipe' },
    }]);
  });

  it('list_meal_sittings resolves a to-many profiles relationship', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{
        id: '7',
        type: 'meal_sitting',
        attributes: { summary: 'Tacos' },
        relationships: { profiles: { data: [{ id: '11', type: 'profile' }, { id: '12', type: 'profile' }] } },
      }],
      included: [{ id: '11', type: 'profile', attributes: { name: 'Ada' } }],
    });
    const out = await tools.skylight_list_meal_sittings({ date_min: '2026-06-01', date_max: '2026-06-07' });
    expect(JSON.parse(out.content[0].text)).toEqual([{
      id: '7', type: 'meal_sitting', summary: 'Tacos',
      profiles: [{ id: '11', type: 'profile', name: 'Ada' }, { id: '12', type: 'profile' }],
    }]);
  });

  it('list_meal_sittings passes through a sitting with no relationships and a doc with no included', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{ id: '7', type: 'meal_sitting', attributes: { summary: 'Leftovers', instances: ['2026-06-03'] } }],
    });
    const out = await tools.skylight_list_meal_sittings({ date_min: '2026-06-01', date_max: '2026-06-07' });
    expect(JSON.parse(out.content[0].text)).toEqual([
      { id: '7', type: 'meal_sitting', summary: 'Leftovers', instances: ['2026-06-03'] },
    ]);
  });

  it('list_meal_sittings with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_meal_sittings({ date_min: '2026-06-01', date_max: '2026-06-07', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/meals/sittings', {
      query: { date_min: '2026-06-01', date_max: '2026-06-07', include: 'meal_category,meal_recipe,profiles' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
