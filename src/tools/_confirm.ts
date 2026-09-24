import type { ServerContext } from '@modelcontextprotocol/server';
import { confirmationFromEnv, confirmTokenParam, requireConfirmationWithFallback } from '@chrischall/mcp-utils';
import type { VettedUpload } from '../upload-guard.js';
import { apiPath } from './_shared.js';

export { confirmTokenParam };

/**
 * `apply_to` scopes that destroy MORE than the occurrence the caller named.
 *
 * Three vocabularies exist across the API for the same idea — meals use
 * `one|future|all`, chore deletes `one|all`, chore updates
 * `this|this_and_future|all` — so this lists every multi-scope spelling rather
 * than assuming one set.
 */
const MULTI_OCCURRENCE_SCOPES = new Set(['future', 'this_and_future', 'all']);

/**
 * Whether an `apply_to` value will affect more than the single occurrence the
 * caller identified.
 *
 * This is the repo's rule for when a destructive API tool needs a confirm gate
 * (CLAUDE.md, "Confirm gates"): gate when the blast radius EXCEEDS what the
 * caller named, not merely because a call is irreversible. Every plain delete
 * here destroys exactly the thing you asked for and stays ungated; an
 * `apply_to` delete can destroy occurrences you did not name — `all` reaches
 * ones previously split off the series, `future` truncates the original's
 * `UNTIL` and takes the whole tail with it.
 *
 * `undefined` is false: an omitted `apply_to` is a plain single delete.
 */
export function affectsMultipleOccurrences(applyTo: string | undefined): boolean {
  return applyTo !== undefined && MULTI_OCCURRENCE_SCOPES.has(applyTo);
}

/**
 * The `/frames/{f}` prefix of a preview path. A gate that runs BEFORE the frame
 * is resolved (so its preview makes no request at all) shows the explicit
 * `frameId` when one was passed and the `{frame}` placeholder otherwise — either
 * way the choice is part of what the token binds.
 */
export function framePath(frameId: string | undefined): string {
  return frameId === undefined ? '/frames/{frame}' : apiPath`/frames/${frameId}`;
}

/**
 * How many named targets a preview `description` spells out before
 * "+N more". A bulk delete of a hundred photos should still read as one
 * sentence; the FULL list is always in `willSend`, which the token binds.
 */
export const PREVIEW_NAMES_MAX = 10;

/** Join up to {@link PREVIEW_NAMES_MAX} names for a description, then "+N more". */
export function nameSome(names: string[]): string {
  const shown = names.slice(0, PREVIEW_NAMES_MAX).join(', ');
  const rest = names.length - PREVIEW_NAMES_MAX;
  return rest > 0 ? `${shown}, +${rest} more` : shown;
}

/** What a confirm-gated write is about to do. */
export interface GatedWrite {
  /** The registered tool name the token is bound to. */
  tool: string;
  /** `<service>.<verb>` — the stable action id shown to the user. */
  action: string;
  /** One human sentence naming what happens and why it is gated. */
  description: string;
  /** The primary id acted on (bound into the token), or '' if none. */
  target: string;
  method: string;
  path: string;
  /** EXACTLY what the write sends — hashed into the token. */
  body?: unknown;
  /** The phase-2 token from the tool input, or undefined on phase 1. */
  confirmToken?: string;
}

/**
 * Confirm-gate for a mutating tool (the fleet convention, MCP_CONFIRM_MODE).
 *
 * A client that can show a prompt gets a real elicitation. One that cannot
 * (claude.ai, Claude Desktop) gets the two-phase token flow: the first call
 * writes nothing and returns the preview plus a confirmToken; only a repeat call
 * with that token, and an unchanged `{ method, path, body }`, proceeds. Resolves
 * `undefined` to proceed, or the result to return unchanged.
 */
export function confirmWrite(ctx: ServerContext, w: GatedWrite) {
  const preview: Record<string, unknown> = {
    description: w.description,
    method: w.method,
    path: w.path,
    ...(w.body !== undefined ? { willSend: w.body } : {}),
  };
  return requireConfirmationWithFallback(ctx, confirmationFromEnv({
    action: w.action,
    message: 'Review and confirm this change:',
    details: preview,
    tool: w.tool,
    confirmToken: w.confirmToken,
    subject: () => ({
      target: w.target,
      payload: { method: w.method, path: w.path, body: w.body },
      preview,
    }),
  }));
}

/**
 * {@link confirmWrite} for a tool that reads a LOCAL file and ships its bytes
 * off-machine (photo/avatar uploads). Takes the file only AFTER `vetUploadFile`
 * has accepted it, so the preview echoes the resolved absolute path, the
 * sniffed-and-allowed mime and the size — a prompt-injected `image_path` is
 * visible before any byte leaves the machine — and all three are bound into the
 * token.
 */
export function confirmFileUpload(
  ctx: ServerContext,
  file: VettedUpload,
  w: Omit<GatedWrite, 'body'> & { extra?: Record<string, unknown> },
) {
  const { extra, ...rest } = w;
  return confirmWrite(ctx, {
    ...rest,
    body: { ...extra, image_path: file.resolved, mime: file.mime, bytes: file.size },
  });
}
