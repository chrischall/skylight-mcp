import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi, type JsonApiDoc } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

export function registerMessageTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_messages', 'List messages posted to the Skylight frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/messages`)));
  });

  server.tool('skylight_list_albums', 'List photo albums on the Skylight frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/albums`)));
  });
}
