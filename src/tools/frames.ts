import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

export function registerFrameTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_frames', 'List Skylight frames (family hubs) on this account.', {}, async () => {
    const c = await getClient();
    return textContent(flattenJsonApi(await c.request('GET', '/frames')));
  });

  server.tool('skylight_get_frame', 'Get one Skylight frame and its settings.',
    { frameId: z.string().optional().describe('Frame id; defaults to the resolved frame.') },
    async ({ frameId }) => {
      const c = await getClient();
      const id = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${id}`)));
    });

  server.tool('skylight_list_frame_members', 'List members (frame_users) of a Skylight frame.',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const id = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${id}/users`)));
    });

  server.tool('skylight_list_devices', 'List physical devices attached to a Skylight frame.',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const id = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${id}/devices`)));
    });
}
