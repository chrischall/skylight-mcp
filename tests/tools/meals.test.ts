import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { registerMealTools } from '../../src/tools/meals.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  // Take the LAST argument as the handler: tools registered with an annotations
  // object (e.g. skylight_delete_meal's destructiveHint) use the 5-arg form.
  const annotations: Record<string, any> = {};
  // `rest` is [description, schema, handler] or, for the 5-arg form,
  // [description, schema, annotations, handler].
  // Schemas are captured too: the harness calls handlers DIRECTLY, so zod never
  // runs on this path and schema-level rules (e.g. instance_date's format) are
  // invisible to a handler test. They have to be asserted against the schema.
  const schemas: Record<string, any> = {};
  const server = { tool: (name: string, ...rest: any[]) => {
    tools[name] = rest[rest.length - 1];
    schemas[name] = rest[1];
    if (rest.length === 4) annotations[name] = rest[2];
  } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerMealTools(server, async () => client);
  return { tools, annotations, schemas, request, resolveFrameId };
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

  // ── skylight_list_meals ─────────────────────────────────────────────────

  it('list_meals fetches sittings for the date range with includes and inlines them', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [
        {
          id: '39053874',
          type: 'meal_sitting',
          attributes: { summary: 'Butter Chicken', description: '', rrule: null, draft: false, recurring: false, instances: ['2026-07-30'] },
          relationships: {
            meal_category: { data: { id: '6234716', type: 'meal_category' } },
            meal_recipe: { data: { id: '55407800', type: 'meal_recipe' } },
            profiles: { data: [] },
          },
        },
      ],
      included: [
        { id: '6234716', type: 'meal_category', attributes: { label: 'Dinner', position: 3 } },
        { id: '55407800', type: 'meal_recipe', attributes: { summary: 'Butter Chicken', draft: false } },
      ],
      meta: { ignored: true },
    });
    const out = await tools.skylight_list_meals({ date_min: '2026-07-30', date_max: '2026-08-05' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/meals/sittings', {
      query: { date_min: '2026-07-30', date_max: '2026-08-05', include: 'meal_category,meal_recipe,profiles' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([
      {
        id: '39053874',
        type: 'meal_sitting',
        summary: 'Butter Chicken',
        description: '',
        rrule: null,
        draft: false,
        recurring: false,
        instances: ['2026-07-30'],
        meal_category: { id: '6234716', type: 'meal_category', label: 'Dinner', position: 3 },
        meal_recipe: { id: '55407800', type: 'meal_recipe', summary: 'Butter Chicken', draft: false },
        profiles: [],
      },
    ]);
  });

  it('list_meals resolves an array relationship through included', async () => {
    // `profiles` (the family members a sitting is assigned to) is array-valued and
    // sideloaded, so each ref must resolve to a named resource rather than a bare id.
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [
        {
          id: '7',
          type: 'meal_sitting',
          attributes: { summary: 'Pancakes', instances: ['2026-08-01'] },
          relationships: { profiles: { data: [{ id: '4', type: 'profile' }, { id: '5', type: 'profile' }] } },
        },
      ],
      included: [
        { id: '4', type: 'profile', attributes: { name: 'Ada' } },
        { id: '5', type: 'profile', attributes: { name: 'Grace' } },
      ],
    });
    const out = await tools.skylight_list_meals({ date_min: '2026-08-01', date_max: '2026-08-01' });
    expect(JSON.parse(out.content[0].text)).toEqual([
      {
        id: '7',
        type: 'meal_sitting',
        summary: 'Pancakes',
        instances: ['2026-08-01'],
        profiles: [
          { id: '4', type: 'profile', name: 'Ada' },
          { id: '5', type: 'profile', name: 'Grace' },
        ],
      },
    ]);
  });

  it('list_meals returns an empty list when the response carries no document', async () => {
    // SkylightClient.request() resolves to undefined for a 204/empty body; a list
    // GET realistically always returns a document, but an empty result beats a
    // "Cannot read properties of undefined" TypeError if one ever does not.
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_list_meals({ date_min: '2026-08-03', date_max: '2026-08-03' });
    expect(JSON.parse(out.content[0].text)).toEqual([]);
  });

  it('list_meals falls back to the bare ref when a relationship is not sideloaded', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [
        {
          id: '1',
          type: 'meal_sitting',
          attributes: { summary: 'Pizza', instances: ['2026-08-03'] },
          relationships: {
            meal_category: { data: { id: '9', type: 'meal_category' } },
            meal_recipe: { data: null },
            profiles: { data: [{ id: '4', type: 'profile' }] },
          },
        },
      ],
    });
    const out = await tools.skylight_list_meals({ date_min: '2026-08-03', date_max: '2026-08-03' });
    expect(JSON.parse(out.content[0].text)).toEqual([
      {
        id: '1',
        type: 'meal_sitting',
        summary: 'Pizza',
        instances: ['2026-08-03'],
        meal_category: { id: '9', type: 'meal_category' },
        profiles: [{ id: '4', type: 'profile' }],
      },
    ]);
  });

  it('list_meals handles a sitting with no attributes and no relationships', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '2', type: 'meal_sitting' }] });
    const out = await tools.skylight_list_meals({ date_min: '2026-08-03', date_max: '2026-08-03' });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '2', type: 'meal_sitting' }]);
  });

  it('list_meals with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_meals({ date_min: '2026-08-03', date_max: '2026-08-03', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/meals/sittings', expect.any(Object));
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

  // ── skylight_update_meal ────────────────────────────────────────────────
  //
  // The route is a member under /instances/{instanceISO}, NOT on the sitting
  // itself — see the note above skylight_update_meal in src/tools/meals.ts.

  // instance_date is interpolated into the PATH, so a bad format produces a
  // routing 404 that reads like "no such sitting" rather than naming the real
  // problem. Asserted on the SCHEMA because the harness bypasses zod.
  it.each(['skylight_update_meal', 'skylight_delete_meal'])(
    '%s rejects an instance_date that is not exactly YYYY-MM-DD',
    (tool) => {
      const { schemas } = harness();
      const field = z.object(schemas[tool]).shape.instance_date;
      expect(field.safeParse('2026-09-08').success).toBe(true);
      for (const bad of ['2026-09-08T00:00:00Z', '2026-9-8', '08-09-2026', '', 'today']) {
        expect(field.safeParse(bad).success, bad).toBe(false);
      }
    },
  );

  it('update_meal PATCHes the instance route with apply_to and the sideload include', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_update_meal({
      id: '42', instance_date: '2026-09-08', apply_to: 'one', summary: 'Burritos',
    });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/3435252/meals/sittings/42/instances/2026-09-08', {
      query: { apply_to: 'one', include: 'meal_category,meal_recipe,profiles' },
      body: { summary: 'Burritos' },
    });
  });

  it('update_meal prunes undefined fields from the body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_update_meal({
      id: '42', instance_date: '2026-09-08', apply_to: 'all', rrule: 'FREQ=WEEKLY;BYDAY=TU', meal_recipe_id: 7, confirm: true,
    });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=TU', meal_recipe_id: 7 });
    expect(Object.keys(body)).not.toContain('summary');
  });

  it('update_meal inlines sideloaded relationships like list_meals does', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [{
        id: '42', type: 'meal_sitting',
        attributes: { summary: 'Tacos', instances: ['2026-09-08'] },
        relationships: { meal_category: { data: { id: '9', type: 'meal_category' } } },
      }],
      included: [{ id: '9', type: 'meal_category', attributes: { label: 'Dinner' } }],
    });
    const out = await tools.skylight_update_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'one' });
    expect(JSON.parse(out.content[0].text)[0].meal_category).toEqual({ id: '9', type: 'meal_category', label: 'Dinner' });
  });

  it('update_meal with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_update_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'one', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PATCH', '/frames/99/meals/sittings/42/instances/2026-09-08', expect.any(Object));
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_meal ────────────────────────────────────────────────

  it('delete_meal without confirm returns a dry-run preview and makes NO network call', async () => {
    const { tools, request } = harness();
    const out = await tools.skylight_delete_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'all' });
    expect(request).not.toHaveBeenCalled();
    const preview = JSON.parse(out.content[0].text);
    expect(preview.dryRun).toBe(true);
    expect(preview.method).toBe('DELETE');
    expect(preview.willSend).toEqual({ id: '42', instance_date: '2026-09-08', apply_to: 'all' });
  });

  it('delete_meal with confirm DELETEs the instance route with apply_to', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_delete_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'future', confirm: true });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/meals/sittings/42/instances/2026-09-08', {
      query: { apply_to: 'future', include: 'meal_category,meal_recipe,profiles' },
    });
  });

  it('delete_meal falls back to a summary object when the API returns an empty body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'one', confirm: true });
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '42', instance_date: '2026-09-08', apply_to: 'one' });
  });
it('update_meal flattens a single-resource data object, not just an array', async () => {
    const { tools, request } = harness();
    // JSON:API member routes conventionally return `data` as one resource
    // rather than a collection. Nothing pins which shape the instance routes
    // use, so flattenSittings() must tolerate both.
    request.mockResolvedValue({
      data: {
        id: '42', type: 'meal_sitting',
        attributes: { summary: 'Tacos' },
        relationships: { meal_category: { data: { id: '9', type: 'meal_category' } } },
      },
      included: [{ id: '9', type: 'meal_category', attributes: { label: 'Dinner' } }],
    });
    const out = await tools.skylight_update_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'one' });
    const rows = JSON.parse(out.content[0].text);
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe('Tacos');
    expect(rows[0].meal_category).toEqual({ id: '9', type: 'meal_category', label: 'Dinner' });
  });

  it('update_meal is annotated destructive — apply_to one/future split the series', async () => {
    const { annotations } = harness();
    expect(annotations.skylight_update_meal).toEqual({ destructiveHint: true });
    expect(annotations.skylight_delete_meal).toEqual({ destructiveHint: true });
  });

  it('delete_meal falls back to a summary object on a 200 with no sittings in it', async () => {
    // A true 204 yields `undefined`, but a 200 {} or 200 {"data":[]} is truthy
    // and would otherwise render as [] — which reads as "nothing was deleted"
    // and invites the model to retry an irreversible call.
    for (const body of [{}, { data: [] }, { data: null }]) {
      const { tools, request } = harness();
      request.mockResolvedValue(body);
      const out = await tools.skylight_delete_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'one', confirm: true });
      expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '42', instance_date: '2026-09-08', apply_to: 'one' });
    }
  });

  it('delete_meal returns the deleted sittings when the API does send a body', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '42', type: 'meal_sitting', attributes: { summary: 'Tacos' } }] });
    const out = await tools.skylight_delete_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'all', confirm: true });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '42', type: 'meal_sitting', summary: 'Tacos' }]);
  });
});

describe('meal confirm gate — scoped to blast radius', () => {
  it('delete_meal does NOT gate apply_to:one', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'one' });
    expect(request).toHaveBeenCalled();
  });

  it.each(['future', 'all'])('delete_meal gates apply_to:%s and makes NO request', async (scope) => {
    const { tools, request } = harness();
    const res = await tools.skylight_delete_meal({ id: '42', instance_date: '2026-09-08', apply_to: scope });
    expect(request).not.toHaveBeenCalled();
    expect(JSON.parse(res.content[0].text).dryRun).toBe(true);
  });

  it.each(['future', 'all'])('update_meal gates apply_to:%s and makes NO request', async (scope) => {
    const { tools, request } = harness();
    const res = await tools.skylight_update_meal({ id: '42', instance_date: '2026-09-08', apply_to: scope, summary: 'x' });
    expect(request).not.toHaveBeenCalled();
    expect(JSON.parse(res.content[0].text).willSend).toEqual({ summary: 'x' });
  });

  it('update_meal does NOT gate apply_to:one', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_update_meal({ id: '42', instance_date: '2026-09-08', apply_to: 'one', summary: 'x' });
    expect(request).toHaveBeenCalled();
  });
});
