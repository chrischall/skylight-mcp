import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { s3Put } from '../src/s3-upload.js';

const creds = {
  access_key_id: 'AKIDEXAMPLE',
  secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  session_token: 'FwoSESSIONTOKEN==',
};
const now = new Date('2026-06-01T12:34:56.789Z');
const body = Buffer.from('hello world');

function okResponse(etag: string | null) {
  return {
    status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === 'etag' ? etag : null) },
    text: async () => '',
  } as unknown as Response;
}

describe('s3Put (SigV4)', () => {
  it('signs a PUT and returns the ETag from the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('"abc123"'));
    const etag = await s3Put({
      creds, region: 'us-east-1', bucket: 'my-bucket', key: 'uploads/10730517/file.jpg',
      body, contentType: 'image/jpeg', fetchImpl, now,
    });

    expect(etag).toBe('"abc123"');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/uploads/10730517/file.jpg');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(body);

    const h = init.headers as Record<string, string>;
    expect(h['x-amz-date']).toBe('20260601T123456Z');
    expect(h['x-amz-content-sha256']).toBe(createHash('sha256').update(body).digest('hex'));
    expect(h['x-amz-security-token']).toBe(creds.session_token);
    expect(h['content-type']).toBe('image/jpeg');
    expect(h.host).toBe('my-bucket.s3.us-east-1.amazonaws.com');

    // Authorization: AWS4-HMAC-SHA256 Credential=.../scope, SignedHeaders=..., Signature=<64 hex>
    expect(h.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260601\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/,
    );
  });

  it('encodes each path segment but preserves slashes in the canonical URI', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('"x"'));
    await s3Put({
      creds, region: 'us-east-1', bucket: 'b', key: 'uploads/1/a b.jpg',
      body, contentType: 'image/jpeg', fetchImpl, now,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://b.s3.us-east-1.amazonaws.com/uploads/1/a%20b.jpg');
  });

  it('falls back to a computed md5 ETag when the response omits one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(null));
    const etag = await s3Put({
      creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg',
      body, contentType: 'image/jpeg', fetchImpl, now,
    });
    expect(etag).toBe(`"${createHash('md5').update(body).digest('hex')}"`);
  });

  it('throws with the response text on a non-2xx status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 403,
      headers: { get: () => null },
      text: async () => '<Error>AccessDenied</Error>',
    } as unknown as Response);
    await expect(s3Put({
      creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg',
      body, contentType: 'image/jpeg', fetchImpl, now,
    })).rejects.toThrow(/S3 upload failed \(HTTP 403\): <Error>AccessDenied<\/Error>/);
  });

  it('tolerates a body whose error text cannot be read', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 500,
      headers: { get: () => null },
      text: async () => { throw new Error('stream closed'); },
    } as unknown as Response);
    await expect(s3Put({
      creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg',
      body, contentType: 'image/jpeg', fetchImpl, now,
    })).rejects.toThrow(/S3 upload failed \(HTTP 500\): $/);
  });

  it('defaults to the global fetch and new Date() when not injected', async () => {
    const globalFetch = vi.fn().mockResolvedValue(okResponse('"g"'));
    vi.stubGlobal('fetch', globalFetch);
    try {
      const etag = await s3Put({
        creds, region: 'us-east-1', bucket: 'b', key: 'k.jpg', body, contentType: 'image/jpeg',
      });
      expect(etag).toBe('"g"');
      expect(globalFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
