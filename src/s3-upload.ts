// Minimal AWS Signature V4 multipart upload to S3, using temporary STS credentials.
// No AWS SDK dependency (keeps the esbuild bundle lean) — just node:crypto.
//
// Skylight's upload bucket requires a *multipart* upload: a single PutObject lands
// the bytes but never fires the S3 event that triggers server-side image processing,
// so the photo sticks in "processing" forever. CreateMultipartUpload → UploadPart →
// CompleteMultipartUpload is what processes. Two further quirks, both verified against
// the real app's traffic:
//   1. The bucket IAM policy only allows the object-create (s3:PutObject, which
//      CompleteMultipartUpload also requires) as a *conditional* write — the Complete
//      MUST carry a signed `If-None-Match: *` or it is denied.
//   2. ETags from S3 are quoted; the part list echoes them verbatim.
import { createHash, createHmac } from 'node:crypto';

import { truncateErrorMessage } from '@chrischall/mcp-utils';

export interface S3Credentials {
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
}

export interface S3UploadOptions {
  creds: S3Credentials;
  region: string;
  bucket: string;
  /** Object key, e.g. "uploads/123/abc.jpg" (slashes preserved in the canonical URI). */
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  /** Bytes per part (last part may be smaller). Defaults to 16 MiB. */
  partSize?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to new Date(). */
  now?: Date;
}

const DEFAULT_PART_SIZE = 16 * 1024 * 1024;
const SERVICE = 's3';

function sha256hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986 encoding for canonical query values (encodeURIComponent leaves !*'() ). */
function uriEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Build the `?a=b&c=d` query string (sorted, encoded) shared by the URL and the signature. */
function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params).sort().map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`).join('&');
}

interface SignArgs {
  method: string;
  host: string;
  region: string;
  canonicalUri: string;
  query: Record<string, string>;
  payloadHash: string;
  creds: S3Credentials;
  amzDate: string;
  /** Extra headers to sign (e.g. content-type, if-none-match). */
  extra?: Record<string, string>;
}

/** Sign a request and return the full header set (including Authorization). */
function sign(a: SignArgs): Record<string, string> {
  const dateStamp = a.amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: a.host,
    'x-amz-content-sha256': a.payloadHash,
    'x-amz-date': a.amzDate,
    'x-amz-security-token': a.creds.session_token,
    ...a.extra,
  };
  const signedKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const lower: Record<string, string> = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  const canonicalHeaders = signedKeys.map((k) => `${k}:${lower[k]}\n`).join('');
  const signedHeaders = signedKeys.join(';');

  const canonicalRequest = [
    a.method, a.canonicalUri, canonicalQuery(a.query), canonicalHeaders, signedHeaders, a.payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${a.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', a.amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + a.creds.secret_access_key, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, a.region), SERVICE), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    ...lower,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${a.creds.access_key_id}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function tagValue(xml: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml)?.[1];
}

/** Upload `body` to S3 via a multipart upload and return the final object ETag.
 *  Splits into ≥5 MiB parts (single part for small files). */
export async function s3Upload(opts: S3UploadOptions): Promise<string> {
  const { creds, region, bucket, key, body, contentType } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const partSize = opts.partSize ?? DEFAULT_PART_SIZE;
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const canonicalUri = '/' + key.split('/').map((s) => encodeURIComponent(s)).join('/');
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const url = (query: Record<string, string>) => `https://${host}${canonicalUri}?${canonicalQuery(query)}`;

  async function send(label: string, query: Record<string, string>, method: string, init: {
    payload: Buffer | Uint8Array | string; extra?: Record<string, string>;
  }): Promise<Response> {
    const headers = sign({ method, host, region, canonicalUri, query, payloadHash: sha256hex(init.payload), creds, amzDate, extra: init.extra });
    const res = await doFetch(url(query), { method, headers, body: init.payload as BodyInit });
    if (res.status < 200 || res.status >= 300) {
      // Redact before truncating — an S3 error body can echo an
      // x-amz-security-token (temporary STS credential) fragment.
      const body = truncateErrorMessage(await res.text().catch(() => ''), 300);
      throw new Error(`S3 ${label} failed (HTTP ${res.status}): ${body}`);
    }
    return res;
  }

  // 1. CreateMultipartUpload — POST /key?uploads
  const createXml = await (await send('create', { uploads: '' }, 'POST', { payload: '', extra: { 'content-type': contentType } })).text();
  const uploadId = tagValue(createXml, 'UploadId');
  if (!uploadId) throw new Error(`S3 create: no UploadId in response: ${createXml.slice(0, 200)}`);

  try {
    // 2. UploadPart for each chunk — PUT /key?partNumber=N&uploadId=…
    const parts: Array<{ PartNumber: number; ETag: string }> = [];
    const chunks = Math.max(1, Math.ceil(body.length / partSize));
    for (let i = 0; i < chunks; i++) {
      const partNumber = i + 1;
      const chunk = body.subarray(i * partSize, (i + 1) * partSize);
      const res = await send('upload-part', { partNumber: String(partNumber), uploadId }, 'PUT', { payload: chunk });
      const etag = res.headers.get('etag') ?? `"${createHash('md5').update(chunk).digest('hex')}"`;
      parts.push({ PartNumber: partNumber, ETag: etag });
    }

    // 3. CompleteMultipartUpload — POST /key?uploadId=… with the part list + signed If-None-Match:*
    const completeBody =
      '<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
      parts.map((p) => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`).join('') +
      '</CompleteMultipartUpload>';
    const completeXml = await (await send('complete', { uploadId }, 'POST', {
      payload: completeBody, extra: { 'content-type': 'application/xml', 'if-none-match': '*' },
    })).text();
    // S3 can return HTTP 200 with an <Error> body for CompleteMultipartUpload.
    if (completeXml.includes('<Error>')) throw new Error(`S3 complete returned an error: ${completeXml.slice(0, 300)}`);
    const etag = tagValue(completeXml, 'ETag');
    if (!etag) throw new Error(`S3 complete: no ETag in response: ${completeXml.slice(0, 200)}`);
    return etag;
  } catch (err) {
    // Best-effort abort so we don't leak an incomplete multipart upload.
    await send('abort', { uploadId }, 'DELETE', { payload: '' }).catch(() => undefined);
    throw err;
  }
}
