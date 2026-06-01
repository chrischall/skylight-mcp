import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, frameScoped, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerFrameTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_frames', 'List Skylight frames (family hubs) on this account.', {}, async () => {
    const c = await getClient();
    return textContent(flattenJsonApi(await c.request('GET', '/frames')));
  });

  server.tool('skylight_get_frame', 'Get one Skylight frame and its settings.',
    { frameId: z.string().optional().describe('Frame id; defaults to the resolved frame.') },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request('GET', `/frames/${f}`)))));

  server.tool('skylight_list_frame_members', 'List members (frame_users) of a Skylight frame.',
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/users`)))));

  server.tool('skylight_list_devices', 'List physical devices attached to a Skylight frame.',
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/devices`)))));

  server.tool('skylight_get_plus_access', 'Get Skylight Plus subscription / entitlement status.', {},
    async () => {
      const c = await getClient();
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', '/plus_access')));
    });

  server.tool('skylight_get_reward_points', 'Get reward-point balances per family member (lifetime earned + current balance).',
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/reward_points`)))));

  server.tool('skylight_get_household_config', 'Get household configuration for the frame.',
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/household_config`)))));
}
