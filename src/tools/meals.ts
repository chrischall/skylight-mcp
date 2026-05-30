import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

export function registerMealTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_recipes', 'List meal recipes for the frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/meals/recipes`) as any));
  });

  server.tool('skylight_list_meal_categories', 'List meal categories for the frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/meals/categories`) as any));
  });
}
