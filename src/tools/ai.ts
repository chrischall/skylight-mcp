import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, idParam, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerAiTools(server: McpServer, getClient: GetClient) {
  server.tool(
    'skylight_generate_meal_plan',
    'Generate an AI meal plan for the given dates (creates draft meal sittings — async; poll with skylight_get_auto_creation_intent, then approve).',
    {
      meal_category_id: idParam.describe('Meal category id (from skylight_list_meal_categories).'),
      dates: z.array(z.string()).describe('YYYY-MM-DD dates to generate meals for.'),
      mouths_to_feed: z.number().optional().describe('How many people to feed.'),
      add_to_grocery_list: z.boolean().optional(),
      recipe_source: z.string().optional().describe("Defaults to 'generate' (AI-generated)."),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { meal_category_id, dates, mouths_to_feed, add_to_grocery_list, recipe_source }: { meal_category_id: string | number; dates: string[]; mouths_to_feed?: number; add_to_grocery_list?: boolean; recipe_source?: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/auto_creation_intents`, {
        body: {
          engine: 'meal_sittings_generator',
          text: '',
          meal_category_id,
          created_via: 'app_form',
          engine_inputs: pruneUndefined({
            meal_sitting_dates: dates,
            meal_recipe_source: recipe_source ?? 'generate',
            meal_mouths_to_feed: mouths_to_feed,
            add_to_grocery_list,
          }),
        },
      });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.tool(
    'skylight_generate_activity_ideas',
    'Generate AI activity/event ideas for a location and time range (creates draft events — async).',
    {
      category_ids: idArrayParam.describe('Family-member category ids the activities are for.'),
      physical_location: z.string().describe('Location, e.g. "Charlotte, NC, USA".'),
      activity_kind: z.string().optional().describe('e.g. "local_event".'),
      budget: z.string().optional().describe('e.g. "$50".'),
      datetime_range_start: z.string().describe('ISO datetime.'),
      datetime_range_end: z.string().describe('ISO datetime.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { category_ids, physical_location, activity_kind, budget, datetime_range_start, datetime_range_end }: { category_ids: Array<string | number>; physical_location: string; activity_kind?: string; budget?: string; datetime_range_start: string; datetime_range_end: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/auto_creation_intents`, {
        body: {
          engine: 'activity_ideas_generator',
          text: '',
          category_ids,
          created_via: 'app_form',
          draft_first: true,
          engine_inputs: pruneUndefined({ physical_location, activity_kind, budget, datetime_range_start, datetime_range_end }),
        },
      });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.tool(
    'skylight_get_auto_creation_intent',
    'Get an AI auto-creation intent (its status + draft results).',
    { id: idParam, frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/auto_creation_intents/${id}`)))),
  );

  server.tool(
    'skylight_list_auto_creation_intents',
    'List all AI auto-creation intents on the frame (find pending/completed drafting jobs and their ids).',
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/auto_creation_intents`)))),
  );

  server.tool(
    'skylight_list_auto_creation_drafts',
    'List the events an AI intent drafted (for review before approving). For meal/activity engines the drafts are items, not events — use skylight_list_auto_creation_items instead.',
    { id: idParam, frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/auto_creation_intents/${id}/created_events`)))),
  );

  server.tool(
    'skylight_list_auto_creation_items',
    'List the draft items an AI intent created (the general draft reader — meal sittings, activities, list items, etc., which the event-only draft list does not surface).',
    { id: idParam, frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/auto_creation_intents/${id}/created_items`)))),
  );

  server.tool(
    'skylight_approve_auto_creation',
    'Approve AI-drafted events — turns them into real calendar events.',
    {
      id: idParam.describe('Auto-creation intent id.'),
      ids: idArrayParam.describe('Draft event ids to approve into real events.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, ids }: { id: string | number; ids: Array<string | number>; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/auto_creation_intents/${id}/created_events/bulk_approve`, { body: { ids } });
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ approved: ids.length });
    }),
  );

  server.tool(
    'skylight_undo_auto_creation',
    'Undo/discard an AI auto-creation intent and its drafts.',
    { id: idParam, frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/auto_creation_intents/${id}/undo`);
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ undone: id });
    }),
  );
}
