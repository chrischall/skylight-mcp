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

  // TODO(Task 13): reconcile body/field names + complete verb against live API
  server.tool(
    'skylight_create_chore',
    'Create a chore on a Skylight frame.',
    {
      name: z.string().describe('Chore name/title.'),
      frameId: z.string().optional(),
    },
    async ({ name, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('POST', `/frames/${f}/chores`, { body: { chore: compact({ name }) } });
      return textContent(flattenJsonApi(doc as any));
    },
  );

  // TODO(Task 13): reconcile body/field names + complete verb against live API
  server.tool(
    'skylight_complete_chore',
    'Mark a chore as complete on a Skylight frame.',
    {
      id: z.string(),
      frameId: z.string().optional(),
    },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('POST', `/frames/${f}/chores/${id}/complete`);
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
