import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, frameScoped, idParam, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerCalendarTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_calendars', "List the frame's calendar accounts (Google/Apple/etc.) and their active calendars.",
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendars`)))));

  server.tool('skylight_get_calendar', 'Get one calendar account.',
    { id: z.string(), frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendars/${id}`)))));

  server.tool('skylight_list_nudges', 'List nudges (reminders) in a date range.',
    {
      after: z.string().describe('YYYY-MM-DD lower bound (required).'),
      before: z.string().describe('YYYY-MM-DD upper bound (required).'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { after, before }: { after: string; before: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/nudges`, { query: { after, before } })))));

  server.tool('skylight_add_webcal', 'Subscribe the frame to a webcal/ICS calendar URL.',
    {
      sync_url: z.string().describe('Public webcal/ICS URL to subscribe the frame to.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { sync_url }: { sync_url: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/webcal_accounts`, { body: { sync_url } })))));

  server.tool('skylight_update_calendar', 'Set which sub-calendars of a connected account are active.',
    {
      id: z.string(),
      active_calendars: idArrayParam.describe('Calendar ids to keep active.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, active_calendars }: { id: string; active_calendars: Array<string | number>; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/calendars/${id}`, { body: { active_calendars } })))));

  server.tool('skylight_delete_source_calendar', 'Remove a connected source calendar (incl. webcal subscriptions).',
    { id: z.string(), frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/source_calendars/${id}`);
      return textContent({ deleted: id });
    }));

  server.tool('skylight_set_default_calendar', 'Set the default source calendar for new events.',
    {
      id: idParam.describe('Source-calendar id to make the default for new events.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/source_calendars/set_default_for_new_events`, { body: { id } });
      return textContent(doc ? flattenJsonApi(doc) : { default: id });
    }));
}
