import { z } from 'zod';
import { textResult, flattenJsonApi } from '@chrischall/mcp-utils';
import type { SkylightClient } from '../client.js';

// Tool-result wrapper + JSON:API flattening now come from @chrischall/mcp-utils.
// `textContent` is kept as a thin alias for `textResult` so the per-tool call
// sites read unchanged; `flattenJsonApi` is re-exported verbatim. The shared
// version flattens the same `{ data: { id, type, attributes } }` envelopes (and
// passes resources without `attributes` through untouched), matching Skylight's
// previous local implementation.
export const textContent = textResult;
export { flattenJsonApi };

/** A JSON:API document — `data` is one resource or an array of them. */
export interface JsonApiResource { id: string; type: string; attributes?: Record<string, unknown>; }
export interface JsonApiDoc { data: JsonApiResource | JsonApiResource[]; }

/** Drop keys whose value is `undefined` (used to build flat write payloads). */
export function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
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
