import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { apiPath, textContent, flattenJsonApi, pruneUndefined, frameScoped, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';
import { confirmFileUpload, confirmTokenParam, framePath } from './_confirm.js';
import { s3Upload, type S3Credentials } from '../s3-upload.js';
import { vetUploadFile, type VettedUpload } from '../upload-guard.js';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic',
  gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime',
};

/** The photo path buffers the whole file for the S3 PUT, so it is capped. */
const MAX_PHOTO_BYTES = 200 * 1024 * 1024;

interface CloudCreds {
  credentials: S3Credentials;
  region: string;
  bucket: string;
  key_prefix: string;
}

/** Upload a local file to the frame's S3 bucket and register it as a message.
 *  Returns { bucket, key, ext } so callers (e.g. event_importer) can reference it. */
async function uploadFile(
  c: { request: <T = unknown>(m: string, p: string, o?: { body?: unknown }) => Promise<T> },
  file: VettedUpload,
): Promise<{ bucket: string; key: string; etag: string; ext: string }> {
  // Only ever a path `vetUploadFile` accepted — allowlisted type, regular file,
  // not a symlink, under the cap, contents matching the extension.
  const body = await readFile(file.resolved);
  const { ext, mime: contentType } = file;
  const credsDoc = await c.request<{ data?: ({ attributes?: CloudCreds } & Partial<CloudCreds>) } & Partial<CloudCreds>>(
    'GET', '/messages/cloud_upload_credentials',
  );
  // Live shape is `{ data: { credentials, region, bucket, key_prefix } }` — the
  // upload-credential fields sit directly on `data` (no JSON:API `attributes`
  // wrapper). Tolerate an attributes wrapper and a flat doc just in case.
  const cc = (credsDoc.data?.attributes ?? credsDoc.data ?? credsDoc) as unknown as CloudCreds;
  // Fail fast at the boundary if the shape drifts, rather than throwing deep in SigV4.
  if (!cc?.credentials || !cc.bucket || !cc.key_prefix) {
    throw new Error('Unexpected cloud_upload_credentials response shape (missing credentials/bucket/key_prefix).');
  }
  const key = `${cc.key_prefix}${randomUUID()}.${ext}`;
  const etag = await s3Upload({ creds: cc.credentials, region: cc.region, bucket: cc.bucket, key, body, contentType });
  return { bucket: cc.bucket, key, etag, ext };
}

export function registerPhotoTools(server: McpServer, getClient: GetClient) {
  const uploadPhoto = frameScoped(getClient, async (c, f, { file, caption, frame_ids }: { file: VettedUpload; caption?: string; frame_ids?: Array<string | number>; frameId?: string }) => {
    const { bucket, key, etag, ext } = await uploadFile(c, file);
    const frames = frame_ids && frame_ids.length ? frame_ids : [f];
    // Register returns `{ data: { message_ids: [...] } }`; the photo then transcodes
    // server-side (status "processing") before it shows on the frame.
    const doc = await c.request<{ data?: { message_ids?: Array<string | number> } }>('POST', '/messages/uploads', {
      body: pruneUndefined({ file_upload: { bucket, key, etag }, frame_ids: frames, caption, ext }),
    });
    return textContent({ message_ids: doc.data?.message_ids ?? [], key, frame_ids: frames, status: 'processing' });
  });

  server.registerTool(
    'skylight_upload_photo',
    {
      description: 'Upload a photo or video from a local file to the Skylight frame (it appears in the slideshow). Two-step: signs an S3 upload with temporary credentials, then registers it as a frame message. Asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token proceeds (see MCP_CONFIRM_MODE). The preview echoes the resolved absolute image_path, detected mime, size and caption, and nothing is read or uploaded until it is confirmed.',
      inputSchema: z.object({
        image_path: z.string().describe('Absolute path to a local image/video file (jpg, jpeg, png, heic, gif, webp, mp4, mov; max 200 MiB). Anything else — or a symlink, or a file whose contents do not match its extension — is refused.'),
        caption: z.string().optional().describe('Caption shown with the photo.'),
        frame_ids: idArrayParam.optional().describe('Frame ids to post to; defaults to the resolved frame.'),
        frameId: z.string().optional(),
        confirmToken: confirmTokenParam,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args: { image_path: string; caption?: string; frame_ids?: Array<string | number>; frameId?: string; confirmToken?: string }, ctx: ServerContext) => {
      const file = await vetUploadFile(args.image_path, { mimeByExt: MIME, maxBytes: MAX_PHOTO_BYTES });
      const gate = await confirmFileUpload(ctx, file, {
        tool: 'skylight_upload_photo',
        action: 'photo.upload',
        description: 'Upload a local file to the Skylight frame (S3)',
        target: file.resolved,
        method: 'POST',
        path: '/messages/uploads',
        extra: pruneUndefined({ caption: args.caption, frame_ids: args.frame_ids, frameId: args.frameId }),
        confirmToken: args.confirmToken,
      });
      if (gate) return gate;
      return uploadPhoto({ ...args, file }, ctx);
    },
  );

  const importEvents = frameScoped(getClient, async (c, f, { file, category_ids }: { file: VettedUpload; category_ids?: Array<string | number>; frameId?: string }) => {
    const { ext } = await uploadFile(c, file);
    // NOTE: the event_importer intent references the just-uploaded photo (created_via app_photo_picker);
    // the exact server-side linkage to the upload is inferred from captured traffic.
    const doc = await c.request<JsonApiDoc>('POST', apiPath`/frames/${f}/auto_creation_intents`, {
      body: pruneUndefined({ ext, engine: 'event_importer', category_ids, created_via: 'app_photo_picker' }),
    });
    return textContent(flattenJsonApi(doc));
  });

  server.registerTool(
    'skylight_import_events_from_photo',
    {
      description: "Import calendar events from a photo of a flyer/invite/schedule using Skylight's AI (event_importer). Best-effort/UNVERIFIED: uploads the photo to S3 then posts an event_importer intent that references the latest upload (the server-side photo↔intent link is inferred from captured traffic, not confirmed). Asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token proceeds (see MCP_CONFIRM_MODE). The preview echoes the resolved absolute image_path, detected mime and size, and nothing is read or uploaded until it is confirmed. Poll skylight_get_auto_creation_intent / skylight_list_auto_creation_drafts, then skylight_approve_auto_creation.",
      inputSchema: z.object({
        image_path: z.string().describe('Absolute path to a local image of the events to import (same types and 200 MiB cap as skylight_upload_photo).'),
        category_ids: idArrayParam.optional().describe('Family-member category ids to assign the imported events to.'),
        frameId: z.string().optional(),
        confirmToken: confirmTokenParam,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args: { image_path: string; category_ids?: Array<string | number>; frameId?: string; confirmToken?: string }, ctx: ServerContext) => {
      const file = await vetUploadFile(args.image_path, { mimeByExt: MIME, maxBytes: MAX_PHOTO_BYTES });
      const gate = await confirmFileUpload(ctx, file, {
        tool: 'skylight_import_events_from_photo',
        action: 'photo.import_events',
        description: 'Upload a local photo to the Skylight frame (S3) and start an event_importer intent',
        target: file.resolved,
        method: 'POST',
        path: `${framePath(args.frameId)}/auto_creation_intents`,
        extra: pruneUndefined({ category_ids: args.category_ids }),
        confirmToken: args.confirmToken,
      });
      if (gate) return gate;
      return importEvents({ ...args, file }, ctx);
    },
  );
}
