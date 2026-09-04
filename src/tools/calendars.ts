import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, frameScoped, idParam, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerCalendarTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_list_calendars',
    {
      description: "List the frame's calendar accounts (Google/Apple/etc.) and their active calendars.",
      inputSchema: { frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendars`)))),
  );

  server.registerTool(
    'skylight_get_calendar',
    {
      description: 'Get one calendar account.',
      inputSchema: { id: z.string(), frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendars/${id}`)))),
  );

  server.registerTool(
    'skylight_list_nudges',
    {
      description: 'List nudges (reminders) in a date range.',
      inputSchema: {
        after: z.string().describe('YYYY-MM-DD lower bound (required).'),
        before: z.string().describe('YYYY-MM-DD upper bound (required).'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f, { after, before }: { after: string; before: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/nudges`, { query: { after, before } })))),
  );

  server.registerTool(
    'skylight_add_webcal',
    {
      description: 'Subscribe the frame to a webcal/ICS calendar URL.',
      inputSchema: {
        sync_url: z.string().describe('Public webcal/ICS URL to subscribe the frame to.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { sync_url }: { sync_url: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/webcal_accounts`, { body: { sync_url } })))),
  );

  server.registerTool(
    'skylight_update_calendar',
    {
      description: 'Set which sub-calendars of a connected account are active.',
      inputSchema: {
        id: z.string(),
        active_calendars: idArrayParam.describe('Calendar ids to keep active.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, active_calendars }: { id: string; active_calendars: Array<string | number>; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/calendars/${id}`, { body: { active_calendars } })))),
  );

  server.registerTool(
    'skylight_delete_source_calendar',
    {
      description: 'Remove a connected source calendar (incl. webcal subscriptions).',
      inputSchema: { id: z.string(), frameId: z.string().optional() },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/source_calendars/${id}`);
      return textContent({ deleted: id });
    }),
  );

  server.registerTool(
    'skylight_set_default_calendar',
    {
      description: 'Set the default source calendar for new events.',
      inputSchema: {
        id: idParam.describe('Source-calendar id to make the default for new events.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/source_calendars/set_default_for_new_events`, { body: { id } });
      return textContent(doc ? flattenJsonApi(doc) : { default: id });
    }),
  );

  server.registerTool(
    'skylight_link_apple_calendar',
    {
      description: 'Link an Apple/iCloud calendar to the frame using an app-specific password.',
      inputSchema: {
        email: z.string().describe('Apple ID email.'),
        app_specific_password: z.string().describe('An app-specific password generated at appleid.apple.com (NOT your normal Apple password).'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { email, app_specific_password }: { email: string; app_specific_password: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/calendars/apple`, { body: { email, app_specific_password } });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_categorize_source_calendar',
    {
      description: "Attribute a source calendar's events to one or more family members.",
      inputSchema: {
        id: idParam.describe('Source-calendar id (from skylight_list_source_calendars / skylight_list_calendars).'),
        category_ids: idArrayParam.describe("Family-member category ids whose members this calendar's events are attributed to."),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, category_ids }: { id: string | number; category_ids: Array<string | number>; frameId?: string }) => {
      const categorizations = category_ids.map((cid) => ({ category_id: cid }));
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/source_calendars/${id}/source_calendar_categorizations`, { body: { categorizations } });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_create_source_calendar',
    {
      description: 'Create a source calendar from raw provider attributes (advanced).',
      inputSchema: {
        attributes: z.record(z.string(), z.unknown()).describe('Provider-specific source-calendar attributes.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { attributes }: { attributes: Record<string, unknown>; frameId?: string }) => {
      // NOTE: generic passthrough; attribute shape is provider-specific.
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/source_calendars`, { body: { attributes } });
      return textContent(flattenJsonApi(doc));
    }),
  );
}
