import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi, type JsonApiDoc } from './_shared.js';

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

  server.tool('skylight_get_plus_access', 'Get Skylight Plus subscription / entitlement status.', {},
    async () => {
      const c = await getClient();
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', '/plus_access')));
    });

  server.tool('skylight_get_reward_points', 'Get reward-point balances per family member (lifetime earned + current balance).',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/reward_points`)));
    });

  server.tool('skylight_get_household_config', 'Get household configuration for the frame.',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/household_config`)));
    });

  server.tool('skylight_list_calendars', "List the frame's calendar accounts (Google/Apple/etc.) and their active calendars.",
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendars`)));
    });

  server.tool('skylight_get_event_notification_settings', "Get the frame's calendar-event notification settings.",
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/event_notification_settings`)));
    });

  server.tool('skylight_resolve_member', 'Resolve a family-member name to its category id (used by chores/rewards).',
    {
      name: z.string().describe('Family-member name (or partial) to resolve to a category id.'),
      frameId: z.string().optional(),
    },
    async ({ name, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const cats = flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/categories`)) as Array<{ id: string; label?: string }>;
      const q = name.toLowerCase();
      const matches = cats.filter((cat) => String(cat.label ?? '').toLowerCase().includes(q));
      const chosen = (matches.length > 0 ? matches : cats).map((cat) => ({ id: cat.id, label: cat.label }));
      return textContent(chosen);
    });

  server.tool('skylight_get_calendar', 'Get one calendar account.',
    { id: z.string(), frameId: z.string().optional() },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendars/${id}`)));
    });

  server.tool('skylight_list_nudges', 'List nudges (reminders) in a date range.',
    {
      after: z.string().describe('YYYY-MM-DD lower bound (required).'),
      before: z.string().describe('YYYY-MM-DD upper bound (required).'),
      frameId: z.string().optional(),
    },
    async ({ after, before, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/nudges`, { query: { after, before } })));
    });
}
