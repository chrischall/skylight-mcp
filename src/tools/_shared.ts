import { z } from 'zod';
import { textResult, flattenJsonApi, pruneUndefined } from '@chrischall/mcp-utils';
import type { SkylightClient } from '../client.js';

// Tool-result wrapper + JSON:API flattening now come from @chrischall/mcp-utils.
// `textContent` is kept as a thin alias for `textResult` so the per-tool call
// sites read unchanged; `flattenJsonApi` is re-exported verbatim. The shared
// version flattens the same `{ data: { id, type, attributes } }` envelopes (and
// passes resources without `attributes` through untouched), matching Skylight's
// previous local implementation. `pruneUndefined` is the shared, byte-identical
// replacement for the former local `compact()` — it shallow-copies an object
// dropping every `undefined`-valued key (falsy values like 0/''/false survive).
export const textContent = textResult;
export { flattenJsonApi, pruneUndefined };

/** A resource identifier object — the `{ id, type }` half of a relationship link. */
export interface JsonApiLink { id: string; type: string; }
/** One relationship: `data` is a link (to-one), an array of links (to-many), or null/absent. */
export interface JsonApiRelationship { data?: JsonApiLink | JsonApiLink[] | null; }

/** A JSON:API document — `data` is one resource or an array of them. */
export interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, JsonApiRelationship>;
}
export interface JsonApiDoc { data: JsonApiResource | JsonApiResource[]; included?: JsonApiResource[]; }

/**
 * `{ ...attributes, id, type }`, always — `relationships` is dropped here.
 *
 * For a resource in `data` the caller re-attaches them (resolved). For a
 * resource in `included` it does not: resolution is deliberately one level
 * deep, so a sideloaded `meal_recipe`'s own `meal_category` link does not
 * surface. Going deeper would mean walking a graph that can contain cycles,
 * and the endpoints here only ever need the sitting's immediate links.
 *
 * This matches `flattenJsonApi` for the ordinary case, but deliberately *not*
 * for a resource with no `attributes`: `flattenJsonApi` returns such a node
 * verbatim (see the note at the top of this file), which would smuggle the raw
 * `relationships` object back into the output. Normalizing to `{ id, type }`
 * instead keeps every resource in the result the same shape.
 */
function flattenResource(r: JsonApiResource): Record<string, unknown> {
  return { ...r.attributes, id: r.id, type: r.type };
}

/**
 * Flatten a JSON:API document *and* resolve its `included` sideload.
 *
 * `flattenJsonApi` keeps only `attributes` + `id`/`type`, so it discards both
 * `relationships` and `included`. That is fine for the ~100 tools whose reads
 * carry no meaningful links, but it is lossy where the relationship *is* the
 * answer — a meal sitting's `meal_category` is the only thing separating
 * breakfast from lunch from dinner (issue #86).
 *
 * Each resource in `data` is flattened, then every relationship is replaced by
 * the matching resource from `included` (an object for to-one, an array for
 * to-many). A link with no sideloaded match degrades to the bare `{ id, type }`
 * so the caller can still follow it; an empty (`data: null`) relationship is
 * dropped. `flattenJsonApi` is deliberately left untouched.
 *
 * A document with no (or null) `data` yields `[]` rather than throwing. The
 * `JsonApiDoc` type says `data` is required, but callers get their documents
 * from `c.request<JsonApiDoc>()` — an unchecked cast of a network response — so
 * the type is a claim, not a guarantee. `flattenJsonApi` guards this too, but
 * differently: it returns the payload verbatim when `data` is absent and `null`
 * for `{ data: null }`, where this returns `[]` for both.
 */
export function resolveJsonApiIncluded(doc: JsonApiDoc): Record<string, unknown> | Record<string, unknown>[] {
  if (doc?.data == null) return [];

  const sideloaded = new Map<string, Record<string, unknown>>();
  for (const r of doc.included ?? []) sideloaded.set(`${r.type}:${r.id}`, flattenResource(r));

  const resolveLink = (l: JsonApiLink) => sideloaded.get(`${l.type}:${l.id}`) ?? { id: l.id, type: l.type };

  const resolveOne = (r: JsonApiResource): Record<string, unknown> => {
    const out = flattenResource(r);
    for (const [name, rel] of Object.entries(r.relationships ?? {})) {
      const link = rel.data;
      if (!link) continue;
      out[name] = Array.isArray(link) ? link.map(resolveLink) : resolveLink(link);
    }
    return out;
  };

  return Array.isArray(doc.data) ? doc.data.map(resolveOne) : resolveOne(doc.data);
}

export type GetClient = () => Promise<SkylightClient>;

/** Wrap a frame-scoped tool handler: resolves the client + frame id once,
 *  then calls `handler(client, frameId, args)`. Eliminates the repeated
 *  getClient()/resolveFrameId() preamble. */
export function frameScoped<A extends { frameId?: string }, R>(
  getClient: GetClient,
  handler: (c: SkylightClient, frameId: string, args: A) => Promise<R>,
): (args: A) => Promise<R> {
  return async (args: A) => {
    const c = await getClient();
    const frameId = args.frameId ?? (await c.resolveFrameId());
    return handler(c, frameId, args);
  };
}

/** Shared zod fragments: an id may be a string or a number, matching the API. */
export const idParam = z.union([z.string(), z.number()]);
export const idArrayParam = z.array(idParam);
