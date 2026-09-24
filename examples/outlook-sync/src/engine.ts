import { randomUUID } from 'node:crypto';
import {
  binding,
  fingerprint,
  inRange,
  signature,
  type Config,
  type Event,
  type State,
  type Mapping,
} from './model.js';
import { interval, owns, payload, safeCopy, type Destination, type OutlookEvent } from './graph.js';
import type { Snapshot } from './source.js';
export interface SourceReader {
  snapshot(from: string, to: string): Promise<Snapshot>;
  confirmMissing(e: Event): Promise<boolean>;
}
function matches(g: OutlookEvent, e: Event, c: Config) {
  const body = payload(e, c).body.content;
  return (
    signature(interval(g, c)) === signature(e) &&
    g.isAllDay === e.allDay &&
    (g.location?.displayName || '') === e.location &&
    g.body.content.replace(/\r\n/g, '\n').trim() === body.trim()
  );
}
export async function sync(
  c: Config,
  s: State,
  source: SourceReader,
  dest: Destination,
  save: () => Promise<void>,
  range: { from: string; to: string },
  apply = false,
  now = new Date(),
) {
  if (s.binding !== binding(c)) throw new Error('STATE_ACCOUNT_BINDING_MISMATCH');
  if (!apply) s = structuredClone(s);
  const snapshot = await source.snapshot(range.from, range.to);
  if (!snapshot.complete) throw new Error('SOURCE_CONTRACT_NOT_VERIFIED');
  const upcoming = (e: Event) =>
    inRange(e, range.from, range.to, c.timezone) &&
    (e.allDay ? e.end > range.from : Date.parse(e.end) > now.valueOf());
  const events = snapshot.events.filter(upcoming);
  if (new Set(events.map((e) => e.key)).size !== events.length)
    throw new Error('DUPLICATE_SOURCE_KEYS');
  const existing = await dest.list(range.from, range.to);
  const active = Object.values(s.mappings).filter((m) => !m.deleted && upcoming(m.source));
  if (active.length && events.length === 0)
    throw new Error('SOURCE_EMPTY_SNAPSHOT_REVIEW_REQUIRED');
  for (const legacy of s.legacy) {
    if (
      Date.parse(legacy.end) > now.valueOf() &&
      legacy.start.slice(0, 10) >= range.from &&
      legacy.start.slice(0, 10) < range.to &&
      !events.some((e) => signature(e) === signature(legacy))
    )
      throw new Error('LEGACY_SOURCE_CHANGED_REVIEW_REQUIRED');
  }
  const present = new Set(events.map((e) => e.key)),
    runAt = now.toISOString();
  const result = { added: 0, updated: 0, deleted: 0, adopted: 0, pendingDeletion: 0 };
  const actions: Array<{
    kind: 'create' | 'update' | 'adopt' | 'delete';
    event: Event;
    mapping: Mapping;
    target?: OutlookEvent;
  }> = [];
  for (const event of events) {
    let m: Mapping | undefined = s.mappings[event.key];
    const owned = existing.filter((g) => owns(g, c, event.key));
    if (owned.length > 1) throw new Error('DUPLICATE_MANAGED_DESTINATION');
    let target = owned[0];
    if (m?.destinationId) {
      const direct = await dest.get(m.destinationId);
      if (direct) {
        if (!owns(direct, c, event.key) && !m.pending)
          throw new Error('DESTINATION_PROVENANCE_LOST');
        target = direct;
      } else if (m.pending === 'update' || m.pending === 'delete')
        throw new Error('PENDING_WRITE_REVIEW_REQUIRED');
    }
    if (m?.deleted) {
      if (target) throw new Error('DELETED_MAPPING_REAPPEARED');
      m = undefined;
    }
    if (m?.pending === 'adopt' && target && !owns(target, c, event.key)) {
      const legacy = s.legacy.find((l) => signature(l) === signature(event));
      if (
        !legacy ||
        signature(interval(target, c)) !== signature(event) ||
        !target.body.content.includes(c.legacyMarker)
      )
        throw new Error('ADOPTION_RECOVERY_UNSAFE');
      safeCopy(target);
      actions.push({ kind: 'adopt', event, mapping: m, target });
      continue;
    }
    if (!m) {
      const legacy = s.legacy.find((l) => signature(l) === signature(event));
      if (legacy) {
        const candidates = existing.filter(
          (g) =>
            signature(interval(g, c)) === signature(legacy) &&
            g.body?.content.includes(c.legacyMarker),
        );
        if (candidates.length !== 1) throw new Error('LEGACY_ADOPTION_REQUIRES_EXACT_MATCH');
        target = candidates[0];
        safeCopy(target);
        m = {
          source: event,
          fingerprint: '',
          transactionId: randomUUID(),
          destinationId: target.id,
        };
        actions.push({ kind: 'adopt', event, mapping: m, target });
        continue;
      }
      m = { source: event, fingerprint: '', transactionId: target?.transactionId || randomUUID() };
    }
    if (target) {
      safeCopy(target);
      if (!owns(target, c, event.key)) throw new Error('DESTINATION_PROVENANCE_LOST');
      m.destinationId = target.id;
      if (!matches(target, event, c)) actions.push({ kind: 'update', event, mapping: m, target });
      else if (apply) {
        if (m.pending === 'adopt')
          s.legacy = s.legacy.filter((l) => signature(l) !== signature(event));
        m.source = event;
        m.fingerprint = fingerprint(event);
        delete m.pending;
        delete m.missingSince;
        delete m.missingCount;
        delete m.lastMissingRun;
        s.mappings[event.key] = m;
      }
    } else {
      if (m.destinationId && !m.pending) {
        m.transactionId = randomUUID();
        delete m.destinationId;
      }
      actions.push({ kind: 'create', event, mapping: m });
    }
  }
  for (const [key, m] of Object.entries(s.mappings)) {
    if (m.deleted || present.has(key) || !upcoming(m.source)) continue;
    result.pendingDeletion++;
    if (!c.allowDeletes) continue;
    if (!m.missingSince) {
      if (apply) {
        m.missingSince = runAt;
        m.lastMissingRun = runAt;
        m.missingCount = 1;
      }
      continue;
    }
    if (now.valueOf() - Date.parse(m.missingSince) < 3600000 || m.lastMissingRun === runAt)
      continue;
    if (!(await source.confirmMissing(m.source))) throw new Error('SOURCE_MISSING_NOT_CONFIRMED');
    if (m.destinationId) {
      const target = await dest.get(m.destinationId);
      if (target) {
        safeCopy(target);
        if (!owns(target, c, key)) throw new Error('DELETE_PROVENANCE_LOST');
        actions.push({ kind: 'delete', event: m.source, mapping: m, target });
      } else if (apply) m.deleted = true;
    }
  }
  const deletes = actions.filter((a) => a.kind === 'delete').length;
  if (deletes > c.maxDeletes || deletes > Math.max(1, Math.floor(active.length * 0.2)))
    throw new Error('DELETE_LIMIT_REVIEW_REQUIRED');
  if (actions.filter((a) => a.kind !== 'adopt').length > c.maxChanges)
    throw new Error('CHANGE_LIMIT_REVIEW_REQUIRED');
  if (!apply) {
    for (const a of actions)
      result[
        a.kind === 'create'
          ? 'added'
          : a.kind === 'adopt'
            ? 'adopted'
            : a.kind === 'delete'
              ? 'deleted'
              : 'updated'
      ]++;
    return { ...result, mode: 'dry-run' as const };
  }
  // Persist intentions before writes; state save failure prevents further calendar writes.
  await save();
  for (const a of actions) {
    const { event, mapping: m } = a;
    const fresh = a.target ? await dest.get(a.target.id) : undefined;
    if (a.target && !fresh) throw new Error('DESTINATION_CHANGED_DURING_RUN');
    if (fresh) {
      safeCopy(fresh);
      if (a.kind === 'adopt') {
        if (
          signature(interval(fresh, c)) !== signature(event) ||
          !fresh.body.content.includes(c.legacyMarker)
        )
          throw new Error('ADOPTION_CHANGED');
      } else if (!owns(fresh, c, event.key)) throw new Error('DESTINATION_PROVENANCE_LOST');
    }
    m.pending = a.kind;
    s.mappings[event.key] = m;
    await save();
    if (a.kind === 'delete') {
      await dest.remove(fresh!.id, fresh!['@odata.etag']);
      if (await dest.get(fresh!.id)) throw new Error('DELETE_NOT_VERIFIED');
      m.deleted = true;
      result.deleted++;
      result.pendingDeletion--;
    } else {
      if (a.kind === 'create') {
        const created = await dest.create({ ...payload(event, c), transactionId: m.transactionId });
        if (!created?.id) throw new Error('CREATE_NOT_CONFIRMED');
        m.destinationId = created.id;
        await save();
      } else {
        m.destinationId = fresh!.id;
        await dest.update(fresh!.id, payload(event, c), fresh!['@odata.etag']);
      }
      const verified = await dest.get(m.destinationId!);
      if (!verified || !owns(verified, c, event.key) || !matches(verified, event, c))
        throw new Error('WRITE_NOT_VERIFIED');
      safeCopy(verified);
      m.source = event;
      m.fingerprint = fingerprint(event);
      delete m.missingSince;
      delete m.missingCount;
      delete m.lastMissingRun;
      if (a.kind === 'adopt') {
        s.legacy = s.legacy.filter((l) => signature(l) !== signature(event));
        result.adopted++;
      } else if (a.kind === 'create') result.added++;
      else result.updated++;
    }
    delete m.pending;
    await save();
  }
  s.lastRun = {
    at: runAt,
    added: result.added,
    updated: result.updated,
    deleted: result.deleted,
    adopted: result.adopted,
  };
  await save();
  return { ...result, mode: 'apply' as const };
}
