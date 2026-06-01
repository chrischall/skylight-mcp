import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, compact, frameScoped, idParam, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerRewardTools(server: McpServer, getClient: GetClient) {
  server.tool(
    'skylight_get_reward',
    'Get one reward.',
    { id: z.string(), frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/rewards/${id}`)))),
  );

  server.tool(
    'skylight_create_reward',
    'Create a reward (live-verified fields: name + description + point_value + respawn_on_redemption + category_ids).',
    {
      name: z.string().describe('Reward name.'),
      description: z.string().optional(),
      point_value: z.number().describe('Points required to redeem (required).'),
      respawn_on_redemption: z.boolean().optional().describe('If true, the reward can be redeemed repeatedly (respawns after redemption).'),
      category_ids: idArrayParam.describe('Family-member category ids this reward applies to (required).'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { name, description, point_value, respawn_on_redemption, category_ids }: { name: string; description?: string; point_value: number; respawn_on_redemption?: boolean; category_ids: Array<string | number>; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/rewards`, { body: compact({ name, description, point_value, respawn_on_redemption, category_ids }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.tool(
    'skylight_update_reward',
    'Update a reward.',
    {
      id: z.string(),
      name: z.string().optional(),
      point_value: z.number().optional(),
      category_ids: idArrayParam.optional(),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, name, point_value, category_ids }: { id: string; name?: string; point_value?: number; category_ids?: Array<string | number>; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/rewards/${id}`, { body: compact({ name, point_value, category_ids }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.tool(
    'skylight_delete_reward',
    'Delete a reward.',
    { id: z.string(), frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/rewards/${id}`);
      return textContent({ deleted: id });
    }),
  );

  server.tool(
    'skylight_redeem_reward',
    'Redeem a reward.',
    {
      id: z.string(),
      category_id: idParam.optional().describe('Member redeeming, if required.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, category_id }: { id: string; category_id?: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/rewards/${id}/redeem`, { body: compact({ category_id }) });
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ redeemed: id });
    }),
  );

  server.tool(
    'skylight_unredeem_reward',
    'Reverse a reward redemption.',
    {
      id: z.string(),
      category_id: idParam.optional().describe('Member who redeemed, if required to identify the redemption to reverse.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, category_id }: { id: string; category_id?: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/rewards/${id}/unredeem`, { body: compact({ category_id }) });
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ unredeemed: id });
    }),
  );

  server.tool(
    'skylight_add_reward_points',
    'Grant (or deduct) reward points to family members.',
    {
      category_ids: idArrayParam.describe('Member category ids to grant points to.'),
      points: z.number().describe('Points to add (can be negative to deduct).'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { category_ids, points }: { category_ids: Array<string | number>; points: number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/reward_points`, { body: { category_ids, points } });
      return textContent(flattenJsonApi(doc));
    }),
  );
}
