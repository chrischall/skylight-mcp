import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { extname, resolve } from 'node:path';
import { schemaConfirm, textResult } from '@chrischall/mcp-utils';

export { schemaConfirm };

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
  return textResult({
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
 * (photo/avatar uploads). Without `confirm: true` it returns a no-network,
 * no-S3 dry-run that echoes the RESOLVED ABSOLUTE path and the mime detected
 * from the file extension — so a prompt-injected `image_path` (e.g. a secret on
 * disk) is visible and interceptable before any byte leaves the machine. With
 * `confirm: true` it returns `null` so the caller proceeds with the upload.
 */
export function previewFileUploadUnlessConfirmed(
  confirm: boolean | undefined,
  imagePath: string,
  action: string,
  method: string,
  path: string,
  mimeByExt: Record<string, string>,
  defaultExt: string,
): CallToolResult | null {
  const resolved = resolve(imagePath);
  const ext = extname(resolved).slice(1).toLowerCase() || defaultExt;
  const mime = mimeByExt[ext] ?? 'application/octet-stream';
  return previewUnlessConfirmed(confirm, action, method, path, { image_path: resolved, mime });
}
