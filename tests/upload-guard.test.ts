import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync, realpathSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, delimiter } from 'node:path';
import { vetUploadFile, readVettedUpload, uploadRoots } from '../src/upload-guard.js';

/**
 * fleet-audit#248: the photo/avatar upload tools read ANY local path the model
 * supplied and shipped it to Skylight — an unknown extension went up as
 * application/octet-stream, and a single injected call with the (then) `confirm: true` flag could
 * upload ~/.ssh/id_ed25519. Nothing capped the size either.
 *
 * fleet-audit#1124: even with every type check passing, ANY real image on the
 * machine (a Desktop screenshot of a bank statement, a hosted child's data dir)
 * could be posted to a frame every household member sees. Uploads are now
 * confined to directories by DEFAULT, not only when SKYLIGHT_UPLOAD_DIR is set.
 */
const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime' };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const box = (type: string, brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(type), Buffer.from(brand), Buffer.alloc(4)]);

const ENV_KEYS = ['SKYLIGHT_UPLOAD_DIR', 'MCP_DATA_DIR', 'HOME'] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let base: string;
/** The confinement root most tests run under (SKYLIGHT_UPLOAD_DIR). */
let dir: string;
/** A directory OUTSIDE every root. */
let outsideDir: string;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  base = realpathSync(mkdtempSync(join(tmpdir(), 'skylight-upload-')));
  dir = join(base, 'inbox');
  outsideDir = join(base, 'elsewhere');
  mkdirSync(dir);
  mkdirSync(outsideDir);
  // Tests must not inherit the runner's settings; most run confined to `dir`.
  delete process.env.MCP_DATA_DIR;
  process.env.SKYLIGHT_UPLOAD_DIR = dir;
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function file(name: string, bytes: Buffer, where = dir): string {
  const p = join(where, name);
  writeFileSync(p, bytes);
  return p;
}

const vet = (p: string, maxBytes = 1024) => vetUploadFile(p, { mimeByExt: MIME, maxBytes });

describe('vetUploadFile — type, shape and size', () => {
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
    expect((await vet(rel)).resolved).toBe(p);
  });

  it('refuses a path with no extension (how a private key or credentials file looks)', async () => {
    const p = file('id_ed25519', Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----'));
    await expect(vet(p)).rejects.toThrow(/Refusing to upload .*no extension is not an allowed type/);
  });

  it('refuses an extension outside the allowlist', async () => {
    const p = file('notes.txt', Buffer.from('hello'));
    await expect(vet(p)).rejects.toThrow(/\.txt is not an allowed type/);
  });

  it('refuses a file whose bytes do not match its image extension', async () => {
    const p = file('credentials.png', Buffer.from('[default]\naws_access_key_id=AKIA...'));
    await expect(vet(p)).rejects.toThrow(/does not look like a \.png/);
  });

  it('refuses a file too short to carry any signature', async () => {
    const p = file('tiny.jpg', Buffer.from([0xff]));
    await expect(vet(p)).rejects.toThrow(/does not look like a \.jpg/);
  });

  it('refuses an allowlisted extension it has no signature for, rather than waving it through', async () => {
    const p = file('scan.bmp', Buffer.from('BM\0\0\0\0'));
    await expect(vetUploadFile(p, { mimeByExt: { bmp: 'image/bmp' }, maxBytes: 1024 })).rejects.toThrow(/does not look like a \.bmp/);
  });

  it('refuses a symlink, even one pointing at a real image in the same directory', async () => {
    const target = file('real.png', PNG);
    const link = join(dir, 'link.png');
    symlinkSync(target, link);
    await expect(vet(link)).rejects.toThrow(/symbolic link/);
  });

  it('refuses something that is not a regular file', async () => {
    mkdirSync(join(dir, 'folder.png'));
    await expect(vet(join(dir, 'folder.png'))).rejects.toThrow(/not a regular file/);
  });

  it('refuses a file over the size cap', async () => {
    const p = file('big.png', Buffer.concat([PNG, Buffer.alloc(2048)]));
    await expect(vet(p)).rejects.toThrow(/over the 1 KiB upload limit/);
  });

  it('names a MiB-sized cap in MiB', async () => {
    const p = file('big.jpg', Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)]));
    await expect(vet(p, 1024 * 1024)).rejects.toThrow(/over the 1 MiB upload limit/);
  });

  it('reports a missing file plainly', async () => {
    await expect(vet(join(dir, 'nope.png'))).rejects.toThrow(/Refusing to upload .*nope\.png: the file cannot be read/);
  });

  it('refuses hidden files and files in hidden directories inside the root', async () => {
    await expect(vet(file('.secret.png', PNG))).rejects.toThrow(/hidden/);
    mkdirSync(join(dir, '.ssh'));
    await expect(vet(file('key.png', PNG, join(dir, '.ssh')))).rejects.toThrow(/hidden/);
  });
});

describe('vetUploadFile — directory confinement (fleet-audit#1124)', () => {
  it('refuses an image outside the upload directories, naming them and SKYLIGHT_UPLOAD_DIR', async () => {
    const outside = file('outside.png', PNG, outsideDir);
    await expect(vet(outside)).rejects.toThrow(/Refusing to upload .*outside\.png: it is outside the upload directories/);
    await expect(vet(outside)).rejects.toThrow(/SKYLIGHT_UPLOAD_DIR/);
  });

  it('refuses an outside path up front, even one that does not exist', async () => {
    await expect(vet(join(outsideDir, 'ghost.png'))).rejects.toThrow(/outside the upload directories/);
  });

  it('refuses a ../ escape from the root', async () => {
    file('escape.png', PNG, outsideDir);
    await expect(vet(join(dir, '..', 'elsewhere', 'escape.png'))).rejects.toThrow(/outside the upload directories/);
  });

  it('refuses a sibling directory that merely shares the root as a name prefix', async () => {
    const sibling = join(base, 'inbox-evil');
    mkdirSync(sibling);
    await expect(vet(file('a.png', PNG, sibling))).rejects.toThrow(/outside the upload directories/);
  });

  it('refuses a path through a symlinked directory inside the root that points outside it', async () => {
    file('target.png', PNG, outsideDir);
    symlinkSync(outsideDir, join(dir, 'portal'));
    await expect(vet(join(dir, 'portal', 'target.png'))).rejects.toThrow(/outside the upload directories/);
  });

  it('accepts an image inside the directory and hands the roots on for the read', async () => {
    const out = await vet(file('ok.png', PNG));
    expect(out.resolved).toBe(join(dir, 'ok.png'));
    expect(out.allowedRoots).toEqual([dir]);
  });

  it('accepts a root that is itself reached through a symlink', async () => {
    const alias = join(base, 'alias');
    symlinkSync(dir, alias);
    process.env.SKYLIGHT_UPLOAD_DIR = alias;
    file('ok.png', PNG);
    const out = await vet(join(alias, 'ok.png'));
    expect(out.resolved).toBe(join(dir, 'ok.png'));
  });

  it('accepts several directories separated by the platform path delimiter', async () => {
    process.env.SKYLIGHT_UPLOAD_DIR = `${dir}${delimiter}${delimiter}${outsideDir}`;
    const out = await vet(file('ok.png', PNG, outsideDir));
    expect(out.allowedRoots).toEqual([dir, outsideDir]);
  });
});

describe('uploadRoots — the default when SKYLIGHT_UPLOAD_DIR is unset', () => {
  let home: string;
  beforeEach(() => {
    home = join(base, 'home');
    mkdirSync(join(home, 'Pictures'), { recursive: true });
    mkdirSync(join(home, 'Downloads'), { recursive: true });
    mkdirSync(join(home, 'Desktop'), { recursive: true });
    process.env.HOME = home;
    delete process.env.SKYLIGHT_UPLOAD_DIR;
  });

  it('is ~/Pictures and ~/Downloads on a local install', () => {
    expect(uploadRoots()).toEqual(['~/Pictures', '~/Downloads']);
  });

  it.each(['   ', `${delimiter}${delimiter}`])('treats a blank SKYLIGHT_UPLOAD_DIR (%j) as unset — still confined', (blank) => {
    process.env.SKYLIGHT_UPLOAD_DIR = blank;
    expect(uploadRoots()).toEqual(['~/Pictures', '~/Downloads']);
  });

  it('accepts a photo in ~/Pictures or ~/Downloads', async () => {
    expect((await vet(file('a.png', PNG, join(home, 'Pictures')))).resolved).toBe(join(home, 'Pictures', 'a.png'));
    expect((await vet(file('b.png', PNG, join(home, 'Downloads')))).resolved).toBe(join(home, 'Downloads', 'b.png'));
  });

  it('refuses an image anywhere else — a Desktop screenshot, the home dir itself', async () => {
    await expect(vet(file('statement.png', PNG, join(home, 'Desktop')))).rejects.toThrow(/outside the upload directories/);
    await expect(vet(file('loose.png', PNG, home))).rejects.toThrow(/outside the upload directories/);
  });

  it('in a hosted child (MCP_DATA_DIR set) is only $MCP_DATA_DIR/uploads — never the host home', async () => {
    const data = join(base, 'data');
    mkdirSync(join(data, 'uploads'), { recursive: true });
    process.env.MCP_DATA_DIR = data;
    expect(uploadRoots()).toEqual([join(data, 'uploads')]);
    await expect(vet(file('a.png', PNG, join(home, 'Pictures')))).rejects.toThrow(/outside the upload directories/);
    // The data dir itself holds the token cache: not uploadable.
    await expect(vet(file('tokens.png', PNG, data))).rejects.toThrow(/outside the upload directories/);
    expect((await vet(file('ok.png', PNG, join(data, 'uploads')))).resolved).toBe(join(data, 'uploads', 'ok.png'));
  });

  it('an explicit SKYLIGHT_UPLOAD_DIR replaces the defaults, locally and hosted', () => {
    process.env.MCP_DATA_DIR = join(base, 'data');
    process.env.SKYLIGHT_UPLOAD_DIR = `~/Photos${delimiter}${outsideDir}`;
    expect(uploadRoots()).toEqual(['~/Photos', outsideDir]);
  });
});

describe('readVettedUpload — the confirmed read', () => {
  it('returns the bytes of the file that was vetted', async () => {
    const vetted = await vet(file('ok.png', PNG));
    expect(Buffer.from(await readVettedUpload(vetted, 1024)).equals(PNG)).toBe(true);
  });

  it('refuses when the file changed size since it was vetted (and previewed)', async () => {
    const p = file('grow.png', PNG);
    const vetted = await vet(p);
    appendFileSync(p, Buffer.alloc(4));
    await expect(readVettedUpload(vetted, 1024)).rejects.toThrow(/changed since it was confirmed/);
  });

  it('refuses when the file was swapped for a symlink since it was vetted', async () => {
    const p = file('swap.png', PNG);
    const vetted = await vet(p);
    rmSync(p);
    symlinkSync(file('other.png', PNG, outsideDir), p);
    await expect(readVettedUpload(vetted, 1024)).rejects.toThrow(/Refusing to upload/);
  });

  it('re-checks the confinement it was vetted under, whatever the environment says now', async () => {
    const vetted = await vet(file('ok.png', PNG));
    process.env.SKYLIGHT_UPLOAD_DIR = outsideDir;
    expect(Buffer.from(await readVettedUpload(vetted, 1024)).equals(PNG)).toBe(true);
    await expect(readVettedUpload({ ...vetted, allowedRoots: [outsideDir] }, 1024)).rejects.toThrow(/outside the upload directories/);
  });
});
