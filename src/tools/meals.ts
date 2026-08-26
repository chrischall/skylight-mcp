import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, idParam, type GetClient, type JsonApiDoc } from './_shared.js';
import { previewUnlessConfirmed, schemaConfirm } from './_confirm.js';

// LIVE-VERIFIED: GET /frames/{f}/meals/sittings requires BOTH date_min and
// date_max (each is a separate 422 — "Date min is required." / "Date max is
// required."), and supports include=meal_category,meal_recipe,profiles, which
// sideloads those resources into the document's `included` array. There is no
// single-sitting read at GET /frames/{f}/meals/sittings/{id} (404) — but there
// IS one a level down, at GET /frames/{f}/meals/sittings/{id}/instances (see
// the instance-route note above skylight_update_meal below).
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
interface SittingDoc { data?: SittingResource | SittingResource[] | null; included?: SittingResource[] }

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
 *
 * `data` is normalized because this runs against both the collection read
 * (`GET /meals/sittings`, an array) and the instance member routes
 * (`PATCH`/`DELETE .../instances/{iso}`). JSON:API member endpoints
 * conventionally return a single resource, and assuming an array would surface
 * as an opaque "map is not a function" TypeError rather than degrading.
 */
function flattenSittings(doc: SittingDoc | undefined): Record<string, unknown>[] {
  const sideloaded = new Map<string, Record<string, unknown>>();
  for (const r of doc?.included ?? []) {
    sideloaded.set(`${r.type}:${r.id}`, { ...r.attributes, id: r.id, type: r.type });
  }
  const resolve = (ref: ResourceRef) => sideloaded.get(`${ref.type}:${ref.id}`) ?? ref;

  const data = doc?.data;
  const rows = Array.isArray(data) ? data : data ? [data] : [];

  return rows.map((sitting) => {
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
    summary: z.string().describe('Meal name. LIVE-VERIFIED: when meal_recipe_id is set, this must be BLANK — pass "" and the sitting inherits its name from the linked recipe. Sending a non-blank summary together with a recipe id returns 422 {"errors":{"summary":["must be blank"]}}.'),
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

  // LIVE-VERIFIED (2026-08-24). Meal sittings are NOT create-only: they can be
  // edited and deleted. The routes are members one level *below* the sitting,
  // under `/instances/{instanceISO}` — which is why probing the sitting itself
  // (`/meals/sittings/{id}`, and the `/instances` collection) only ever found
  // routing 404s. Recovered from the web client bundle, then exercised against
  // the live API on a throwaway series.
  //
  //   PATCH  /frames/{f}/meals/sittings/{id}/instances/{iso}?apply_to=…
  //   DELETE /frames/{f}/meals/sittings/{id}/instances/{iso}?apply_to=…
  //
  // `instanceISO` is the YYYY-MM-DD of the occurrence being acted on and must be
  // one of that sitting's `instances`. `apply_to` is the app-wide recurrence
  // scope (`ScheduledItemUpdateApplyTo`), shared with calendar events.
  //
  // Observed scope semantics (each verified live):
  //   one    — splits that occurrence out into its own standalone sitting (new
  //            id, `rrule: null`) and drops the date from the original series.
  //   future — truncates the original series' rrule UNTIL to just before the
  //            occurrence, and creates a NEW INDEPENDENT sitting for the
  //            remainder. That new sitting is NOT reachable from the original's
  //            /instances endpoint — re-run skylight_list_meals over the date
  //            range to find it, or it looks like the tail silently vanished.
  //   all    — applies to (or deletes) the entire series.
  const APPLY_TO = z
    .enum(['one', 'future', 'all'])
    .describe("Recurrence scope: 'one' = just this occurrence (splits it out of the series), 'future' = this and all later occurrences (splits the tail into a new sitting), 'all' = the whole series.");

  server.tool('skylight_update_meal', "Update a planned meal (meal sitting) — change its name, recipe, category/slot, notes, date or repeat rule. Targets one occurrence by its date and applies the change at the chosen recurrence scope. For a recurring meal, note that apply_to:'one' and 'future' SPLIT the series into additional sittings rather than editing in place; re-run skylight_list_meals afterward to see the resulting shape.",
    {
      id: idParam.describe('Meal sitting id (from skylight_list_meals).'),
      instance_date: z.string().describe("YYYY-MM-DD of the occurrence to act on — must be one of that sitting's `instances`."),
      apply_to: APPLY_TO,
      summary: z.string().optional().describe('New meal name. The create route 422s when this is non-blank and meal_recipe_id is also set; whether PATCH enforces the same rule is UNVERIFIED, so prefer setting one or the other.'),
      description: z.string().optional().describe('Ingredients / instructions.'),
      note: z.string().optional(),
      date: z.string().optional().describe('YYYY-MM-DD to move the meal to.'),
      rrule: z.string().optional().describe('Replacement iCal RRULE string (plain string, NOT an array).'),
      meal_category_id: idParam.optional().describe('Move to another slot (breakfast/lunch/dinner).'),
      meal_recipe_id: idParam.optional().describe('Link a different recipe.'),
      frameId: z.string().optional(),
    },
    // Destructive despite being an "update": per the live findings above,
    // apply_to 'one' and 'future' do not edit in place — they rewrite the
    // original series' rrule and spawn additional sittings.
    { destructiveHint: true },
    frameScoped(getClient, async (c, f, { id, instance_date, apply_to, summary, description, note, date, rrule, meal_category_id, meal_recipe_id }: { id: string | number; instance_date: string; apply_to: 'one' | 'future' | 'all'; summary?: string; description?: string; note?: string; date?: string; rrule?: string; meal_category_id?: string | number; meal_recipe_id?: string | number; frameId?: string }) => {
      const body = pruneUndefined({ summary, description, note, date, rrule, meal_category_id, meal_recipe_id });
      const doc = await c.request<SittingDoc>('PATCH', `/frames/${f}/meals/sittings/${id}/instances/${instance_date}`, {
        query: { apply_to, include: SITTING_INCLUDE },
        body,
      });
      return textContent(flattenSittings(doc));
    }));

  const deleteMeal = frameScoped(getClient, async (c, f, { id, instance_date, apply_to }: { id: string | number; instance_date: string; apply_to: 'one' | 'future' | 'all'; frameId?: string }) => {
    const doc = await c.request<SittingDoc>('DELETE', `/frames/${f}/meals/sittings/${id}/instances/${instance_date}`, {
      query: { apply_to, include: SITTING_INCLUDE },
    });
    // A true 204 yields `undefined`, but a 200 {} or 200 {"data":[]} is truthy
    // and would render as [] — which reads to a model as "nothing was deleted",
    // inviting a retry of an irreversible call. Decide on the flattened rows.
    const rows = flattenSittings(doc);
    return rows.length ? textContent(rows) : textContent({ deleted: String(id), instance_date, apply_to });
  });

  server.tool('skylight_delete_meal', "Remove a planned meal (meal sitting) from the meal plan. Deletes one occurrence, this-and-future occurrences, or the whole series depending on apply_to. There is no undo — without confirm:true this returns a dry-run preview of exactly what would be deleted and makes NO network call; with confirm:true it deletes.",
    {
      id: idParam.describe('Meal sitting id (from skylight_list_meals).'),
      instance_date: z.string().describe("YYYY-MM-DD of the occurrence to act on — must be one of that sitting's `instances`."),
      apply_to: APPLY_TO,
      frameId: z.string().optional(),
      confirm: schemaConfirm,
    },
    { destructiveHint: true },
    async (args: { id: string | number; instance_date: string; apply_to: 'one' | 'future' | 'all'; frameId?: string; confirm?: boolean }) => {
      const gate = previewUnlessConfirmed(
        args.confirm,
        `Delete planned meal ${args.id} at ${args.instance_date} (scope: ${args.apply_to})`,
        'DELETE',
        '/frames/{frame}/meals/sittings/{id}/instances/{instance_date}',
        { id: args.id, instance_date: args.instance_date, apply_to: args.apply_to },
      );
      if (gate) return gate;
      return deleteMeal(args);
    });

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
