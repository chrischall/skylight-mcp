import { createHash } from 'node:crypto';
import { z } from 'zod';
export const configSchema = z
  .object({
    legacyMarker: z.string().min(20).default('One-time copy from Skylight'),
    syncId: z.string().uuid(),
    frameId: z.string().regex(/^\d+$/),
    account: z.string().email(),
    calendarId: z.string().min(1),
    graphTimezone: z.string().min(1).default('Eastern Standard Time'),
    timezone: z
      .string()
      .default('America/Toronto')
      .refine((t) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: t });
          return true;
        } catch {
          return false;
        }
      }),
    excludedCategoryIds: z.array(z.string()).min(1),
    excludedCalendarAccountIds: z.array(z.string()).min(1),
    startHour: z.number().int().min(0).max(23).default(8),
    endHour: z.number().int().min(0).max(23).default(20),
    allowDeletes: z.boolean().default(false),
    sourceContractVerified: z.boolean().default(false),
    maxChanges: z.number().int().positive().max(200).default(30),
    maxDeletes: z.number().int().min(0).max(20).default(5),
  })
  .strict()
  .refine((c) => c.endHour >= c.startHour);
export type Config = z.infer<typeof configSchema>;
export interface Event {
  key: string;
  sourceId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string;
  location: string;
}
export interface Token {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
export interface Mapping {
  destinationId?: string;
  transactionId: string;
  source: Event;
  fingerprint: string;
  missingSince?: string;
  lastMissingRun?: string;
  missingCount?: number;
  pending?: 'create' | 'update' | 'delete' | 'adopt';
  deleted?: boolean;
}
export interface Legacy {
  title: string;
  start: string;
  end: string;
  uid: string;
}
export interface State {
  version: 1;
  binding: string;
  microsoft?: Token;
  skylight?: Token;
  mappings: Record<string, Mapping>;
  legacy: Legacy[];
  lastRun?: { at: string; added: number; updated: number; deleted: number; adopted: number };
}
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function binding(c: Config): string {
  return digest([c.syncId, c.frameId, c.account.toLowerCase(), c.calendarId]);
}
export function fingerprint(e: Event): string {
  return digest([e.title, e.start, e.end, e.allDay, e.description, e.location]);
}
export function signature(e: Pick<Event, 'title' | 'start' | 'end'>): string {
  return digest([e.title, e.start, e.end]);
}
export function dayAt(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function dayPlus(day: string, n: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
export function horizon(now: Date, tz: string): { from: string; to: string } {
  const from = dayAt(now, tz);
  const d = new Date(from + 'T00:00:00Z');
  const m = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  if (d.getUTCMonth() !== m) d.setUTCDate(0);
  return { from, to: dayPlus(d.toISOString().slice(0, 10), 1) };
}
export function daytime(now: Date, c: Config): boolean {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: c.timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  return h >= c.startHour && h <= c.endHour;
}
export function inRange(e: Event, from: string, to: string, tz: string): boolean {
  const d = e.allDay ? e.start.slice(0, 10) : dayAt(new Date(e.start), tz);
  return d >= from && d < to;
}
