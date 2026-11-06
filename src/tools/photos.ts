import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { expandPath, McpToolError } from '@chrischall/mcp-utils';
import {
  blobStoreFromEnv,
  inlineFileSchema,
  MAX_UPLOAD_FILES,
  mintUploadSlot,
  resolveUploadSource,
  uploadSlotRequestSchema,
  type InlineFile,
  type UploadSlotRequest,
  type UploadSource,
} from '@chrischall/mcp-utils/export';
import { apiPath, textContent, flattenJsonApi, pruneUndefined, frameScoped, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';
import { confirmTokenParam, confirmUploadSource, framePath } from './_confirm.js';
import { s3Upload, type S3Credentials } from '../s3-upload.js';
import { explainUploadRefusal, uploadRoots } from '../upload-guard.js';
import { CHANGE, familyMeta } from './hints.js';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic',
  gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime',
};

/** Every type the photo tools accept, on every route (magic bytes checked on each). */
const ALLOWED_MIME = [...new Set(Object.values(MIME))];

/** The extension Skylight is told for a type, when the filename has no matching one. */
const EXT_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME).filter(([ext]) => ext !== 'jpeg').map(([ext, mime]) => [mime, ext]),
);

/**
 * The photo path buffers the whole file for the S3 PUT, so it is capped — on
 * the path and blob routes alike. (An inline file rides inside one JSON-RPC
 * request, which mcp-host caps at ~9.9 MiB, so in practice inline is for small
 * files only.)
 */
const MAX_PHOTO_BYTES = 200 * 1024 * 1024;

const SLOT_TOOL = 'skylight_upload_slots';

/** Parameter names, so the shared refusals speak this server's spelling. */
const NAMES = { path: 'image_path', inline: 'image_inline', blobKey: 'image_blob_key', slotTool: SLOT_TOOL };

interface PhotoSourceArgs {
  image_path?: string;
  image_inline?: InlineFile;
  image_blob_key?: string;
}

/**
 * The caller's photo, from exactly one of `image_path` (a local file inside
 * the upload directories — refused on a hosted deployment), `image_inline`
 * (base64) or `image_blob_key` (a file PUT to a {@link SLOT_TOOL} slot). Every
 * route ends at the same allowlist and magic-byte check.
 */
async function resolvePhoto(args: PhotoSourceArgs): Promise<UploadSource> {
  const roots = uploadRoots();
  try {
    return await resolveUploadSource(
      { path: args.image_path, inline: args.image_inline, blobKey: args.image_blob_key },
      {
        maxBytes: MAX_PHOTO_BYTES,
        allowedMimeTypes: ALLOWED_MIME,
        path: { mimeByExt: MIME, allowedRoots: roots, denyHiddenSegments: true },
        names: NAMES,
      },
    );
  } catch (err) {
    return explainUploadRefusal(err, roots);
  }
}

/** The extension to register: the filename's own when it names this type, else the type's canonical one. */
function extFor(src: UploadSource): string {
  const dot = src.fileName.lastIndexOf('.');
  const ext = dot > 0 ? src.fileName.slice(dot + 1).toLowerCase() : '';
  return MIME[ext] === src.mimeType ? ext : EXT_BY_MIME[src.mimeType]!;
}

/** Delete a used blob-store upload and say so; nothing to report for path/inline. */
async function releaseBlob(src: UploadSource): Promise<Record<string, unknown> | undefined> {
  if (src.origin !== 'blob') return undefined;
  return { key: src.blobKey, ...(await src.release()) };
}

const SOURCE_PARAMS = {
  image_path: z.string().optional().describe('LOCAL installs only: absolute path to an image/video file inside the upload directories (SKYLIGHT_UPLOAD_DIR; by default ~/Pictures and ~/Downloads) (jpg, jpeg, png, heic, gif, webp, mp4, mov; max 200 MiB). Anything else — a file outside those directories, a hidden file, a symlink, or a file whose contents do not match its extension — is refused. Refused on a hosted deployment (the claude.ai connector): use image_blob_key there.'),
  image_inline: inlineFileSchema.optional().describe('The file itself as base64: {filename, contentBase64, mimeType?}. Small files only — the whole file rides inside one tool call (a hosted deployment caps a request at about 9.9 MiB). Same types as image_path; the bytes must match the type.'),
  image_blob_key: z.string().optional().describe(`Hosted deployments: the blobKey from ${SLOT_TOOL}, after the file was PUT to its uploadUrl. Same types as image_path, max 200 MiB. The upload is deleted from the blob store once Skylight accepts it, and kept if the upload fails.`),
};

const SOURCE_NOTE = `Pass exactly ONE of image_path (a local file — local installs), image_blob_key (on the hosted connector: call ${SLOT_TOOL} first, PUT the file to the returned uploadUrl, then pass its blobKey) or image_inline (base64; small files only).`;

interface CloudCreds {
  credentials: S3Credentials;
  region: string;
  bucket: string;
  key_prefix: string;
}

/** Upload the caller's file to the frame's S3 bucket.
 *  Returns { bucket, key, etag, ext } so callers (register, event_importer) can reference it. */
async function uploadFile(
  c: { request: <T = unknown>(m: string, p: string, o?: { body?: unknown }) => Promise<T> },
  src: UploadSource,
): Promise<{ bucket: string; key: string; etag: string; ext: string }> {
  // Only ever bytes `resolveUploadSource` accepted on THIS (confirmed) call —
  // allowlisted type, contents matching it, under the cap, and (for a path)
  // inside the upload directories; the token bound their SHA-256.
  const body = Buffer.from(src.bytes);
  const ext = extFor(src);
  const contentType = src.mimeType;
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
  server.registerTool(
    SLOT_TOOL,
    {
      description: `Hosted deployments (the claude.ai connector): get signed upload URLs so skylight_upload_photo / skylight_import_events_from_photo can take a photo or video the server cannot read from your disk. For each file returns {blobKey, uploadUrl, curl, expiresAt}: PUT the file to uploadUrl with exactly the Content-Type shown (the curl does it), then call the photo tool with image_blob_key set to blobKey. Types: jpg, jpeg, png, heic, gif, webp, mp4, mov (max 200 MiB). Writes nothing to Skylight; each URL is a credential to write that one upload and expires in 30 minutes. Refused when this server has no blob store (a local install: pass image_path instead). Up to ${MAX_UPLOAD_FILES} files per call.`,
      inputSchema: z.object({
        files: z.array(uploadSlotRequestSchema).min(1).max(MAX_UPLOAD_FILES).describe('One entry per file to upload: {filename, mimeType?}. The filename (a bare name, no path) is what Skylight will see; its extension sets the type when mimeType is omitted.'),
      }),
      // Signs URLs locally: changes nothing on Skylight. The URLs it returns
      // point at mcp-host's blob store, which is why it is still open-world.
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: familyMeta('lookup', { aliases: ['upload url', 'photo upload'] }),
    },
    async ({ files }: { files: UploadSlotRequest[] }) => {
      const store = blobStoreFromEnv();
      if (!store) {
        throw new McpToolError(
          `${SLOT_TOOL} needs the blob store a hosted deployment provides, and this server has no blob store. `
          + 'Pass image_path (a local file) or image_inline (base64) to skylight_upload_photo / skylight_import_events_from_photo instead.',
          { kind: 'unknown' },
        );
      }
      const slots = files.map((req) => mintUploadSlot(store, req));
      for (const slot of slots) {
        if (!ALLOWED_MIME.includes(slot.mimeType)) {
          throw new McpToolError(
            `${slot.filename}: ${slot.mimeType} is not accepted here (accepted: ${ALLOWED_MIME.join(', ')}). Name the file with its real extension or pass mimeType.`,
            { kind: 'unknown' },
          );
        }
      }
      return textContent({
        slots,
        next: 'PUT each file to its uploadUrl with exactly its Content-Type (run the curl, replacing the <path to …> placeholder), then call skylight_upload_photo or skylight_import_events_from_photo with image_blob_key set to that slot\'s blobKey.',
      });
    },
  );

  const uploadPhoto = frameScoped(getClient, async (c, f, { src, caption, frame_ids }: { src: UploadSource; caption?: string; frame_ids?: Array<string | number>; frameId?: string }) => {
    const { bucket, key, etag, ext } = await uploadFile(c, src);
    const frames = frame_ids && frame_ids.length ? frame_ids : [f];
    // Register returns `{ data: { message_ids: [...] } }`; the photo then transcodes
    // server-side (status "processing") before it shows on the frame.
    const doc = await c.request<{ data?: { message_ids?: Array<string | number> } }>('POST', '/messages/uploads', {
      body: pruneUndefined({ file_upload: { bucket, key, etag }, frame_ids: frames, caption, ext }),
    });
    // Only now — Skylight has the photo — is the blob-store upload deleted.
    const blob = await releaseBlob(src);
    return textContent({ message_ids: doc.data?.message_ids ?? [], key, frame_ids: frames, status: 'processing', blob });
  });

  server.registerTool(
    'skylight_upload_photo',
    {
      description: `Upload a photo or video to the Skylight frame (it appears in the slideshow). ${SOURCE_NOTE} Two-step: signs an S3 upload with temporary credentials, then registers it as a frame message. Asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token (and the same file) proceeds (see MCP_CONFIRM_MODE). The preview names the file (absolute image_path, or filename and image_blob_key), detected mime, size, SHA-256 and caption; nothing is uploaded until it is confirmed, and a file that changed in between is refused. A blob-store upload is deleted once Skylight accepts the photo (reported as blob.deleted) and kept if the upload fails.`,
      inputSchema: z.object({
        ...SOURCE_PARAMS,
        caption: z.string().optional().describe('Caption shown with the photo.'),
        frame_ids: idArrayParam.optional().describe('Frame ids to post to; defaults to the resolved frame.'),
        frameId: z.string().optional(),
        confirmToken: confirmTokenParam,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      _meta: familyMeta('send', { aliases: ['photo', 'picture', 'frame'] }),
    },
    async (args: PhotoSourceArgs & { caption?: string; frame_ids?: Array<string | number>; frameId?: string; confirmToken?: string }, ctx: ServerContext) => {
      const src = await resolvePhoto(args);
      const gate = await confirmUploadSource(ctx, src, {
        tool: 'skylight_upload_photo',
        action: 'photo.upload',
        summary: 'Upload a file to the Skylight frame (S3)',
        absolutePath: args.image_path === undefined ? undefined : expandPath(args.image_path),
        method: 'POST',
        path: '/messages/uploads',
        extra: pruneUndefined({ caption: args.caption, frame_ids: args.frame_ids, frameId: args.frameId }),
        confirmToken: args.confirmToken,
      });
      if (gate) return gate;
      return uploadPhoto({ ...args, src }, ctx);
    },
  );

  const importEvents = frameScoped(getClient, async (c, f, { src, category_ids }: { src: UploadSource; category_ids?: Array<string | number>; frameId?: string }) => {
    const { ext } = await uploadFile(c, src);
    // NOTE: the event_importer intent references the just-uploaded photo (created_via app_photo_picker);
    // the exact server-side linkage to the upload is inferred from captured traffic.
    const doc = await c.request<JsonApiDoc>('POST', apiPath`/frames/${f}/auto_creation_intents`, {
      body: pruneUndefined({ ext, engine: 'event_importer', category_ids, created_via: 'app_photo_picker' }),
    });
    const blob = await releaseBlob(src);
    return textContent({ ...(flattenJsonApi(doc) as Record<string, unknown>), blob });
  });

  server.registerTool(
    'skylight_import_events_from_photo',
    {
      description: `Import calendar events from a photo of a flyer/invite/schedule using Skylight's AI (event_importer). ${SOURCE_NOTE} Best-effort/UNVERIFIED: uploads the photo to S3 then posts an event_importer intent that references the latest upload (the server-side photo↔intent link is inferred from captured traffic, not confirmed). Asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token (and the same file) proceeds (see MCP_CONFIRM_MODE). The preview names the file, detected mime, size and SHA-256; nothing is uploaded until it is confirmed. A blob-store upload is deleted once the intent is created (reported as blob.deleted) and kept if it fails. Poll skylight_get_auto_creation_intent / skylight_list_auto_creation_drafts, then skylight_approve_auto_creation.`,
      inputSchema: z.object({
        ...SOURCE_PARAMS,
        category_ids: idArrayParam.optional().describe('Family-member category ids to assign the imported events to.'),
        frameId: z.string().optional(),
        confirmToken: confirmTokenParam,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      _meta: CHANGE,
    },
    async (args: PhotoSourceArgs & { category_ids?: Array<string | number>; frameId?: string; confirmToken?: string }, ctx: ServerContext) => {
      const src = await resolvePhoto(args);
      const gate = await confirmUploadSource(ctx, src, {
        tool: 'skylight_import_events_from_photo',
        action: 'photo.import_events',
        summary: 'Upload a photo to the Skylight frame (S3) and start an event_importer intent',
        absolutePath: args.image_path === undefined ? undefined : expandPath(args.image_path),
        method: 'POST',
        path: `${framePath(args.frameId)}/auto_creation_intents`,
        extra: pruneUndefined({ category_ids: args.category_ids }),
        confirmToken: args.confirmToken,
      });
      if (gate) return gate;
      return importEvents({ ...args, src }, ctx);
    },
  );
}
