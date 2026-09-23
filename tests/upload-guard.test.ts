import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { vetUploadFile } from '../src/upload-guard.js';

/**
 * fleet-audit#248: the photo/avatar upload tools read ANY local path the model
 * supplied and shipped it to Skylight — an unknown extension went up as
 * application/octet-stream, and a single injected call with confirm:true could
 * upload ~/.ssh/id_ed25519. Nothing capped the size either.
 */
const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime' };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const box = (type: string, brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(type), Buffer.from(brand), Buffer.alloc(4)]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skylight-upload-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, bytes: Buffer): string {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

describe('vetUploadFile', () => {
  it.each([
    ['photo.jpg', JPEG, 'image/jpeg'],
    ['photo.JPEG', JPEG, undefined],
    ['photo.png', PNG, 'image/png'],
    ['anim.gif', GIF, 'image/gif'],
    ['pic.webp', WEBP, 'image/webp'],
    ['pic.heic', box('ftyp', 'heic'), 'image/heic'],
    ['clip.mp4', box('ftyp', 'isom'), 'video/mp4'],
    ['clip.mov', box('moov', 'xxxx'), 'video/quicktime'],
  ])('accepts a genuine %s', async (name, bytes, mime) => {
    const mimeMap = { ...MIME, jpeg: 'image/jpeg' };
    const out = await vetUploadFile(file(name, bytes), { mimeByExt: mimeMap, maxBytes: 1024 });
    expect(out.resolved).toBe(join(dir, name));
    expect(out.size).toBe(bytes.length);
    if (mime) expect(out.mime).toBe(mime);
  });

  it('resolves a relative path to an absolute one', async () => {
    const p = file('rel.png', PNG);
    const rel = relative(process.cwd(), p);
    expect((await vetUploadFile(rel, { mimeByExt: MIME, maxBytes: 1024 })).resolved).toBe(p);
  });

  it('refuses a path with no extension (how a private key or credentials file looks)', async () => {
    const p = file('id_ed25519', Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----'));
    await expect(vetUploadFile(p, { mimeByExt: MIME, maxBytes: 1024 })).rejects.toThrow(/not an allowed image\/video type/);
  });

  it('refuses an extension outside the allowlist', async () => {
    const p = file('notes.txt', Buffer.from('hello'));
    await expect(vetUploadFile(p, { mimeByExt: MIME, maxBytes: 1024 })).rejects.toThrow(/\.txt.*not an allowed/);
  });

  it('refuses a file whose bytes do not match its image extension', async () => {
    const p = file('credentials.png', Buffer.from('[default]\naws_access_key_id=AKIA...'));
    await expect(vetUploadFile(p, { mimeByExt: MIME, maxBytes: 1024 })).rejects.toThrow(/does not look like a \.png/);
  });

  it('refuses a file too short to carry any signature', async () => {
    const p = file('tiny.jpg', Buffer.from([0xff]));
    await expect(vetUploadFile(p, { mimeByExt: MIME, maxBytes: 1024 })).rejects.toThrow(/does not look like a \.jpg/);
  });

  it('refuses an allowlisted extension it has no signature for, rather than waving it through', async () => {
    const p = file('scan.bmp', Buffer.from('BM\0\0\0\0'));
    await expect(vetUploadFile(p, { mimeByExt: { bmp: 'image/bmp' }, maxBytes: 1024 })).rejects.toThrow(/does not look like a \.bmp/);
  });

  it('refuses a symlink, even one pointing at a real image', async () => {
    const target = file('real.png', PNG);
    const link = join(dir, 'link.png');
    symlinkSync(target, link);
    await expect(vetUploadFile(link, { mimeByExt: MIME, maxBytes: 1024 })).rejects.toThrow(/symbolic link/);
  });

  it('refuses something that is not a regular file', async () => {
    const d = join(dir, 'folder.png');
    mkdirSync(d);
    await expect(vetUploadFile(d, { mimeByExt: MIME, maxBytes: 1024 })).rejects.toThrow(/not a regular file/);
  });

  it('refuses a file over the size cap without reading it', async () => {
    const p = file('big.png', Buffer.concat([PNG, Buffer.alloc(2048)]));
    await expect(vetUploadFile(p, { mimeByExt: MIME, maxBytes: 1024 })).rejects.toThrow(/over the 1 KiB upload limit/);
  });

  it('names a MiB-sized cap in MiB', async () => {
    const p = file('big.jpg', Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)]));
    await expect(vetUploadFile(p, { mimeByExt: MIME, maxBytes: 1024 * 1024 })).rejects.toThrow(/over the 1 MiB upload limit/);
  });

  it('reports a missing file plainly', async () => {
    await expect(vetUploadFile(join(dir, 'nope.png'), { mimeByExt: MIME, maxBytes: 1024 })).rejects.toThrow(/ENOENT/);
  });
});
