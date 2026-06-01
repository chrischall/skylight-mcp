import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi, compact, type JsonApiDoc } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

export function registerRewardTools(server: McpServer, getClient: GetClient) {
  server.tool(
    'skylight_get_reward',
    'Get one reward.',
    { id: z.string(), frameId: z.string().optional() },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/rewards/${id}`)));
    },
  );

  server.tool(
    'skylight_create_reward',
    'Create a reward (live-verified fields: name + point_value + category_ids).',
    {
      name: z.string().describe('Reward name.'),
      point_value: z.number().describe('Points required to redeem (required).'),
      category_ids: z.array(z.union([z.string(), z.number()])).describe('Family-member category ids this reward applies to (required).'),
      frameId: z.string().optional(),
    },
    async ({ name, point_value, category_ids, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/rewards`, { body: { name, point_value, category_ids } });
      return textContent(flattenJsonApi(doc));
    },
  );

  server.tool(
    'skylight_update_reward',
    'Update a reward.',
    {
      id: z.string(),
      name: z.string().optional(),
      point_value: z.number().optional(),
      category_ids: z.array(z.union([z.string(), z.number()])).optional(),
      frameId: z.string().optional(),
    },
    async ({ id, name, point_value, category_ids, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/rewards/${id}`, { body: compact({ name, point_value, category_ids }) });
      return textContent(flattenJsonApi(doc));
    },
  );

  server.tool(
    'skylight_delete_reward',
    'Delete a reward.',
    { id: z.string(), frameId: z.string().optional() },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      await c.request('DELETE', `/frames/${f}/rewards/${id}`);
      return textContent({ deleted: id });
    },
  );

  server.tool(
    'skylight_redeem_reward',
    'Redeem a reward.',
    {
      id: z.string(),
      category_id: z.union([z.string(), z.number()]).optional().describe('Member redeeming, if required.'),
      frameId: z.string().optional(),
    },
    async ({ id, category_id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('POST', `/frames/${f}/rewards/${id}/redeem`, { body: compact({ category_id }) });
      return doc ? textContent(flattenJsonApi(doc as any)) : textContent({ redeemed: id });
    },
  );

  server.tool(
    'skylight_unredeem_reward',
    'Reverse a reward redemption.',
    {
      id: z.string(),
      category_id: z.union([z.string(), z.number()]).optional().describe('Member redeeming, if required.'),
      frameId: z.string().optional(),
    },
    async ({ id, category_id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('POST', `/frames/${f}/rewards/${id}/unredeem`, { body: compact({ category_id }) });
      return doc ? textContent(flattenJsonApi(doc as any)) : textContent({ unredeemed: id });
    },
  );

  server.tool(
    'skylight_add_reward_points',
    'Grant (or deduct) reward points to family members.',
    {
      category_ids: z.array(z.union([z.string(), z.number()])).describe('Member category ids to grant points to.'),
      points: z.number().describe('Points to add (can be negative to deduct).'),
      frameId: z.string().optional(),
    },
    async ({ category_ids, points, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/reward_points`, { body: { category_ids, points } });
      return textContent(flattenJsonApi(doc));
    },
  );
}
