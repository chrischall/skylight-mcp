import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { confirmTokenParam, confirmWrite } from './_confirm.js';
import { apiPath, textContent, flattenJsonApi, pruneUndefined, frameScoped, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerSettingsTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_update_frame',
    {
      description: 'Update Skylight frame display/sleep settings. Setting open_to_public:true makes the frame publicly reachable, so that one change asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token proceeds (see MCP_CONFIRM_MODE). Every other setting applies directly.',
      inputSchema: z.object({
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
        confirmToken: confirmTokenParam,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { frameId: _frameId, confirmToken, ...rest }, ctx) => {
      const body = pruneUndefined(rest);
      const path = apiPath`/frames/${f}`;
      // Opening the frame to the public is an access grant, not a display
      // setting (fleet-audit#246) — gate that one change, and only that one.
      if (rest.open_to_public === true) {
        const gate = await confirmWrite(ctx, {
          tool: 'skylight_update_frame',
          action: 'frame.open_to_public',
          description: `Make frame ${f} open to the public — anyone can then reach it`,
          target: f,
          method: 'PUT',
          path,
          body,
          confirmToken,
        });
        if (gate) return gate;
      }
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', path, { body })));
    }),
  );

  server.registerTool(
    'skylight_rename_frame',
    {
      description: 'Rename a Skylight frame.',
      inputSchema: z.object({ name: z.string(), frameId: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { name }: { name: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', apiPath`/frames/${f}/rename`, { body: { name } })))),
  );

  server.registerTool(
    'skylight_update_profile',
    {
      description: 'Update the frame profile (name, birthday).',
      inputSchema: z.object({
        name: z.string().optional(),
        birthday: z.string().optional().describe('YYYY-MM-DD'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { name, birthday }: { name?: string; birthday?: string; frameId?: string }) => {
      const body = pruneUndefined({ name, birthday });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', apiPath`/frames/${f}/profile`, { body })));
    }),
  );

  server.registerTool(
    'skylight_update_household_config',
    {
      description: 'Update household configuration.',
      inputSchema: z.object({
        disney_profile_pictures: z.boolean().optional(),
        disney_screensaver: z.boolean().optional(),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { disney_profile_pictures, disney_screensaver }: { disney_profile_pictures?: boolean; disney_screensaver?: boolean; frameId?: string }) => {
      const body = pruneUndefined({ disney_profile_pictures, disney_screensaver });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PATCH', apiPath`/frames/${f}/household_config`, { body })));
    }),
  );

  server.registerTool(
    'skylight_set_reminder_profile',
    {
      description: 'Set the global reminder cadence (how often Skylight nudges about reminders).',
      inputSchema: z.object({ interval_weeks: z.number().describe('How many weeks between reminder nudges.') }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ interval_weeks }) => {
      const c = await getClient();
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/reminder_profile`, { body: { interval_weeks } })));
    },
  );
}
