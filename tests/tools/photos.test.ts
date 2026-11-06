import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerPhotoTools } from '../../src/tools/photos.js';
import { makeClient, NO_ELICIT_CTX, confirmed, phaseOne } from './_setup.js';
import { s3Upload } from '../../src/s3-upload.js';

vi.mock('../../src/s3-upload.js', () => ({ s3Upload: vi.fn() }));

const s3UploadMock = vi.mocked(s3Upload);

// Synthetic file heads: just enough bytes for the magic-number check.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const JPEG2 = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(4), Buffer.from('isommp42')]);
const b64 = (b: Buffer) => b.toString('base64');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const MAX = 200 * 1024 * 1024;

const CREDS = { access_key_id: 'AKID', secret_access_key: 'secret', session_token: 'tok' };
// Real live shape: the fields sit directly on `data` (no JSON:API `attributes`).
const CREDS_DOC = {
  data: { credentials: CREDS, region: 'us-east-1', bucket: 'prod-bucket', key_prefix: 'uploads/10730517/' },
};
// Tolerated alternate shape: a JSON:API `attributes` wrapper.
const CREDS_DOC_WRAPPED = {
  data: { id: '1', type: 'cloud_upload_credential', attributes: {
    credentials: CREDS, region: 'us-east-1', bucket: 'wrapped-bucket', key_prefix: 'uploads/7/',
  } },
};
const INTENT_DOC = { data: { id: 'intent1', type: 'auto_creation_intent', attributes: { status: 'pending' } } };

type Tools = Record<string, (a: any) => Promise<any>>;

function harness() {
  const tools: Tools = {};
  // Minimal `registerTool(name, config, handler)` stand-in: this harness only
  // needs the handler. `tool-annotations.test.ts` reads the config.
  const server = { registerTool: (name: string, _cfg: any, cb: any) => { tools[name] = (a: any) => cb(a, NO_ELICIT_CTX); } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerPhotoTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

/** Queue the two API answers a successful upload/import needs. */
function answers(request: ReturnType<typeof makeClient>['request'], tool: string) {
  request
    .mockResolvedValueOnce(CREDS_DOC)
    .mockResolvedValueOnce(tool === 'skylight_upload_photo' ? { data: { message_ids: [1753265440] } } : INTENT_DOC);
}

// ── local upload directory (real files) ───────────────────────────────────
let root: string;

function file(name: string, bytes: Buffer): string {
  const p = join(root, name);
  writeFileSync(p, bytes);
  return p;
}

// ── fake mcp-host blob store behind a stubbed fetch ───────────────────────
const BLOB_BASE = 'https://blob.example.test/b/reg_0123456789abcdef01234567';
interface Blob { bytes: Buffer; type: string; length?: string }
let blobs: Map<string, Blob>;
let blobCalls: Array<{ method: string; key: string }>;
let deleteStatus: number;

function enableBlobStore() {
  vi.stubEnv('MCP_BLOB_BASE_URL', BLOB_BASE);
  vi.stubEnv('MCP_BLOB_SIGNING_KEY', 'dGVzdC1zaWduaW5nLWtleQ');
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const key = u.pathname.replace('/b/reg_0123456789abcdef01234567/', '').split('/').map(decodeURIComponent).join('/');
    const method = init?.method ?? 'GET';
    blobCalls.push({ method, key });
    if (method === 'DELETE') {
      if (deleteStatus !== 204) return new Response(null, { status: deleteStatus });
      blobs.delete(key);
      return new Response(null, { status: 204 });
    }
    const obj = blobs.get(key);
    if (!obj) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(obj.bytes), { headers: { 'content-type': obj.type, ...(obj.length ? { 'content-length': obj.length } : {}) } });
  }));
}

/** Mint a slot through the tool (as a hosted caller would), then "PUT" the bytes to it. */
async function putViaSlot(tools: Tools, filename: string, bytes: Buffer, type = 'image/jpeg', length?: string): Promise<string> {
  const out = JSON.parse((await tools.skylight_upload_slots({ files: [{ filename }] })).content[0].text);
  const key = out.slots[0].blobKey as string;
  blobs.set(key, { bytes, type, ...(length ? { length } : {}) });
  return key;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'skylight-photos-')));
  vi.stubEnv('SKYLIGHT_UPLOAD_DIR', root);
  // A local install: no data dir, no blob store (readEnvVar treats '' as unset).
  vi.stubEnv('MCP_DATA_DIR', '');
  vi.stubEnv('MCP_BLOB_BASE_URL', '');
  vi.stubEnv('MCP_BLOB_SIGNING_KEY', '');
  blobs = new Map();
  blobCalls = [];
  deleteStatus = 204;
  s3UploadMock.mockReset().mockResolvedValue('"etag-xyz"');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

const UUID_RE = /^uploads\/10730517\/[0-9a-f-]{36}\.jpg$/;
const BOTH = ['skylight_upload_photo', 'skylight_import_events_from_photo'] as const;

describe('photo tools — local path (unchanged behaviour)', () => {
  it('upload_photo: phase 1 previews the absolute path, mime, size and sha256 and makes NO S3/API call', async () => {
    const { tools, request } = harness();
    const p = file('pic.jpg', JPEG);
    const out = phaseOne(await tools.skylight_upload_photo({ image_path: p, caption: 'Hi' }));
    expect(s3UploadMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(out.status).toBe('confirmation-required');
    expect(out.confirmToken).toEqual(expect.any(String));
    expect(out.preview.willSend).toEqual({
      caption: 'Hi', source: 'path', image_path: p, mime: 'image/jpeg', bytes: JPEG.length, sha256: sha(JPEG),
    });
  });

  it('import_events_from_photo: phase 1 previews and makes NO S3/API call', async () => {
    const { tools, request } = harness();
    const p = file('flyer.png', PNG);
    const out = phaseOne(await tools.skylight_import_events_from_photo({ image_path: p }));
    expect(s3UploadMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(out.preview.willSend).toEqual({ source: 'path', image_path: p, mime: 'image/png', bytes: PNG.length, sha256: sha(PNG) });
  });

  it('upload_photo: reads the file, signs the S3 PUT, registers the upload (default frame)', async () => {
    const { tools, request } = harness();
    answers(request, 'skylight_upload_photo');
    const out = await confirmed(tools.skylight_upload_photo, { image_path: file('pic.jpg', JPEG), caption: 'Hi' });

    expect(request).toHaveBeenNthCalledWith(1, 'GET', '/messages/cloud_upload_credentials');
    const putArgs = s3UploadMock.mock.calls[0][0];
    expect(putArgs.creds).toEqual(CREDS);
    expect(putArgs.region).toBe('us-east-1');
    expect(putArgs.bucket).toBe('prod-bucket');
    expect(putArgs.contentType).toBe('image/jpeg');
    expect(putArgs.key).toMatch(UUID_RE);
    expect(Buffer.from(putArgs.body)).toEqual(JPEG);

    const [, path, opts] = request.mock.calls[1];
    expect(path).toBe('/messages/uploads');
    expect(opts.body).toEqual({
      file_upload: { bucket: 'prod-bucket', key: putArgs.key, etag: '"etag-xyz"' },
      frame_ids: ['3435252'], caption: 'Hi', ext: 'jpg',
    });
    // No blob was involved, so nothing about one is reported.
    expect(JSON.parse(out.content[0].text)).toEqual({
      message_ids: [1753265440], key: putArgs.key, frame_ids: ['3435252'], status: 'processing',
    });
  });

  it('upload_photo: honors explicit frame_ids and omits an absent caption', async () => {
    const { tools, request } = harness();
    request.mockResolvedValueOnce(CREDS_DOC).mockResolvedValueOnce({ data: { id: '78', type: 'message', attributes: {} } });
    const out = await confirmed(tools.skylight_upload_photo, { image_path: file('pic.jpg', JPEG), frame_ids: ['11', 22] });
    const body = request.mock.calls[1][2].body;
    expect(body.frame_ids).toEqual(['11', 22]);
    expect('caption' in body).toBe(false);
    expect(JSON.parse(out.content[0].text).message_ids).toEqual([]);
  });

  it('upload_photo: keeps the file extension for the content type and ext (case-insensitive)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValueOnce(CREDS_DOC).mockResolvedValueOnce({ data: {} });
    await confirmed(tools.skylight_upload_photo, { image_path: file('clip.MP4', MP4) });
    expect(s3UploadMock.mock.calls[0][0].contentType).toBe('video/mp4');
    expect(s3UploadMock.mock.calls[0][0].key).toMatch(/\.mp4$/);
    expect(request.mock.calls[1][2].body.ext).toBe('mp4');
  });

  it('upload_photo: a .jpeg file keeps ext "jpeg"', async () => {
    const { tools, request } = harness();
    request.mockResolvedValueOnce(CREDS_DOC).mockResolvedValueOnce({ data: {} });
    await confirmed(tools.skylight_upload_photo, { image_path: file('pic.jpeg', JPEG) });
    expect(request.mock.calls[1][2].body.ext).toBe('jpeg');
  });

  it.each(BOTH)('%s: a file changed between preview and confirm is DRAFT_CHANGED and uploads nothing', async (tool) => {
    const { tools, request } = harness();
    const p = file('pic.jpg', JPEG);
    const { confirmToken } = phaseOne(await tools[tool]!({ image_path: p }));
    writeFileSync(p, JPEG2);
    const out = await tools[tool]!({ image_path: p, confirmToken });
    expect(JSON.parse(out.content[0].text).error).toBe('DRAFT_CHANGED');
    expect(s3UploadMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(BOTH)('%s: refuses a path outside the upload directories, naming them', async (tool) => {
    const { tools, request } = harness();
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'skylight-elsewhere-')));
    try {
      writeFileSync(join(elsewhere, 'pic.jpg'), JPEG);
      await expect(tools[tool]!({ image_path: join(elsewhere, 'pic.jpg') }))
        .rejects.toThrow(new RegExp(`outside the upload directories.*Uploads may only come from: ${root}`));
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it.each(BOTH)('%s: refuses a type off the allowlist, a hidden file and a mismatched head', async (tool) => {
    const { tools } = harness();
    await expect(tools[tool]!({ image_path: file('notes.txt', Buffer.from('hello')) })).rejects.toThrow();
    mkdirSync(join(root, '.secret'));
    await expect(tools[tool]!({ image_path: file('.secret/pic.jpg', JPEG) })).rejects.toThrow();
    await expect(tools[tool]!({ image_path: file('fake.jpg', Buffer.from('not an image at all')) })).rejects.toThrow();
    expect(s3UploadMock).not.toHaveBeenCalled();
  });

  it('upload_photo: reads credentials from a JSON:API attributes wrapper too', async () => {
    const { tools, request } = harness();
    request.mockResolvedValueOnce(CREDS_DOC_WRAPPED).mockResolvedValueOnce({ data: {} });
    await confirmed(tools.skylight_upload_photo, { image_path: file('pic.jpg', JPEG) });
    expect(s3UploadMock.mock.calls[0][0].bucket).toBe('wrapped-bucket');
    expect(s3UploadMock.mock.calls[0][0].key).toMatch(/^uploads\/7\//);
  });

  it('upload_photo: reads credentials from a flat (non-JSON:API) response too', async () => {
    const { tools, request } = harness();
    request
      .mockResolvedValueOnce({ credentials: CREDS, region: 'us-east-1', bucket: 'flat-bucket', key_prefix: 'uploads/9/' })
      .mockResolvedValueOnce({ data: {} });
    await confirmed(tools.skylight_upload_photo, { image_path: file('pic.jpg', JPEG) });
    expect(s3UploadMock.mock.calls[0][0].bucket).toBe('flat-bucket');
  });

  it('upload_photo: throws a clear error when the credentials response shape is unexpected', async () => {
    const { tools, request } = harness();
    request.mockResolvedValueOnce({ data: {} });
    await expect(confirmed(tools.skylight_upload_photo, { image_path: file('pic.jpg', JPEG) }))
      .rejects.toThrow(/Unexpected cloud_upload_credentials response shape/);
    expect(s3UploadMock).not.toHaveBeenCalled();
  });

  it('import_events_from_photo: uploads then kicks off an event_importer intent', async () => {
    const { tools, request } = harness();
    answers(request, 'skylight_import_events_from_photo');
    const out = await confirmed(tools.skylight_import_events_from_photo, { image_path: file('flyer.jpg', JPEG), category_ids: ['5'] });
    expect(s3UploadMock).toHaveBeenCalledOnce();
    expect(request).toHaveBeenNthCalledWith(2, 'POST', '/frames/3435252/auto_creation_intents', {
      body: { ext: 'jpg', engine: 'event_importer', category_ids: ['5'], created_via: 'app_photo_picker' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: 'intent1', type: 'auto_creation_intent', status: 'pending' });
  });

  it('import_events_from_photo: omits category_ids when not given and respects explicit frameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValueOnce(CREDS_DOC).mockResolvedValueOnce({ data: { id: 'i2', type: 'auto_creation_intent', attributes: {} } });
    await confirmed(tools.skylight_import_events_from_photo, { image_path: file('flyer.jpg', JPEG), frameId: '99' });
    expect(resolveFrameId).not.toHaveBeenCalled();
    const [, path, opts] = request.mock.calls[1];
    expect(path).toBe('/frames/99/auto_creation_intents');
    expect('category_ids' in opts.body).toBe(false);
  });
});

describe('photo tools — exactly one source', () => {
  it.each(BOTH)('%s: refuses no source and two sources, naming the three parameters', async (tool) => {
    const { tools, request } = harness();
    const one = /exactly one of image_path, image_inline or image_blob_key/;
    await expect(tools[tool]!({})).rejects.toThrow(one);
    await expect(tools[tool]!({
      image_path: file('pic.jpg', JPEG), image_inline: { filename: 'pic.jpg', contentBase64: b64(JPEG) },
    })).rejects.toThrow(one);
    expect(request).not.toHaveBeenCalled();
    expect(s3UploadMock).not.toHaveBeenCalled();
  });
});

describe('photo tools — inline base64', () => {
  it.each(BOTH)('%s: previews, then uploads the decoded bytes', async (tool) => {
    const { tools, request } = harness();
    const args = { image_inline: { filename: 'beach day.jpg', contentBase64: b64(JPEG) } };
    const preview = phaseOne(await tools[tool]!(args));
    expect(preview.preview.willSend).toMatchObject({ source: 'inline', filename: 'beach day.jpg', mime: 'image/jpeg', bytes: JPEG.length, sha256: sha(JPEG) });
    expect(s3UploadMock).not.toHaveBeenCalled();

    answers(request, tool);
    const out = await tools[tool]!({ ...args, confirmToken: preview.confirmToken });
    expect(out.isError).toBeFalsy();
    const put = s3UploadMock.mock.calls[0][0];
    expect(Buffer.from(put.body)).toEqual(JPEG);
    expect(put.contentType).toBe('image/jpeg');
    expect(put.key).toMatch(UUID_RE);
    expect(request.mock.calls[1][2].body.ext).toBe('jpg');
    expect(JSON.parse(out.content[0].text).blob).toBeUndefined();
  });

  it('upload_photo: an extensionless name takes its ext from the declared mimeType', async () => {
    const { tools, request } = harness();
    answers(request, 'skylight_upload_photo');
    await confirmed(tools.skylight_upload_photo, { image_inline: { filename: 'IMG_0001', contentBase64: b64(PNG), mimeType: 'image/png' } });
    expect(s3UploadMock.mock.calls[0][0].key).toMatch(/\.png$/);
    expect(request.mock.calls[1][2].body.ext).toBe('png');
  });

  it.each(BOTH)('%s: refuses bad base64', async (tool) => {
    const { tools } = harness();
    await expect(tools[tool]!({ image_inline: { filename: 'pic.jpg', contentBase64: '/9j/4AAQ!!' } }))
      .rejects.toThrow(/not valid base64/);
    expect(s3UploadMock).not.toHaveBeenCalled();
  });

  it.each(BOTH)('%s: refuses a type that is not a photo/video, and bytes that do not match the type', async (tool) => {
    const { tools } = harness();
    await expect(tools[tool]!({ image_inline: { filename: 'notes.txt', contentBase64: b64(Buffer.from('hello')) } }))
      .rejects.toThrow(/text\/plain is not accepted here/);
    await expect(tools[tool]!({ image_inline: { filename: 'pic.jpg', contentBase64: b64(PNG) } }))
      .rejects.toThrow(/do not look like image\/jpeg/);
    expect(s3UploadMock).not.toHaveBeenCalled();
  });

  it.each(BOTH)('%s: refuses a file over the 200 MiB cap before decoding it', async (tool) => {
    const { tools } = harness();
    const tooBig = 'A'.repeat(Math.ceil((MAX + 3) / 3) * 4);
    await expect(tools[tool]!({ image_inline: { filename: 'big.jpg', contentBase64: tooBig } }))
      .rejects.toThrow(/too large.*200 MiB/);
    expect(s3UploadMock).not.toHaveBeenCalled();
  });
});

describe('skylight_upload_slots', () => {
  it('mints one signed PUT slot per file when the deployment has a blob store', async () => {
    enableBlobStore();
    const { tools, request } = harness();
    const out = JSON.parse((await tools.skylight_upload_slots({
      files: [{ filename: 'beach day.jpg' }, { filename: 'clip.mov' }],
    })).content[0].text);
    expect(out.slots).toHaveLength(2);
    expect(out.slots[0]).toMatchObject({ filename: 'beach day.jpg', mimeType: 'image/jpeg', method: 'PUT' });
    expect(out.slots[0].blobKey).toMatch(/^uploads\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+$/);
    expect(out.slots[0].uploadUrl.startsWith(`${BLOB_BASE}/uploads/`)).toBe(true);
    expect(out.slots[0].curl).toContain("Content-Type: image/jpeg");
    expect(out.slots[1].mimeType).toBe('video/quicktime');
    expect(out.next).toMatch(/image_blob_key/);
    // Minting is signing: nothing reaches Skylight or the store.
    expect(request).not.toHaveBeenCalled();
    expect(blobCalls).toEqual([]);
  });

  it('refuses clearly when there is no blob store (a local install)', async () => {
    const { tools } = harness();
    await expect(tools.skylight_upload_slots({ files: [{ filename: 'pic.jpg' }] }))
      .rejects.toThrow(/no blob store.*image_path.*image_inline/s);
  });

  it('refuses a slot for a type the photo tools will not accept', async () => {
    enableBlobStore();
    const { tools } = harness();
    await expect(tools.skylight_upload_slots({ files: [{ filename: 'pic.jpg' }, { filename: 'report.pdf' }] }))
      .rejects.toThrow(/report\.pdf.*application\/pdf is not accepted/);
    await expect(tools.skylight_upload_slots({ files: [{ filename: 'IMG_0001' }] }))
      .rejects.toThrow(/application\/octet-stream is not accepted/);
  });
});

describe('photo tools — blob key (hosted upload slots)', () => {
  it.each(BOTH)('%s: previews from the blob, uploads it, then deletes it and reports the delete', async (tool) => {
    enableBlobStore();
    const { tools, request } = harness();
    const key = await putViaSlot(tools, 'beach day.jpg', JPEG);

    const preview = phaseOne(await tools[tool]!({ image_blob_key: key }));
    expect(preview.preview.willSend).toMatchObject({
      source: 'blob', image_blob_key: key, filename: 'beach day.jpg', mime: 'image/jpeg', bytes: JPEG.length, sha256: sha(JPEG),
    });
    // Reading never deletes: the preview only GETs.
    expect(blobCalls.map((c) => c.method)).toEqual(['GET']);

    answers(request, tool);
    const out = await tools[tool]!({ image_blob_key: key, confirmToken: preview.confirmToken });
    expect(Buffer.from(s3UploadMock.mock.calls[0][0].body)).toEqual(JPEG);
    expect(request).toHaveBeenCalledTimes(2);
    expect(blobCalls.map((c) => c.method)).toEqual(['GET', 'GET', 'DELETE']);
    expect(blobs.has(key)).toBe(false);
    expect(JSON.parse(out.content[0].text).blob).toEqual({ key, deleted: true });
  });

  it.each(BOTH)('%s: keeps the blob when Skylight refuses the upload', async (tool) => {
    enableBlobStore();
    const { tools, request } = harness();
    const key = await putViaSlot(tools, 'pic.jpg', JPEG);
    request.mockResolvedValueOnce(CREDS_DOC).mockRejectedValueOnce(new Error('Skylight 500'));
    await expect(confirmed(tools[tool]!, { image_blob_key: key })).rejects.toThrow(/Skylight 500/);
    expect(blobCalls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(blobs.has(key)).toBe(true);
  });

  it('upload_photo: keeps the blob when the S3 PUT fails', async () => {
    enableBlobStore();
    const { tools, request } = harness();
    const key = await putViaSlot(tools, 'pic.jpg', JPEG);
    request.mockResolvedValueOnce(CREDS_DOC);
    s3UploadMock.mockRejectedValueOnce(new Error('S3 403'));
    await expect(confirmed(tools.skylight_upload_photo, { image_blob_key: key })).rejects.toThrow(/S3 403/);
    expect(blobs.has(key)).toBe(true);
  });

  it('upload_photo: reports (does not throw) a failed delete after a successful upload', async () => {
    enableBlobStore();
    deleteStatus = 500;
    const { tools, request } = harness();
    const key = await putViaSlot(tools, 'pic.jpg', JPEG);
    answers(request, 'skylight_upload_photo');
    const out = await confirmed(tools.skylight_upload_photo, { image_blob_key: key });
    const blob = JSON.parse(out.content[0].text).blob;
    expect(blob).toMatchObject({ key, deleted: false });
    expect(blob.error).toMatch(/HTTP 500/);
  });

  it.each(BOTH)('%s: a blob changed after the preview is DRAFT_CHANGED and nothing is uploaded or deleted', async (tool) => {
    enableBlobStore();
    const { tools, request } = harness();
    const key = await putViaSlot(tools, 'pic.jpg', JPEG);
    const { confirmToken } = phaseOne(await tools[tool]!({ image_blob_key: key }));
    blobs.set(key, { bytes: JPEG2, type: 'image/jpeg' });
    const out = await tools[tool]!({ image_blob_key: key, confirmToken });
    expect(JSON.parse(out.content[0].text).error).toBe('DRAFT_CHANGED');
    expect(s3UploadMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(blobs.has(key)).toBe(true);
  });

  it.each(BOTH)('%s: refuses a key the slot tool did not mint, a missing blob, and a wrong-typed blob', async (tool) => {
    enableBlobStore();
    const { tools } = harness();
    await expect(tools[tool]!({ image_blob_key: 'exports/calendar.ics' })).rejects.toThrow(/not an upload key/);
    const missing = await putViaSlot(tools, 'gone.jpg', JPEG);
    blobs.delete(missing);
    await expect(tools[tool]!({ image_blob_key: missing })).rejects.toThrow(/not found/);
    const wrong = await putViaSlot(tools, 'pic.jpg', PNG);
    await expect(tools[tool]!({ image_blob_key: wrong })).rejects.toThrow(/do not look like image\/jpeg/);
    expect(s3UploadMock).not.toHaveBeenCalled();
  });

  it.each(BOTH)('%s: refuses a blob over the 200 MiB cap', async (tool) => {
    enableBlobStore();
    const { tools } = harness();
    const key = await putViaSlot(tools, 'huge.jpg', JPEG, 'image/jpeg', String(MAX + 1));
    await expect(tools[tool]!({ image_blob_key: key })).rejects.toThrow(/larger than the 209715200-byte limit/);
    expect(s3UploadMock).not.toHaveBeenCalled();
  });

  it.each(BOTH)('%s: refuses image_blob_key without a blob store', async (tool) => {
    const { tools } = harness();
    await expect(tools[tool]!({ image_blob_key: 'uploads/0b0c4b4e-3d1b-4b8e-9c63-0b8c3d0e5f11/cGljLmpwZw' }))
      .rejects.toThrow(/no blob store.*image_path or image_inline/);
  });
});

describe('photo tools — hosted deployment', () => {
  it.each(BOTH)('%s: refuses image_path and points to the slot tool or inline', async (tool) => {
    enableBlobStore();
    vi.stubEnv('MCP_DATA_DIR', root);
    const { tools, request } = harness();
    await expect(tools[tool]!({ image_path: file('pic.jpg', JPEG) }))
      .rejects.toThrow(/can't read files on your machine.*call skylight_upload_slots.*image_blob_key.*image_inline/);
    expect(request).not.toHaveBeenCalled();
  });

  it.each(BOTH)('%s: hosted without a blob store points to inline', async (tool) => {
    vi.stubEnv('MCP_DATA_DIR', root);
    const { tools } = harness();
    await expect(tools[tool]!({ image_path: file('pic.jpg', JPEG) }))
      .rejects.toThrow(/can't read files on your machine.*Pass the bytes with image_inline/);
  });
});
