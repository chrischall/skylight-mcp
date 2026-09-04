import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';

const INCLUDE = 'categories,calendar_account,event_notification_setting';

const eventAttrs = {
  summary: z.string().describe('Event title.'),
  starts_at: z.string().optional().describe('ISO 8601 start.'),
  ends_at: z.string().optional().describe('ISO 8601 end.'),
  all_day: z.boolean().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  timezone: z.string().optional(),
  invited_emails: z.array(z.string()).optional(),
  rrule: z.string().optional().describe('iCalendar RRULE for recurrence.'),
  category_ids: idArrayParam.optional().describe('Family-member category ids to assign the event to (see skylight_list_categories / skylight_resolve_member).'),
};

export function registerEventTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_list_events',
    {
      description: 'List calendar events in a date range for a Skylight frame.',
      inputSchema: {
        date_min: z.string().describe('YYYY-MM-DD inclusive lower bound.'),
        date_max: z.string().describe('YYYY-MM-DD inclusive upper bound.'),
        timezone: z.string().optional().describe('IANA tz; defaults to the frame timezone.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f, { date_min, date_max, timezone }: { date_min: string; date_max: string; timezone?: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('GET', `/frames/${f}/calendar_events`, {
        query: { date_min, date_max, timezone, include: INCLUDE },
      });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_get_event',
    {
      description: 'Get one calendar event by id.',
      inputSchema: {
        id: z.string(), frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendar_events/${id}`)))),
  );

  server.registerTool(
    'skylight_create_event',
    {
      description: 'Create a calendar event on a Skylight frame.',
      inputSchema: { ...eventAttrs, frameId: z.string().optional() },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { frameId: _frameId, ...attrs }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/calendar_events`, { body: pruneUndefined(attrs) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_update_event',
    {
      description: 'Update a calendar event by id.',
      inputSchema: { id: z.string(), ...Object.fromEntries(Object.entries(eventAttrs).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])), frameId: z.string().optional() },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, frameId: _frameId, ...attrs }: { id: string; frameId?: string } & Record<string, unknown>) => {
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/calendar_events/${id}`, { body: pruneUndefined(attrs) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_delete_event',
    {
      description: 'Delete a calendar event by id.',
      inputSchema: { id: z.string(), frameId: z.string().optional() },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/calendar_events/${id}`);
      return textContent({ deleted: id });
    }),
  );

  server.registerTool(
    'skylight_list_categories',
    {
      description: 'List calendar/chore categories for a Skylight frame.',
      inputSchema: { frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/categories`)))),
  );

  server.registerTool(
    'skylight_list_source_calendars',
    {
      description: 'List linked source calendars (Google, etc.) for a frame.',
      inputSchema: { frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/source_calendars`)))),
  );

  server.registerTool(
    'skylight_list_recent_invited_emails',
    {
      description: 'List recently-invited email addresses (handy for filling create_event invited_emails).',
      inputSchema: { frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendar_events/recent_invited_emails`)))),
  );

  server.registerTool(
    'skylight_get_event_notification_settings',
    {
      description: "Get the frame's calendar-event notification settings.",
      inputSchema: { frameId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/event_notification_settings`)))),
  );

  server.registerTool(
    'skylight_update_event_notification_settings',
    {
      description: 'Update calendar-event notification settings.',
      inputSchema: {
        on_time: z.boolean().optional(),
        early: z.boolean().optional(),
        early_minutes_before: z.number().optional(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { on_time, early, early_minutes_before }: { on_time?: boolean; early?: boolean; early_minutes_before?: number; frameId?: string }) => {
      const body = pruneUndefined({ on_time, early, early_minutes_before });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/event_notification_settings`, { body })));
    }),
  );
}
