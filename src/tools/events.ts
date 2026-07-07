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
  server.tool('skylight_list_events', 'List calendar events in a date range for a Skylight frame.', {
    date_min: z.string().describe('YYYY-MM-DD inclusive lower bound.'),
    date_max: z.string().describe('YYYY-MM-DD inclusive upper bound.'),
    timezone: z.string().optional().describe('IANA tz; defaults to the frame timezone.'),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { date_min, date_max, timezone }: { date_min: string; date_max: string; timezone?: string; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc>('GET', `/frames/${f}/calendar_events`, {
      query: { date_min, date_max, timezone, include: INCLUDE },
    });
    return textContent(flattenJsonApi(doc));
  }));

  server.tool('skylight_get_event', 'Get one calendar event by id.', {
    id: z.string(), frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) =>
    textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendar_events/${id}`)))));

  server.tool('skylight_create_event', 'Create a calendar event on a Skylight frame.',
    { ...eventAttrs, frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { frameId: _frameId, ...attrs }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/calendar_events`, { body: pruneUndefined(attrs) });
      return textContent(flattenJsonApi(doc));
    }));

  server.tool('skylight_update_event', 'Update a calendar event by id.',
    { id: z.string(), ...Object.fromEntries(Object.entries(eventAttrs).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])), frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id, frameId: _frameId, ...attrs }: { id: string; frameId?: string } & Record<string, unknown>) => {
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/calendar_events/${id}`, { body: pruneUndefined(attrs) });
      return textContent(flattenJsonApi(doc));
    }));

  server.tool('skylight_delete_event', 'Delete a calendar event by id.',
    { id: z.string(), frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/calendar_events/${id}`);
      return textContent({ deleted: id });
    }));

  server.tool('skylight_list_categories', 'List calendar/chore categories for a Skylight frame.',
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/categories`)))));

  server.tool('skylight_list_source_calendars', 'List linked source calendars (Google, etc.) for a frame.',
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/source_calendars`)))));

  server.tool('skylight_list_recent_invited_emails', 'List recently-invited email addresses (handy for filling create_event invited_emails).',
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/calendar_events/recent_invited_emails`)))));

  server.tool('skylight_get_event_notification_settings', "Get the frame's calendar-event notification settings.",
    { frameId: z.string().optional() },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/event_notification_settings`)))));

  server.tool('skylight_update_event_notification_settings', 'Update calendar-event notification settings.',
    {
      on_time: z.boolean().optional(),
      early: z.boolean().optional(),
      early_minutes_before: z.number().optional(),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { on_time, early, early_minutes_before }: { on_time?: boolean; early?: boolean; early_minutes_before?: number; frameId?: string }) => {
      const body = pruneUndefined({ on_time, early, early_minutes_before });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/event_notification_settings`, { body })));
    }));
}
