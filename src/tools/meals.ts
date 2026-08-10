import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, idParam, type GetClient, type JsonApiDoc } from './_shared.js';

// LIVE-VERIFIED: GET /frames/{f}/meals/sittings requires BOTH date_min and
// date_max (each is a separate 422 — "Date min is required." / "Date max is
// required."), and supports include=meal_category,meal_recipe,profiles, which
// sideloads those resources into the document's `included` array. There is no
// single-sitting read — GET /frames/{f}/meals/sittings/{id} returns 404.
//
// `profiles` (the family members a sitting is assigned to) is included for the
// same reason as the other two: relationship data is only ever a bare
// `{ id, type }` ref, and the caller has no way to turn a profile id into a name
// on its own — there is no profiles collection to look it up in (GET
// /frames/{f}/profiles and GET /profiles both 404), and a `category_detail`
// carries no profile link, so whether a profile id is even the same id space as
// the category ids `skylight_resolve_member` returns is unverified. Sideloading
// is therefore the only route from an assigned member to its name.
// Not extended further: `include` is validated server-side and an unknown
// relationship 500s, so only relationships verified to return 200 belong here.
const SITTING_INCLUDE = 'meal_category,meal_recipe,profiles';

/** A JSON:API resource identifier — the `{ id, type }` pointer in a relationship. */
interface ResourceRef { id: string; type: string }
interface SittingResource extends ResourceRef {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: ResourceRef | ResourceRef[] | null }>;
}
interface SittingDoc { data: SittingResource[]; included?: SittingResource[] }

/**
 * Flatten meal sittings, inlining their sideloaded relationships.
 *
 * The shared `flattenJsonApi()` keeps only `attributes` + `id`/`type`, dropping
 * `relationships` and `included`. Applied to a sitting, that discards the one
 * field saying whether the meal is breakfast, lunch or dinner (`meal_category`),
 * and leaves the caller no id with which to recover it. So resolve each
 * relationship ref against `included` and inline the flattened resource under the
 * relationship name, falling back to the bare `{ id, type }` ref when it was not
 * sideloaded.
 */
function flattenSittings(doc: SittingDoc | undefined): Record<string, unknown>[] {
  const sideloaded = new Map<string, Record<string, unknown>>();
  for (const r of doc?.included ?? []) {
    sideloaded.set(`${r.type}:${r.id}`, { ...r.attributes, id: r.id, type: r.type });
  }
  const resolve = (ref: ResourceRef) => sideloaded.get(`${ref.type}:${ref.id}`) ?? ref;

  return (doc?.data ?? []).map((sitting) => {
    const flat: Record<string, unknown> = { ...sitting.attributes, id: sitting.id, type: sitting.type };
    for (const [name, rel] of Object.entries(sitting.relationships ?? {})) {
      // A relationship with `data: null` (no linked recipe) carries no information.
      if (rel.data === null || rel.data === undefined) continue;
      flat[name] = Array.isArray(rel.data) ? rel.data.map(resolve) : resolve(rel.data);
    }
    return flat;
  });
}

export function registerMealTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_recipes', 'List meal recipes for the frame.', {
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f) =>
    textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/meals/recipes`)))));

  server.tool('skylight_list_meal_categories', 'List meal categories for the frame.', {
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f) =>
    textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/meals/categories`)))));

  server.tool('skylight_list_meals', 'List planned meals (meal sittings) in a date range — what is on the meal plan for each day. Each sitting carries the dates it falls on in its `instances` array, its meal slot in `meal_category` (breakfast/lunch/dinner), its linked recipe in `meal_recipe`, and the family members it is assigned to in `profiles`.', {
    date_min: z.string().describe('YYYY-MM-DD inclusive lower bound (required by the API).'),
    date_max: z.string().describe('YYYY-MM-DD inclusive upper bound (required by the API).'),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { date_min, date_max }: { date_min: string; date_max: string; frameId?: string }) => {
    const doc = await c.request<SittingDoc>('GET', `/frames/${f}/meals/sittings`, {
      query: { date_min, date_max, include: SITTING_INCLUDE },
    });
    return textContent(flattenSittings(doc));
  }));

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
