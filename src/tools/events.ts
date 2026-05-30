import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;
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
};

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function registerEventTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_events', 'List calendar events in a date range for a Skylight frame.', {
    date_min: z.string().describe('YYYY-MM-DD inclusive lower bound.'),
    date_max: z.string().describe('YYYY-MM-DD inclusive upper bound.'),
    timezone: z.string().optional().describe('IANA tz; defaults to the frame timezone.'),
    frameId: z.string().optional(),
  }, async ({ date_min, date_max, timezone, frameId }) => {
    const c = await getClient();
    const id = frameId ?? (await c.resolveFrameId());
    const doc = await c.request('GET', `/frames/${id}/calendar_events`, {
      query: { date_min, date_max, timezone, include: INCLUDE },
    });
    return textContent(flattenJsonApi(doc as any));
  });

  server.tool('skylight_get_event', 'Get one calendar event by id.', {
    id: z.string(), frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/calendar_events/${id}`) as any));
  });

  server.tool('skylight_create_event', 'Create a calendar event on a Skylight frame.',
    { ...eventAttrs, frameId: z.string().optional() },
    async ({ frameId, ...attrs }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('POST', `/frames/${f}/calendar_events`, { body: compact(attrs) });
      return textContent(flattenJsonApi(doc as any));
    });

  server.tool('skylight_update_event', 'Update a calendar event by id.',
    { id: z.string(), ...Object.fromEntries(Object.entries(eventAttrs).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])), frameId: z.string().optional() },
    async ({ id, frameId, ...attrs }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      const doc = await c.request('PATCH', `/frames/${f}/calendar_events/${id}`, { body: compact(attrs) });
      return textContent(flattenJsonApi(doc as any));
    });

  server.tool('skylight_delete_event', 'Delete a calendar event by id.',
    { id: z.string(), frameId: z.string().optional() },
    async ({ id, frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      await c.request('DELETE', `/frames/${f}/calendar_events/${id}`);
      return textContent({ deleted: id });
    });

  server.tool('skylight_list_categories', 'List calendar/chore categories for a Skylight frame.',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/categories`) as any));
    });

  server.tool('skylight_list_source_calendars', 'List linked source calendars (Google, etc.) for a frame.',
    { frameId: z.string().optional() },
    async ({ frameId }) => {
      const c = await getClient();
      const f = frameId ?? (await c.resolveFrameId());
      return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/source_calendars`) as any));
    });
}
