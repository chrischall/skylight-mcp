import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { s3Upload } from '../src/s3-upload.js';

const creds = {
  access_key_id: 'AKIDEXAMPLE',
  secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  session_token: 'FwoSESSIONTOKEN==',
};
const now = new Date('2026-06-01T12:34:56.789Z');

const UPLOAD_ID = 'aBc.123_uploadId-(x)'; // includes '(' ')' to exercise RFC3986 query encoding

function xml(tag: string, val: string) { return `<${tag}>${val}</${tag}>`; }

/** A fetch mock that plays the create → upload-part → complete sequence. */
function s3Mock(opts: { partEtag?: string | null; completeBody?: string; createBody?: string } = {}) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
  const impl = vi.fn(async (url: string, init: any) => {
    calls.push({ method: init.method, url, headers: init.headers, body: init.body });
    const u = new URL(url);
    if (init.method === 'POST' && u.searchParams.has('uploads')) {
      return { status: 200, headers: { get: () => null }, text: async () => opts.createBody ?? `<x>${xml('UploadId', UPLOAD_ID)}</x>` } as unknown as Response;
    }
    if (init.method === 'PUT') {
      return { status: 200, headers: { get: (k: string) => (k.toLowerCase() === 'etag' && opts.partEtag !== null ? (opts.partEtag ?? '"part-etag"') : null) }, text: async () => '' } as unknown as Response;
    }
    if (init.method === 'POST' && u.searchParams.has('uploadId')) {
      return { status: 200, headers: { get: () => null }, text: async () => opts.completeBody ?? `<x>${xml('ETag', '"final-etag-1"')}</x>` } as unknown as Response;
    }
    // DELETE (abort)
    return { status: 204, headers: { get: () => null }, text: async () => '' } as unknown as Response;
  });
  return { impl, calls };
}

describe('s3Upload (SigV4 multipart)', () => {
  it('runs create → upload-part → complete and returns the final ETag', async () => {
    const { impl, calls } = s3Mock();
    const body = Buffer.from('hello world');
    const etag = await s3Upload({ creds, region: 'us-east-1', bucket: 'my-bucket', key: 'uploads/10730517/file.jpg', body, contentType: 'image/jpeg', fetchImpl: impl, now });

    expect(etag).toBe('"final-etag-1"');
    expect(calls.map((c) => `${c.method} ${new URL(c.url).search}`)).toEqual([
      'POST ?uploads=',
      'PUT ?partNumber=1&uploadId=aBc.123_uploadId-%28x%29',
      'POST ?uploadId=aBc.123_uploadId-%28x%29',
    ]);
    // all three go to the virtual-hosted bucket URL with the encoded key path
    expect(new URL(calls[0].url).origin + new URL(calls[0].url).pathname)
      .toBe('https://my-bucket.s3.us-east-1.amazonaws.com/uploads/10730517/file.jpg');
  });

  it('signs create with content-type, and complete with content-type + if-none-match:*', async () => {
    const { impl, calls } = s3Mock();
    await s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body: Buffer.from('x'), contentType: 'image/jpeg', fetchImpl: impl, now });

    const create = calls[0].headers as Record<string, string>;
    expect(create['content-type']).toBe('image/jpeg');
    expect(create.Authorization).toMatch(/SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token,/);

    const complete = calls[2].headers as Record<string, string>;
    expect(complete['if-none-match']).toBe('*');
    expect(complete['content-type']).toBe('application/xml');
    expect(complete.Authorization).toMatch(/SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date;x-amz-security-token,/);
    // the complete body is the XML part list with the (quoted) part ETag
    expect(String(calls[2].body)).toBe('<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Part><PartNumber>1</PartNumber><ETag>"part-etag"</ETag></Part></CompleteMultipartUpload>');
  });

  it('splits a large body into ≥1 parts per partSize and lists them all on complete', async () => {
    const { impl, calls } = s3Mock();
    const body = Buffer.from('0123456789AB'); // 12 bytes
    await s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.bin', body, contentType: 'application/octet-stream', partSize: 5, fetchImpl: impl, now });
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.length).toBe(3); // 5 + 5 + 2
    expect(puts.map((p) => new URL(p.url).searchParams.get('partNumber'))).toEqual(['1', '2', '3']);
    // complete body references all three parts
    const completeBody = String(calls.find((c) => c.method === 'POST' && new URL(c.url).searchParams.has('uploadId'))!.body);
    expect((completeBody.match(/<Part>/g) ?? []).length).toBe(3);
  });

  it('falls back to a computed md5 part ETag when S3 omits the header', async () => {
    const { impl, calls } = s3Mock({ partEtag: null });
    const body = Buffer.from('chunk');
    await s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body, contentType: 'image/jpeg', fetchImpl: impl, now });
    const completeBody = String(calls[2].body);
    expect(completeBody).toContain(`<ETag>"${createHash('md5').update(body).digest('hex')}"</ETag>`);
  });

  it('throws (and aborts) when create returns no UploadId', async () => {
    const { impl, calls } = s3Mock({ createBody: '<x>nope</x>' });
    await expect(s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body: Buffer.from('x'), contentType: 'image/jpeg', fetchImpl: impl, now }))
      .rejects.toThrow(/no UploadId/);
    // no abort here — we never got an uploadId, so only the create call happened
    expect(calls.map((c) => c.method)).toEqual(['POST']);
  });

  it('throws and aborts the upload when complete returns a 200 <Error> body', async () => {
    const { impl, calls } = s3Mock({ completeBody: '<Error><Code>InternalError</Code></Error>' });
    await expect(s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body: Buffer.from('x'), contentType: 'image/jpeg', fetchImpl: impl, now }))
      .rejects.toThrow(/complete returned an error/);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true); // aborted
  });

  it('still surfaces the original error when the abort cleanup itself fails', async () => {
    let n = 0;
    const impl = vi.fn(async (_url: string, init: any) => {
      n++;
      if (init.method === 'POST' && _url.includes('uploads=')) return { status: 200, headers: { get: () => null }, text: async () => `<x>${xml('UploadId', 'u1')}</x>` } as unknown as Response;
      if (init.method === 'PUT') return { status: 200, headers: { get: () => '"e"' }, text: async () => '' } as unknown as Response;
      if (init.method === 'POST') return { status: 200, headers: { get: () => null }, text: async () => '<Error><Code>x</Code></Error>' } as unknown as Response;
      throw new Error('network down during abort'); // DELETE (abort) fails
    });
    await expect(s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body: Buffer.from('x'), contentType: 'image/jpeg', fetchImpl: impl, now }))
      .rejects.toThrow(/complete returned an error/);
    expect(n).toBe(4); // create, part, complete, abort(failed)
  });

  it('throws when complete returns no ETag', async () => {
    const { impl } = s3Mock({ completeBody: '<x>done</x>' });
    await expect(s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body: Buffer.from('x'), contentType: 'image/jpeg', fetchImpl: impl, now }))
      .rejects.toThrow(/no ETag/);
  });

  it('throws with the response text on a non-2xx S3 status', async () => {
    const impl = vi.fn().mockResolvedValue({ status: 403, headers: { get: () => null }, text: async () => '<Error>AccessDenied</Error>' } as unknown as Response);
    await expect(s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body: Buffer.from('x'), contentType: 'image/jpeg', fetchImpl: impl, now }))
      .rejects.toThrow(/S3 create failed \(HTTP 403\): <Error>AccessDenied<\/Error>/);
  });

  it('tolerates an unreadable error body on a failed request', async () => {
    const impl = vi.fn().mockResolvedValue({ status: 500, headers: { get: () => null }, text: async () => { throw new Error('closed'); } } as unknown as Response);
    await expect(s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body: Buffer.from('x'), contentType: 'image/jpeg', fetchImpl: impl, now }))
      .rejects.toThrow(/S3 create failed \(HTTP 500\): $/);
  });

  it('defaults to the global fetch and new Date() when not injected', async () => {
    const { impl } = s3Mock();
    vi.stubGlobal('fetch', impl);
    try {
      const etag = await s3Upload({ creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body: Buffer.from('x'), contentType: 'image/jpeg' });
      expect(etag).toBe('"final-etag-1"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
