import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, compact, frameScoped, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';
import { s3Upload, type S3Credentials } from '../s3-upload.js';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic',
  gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime',
};

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
  imagePath: string,
): Promise<{ bucket: string; key: string; etag: string; ext: string }> {
  const body = await readFile(imagePath);
  const ext = extname(imagePath).slice(1).toLowerCase() || 'jpg';
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const credsDoc = await c.request<{ data?: ({ attributes?: CloudCreds } & Partial<CloudCreds>) } & Partial<CloudCreds>>(
    'GET', '/messages/cloud_upload_credentials',
  );
  // Live shape is `{ data: { credentials, region, bucket, key_prefix } }` — the
  // upload-credential fields sit directly on `data` (no JSON:API `attributes`
  // wrapper). Tolerate an attributes wrapper and a flat doc just in case.
  const cc = (credsDoc.data?.attributes ?? credsDoc.data ?? credsDoc) as unknown as CloudCreds;
  const key = `${cc.key_prefix}${randomUUID()}.${ext}`;
  const etag = await s3Upload({ creds: cc.credentials, region: cc.region, bucket: cc.bucket, key, body, contentType });
  return { bucket: cc.bucket, key, etag, ext };
}

export function registerPhotoTools(server: McpServer, getClient: GetClient) {
  server.tool(
    'skylight_upload_photo',
    'Upload a photo or video from a local file to the Skylight frame (it appears in the slideshow). Two-step: signs an S3 upload with temporary credentials, then registers it as a frame message.',
    {
      image_path: z.string().describe('Absolute path to a local image/video file (jpg, png, heic, mp4, …).'),
      caption: z.string().optional().describe('Caption shown with the photo.'),
      frame_ids: idArrayParam.optional().describe('Frame ids to post to; defaults to the resolved frame.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { image_path, caption, frame_ids }: { image_path: string; caption?: string; frame_ids?: Array<string | number>; frameId?: string }) => {
      const { bucket, key, etag, ext } = await uploadFile(c, image_path);
      const frames = frame_ids && frame_ids.length ? frame_ids : [f];
      // Register returns `{ data: { message_ids: [...] } }`; the photo then transcodes
      // server-side (status "processing") before it shows on the frame.
      const doc = await c.request<{ data?: { message_ids?: Array<string | number> } }>('POST', '/messages/uploads', {
        body: compact({ file_upload: { bucket, key, etag }, frame_ids: frames, caption, ext }),
      });
      return textContent({ message_ids: doc.data?.message_ids ?? [], key, frame_ids: frames, status: 'processing' });
    }),
  );

  server.tool(
    'skylight_import_events_from_photo',
    "Import calendar events from a photo of a flyer/invite/schedule using Skylight's AI (event_importer). Uploads the photo, then kicks off an auto-creation intent — poll skylight_get_auto_creation_intent / skylight_list_auto_creation_drafts, then skylight_approve_auto_creation.",
    {
      image_path: z.string().describe('Absolute path to a local image of the events to import.'),
      category_ids: idArrayParam.optional().describe('Family-member category ids to assign the imported events to.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { image_path, category_ids }: { image_path: string; category_ids?: Array<string | number>; frameId?: string }) => {
      const { ext } = await uploadFile(c, image_path);
      // NOTE: the event_importer intent references the just-uploaded photo (created_via app_photo_picker);
      // the exact server-side linkage to the upload is inferred from captured traffic.
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/auto_creation_intents`, {
        body: compact({ ext, engine: 'event_importer', category_ids, created_via: 'app_photo_picker' }),
      });
      return textContent(flattenJsonApi(doc));
    }),
  );
}
