import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, idParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerMealTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_recipes', 'List meal recipes for the frame.', {
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f) =>
    textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/meals/recipes`)))));

  server.tool('skylight_list_meal_categories', 'List meal categories for the frame.', {
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f) =>
    textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/meals/categories`)))));

  server.tool('skylight_get_recipe', 'Get one meal recipe.', {
    id: z.string(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) =>
    textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/meals/recipes/${id}?include=meal_category`)))));

  server.tool('skylight_create_recipe', 'Create a meal recipe.', {
    meal_category_id: idParam.describe('Meal category id (from list_meal_categories, required).'),
    summary: z.string().describe('Recipe title.'),
    description: z.string().optional(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { meal_category_id, summary, description }: { meal_category_id: string | number; summary: string; description?: string; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/meals/recipes?include=meal_category`, {
      body: pruneUndefined({ meal_category_id, summary, description }),
    });
    return textContent(flattenJsonApi(doc));
  }));

  server.tool('skylight_update_recipe', 'Update a meal recipe.', {
    id: z.string(),
    meal_category_id: idParam.optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { id, meal_category_id, summary, description }: { id: string; meal_category_id?: string | number; summary?: string; description?: string; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/meals/recipes/${id}?include=meal_category`, {
      body: pruneUndefined({ meal_category_id, summary, description }),
    });
    return textContent(flattenJsonApi(doc));
  }));

  server.tool('skylight_delete_recipe', 'Delete a meal recipe.', {
    id: z.string(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
    await c.request('DELETE', `/frames/${f}/meals/recipes/${id}`);
    return textContent({ deleted: id });
  }));

  server.tool('skylight_plan_meal', 'Plan a meal on a date (optionally repeating, link a recipe, add to grocery list).', {
    meal_category_id: idParam.describe('Meal category id (breakfast/lunch/dinner — from skylight_list_meal_categories).'),
    date: z.string().describe('YYYY-MM-DD the meal is planned for.'),
    summary: z.string().describe('Meal name.'),
    description: z.string().optional().describe('Ingredients / instructions.'),
    meal_recipe_id: idParam.optional().describe('Link an existing recipe.'),
    rrule: z.string().optional().describe('iCal RRULE string for a repeating meal, e.g. "FREQ=DAILY;INTERVAL=1;UNTIL=20260626T235959Z" (meals use a plain rrule string, NOT an array).'),
    note: z.string().optional(),
    add_to_grocery_list: z.boolean().optional(),
    saveToRecipeBox: z.boolean().optional(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { meal_recipe_id, meal_category_id, date, rrule, summary, description, note, add_to_grocery_list, saveToRecipeBox }: { meal_recipe_id?: string | number; meal_category_id: string | number; date: string; rrule?: string; summary: string; description?: string; note?: string; add_to_grocery_list?: boolean; saveToRecipeBox?: boolean; frameId?: string }) => {
    const body = pruneUndefined({ meal_recipe_id, meal_category_id, date, rrule, summary, description, note, add_to_grocery_list, saveToRecipeBox });
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/meals/sittings`, { body })));
  }));

  server.tool('skylight_add_recipe_to_grocery_list', "Add a recipe's ingredients to a grocery list.", {
    id: z.string(),
    list_id: idParam.optional().describe('Target grocery list id; omit for the default grocery list.'),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { id, list_id }: { id: string; list_id?: string | number; frameId?: string }) => {
    // NOTE: add_to_grocery_list body (list_id) is inferred, not live-verified.
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/meals/recipes/${id}/add_to_grocery_list`, {
      body: pruneUndefined({ list_id }),
    });
    return doc ? textContent(flattenJsonApi(doc)) : textContent({ added: id });
  }));
}
