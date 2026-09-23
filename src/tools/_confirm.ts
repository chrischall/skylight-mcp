import type { CallToolResult } from '@modelcontextprotocol/server';
import { minifiedResult, schemaConfirm } from '@chrischall/mcp-utils';
import type { VettedUpload } from '../upload-guard.js';

export { schemaConfirm };

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
 * Confirm-gate for a mutating tool (the fleet convention). When `confirm` is not
 * `true`, returns a no-network dry-run preview of exactly what would be sent;
 * when it is `true`, returns `null` so the caller proceeds with the write.
 */
export function previewUnlessConfirmed(
  confirm: boolean | undefined,
  action: string,
  method: string,
  path: string,
  body?: unknown,
): CallToolResult | null {
  if (confirm === true) return null;
  return minifiedResult({
    dryRun: true,
    action,
    method,
    path,
    ...(body !== undefined ? { willSend: body } : {}),
    note: 'Re-run with confirm: true to execute.',
  });
}

/**
 * Confirm-gate for a tool that reads a LOCAL file and ships its bytes off-machine
 * (photo/avatar uploads). Takes the file only AFTER `vetUploadFile` has accepted
 * it, so the preview echoes the resolved absolute path, the sniffed-and-allowed
 * mime and the size — a prompt-injected `image_path` is visible before any byte
 * leaves the machine. With `confirm: true` it returns `null` so the caller
 * proceeds with the upload.
 */
export function previewFileUploadUnlessConfirmed(
  confirm: boolean | undefined,
  file: VettedUpload,
  action: string,
  method: string,
  path: string,
  extra?: Record<string, unknown>,
): CallToolResult | null {
  return previewUnlessConfirmed(confirm, action, method, path, {
    ...extra,
    image_path: file.resolved,
    mime: file.mime,
    bytes: file.size,
  });
}
