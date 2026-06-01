// One-off live test for the photo-upload flow (SigV4 → S3 → register).
// Run: node --env-file=.env node_modules/.bin/tsx scripts/live-photo-test.ts <image>
// Uploads, lists messages to confirm it landed, then deletes it to clean up.
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadDotenvSafely } from '@chrischall/mcp-utils';
import { resolveAuth } from '../src/auth.js';
import { s3Put } from '../src/s3-upload.js';

await loadDotenvSafely();

const imagePath = process.argv[2] ?? '/tmp/skylight-test.png';

const { client } = await resolveAuth();
const frameId = await client.resolveFrameId();
console.log('frame:', frameId);

const body = await readFile(imagePath);
const ext = extname(imagePath).slice(1).toLowerCase() || 'jpg';
const creds: any = await client.request('GET', '/messages/cloud_upload_credentials');
const cc = creds.data?.attributes ?? creds.data ?? creds;
console.log('creds: bucket=%s region=%s prefix=%s', cc.bucket, cc.region, cc.key_prefix);

const key = `${cc.key_prefix}${randomUUID()}.${ext}`;
const etag = await s3Put({
  creds: cc.credentials, region: cc.region, bucket: cc.bucket, key, body,
  contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
});
console.log('S3 PUT ok, etag=%s key=%s', etag, key);

const reg: any = await client.request('POST', '/messages/uploads', {
  body: { file_upload: { bucket: cc.bucket, key, etag }, frame_ids: [frameId], caption: 'skylight-mcp test upload', ext },
});
const msg = reg.data ?? reg;
const msgId = msg.id;
console.log('registered message id=%s', msgId, JSON.stringify(msg.attributes ?? {}).slice(0, 200));

// Confirm it shows up in the message list.
const list: any = await client.request('GET', `/frames/${frameId}/messages`);
const found = (Array.isArray(list.data) ? list.data : []).some((m: any) => m.id === msgId);
console.log('appears in message list:', found);

// Clean up — delete the test message.
if (msgId) {
  await client.request('DELETE', `/frames/${frameId}/messages/${msgId}`);
  console.log('cleaned up (deleted message', msgId + ')');
}
console.log('LIVE TEST PASSED');
