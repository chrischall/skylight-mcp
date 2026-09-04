import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerSettingsTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_update_frame',
    {
      description: 'Update Skylight frame display/sleep settings.',
      inputSchema: {
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
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { frameId: _frameId, ...rest }) => {
      const body = pruneUndefined(rest);
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}`, { body })));
    }),
  );

  server.registerTool(
    'skylight_rename_frame',
    {
      description: 'Rename a Skylight frame.',
      inputSchema: { name: z.string(), frameId: z.string().optional() },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { name }: { name: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/rename`, { body: { name } })))),
  );

  server.registerTool(
    'skylight_update_profile',
    {
      description: 'Update the frame profile (name, birthday).',
      inputSchema: {
        name: z.string().optional(),
        birthday: z.string().optional().describe('YYYY-MM-DD'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { name, birthday }: { name?: string; birthday?: string; frameId?: string }) => {
      const body = pruneUndefined({ name, birthday });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/profile`, { body })));
    }),
  );

  server.registerTool(
    'skylight_update_household_config',
    {
      description: 'Update household configuration.',
      inputSchema: {
        disney_profile_pictures: z.boolean().optional(),
        disney_screensaver: z.boolean().optional(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { disney_profile_pictures, disney_screensaver }: { disney_profile_pictures?: boolean; disney_screensaver?: boolean; frameId?: string }) => {
      const body = pruneUndefined({ disney_profile_pictures, disney_screensaver });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PATCH', `/frames/${f}/household_config`, { body })));
    }),
  );

  server.registerTool(
    'skylight_set_reminder_profile',
    {
      description: 'Set the global reminder cadence (how often Skylight nudges about reminders).',
      inputSchema: { interval_weeks: z.number().describe('How many weeks between reminder nudges.') },
      annotations: { readOnlyHint: false },
    },
    async ({ interval_weeks }) => {
      const c = await getClient();
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/reminder_profile`, { body: { interval_weeks } })));
    },
  );
}
