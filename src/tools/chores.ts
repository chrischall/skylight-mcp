import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, compact, frameScoped, idParam, type GetClient, type JsonApiDoc } from './_shared.js';

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

  server.tool(
    'skylight_update_chore',
    'Update a chore.',
    {
      id: z.string(),
      summary: z.string().optional(),
      category_id: idParam.optional(),
      start: z.string().optional(),
      description: z.string().optional(),
      reward_points: z.number().optional(),
      apply_to: z.enum(['this', 'this_and_future', 'all']).optional().describe('For recurring chores: which occurrences to update.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, summary, category_id, start, description, reward_points, apply_to }: { id: string; summary?: string; category_id?: string | number; start?: string; description?: string; reward_points?: number; apply_to?: 'this' | 'this_and_future' | 'all'; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/chores/${id}`, { body: compact({ summary, category_id, start, description, reward_points, apply_to }) });
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
