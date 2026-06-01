import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi, compact, type JsonApiDoc } from './_shared.js';

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

  server.tool('skylight_update_frame', 'Update Skylight frame display/sleep settings.',
    {
      brightness: z.number().optional(),
      slideshow_speed: z.number().optional(),
      slideshow_style: z.string().optional(),
      sleeps_at: z.string().optional().describe('Time the frame sleeps, e.g. "22:00".'),
      wakes_at: z.string().optional(),
      show_caption: z.boolean().optional(),
      show_heart: z.boolean().optional(),
      blur_effect: z.boolean().optional(),
      side_by_side: z.boolean().optional(),
      open_to_public: z.boolean().optional(),
      frameId: z.string().optional(),
    },
    async ({ frameId, brightness, slideshow_speed, slideshow_style, sleeps_at, wakes_at, show_caption, show_heart, blur_effect, side_by_side, open_to_public }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const body = compact({ brightness, slideshow_speed, slideshow_style, sleeps_at, wakes_at, show_caption, show_heart, blur_effect, side_by_side, open_to_public });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}`, { body })));
    });

  server.tool('skylight_rename_frame', 'Rename a Skylight frame.',
    { name: z.string(), frameId: z.string().optional() },
    async ({ name, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/rename`, { body: { name } })));
    });

  server.tool('skylight_update_profile', 'Update the frame profile (name, birthday).',
    {
      name: z.string().optional(),
      birthday: z.string().optional().describe('YYYY-MM-DD'),
      frameId: z.string().optional(),
    },
    async ({ name, birthday, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const body = compact({ name, birthday });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/profile`, { body })));
    });

  server.tool('skylight_update_household_config', 'Update household configuration.',
    {
      disney_profile_pictures: z.boolean().optional(),
      disney_screensaver: z.boolean().optional(),
      frameId: z.string().optional(),
    },
    async ({ disney_profile_pictures, disney_screensaver, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const body = compact({ disney_profile_pictures, disney_screensaver });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PATCH', `/frames/${f}/household_config`, { body })));
    });

  server.tool('skylight_add_webcal', 'Subscribe the frame to a webcal/ICS calendar URL.',
    {
      sync_url: z.string().describe('Public webcal/ICS URL to subscribe the frame to.'),
      frameId: z.string().optional(),
    },
    async ({ sync_url, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/webcal_accounts`, { body: { sync_url } })));
    });

  server.tool('skylight_update_calendar', 'Set which sub-calendars of a connected account are active.',
    {
      id: z.string(),
      active_calendars: z.array(z.union([z.string(), z.number()])).describe('Calendar ids to keep active.'),
      frameId: z.string().optional(),
    },
    async ({ id, active_calendars, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/calendars/${id}`, { body: { active_calendars } })));
    });

  server.tool('skylight_delete_source_calendar', 'Remove a connected source calendar (incl. webcal subscriptions).',
    { id: z.string(), frameId: z.string().optional() },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      await c.request('DELETE', `/frames/${f}/source_calendars/${id}`);
      return textContent({ deleted: id });
    });

  server.tool('skylight_set_default_calendar', 'Set the default source calendar for new events.',
    {
      id: z.union([z.string(), z.number()]).describe('Source-calendar id to make the default for new events.'),
      frameId: z.string().optional(),
    },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/source_calendars/set_default_for_new_events`, { body: { id } });
      return textContent(doc ? flattenJsonApi(doc) : { default: id });
    });

  server.tool('skylight_invite_user', 'Invite a user to the frame by email.',
    {
      email: z.string().describe('Email to invite to the frame.'),
      frameId: z.string().optional(),
    },
    async ({ email, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/users`, { body: { email } })));
    });

  server.tool('skylight_approve_user', 'Approve a pending frame user.',
    { id: z.string(), frameId: z.string().optional() },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/users/${id}/approve`);
      return textContent(doc ? flattenJsonApi(doc) : { approved: id });
    });

  server.tool('skylight_remove_user', 'Remove a user from the frame.',
    { id: z.union([z.string(), z.number()]), frameId: z.string().optional() },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      await c.request('DELETE', `/frames/${f}/users/${id}`);
      return textContent({ removed: id });
    });

  server.tool('skylight_delete_category', 'Delete a category / family member.',
    { id: z.union([z.string(), z.number()]), frameId: z.string().optional() },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      await c.request('DELETE', `/frames/${f}/categories/${id}`);
      return textContent({ deleted: id });
    });
}
