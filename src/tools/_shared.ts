import { z } from 'zod';
import { flattenJsonApi, minifiedResult, pruneUndefined } from '@chrischall/mcp-utils';
import type { SkylightClient } from '../client.js';

// Tool-result wrapper + JSON:API flattening now come from @chrischall/mcp-utils.
// `textContent` is kept as a thin alias for `minifiedResult` so the per-tool call
// sites read unchanged; `flattenJsonApi` is re-exported verbatim. The shared
// version flattens the same `{ data: { id, type, attributes } }` envelopes (and
// passes resources without `attributes` through untouched), matching Skylight's
// previous local implementation. `pruneUndefined` is the shared, byte-identical
// replacement for the former local `compact()` — it shallow-copies an object
// dropping every `undefined`-valued key (falsy values like 0/''/false survive).
export const textContent = minifiedResult;
export { flattenJsonApi, pruneUndefined };

/** A JSON:API document — `data` is one resource or an array of them. */
export interface JsonApiResource { id: string; type: string; attributes?: Record<string, unknown>; }
export interface JsonApiDoc { data: JsonApiResource | JsonApiResource[]; }

/** A JSON:API resource identifier — the `{ id, type }` pointer in a relationship. */
export interface ResourceRef { id: string; type: string }

/** A resource whose `relationships` are load-bearing. `flattenJsonApi()` drops
 *  them (see the JSON:API flattening convention in CLAUDE.md), so the handlers
 *  that must keep them — `flattenChores`, `flattenSittings` — walk this shape
 *  instead of `JsonApiResource`. */
export interface RelatedResource extends ResourceRef {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: ResourceRef | ResourceRef[] | null }>;
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

/**
 * Tagged template for an API path: every interpolated value is one path
 * SEGMENT, percent-encoded with `encodeURIComponent`. The static parts of the
 * template (including a static `?include=…`) pass through verbatim.
 *
 * Ids reach these paths straight from the model, and WHATWG URL parsing honours
 * `?`, `#` and `../` — so an unencoded `id: '123?apply_to=all'` smuggled a query
 * past the delete_chore confirm gate, and `itemId: '../../../lists/5'` turned a
 * single-item delete into a whole-list delete (fleet-audit#247). Encoding keeps
 * each value inside its segment. `.`/`..`/empty survive encoding unchanged and
 * would still resolve as traversal, so they are refused outright.
 */
export function apiPath(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]!;
  values.forEach((v, i) => {
    const s = String(v);
    if (s === '' || s === '.' || s === '..') {
      throw new Error(`Invalid id ${JSON.stringify(s)}: a path segment cannot be empty, "." or "..".`);
    }
    out += encodeURIComponent(s) + strings[i + 1]!;
  });
  return out;
}

/** Shared zod fragments: an id may be a string or a number, matching the API. */
export const idParam = z.union([z.string(), z.number()]);
export const idArrayParam = z.array(idParam);
