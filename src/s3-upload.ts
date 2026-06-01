// Minimal AWS Signature V4 for a single S3 PUT, using temporary STS credentials.
// No AWS SDK dependency (keeps the esbuild bundle lean) — just node:crypto.
import { createHash, createHmac } from 'node:crypto';

export interface S3Credentials {
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
}

export interface S3PutOptions {
  creds: S3Credentials;
  region: string;
  bucket: string;
  /** Object key, e.g. "uploads/123/abc.jpg" (slashes preserved in the canonical URI). */
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to new Date(). */
  now?: Date;
}

function sha256hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** PUT `body` to S3 with a SigV4-signed request. Returns the object ETag. */
export async function s3Put(opts: S3PutOptions): Promise<string> {
  const { creds, region, bucket, key, body, contentType } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const service = 's3';
  const host = `${bucket}.s3.${region}.amazonaws.com`;

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

  // Canonical URI: encode each path segment, keep the slashes.
  const canonicalUri = '/' + key.split('/').map((s) => encodeURIComponent(s)).join('/');
  const payloadHash = sha256hex(body);

  const headers: Record<string, string> = {
    'content-type': contentType,
    host,
    // The bucket's IAM policy only allows PutObject as a conditional create-if-absent
    // write — the request MUST carry a signed `If-None-Match: *` or it is denied
    // ("no identity-based policy allows the s3:PutObject action"). Verified against
    // the real app's upload, which signs this header.
    'if-none-match': '*',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'x-amz-security-token': creds.session_token,
  };
  const signedKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedKeys.join(';');

  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + creds.secret_access_key, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.access_key_id}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await doFetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: { ...headers, Authorization: authorization },
    body: body as BodyInit,
  });
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text().catch(() => '');
    throw new Error(`S3 upload failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  return res.headers.get('etag') ?? `"${createHash('md5').update(body).digest('hex')}"`;
}
