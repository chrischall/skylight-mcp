import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerPhotoTools } from '../../src/tools/photos.js';
import { makeClient } from './_setup.js';
import { readFile } from 'node:fs/promises';
import { s3Upload } from '../../src/s3-upload.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('../../src/s3-upload.js', () => ({ s3Upload: vi.fn() }));

const readFileMock = vi.mocked(readFile);
const s3UploadMock = vi.mocked(s3Upload);

const CREDS = {
  access_key_id: 'AKID', secret_access_key: 'secret', session_token: 'tok',
};
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

function harness() {
  const tools: Record<string, (a: any) => Promise<any>> = {};
  // Tools register with an optional annotations arg before the callback
  // (server.tool(name, desc, schema[, annotations], cb)); the handler is always last.
  const server = { tool: (name: string, ...rest: any[]) => { tools[name] = rest[rest.length - 1]; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerPhotoTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

beforeEach(() => {
  readFileMock.mockReset().mockResolvedValue(Buffer.from('imgbytes'));
  s3UploadMock.mockReset().mockResolvedValue('"etag-xyz"');
});

const UUID_RE = /^uploads\/10730517\/[0-9a-f-]{36}\.jpg$/;

describe('photo tools', () => {
  // ── confirm gate (dry-run) ──────────────────────────────────────────────

  it('upload_photo: without confirm, returns a dry-run preview and makes NO S3/network call', async () => {
    const { tools, request } = harness();
    const out = await tools.skylight_upload_photo({ image_path: '/tmp/secret.jpg', caption: 'Hi' });
    // No file read, no S3 upload, no API request happened.
    expect(readFileMock).not.toHaveBeenCalled();
    expect(s3UploadMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    const preview = JSON.parse(out.content[0].text);
    expect(preview.dryRun).toBe(true);
    expect(preview.willSend).toEqual({ image_path: '/tmp/secret.jpg', mime: 'image/jpeg' });
    expect(preview.note).toMatch(/confirm: true/);
  });

  it('import_events_from_photo: without confirm, returns a dry-run preview and makes NO S3/network call', async () => {
    const { tools, request } = harness();
    const out = await tools.skylight_import_events_from_photo({ image_path: '/tmp/flyer.png' });
    expect(readFileMock).not.toHaveBeenCalled();
    expect(s3UploadMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    const preview = JSON.parse(out.content[0].text);
    expect(preview.dryRun).toBe(true);
    expect(preview.willSend).toEqual({ image_path: '/tmp/flyer.png', mime: 'image/png' });
  });

  // ── skylight_upload_photo ───────────────────────────────────────────────

  it('upload_photo: reads file, signs S3 PUT, registers the upload (default frame)', async () => {
    const { tools, request } = harness();
    request
      .mockResolvedValueOnce(CREDS_DOC) // GET cloud_upload_credentials
      .mockResolvedValueOnce({ data: { message_ids: [1753265440] } }); // POST /messages/uploads

    const out = await tools.skylight_upload_photo({ image_path: '/tmp/pic.jpg', caption: 'Hi', confirm: true });

    expect(readFileMock).toHaveBeenCalledWith('/tmp/pic.jpg');
    expect(request).toHaveBeenNthCalledWith(1, 'GET', '/messages/cloud_upload_credentials');

    // s3Upload got the credentials, region, bucket, a uuid key, the bytes + mime.
    const putArgs = s3UploadMock.mock.calls[0][0];
    expect(putArgs.creds).toEqual(CREDS);
    expect(putArgs.region).toBe('us-east-1');
    expect(putArgs.bucket).toBe('prod-bucket');
    expect(putArgs.contentType).toBe('image/jpeg');
    expect(putArgs.key).toMatch(UUID_RE);

    // Register call references the same bucket/key/etag and defaults frame_ids.
    const [, path, opts] = request.mock.calls[1];
    expect(path).toBe('/messages/uploads');
    expect(opts.body).toEqual({
      file_upload: { bucket: 'prod-bucket', key: putArgs.key, etag: '"etag-xyz"' },
      frame_ids: ['3435252'], caption: 'Hi', ext: 'jpg',
    });
    expect(JSON.parse(out.content[0].text)).toEqual({
      message_ids: [1753265440], key: putArgs.key, frame_ids: ['3435252'], status: 'processing',
    });
  });

  it('upload_photo: honors explicit frame_ids and omits an absent caption', async () => {
    const { tools, request } = harness();
    request
      .mockResolvedValueOnce(CREDS_DOC)
      .mockResolvedValueOnce({ data: { id: '78', type: 'message', attributes: {} } });

    await tools.skylight_upload_photo({ image_path: '/tmp/pic.jpg', frame_ids: ['11', 22], confirm: true });

    const body = request.mock.calls[1][2].body;
    expect(body.frame_ids).toEqual(['11', 22]);
    expect('caption' in body).toBe(false);
  });

  it('upload_photo: derives the content type and ext from the file extension', async () => {
    const { tools, request } = harness();
    request
      .mockResolvedValueOnce(CREDS_DOC)
      .mockResolvedValueOnce({ data: { id: '1', type: 'message', attributes: {} } });

    await tools.skylight_upload_photo({ image_path: '/tmp/clip.MP4', confirm: true });

    expect(s3UploadMock.mock.calls[0][0].contentType).toBe('video/mp4');
    expect(s3UploadMock.mock.calls[0][0].key).toMatch(/\.mp4$/);
    expect(request.mock.calls[1][2].body.ext).toBe('mp4');
  });

  it('upload_photo: defaults an extensionless path to a jpg', async () => {
    const { tools, request } = harness();
    request
      .mockResolvedValueOnce(CREDS_DOC)
      .mockResolvedValueOnce({ data: { id: '1', type: 'message', attributes: {} } });

    await tools.skylight_upload_photo({ image_path: '/tmp/rawphoto', confirm: true });

    expect(s3UploadMock.mock.calls[0][0].contentType).toBe('image/jpeg');
    expect(request.mock.calls[1][2].body.ext).toBe('jpg');
  });

  it('upload_photo: uses octet-stream for an unrecognized extension', async () => {
    const { tools, request } = harness();
    request
      .mockResolvedValueOnce(CREDS_DOC)
      .mockResolvedValueOnce({ data: { id: '1', type: 'message', attributes: {} } });

    await tools.skylight_upload_photo({ image_path: '/tmp/scan.xyz', confirm: true });

    expect(s3UploadMock.mock.calls[0][0].contentType).toBe('application/octet-stream');
    expect(request.mock.calls[1][2].body.ext).toBe('xyz');
  });

  it('upload_photo: reads credentials from a JSON:API attributes wrapper too', async () => {
    const { tools, request } = harness();
    request
      .mockResolvedValueOnce(CREDS_DOC_WRAPPED)
      .mockResolvedValueOnce({ data: { id: '1', type: 'message', attributes: {} } });

    await tools.skylight_upload_photo({ image_path: '/tmp/pic.jpg', confirm: true });

    expect(s3UploadMock.mock.calls[0][0].bucket).toBe('wrapped-bucket');
    expect(s3UploadMock.mock.calls[0][0].key).toMatch(/^uploads\/7\//);
  });

  it('upload_photo: reads credentials from a flat (non-JSON:API) response too', async () => {
    const { tools, request } = harness();
    request
      .mockResolvedValueOnce({ credentials: CREDS, region: 'us-east-1', bucket: 'flat-bucket', key_prefix: 'uploads/9/' })
      .mockResolvedValueOnce({ data: { id: '1', type: 'message', attributes: {} } });

    await tools.skylight_upload_photo({ image_path: '/tmp/pic.jpg', confirm: true });

    expect(s3UploadMock.mock.calls[0][0].bucket).toBe('flat-bucket');
    expect(s3UploadMock.mock.calls[0][0].key).toMatch(/^uploads\/9\//);
  });

  it('upload_photo: throws a clear error when the credentials response shape is unexpected', async () => {
    const { tools, request } = harness();
    request.mockResolvedValueOnce({ data: {} }); // no credentials/bucket/key_prefix
    await expect(tools.skylight_upload_photo({ image_path: '/tmp/pic.jpg', confirm: true }))
      .rejects.toThrow(/Unexpected cloud_upload_credentials response shape/);
    expect(s3UploadMock).not.toHaveBeenCalled();
  });

  // ── skylight_import_events_from_photo ───────────────────────────────────

  it('import_events_from_photo: uploads then kicks off an event_importer intent', async () => {
    const { tools, request } = harness();
    request
      .mockResolvedValueOnce(CREDS_DOC)
      .mockResolvedValueOnce({ data: { id: 'intent1', type: 'auto_creation_intent', attributes: { status: 'pending' } } });

    const out = await tools.skylight_import_events_from_photo({ image_path: '/tmp/flyer.jpg', category_ids: ['5'], confirm: true });

    expect(s3UploadMock).toHaveBeenCalledOnce();
    expect(request).toHaveBeenNthCalledWith(2, 'POST', '/frames/3435252/auto_creation_intents', {
      body: { ext: 'jpg', engine: 'event_importer', category_ids: ['5'], created_via: 'app_photo_picker' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: 'intent1', type: 'auto_creation_intent', status: 'pending' });
  });

  it('import_events_from_photo: omits category_ids when not given and respects explicit frameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request
      .mockResolvedValueOnce(CREDS_DOC)
      .mockResolvedValueOnce({ data: { id: 'i2', type: 'auto_creation_intent', attributes: {} } });

    await tools.skylight_import_events_from_photo({ image_path: '/tmp/flyer.jpg', frameId: '99', confirm: true });

    expect(resolveFrameId).not.toHaveBeenCalled();
    const [, path, opts] = request.mock.calls[1];
    expect(path).toBe('/frames/99/auto_creation_intents');
    expect('category_ids' in opts.body).toBe(false);
  });
});
