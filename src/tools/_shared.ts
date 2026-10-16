import { z } from 'zod';
import { flattenJsonApi, minifiedResult, pruneUndefined } from '@chrischall/mcp-utils';
import type { ServerContext } from '@modelcontextprotocol/server';
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
 *  then calls `handler(client, frameId, args, ctx)`. Eliminates the repeated
 *  getClient()/resolveFrameId() preamble. `ctx` is the MCP request context,
 *  passed through for the tools that confirm a write. */
export function frameScoped<A extends { frameId?: string }, R>(
  getClient: GetClient,
  handler: (c: SkylightClient, frameId: string, args: A, ctx: ServerContext) => Promise<R>,
): (args: A, ctx: ServerContext) => Promise<R> {
  return async (args: A, ctx: ServerContext) => {
    const c = await getClient();
    const frameId = args.frameId ?? (await c.resolveFrameId());
    return handler(c, frameId, args, ctx);
  };
}

/**
 * `apiPath` — the tagged template for an API path — is the fleet's shared one
 * from `@chrischall/mcp-utils` (fleet-audit#1339; it was hoisted from this
 * file): every interpolated value is one percent-encoded path SEGMENT, and
 * `.`/`..`/empty are refused. Ids reach these paths straight from the model,
 * and an unencoded `id: '123?apply_to=all'` once smuggled a query past the
 * delete_chore confirm gate (fleet-audit#247). Re-exported so the tools keep
 * importing it from here.
 */
export { apiPath } from '@chrischall/mcp-utils';

/** Shared zod fragments: an id may be a string or a number, matching the API. */
export const idParam = z.union([z.string(), z.number()]);
export const idArrayParam = z.array(idParam);
