import { dayPlus, digest, type Config, type Event } from './model.js';
export interface SkylightReader {
  request(method: string, path: string, opts?: { query?: Record<string, string> }): Promise<any>;
}
export interface Snapshot {
  events: Event[];
  seen: Set<string>;
  complete: boolean;
}
export function listData(x: any): any[] {
  if (!x || !Array.isArray(x.data)) throw new Error('SOURCE_LIST_SHAPE');
  // No undocumented pagination or silent truncation is accepted by this adapter.
  if (
    x.links?.next ||
    x.meta?.next_page ||
    x.meta?.has_more ||
    x.meta?.pagination ||
    x.meta?.total_pages > 1 ||
    x.meta?.total_count > x.data.length
  )
    throw new Error('SOURCE_PAGINATION_UNSUPPORTED');
  return x.data;
}
function refs(e: any, name: string): string[] {
  const v = e.relationships?.[name]?.data;
  if (!Array.isArray(v) || v.some((x) => typeof x.id !== 'string'))
    throw new Error('SOURCE_CATEGORIES_MISSING');
  return v.map((x) => x.id);
}
export function normalize(e: any, c: Config): { key: string; event?: Event } {
  const a = e.attributes;
  if (
    typeof e.id !== 'string' ||
    !a ||
    typeof a.summary !== 'string' ||
    typeof a.all_day !== 'boolean' ||
    !['standard'].includes(a.kind)
  )
    throw new Error('SOURCE_EVENT_UNSUPPORTED');
  const key = digest([c.frameId, e.id]);
  const categories = refs(e, 'categories');
  const account = e.relationships?.calendar_account?.data;
  if (account !== null && (!account || typeof account.id !== 'string'))
    throw new Error('SOURCE_ACCOUNT_MISSING');
  if (
    categories.some((id) => c.excludedCategoryIds.includes(id)) ||
    (account && c.excludedCalendarAccountIds.includes(account.id)) ||
    a.status === 'cancelled'
  )
    return { key };
  if (
    !Number.isFinite(Date.parse(a.starts_at)) ||
    !Number.isFinite(Date.parse(a.ends_at)) ||
    Date.parse(a.ends_at) <= Date.parse(a.starts_at)
  )
    throw new Error('SOURCE_TIME_INVALID');
  for (const field of ['starts_at', 'ends_at'])
    if (!/(Z|[+-]\d\d:\d\d)$/.test(a[field])) throw new Error('SOURCE_OFFSET_REQUIRED');
  if (
    (a.description !== null && a.description !== undefined && typeof a.description !== 'string') ||
    (a.location !== null && a.location !== undefined && typeof a.location !== 'string')
  )
    throw new Error('SOURCE_TEXT_INVALID');
  const event = {
    key,
    sourceId: e.id,
    title: a.summary.trim(),
    start: a.all_day ? a.starts_at.slice(0, 10) : new Date(a.starts_at).toISOString(),
    end: a.all_day ? a.ends_at.slice(0, 10) : new Date(a.ends_at).toISOString(),
    allDay: a.all_day,
    description: a.description || '',
    location: a.location || '',
  };
  return { key, event };
}
export class Source {
  constructor(
    private p: SkylightReader,
    private c: Config,
  ) {}
  async snapshot(from: string, to: string): Promise<Snapshot> {
    const base = '/frames/' + this.c.frameId;
    const categories = listData(await this.p.request('GET', base + '/categories'));
    if (this.c.excludedCategoryIds.some((id) => !categories.some((x) => x.id === id)))
      throw new Error('SOURCE_FILTER_IDS_MISSING');
    const sources = listData(await this.p.request('GET', base + '/source_calendars'));
    if (
      this.c.excludedCalendarAccountIds.some(
        (id) => !sources.some((x) => x.relationships?.calendar_account?.data?.id === id),
      )
    )
      throw new Error('SOURCE_LOOP_FILTER_MISSING');
    const result = new Map<string, Event>(),
      seen = new Set<string>();
    for (let day = from; day < to; ) {
      const end = dayPlus(day, 7) < to ? dayPlus(day, 7) : to;
      const rows = listData(
        await this.p.request('GET', base + '/calendar_events', {
          query: {
            date_min: day,
            date_max: end,
            timezone: this.c.timezone,
            include: 'categories,calendar_account',
          },
        }),
      );
      for (const row of rows) {
        const n = normalize(row, this.c);
        seen.add(n.key);
        if (n.event) {
          const old = result.get(n.key);
          if (old && JSON.stringify(old) !== JSON.stringify(n.event))
            throw new Error('SOURCE_CHANGED_DURING_SCAN');
          result.set(n.key, n.event);
        }
      }
      day = end;
    }
    return { events: [...result.values()], seen, complete: this.c.sourceContractVerified };
  }
  async confirmMissing(e: Event): Promise<boolean> {
    const day = e.start.slice(0, 10);
    const rows = listData(
      await this.p.request('GET', '/frames/' + this.c.frameId + '/calendar_events', {
        query: {
          date_min: dayPlus(day, -1),
          date_max: dayPlus(day, 2),
          timezone: this.c.timezone,
          include: 'categories,calendar_account',
        },
      }),
    );
    return !rows.some((row) => {
      const n = normalize(row, this.c);
      return n.key === e.key && n.event !== undefined;
    });
  }
}
