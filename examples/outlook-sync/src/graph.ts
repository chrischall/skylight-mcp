import { dayAt, type Config, type Event } from './model.js';
export interface OutlookEvent {
  id: string;
  subject: string;
  body: { content: string; contentType: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  attendees?: unknown[];
  type?: string;
  location?: { displayName?: string };
  iCalUId?: string;
  transactionId?: string;
  '@odata.etag'?: string;
}
export function marker(c: Config, key: string): string {
  return `[SkylightSync:${c.syncId}:${key}]`;
}
export function payload(e: Event, c: Config) {
  return {
    subject: e.title,
    body: {
      contentType: 'text',
      content: `${marker(c, e.key)}\nSynced from Skylight. Edit the original in Skylight.\n\n${e.description}`,
    },
    start: {
      dateTime: e.allDay ? e.start + 'T00:00:00' : e.start.replace(/Z$/, ''),
      timeZone: e.allDay ? c.graphTimezone : 'UTC',
    },
    end: {
      dateTime: e.allDay ? e.end + 'T00:00:00' : e.end.replace(/Z$/, ''),
      timeZone: e.allDay ? c.graphTimezone : 'UTC',
    },
    isAllDay: e.allDay,
    location: { displayName: e.location },
    sensitivity: 'private',
    showAs: 'busy',
    isReminderOn: false,
  };
}
function utc(s: string) {
  return new Date(/(Z|[+-]\d\d:\d\d)$/.test(s) ? s : s + 'Z').toISOString();
}
export function interval(g: OutlookEvent, c: Config) {
  if (g.start.timeZone !== 'UTC' || g.end.timeZone !== 'UTC')
    throw new Error('GRAPH_TIMEZONE_UNEXPECTED');
  return {
    title: g.subject,
    start: g.isAllDay ? dayAt(new Date(utc(g.start.dateTime)), c.timezone) : utc(g.start.dateTime),
    end: g.isAllDay ? dayAt(new Date(utc(g.end.dateTime)), c.timezone) : utc(g.end.dateTime),
  };
}
export function safeCopy(g: OutlookEvent) {
  if (g.attendees?.length || g.type !== 'singleInstance')
    throw new Error('UNSAFE_DESTINATION_EVENT');
}
export function owns(g: OutlookEvent, c: Config, key: string) {
  return g.body?.content.trimStart().startsWith(marker(c, key));
}
export interface Destination {
  list(from: string, to: string): Promise<OutlookEvent[]>;
  get(id: string): Promise<OutlookEvent | undefined>;
  create(body: unknown): Promise<OutlookEvent>;
  update(id: string, body: unknown, etag?: string): Promise<void>;
  remove(id: string, etag?: string): Promise<void>;
}
export class Graph implements Destination {
  private base: string;
  constructor(
    private auth: { token(): Promise<string> },
    private c: Config,
    private http: typeof fetch = fetch,
  ) {
    this.base = '/me/calendars/' + encodeURIComponent(c.calendarId);
  }
  async request(path: string, method = 'GET', body?: unknown, etag?: string): Promise<any> {
    const u = new URL(path, 'https://graph.microsoft.com/v1.0/');
    if (
      u.origin !== 'https://graph.microsoft.com' ||
      !u.pathname.startsWith('/v1.0/') ||
      u.username ||
      u.password ||
      u.hash
    )
      throw new Error('GRAPH_DESTINATION_INVALID');
    let r: Response;
    try {
      r = await this.http(u, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
        headers: {
          Authorization: `Bearer ${await this.auth.token()}`,
          'Content-Type': 'application/json',
          Prefer: 'outlook.timezone="UTC", IdType="ImmutableId", outlook.body-content-type="text"',
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(method === 'GET' ? 'GRAPH_NETWORK' : 'GRAPH_WRITE_UNCERTAIN');
    }
    if (r.status === 404 && method === 'GET') return undefined;
    if (!r.ok) {
      await r.body?.cancel();
      throw new Error('GRAPH_HTTP_' + r.status);
    }
    if (r.status === 204) return undefined;
    return r.json();
  }
  private path(suffix: string) {
    return 'https://graph.microsoft.com/v1.0' + this.base + suffix;
  }
  async verifyAccount() {
    const me = await this.request(
      'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName',
    );
    if (
      !me ||
      ![me.mail, me.userPrincipalName].some(
        (x) => typeof x === 'string' && x.toLowerCase() === this.c.account.toLowerCase(),
      )
    )
      throw new Error('WRONG_MICROSOFT_ACCOUNT');
    const cal = await this.request(this.path(''));
    if (!cal?.canEdit) throw new Error('CALENDAR_NOT_WRITABLE');
  }
  async list(from: string, to: string) {
    let next =
      this.path('/calendarView?') +
      new URLSearchParams({
        startDateTime: from + 'T00:00:00Z',
        endDateTime: to + 'T23:59:59Z',
        $top: '1000',
      });
    const events: OutlookEvent[] = [];
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next) || seen.size >= 100) throw new Error('GRAPH_PAGINATION_LOOP');
      seen.add(next);
      const x = await this.request(next);
      if (!Array.isArray(x?.value)) throw new Error('GRAPH_LIST_SHAPE');
      events.push(...x.value);
      next = x['@odata.nextLink'] || '';
    }
    if (new Set(events.map((e) => e.id)).size !== events.length)
      throw new Error('GRAPH_DUPLICATE_IDS');
    return events;
  }
  get(id: string) {
    return this.request(this.path('/events/' + encodeURIComponent(id)));
  }
  create(body: unknown) {
    return this.request(this.path('/events'), 'POST', body);
  }
  async update(id: string, body: unknown, etag?: string) {
    await this.request(this.path('/events/' + encodeURIComponent(id)), 'PATCH', body, etag);
  }
  async remove(id: string, etag?: string) {
    await this.request(this.path('/events/' + encodeURIComponent(id)), 'DELETE', undefined, etag);
  }
}
