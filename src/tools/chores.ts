import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function registerChoreTools(server: McpServer, getClient: GetClient) {
  server.tool(
    'skylight_list_chores',
    'List chores for a Skylight frame within a required date range.',
    {
      after: z.string().describe('YYYY-MM-DD inclusive lower bound (required by the API).'),
      before: z.string().describe('YYYY-MM-DD inclusive upper bound (required by the API).'),
      frameId: z.string().optional(),
    },
    async ({ after, before, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('GET', `/frames/${f}/chores`, { query: { after, before } });
      return textContent(flattenJsonApi(doc as any));
    },
  );

  // LIVE-VERIFIED: create_chore requires flat {summary, category_id} — category_id is mandatory
  // (422 "Category is required" without it). The `name` field does not exist; use `summary`.
  server.tool(
    'skylight_create_chore',
    'Create a chore on a Skylight frame.',
    {
      summary: z.string().describe('Chore title.'),
      category_id: z.union([z.string(), z.number()]).describe('Category / family-member id the chore belongs to (required). Get ids from skylight_list_categories.'),
      start: z.string().optional().describe('YYYY-MM-DD start date.'),
      description: z.string().optional(),
      reward_points: z.number().optional().describe('Reward points/stars for completing.'),
      frameId: z.string().optional(),
    },
    async ({ summary, category_id, start, description, reward_points, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('POST', `/frames/${f}/chores`, { body: compact({ summary, category_id, start, description, reward_points }) });
      return textContent(flattenJsonApi(doc as any));
    },
  );

  // LIVE-VERIFIED: complete_chore verb/path is PATCH /frames/{f}/chores/{id} (not POST /complete — 404).
  // Completion body {completed_on, completed_category_id} is the best-supported shape;
  // the effect wasn't list-confirmable due to chore-chart visibility semantics.
  server.tool(
    'skylight_complete_chore',
    'Mark a chore as complete on a Skylight frame.',
    {
      id: z.string(),
      completed_on: z.string().optional().describe('YYYY-MM-DD the chore was completed; defaults to today.'),
      completed_category_id: z.union([z.string(), z.number()]).optional().describe('Category / family-member who completed it.'),
      frameId: z.string().optional(),
    },
    async ({ id, completed_on, completed_category_id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const on = completed_on ?? new Date().toISOString().slice(0, 10);
      const doc = await c.request('PATCH', `/frames/${f}/chores/${id}`, { body: compact({ completed_on: on, completed_category_id }) });
      return doc ? textContent(flattenJsonApi(doc as any)) : textContent({ completed: id });
    },
  );

  server.tool(
    'skylight_list_rewards',
    'List redeemed rewards for a Skylight frame, defaulting to the last 30 days.',
    {
      redeemed_at_min: z.string().optional(),
      redeemed_at_max: z.string().optional(),
      frameId: z.string().optional(),
    },
    async ({ redeemed_at_min, redeemed_at_max, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const now = new Date();
      const min = redeemed_at_min ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const max = redeemed_at_max ?? now.toISOString();
      const doc = await c.request('GET', `/frames/${f}/rewards`, { query: { redeemed_at_min: min, redeemed_at_max: max } });
      return textContent(flattenJsonApi(doc as any));
    },
  );
}
