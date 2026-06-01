import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, compact, frameScoped, idParam, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerChoreTools(server: McpServer, getClient: GetClient) {
  server.tool(
    'skylight_list_chores',
    'List chores for a Skylight frame within a required date range.',
    {
      after: z.string().describe('YYYY-MM-DD inclusive lower bound (required by the API).'),
      before: z.string().describe('YYYY-MM-DD inclusive upper bound (required by the API).'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { after, before }: { after: string; before: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('GET', `/frames/${f}/chores`, { query: { after, before } });
      return textContent(flattenJsonApi(doc));
    }),
  );

  // LIVE-VERIFIED: create_chore requires flat {summary, category_id} — category_id is mandatory
  // (422 "Category is required" without it). The `name` field does not exist; use `summary`.
  server.tool(
    'skylight_create_chore',
    'Create a chore on a Skylight frame.',
    {
      summary: z.string().describe('Chore title.'),
      category_id: idParam.describe('Category / family-member id the chore belongs to (required). Get ids from skylight_list_categories.'),
      start: z.string().optional().describe('YYYY-MM-DD start date.'),
      description: z.string().optional(),
      reward_points: z.number().optional().describe('Reward points/stars for completing.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { summary, category_id, start, description, reward_points }: { summary: string; category_id: string | number; start?: string; description?: string; reward_points?: number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/chores`, { body: compact({ summary, category_id, start, description, reward_points }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  // LIVE-VERIFIED: recurring chores + routines are created via create_multiple with
  // recurrence_set as an ARRAY of "RRULE:…" strings (this is what flips recurring:true).
  // Routines = the same call with routine:true (use BYHOUR in the RRULE for time-of-day).
  // up_for_grabs:true works because the client sends the skylight-api-version header.
  // The response is `{ data: [...] }` (array).
  server.tool(
    'skylight_create_recurring_chore',
    'Create a recurring chore or routine (repeats per an RRULE; verified live).',
    {
      summary: z.string().describe('Chore title.'),
      recurrence: z.string().describe('iCalendar RRULE without the "RRULE:" prefix, e.g. "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR" (daily: "FREQ=DAILY;INTERVAL=1"). Use BYHOUR for routine time-of-day.'),
      category_ids: idArrayParam.optional().describe('Family-member category ids to assign (omit only with up_for_grabs).'),
      start: z.string().describe('YYYY-MM-DD first occurrence date.'),
      start_time: z.string().optional().describe('HH:mm time of day (e.g. "17:00").'),
      recurring_until: z.string().optional().describe('ISO datetime the recurrence ends (e.g. "2026-12-31T23:59:59.999Z").'),
      reward_points: z.number().optional(),
      emoji_icon: z.string().optional(),
      description: z.string().optional(),
      routine: z.boolean().optional().describe('Set true to create a routine (habit-style recurring task) instead of a chore.'),
      up_for_grabs: z.boolean().optional().describe('Set true for an unassigned "anyone can do it" chore (requires no category_ids).'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { summary, recurrence, category_ids, start, start_time, recurring_until, reward_points, emoji_icon, description, routine, up_for_grabs }: { summary: string; recurrence: string; category_ids?: (string | number)[]; start: string; start_time?: string; recurring_until?: string; reward_points?: number; emoji_icon?: string; description?: string; routine?: boolean; up_for_grabs?: boolean; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/chores/create_multiple`, {
        body: compact({ summary, category_ids, recurrence_set: [`RRULE:${recurrence}`], start, start_time, recurring_until, reward_points, emoji_icon, description, routine, up_for_grabs }),
      });
      return textContent(flattenJsonApi(doc));
    }),
  );

  // LIVE-VERIFIED: complete_chore is PUT /frames/{f}/chores/{id}/completions with {status:'complete'}
  // (the old POST /complete was 404 and the PATCH /frames/{f}/chores/{id} was a no-op — status stayed
  // pending). Completing a specific recurring *instance* (via instance_date + category_id) is
  // intentionally not exposed; this is the simple whole-chore completion.
  server.tool(
    'skylight_complete_chore',
    'Mark a chore complete.',
    { id: z.string(), frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('PUT', `/frames/${f}/chores/${id}/completions`, { body: { status: 'complete' } });
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ completed: id });
    }),
  );

  // A whole-series edit is PUT /frames/{f}/chores/{id} with the full chore body
  // (no apply_to needed for a series edit; apply_to is for occurrence-level edits).
  // When `recurrence` is provided, send recurrence_set as the ["RRULE:…"] array.
  server.tool(
    'skylight_update_chore',
    'Update a chore.',
    {
      id: z.string(),
      summary: z.string().optional(),
      category_id: idParam.optional(),
      start: z.string().optional(),
      start_time: z.string().optional(),
      description: z.string().optional(),
      reward_points: z.number().optional(),
      emoji_icon: z.string().optional(),
      recurrence: z.string().optional().describe('iCalendar RRULE without the "RRULE:" prefix; edits the whole series.'),
      recurring_until: z.string().optional().describe('ISO datetime the recurrence ends.'),
      apply_to: z.enum(['this', 'this_and_future', 'all']).optional().describe('For recurring chores: which occurrences to update.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, summary, category_id, start, start_time, description, reward_points, emoji_icon, recurrence, recurring_until, apply_to }: { id: string; summary?: string; category_id?: string | number; start?: string; start_time?: string; description?: string; reward_points?: number; emoji_icon?: string; recurrence?: string; recurring_until?: string; apply_to?: 'this' | 'this_and_future' | 'all'; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/chores/${id}`, {
        body: compact({ summary, category_id, start, start_time, description, reward_points, emoji_icon, recurrence_set: recurrence !== undefined ? [`RRULE:${recurrence}`] : undefined, recurring_until, apply_to }),
      });
      return textContent(flattenJsonApi(doc));
    }),
  );

  // NOTE: instance completion status value inferred ('completed'); whole-chore completion uses 'complete'.
  server.tool(
    'skylight_complete_chore_instance',
    'Mark a specific occurrence of a recurring chore complete.',
    {
      id: z.string(),
      instance_date: z.string().describe('YYYY-MM-DD occurrence date (required).'),
      category_id: idParam.describe('Member completing it (required).'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, instance_date, category_id }: { id: string; instance_date: string; category_id: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('PUT', `/frames/${f}/chores/${id}/completions`, { body: compact({ status: 'completed', instance_date, category_id }) });
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ completed: id, instance_date });
    }),
  );

  // LIVE-VERIFIED: uncomplete reverses a completion — PUT the completions endpoint
  // with {status:'pending'} reopens a chore that `complete` had marked complete.
  server.tool(
    'skylight_uncomplete_chore',
    'Reopen (un-complete) a chore.',
    { id: z.string(), frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('PUT', `/frames/${f}/chores/${id}/completions`, { body: { status: 'pending' } });
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ uncompleted: id });
    }),
  );

  // LIVE-VERIFIED: series delete uses a query param — DELETE /frames/{f}/chores/{id}?apply_to=one|all.
  // "one" drops just this occurrence; "all" deletes the whole series. The API returns HTTP 200 with
  // no body, so fall back to a { deleted: id } acknowledgement.
  server.tool(
    'skylight_delete_chore',
    'Delete a chore (optionally a single occurrence or the whole series).',
    {
      id: z.string(),
      apply_to: z.enum(['one', 'all']).optional().describe('For a recurring chore: delete just this occurrence ("one") or the whole series ("all").'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, apply_to }: { id: string; apply_to?: 'one' | 'all'; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('DELETE', `/frames/${f}/chores/${id}`, apply_to ? { query: { apply_to } } : {});
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ deleted: id });
    }),
  );

  // LIVE-VERIFIED: search surfaces unscheduled/template chores that the date-range list can't return.
  // GET /frames/{f}/chores/search?search_query=…&include_up_for_grabs=…&limit=…&ended_chore_lookback_days=…
  server.tool(
    'skylight_search_chores',
    "Search chores (incl. unscheduled/template chores the date-range list can't return).",
    {
      search_query: z.string().describe('Text to search chore summaries.'),
      include_up_for_grabs: z.boolean().optional(),
      limit: z.number().optional(),
      ended_chore_lookback_days: z.number().optional().describe('How many days back to include ended chores.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { search_query, include_up_for_grabs, limit, ended_chore_lookback_days }: { search_query: string; include_up_for_grabs?: boolean; limit?: number; ended_chore_lookback_days?: number; frameId?: string }) => {
      const query: Record<string, string | number> = { search_query };
      if (include_up_for_grabs !== undefined) query.include_up_for_grabs = String(include_up_for_grabs);
      if (limit !== undefined) query.limit = limit;
      if (ended_chore_lookback_days !== undefined) query.ended_chore_lookback_days = ended_chore_lookback_days;
      const doc = await c.request<JsonApiDoc>('GET', `/frames/${f}/chores/search`, { query });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.tool(
    'skylight_list_rewards',
    'List redeemed rewards for a Skylight frame, defaulting to the last 30 days.',
    {
      redeemed_at_min: z.string().optional(),
      redeemed_at_max: z.string().optional(),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { redeemed_at_min, redeemed_at_max }: { redeemed_at_min?: string; redeemed_at_max?: string; frameId?: string }) => {
      const now = new Date();
      const min = redeemed_at_min ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const max = redeemed_at_max ?? now.toISOString();
      const doc = await c.request<JsonApiDoc>('GET', `/frames/${f}/rewards`, { query: { redeemed_at_min: min, redeemed_at_max: max } });
      return textContent(flattenJsonApi(doc));
    }),
  );
}
