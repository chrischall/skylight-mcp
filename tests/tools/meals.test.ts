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
});
