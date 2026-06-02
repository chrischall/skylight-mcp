// One-off live test for the photo-upload flow (SigV4 multipart → S3 → register).
// Run: npx tsx scripts/live-photo-test.ts <image>
// Uploads, polls the feed until the photo finishes processing, then deletes it.
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadDotenvSafely } from '@chrischall/mcp-utils';
import { resolveAuth } from '../src/auth.js';
import { s3Upload } from '../src/s3-upload.js';

await loadDotenvSafely();

const imagePath = process.argv[2] ?? '/tmp/sky-real.png';

const { client } = await resolveAuth();
const frameId = await client.resolveFrameId();
console.log('frame:', frameId);

const body = await readFile(imagePath);
const ext = extname(imagePath).slice(1).toLowerCase() || 'jpg';
const creds: any = await client.request('GET', '/messages/cloud_upload_credentials');
const cc = creds.data?.attributes ?? creds.data ?? creds;
console.log('creds: bucket=%s region=%s prefix=%s', cc.bucket, cc.region, cc.key_prefix);

const key = `${cc.key_prefix}${randomUUID()}.${ext}`;
const etag = await s3Upload({
  creds: cc.credentials, region: cc.region, bucket: cc.bucket, key, body,
  contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
});
console.log('S3 multipart upload complete, etag=%s key=%s', etag, key);

const reg: any = await client.request('POST', '/messages/uploads', {
  body: { file_upload: { bucket: cc.bucket, key, etag }, frame_ids: [frameId], caption: 'skylight-mcp test upload', ext },
});
const msgId = (reg.data ?? reg).message_ids?.[0];
console.log('registered message id=%s', msgId);

// Poll the feed (page_token pagination) until it leaves "processing".
let status = '';
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const list: any = await client.request('GET', `/frames/${frameId}/messages?page_token=__START__`);
  const m = (list.data ?? []).find((x: any) => String(x.id) === String(msgId));
  status = m?.attributes?.status ?? '(gone)';
  console.log(`  poll ${i}: status=${status}`);
  if (status !== 'processing') break;
}

// Clean up — a processed message is deletable; a stuck "processing" one is not.
if (msgId && status !== 'processing' && status !== '(gone)') {
  await client.request('DELETE', `/frames/${frameId}/messages/${msgId}`);
  console.log('cleaned up (deleted message', msgId + ')');
}
console.log(status !== 'processing' ? `LIVE TEST PASSED (status=${status})` : 'FAILED — stuck in processing');
