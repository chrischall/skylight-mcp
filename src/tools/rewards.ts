import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, idParam, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerRewardTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_get_reward',
    {
      description: 'Get one reward.',
      inputSchema: { id: z.string(), frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/rewards/${id}`)))),
  );

  server.registerTool(
    'skylight_create_reward',
    {
      description: 'Create a reward (live-verified fields: name + description + point_value + respawn_on_redemption + category_ids).',
      inputSchema: {
        name: z.string().describe('Reward name.'),
        description: z.string().optional(),
        point_value: z.number().describe('Points required to redeem (required).'),
        respawn_on_redemption: z.boolean().optional().describe('If true, the reward can be redeemed repeatedly (respawns after redemption).'),
        category_ids: idArrayParam.describe('Family-member category ids this reward applies to (required).'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { name, description, point_value, respawn_on_redemption, category_ids }: { name: string; description?: string; point_value: number; respawn_on_redemption?: boolean; category_ids: Array<string | number>; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/rewards`, { body: pruneUndefined({ name, description, point_value, respawn_on_redemption, category_ids }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_update_reward',
    {
      description: 'Update a reward.',
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        point_value: z.number().optional(),
        category_ids: idArrayParam.optional(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, name, point_value, category_ids }: { id: string; name?: string; point_value?: number; category_ids?: Array<string | number>; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/rewards/${id}`, { body: pruneUndefined({ name, point_value, category_ids }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_delete_reward',
    {
      description: 'Delete a reward.',
      inputSchema: { id: z.string(), frameId: z.string().optional() },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/rewards/${id}`);
      return textContent({ deleted: id });
    }),
  );

  server.registerTool(
    'skylight_redeem_reward',
    {
      description: 'Redeem a reward.',
      inputSchema: {
        id: z.string(),
        category_id: idParam.optional().describe('Member redeeming, if required.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, category_id }: { id: string; category_id?: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/rewards/${id}/redeem`, { body: pruneUndefined({ category_id }) });
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ redeemed: id });
    }),
  );

  server.registerTool(
    'skylight_unredeem_reward',
    {
      description: 'Reverse a reward redemption.',
      inputSchema: {
        id: z.string(),
        category_id: idParam.optional().describe('Member who redeemed, if required to identify the redemption to reverse.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, category_id }: { id: string; category_id?: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/rewards/${id}/unredeem`, { body: pruneUndefined({ category_id }) });
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ unredeemed: id });
    }),
  );

  server.registerTool(
    'skylight_add_reward_points',
    {
      description: 'Grant (or deduct) reward points to family members.',
      inputSchema: {
        category_ids: idArrayParam.describe('Member category ids to grant points to.'),
        points: z.number().describe('Points to add (can be negative to deduct).'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { category_ids, points }: { category_ids: Array<string | number>; points: number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/reward_points`, { body: { category_ids, points } });
      return textContent(flattenJsonApi(doc));
    }),
  );
}
