import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, frameScoped, idParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerFrameTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_list_frames',
    {
      description: 'List Skylight frames (family hubs) on this account.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const c = await getClient();
      return textContent(flattenJsonApi(await c.request('GET', '/frames')));
    },
  );

  server.registerTool(
    'skylight_get_frame',
    {
      description: 'Get one Skylight frame and its settings.',
      inputSchema: { frameId: z.string().optional().describe('Frame id; defaults to the resolved frame.') },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request('GET', `/frames/${f}`)))),
  );

  server.registerTool(
    'skylight_list_frame_members',
    {
      description: 'List members (frame_users) of a Skylight frame.',
      inputSchema: { frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/users`)))),
  );

  server.registerTool(
    'skylight_list_devices',
    {
      description: 'List physical devices attached to a Skylight frame.',
      inputSchema: { frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/devices`)))),
  );

  server.registerTool(
    'skylight_get_plus_access',
    {
      description: 'Get Skylight Plus subscription / entitlement status.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const c = await getClient();
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', '/plus_access')));
    },
  );

  server.registerTool(
    'skylight_get_reward_points',
    {
      description: 'Get reward-point balances per family member (lifetime earned + current balance).',
      inputSchema: { frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/reward_points`)))),
  );

  server.registerTool(
    'skylight_get_household_config',
    {
      description: 'Get household configuration for the frame.',
      inputSchema: { frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/household_config`)))),
  );

  // NOTE: device PUT body confirmed for current_album_id from the bundle; other device fields not yet exposed.
  server.registerTool(
    'skylight_set_device_album',
    {
      description: 'Set which photo album a device displays.',
      inputSchema: {
        id: idParam.describe('Device id (from skylight_list_devices).'),
        current_album_id: idParam.describe('Album id to display on this device.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, current_album_id }: { id: string | number; current_album_id: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/devices/${id}`, { body: { current_album_id } });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_rename_device',
    {
      description: 'Rename a Skylight device.',
      inputSchema: {
        id: idParam.describe('Device id (from skylight_list_devices).'),
        name: z.string().describe('New device name.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, name }: { id: string | number; name: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/devices/${id}`, { body: { name } });
      return textContent(flattenJsonApi(doc));
    }),
  );
}
