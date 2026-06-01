import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi, compact, type JsonApiDoc } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

export function registerMealTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_recipes', 'List meal recipes for the frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/meals/recipes`)));
  });

  server.tool('skylight_list_meal_categories', 'List meal categories for the frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/meals/categories`)));
  });

  server.tool('skylight_get_recipe', 'Get one meal recipe.', {
    id: z.string(),
    frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/meals/recipes/${id}?include=meal_category`)));
  });

  server.tool('skylight_create_recipe', 'Create a meal recipe.', {
    meal_category_id: z.union([z.string(), z.number()]).describe('Meal category id (from list_meal_categories, required).'),
    summary: z.string().describe('Recipe title.'),
    description: z.string().optional(),
    frameId: z.string().optional(),
  }, async ({ meal_category_id, summary, description, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/meals/recipes?include=meal_category`, {
      body: compact({ meal_category_id, summary, description }),
    });
    return textContent(flattenJsonApi(doc));
  });

  server.tool('skylight_update_recipe', 'Update a meal recipe.', {
    id: z.string(),
    meal_category_id: z.union([z.string(), z.number()]).optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    frameId: z.string().optional(),
  }, async ({ id, meal_category_id, summary, description, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/meals/recipes/${id}?include=meal_category`, {
      body: compact({ meal_category_id, summary, description }),
    });
    return textContent(flattenJsonApi(doc));
  });

  server.tool('skylight_delete_recipe', 'Delete a meal recipe.', {
    id: z.string(),
    frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    await c.request('DELETE', `/frames/${f}/meals/recipes/${id}`);
    return textContent({ deleted: id });
  });

  server.tool('skylight_add_recipe_to_grocery_list', "Add a recipe's ingredients to a grocery list.", {
    id: z.string(),
    list_id: z.union([z.string(), z.number()]).optional().describe('Target grocery list id; omit for the default grocery list.'),
    frameId: z.string().optional(),
  }, async ({ id, list_id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    // NOTE: add_to_grocery_list body (list_id) is inferred, not live-verified.
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/meals/recipes/${id}/add_to_grocery_list`, {
      body: compact({ list_id }),
    });
    return doc ? textContent(flattenJsonApi(doc)) : textContent({ added: id });
  });
}
