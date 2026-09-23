import { lstat, open, constants } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

/**
 * Leading-byte signatures per extension. A file must START like the type its
 * extension claims, so a renamed secret (`credentials.png`) is refused.
 * HEIC/MP4/MOV are ISO-BMFF: the first box's type sits at offset 4 — `ftyp`
 * for anything modern, and one of the older QuickTime atoms for legacy `.mov`.
 */
const BMFF_BOXES = ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'];
const SIGNATURES: Record<string, (head: Buffer) => boolean> = {
  jpg: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  jpeg: (h) => SIGNATURES.jpg!(h),
  png: (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  gif: (h) => h.subarray(0, 4).toString('latin1') === 'GIF8',
  webp: (h) => h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP',
  heic: (h) => BMFF_BOXES.includes(h.subarray(4, 8).toString('latin1')),
  mp4: (h) => SIGNATURES.heic!(h),
  mov: (h) => SIGNATURES.heic!(h),
};

export interface VettedUpload {
  /** Absolute path that was checked — read THIS, not the caller's string. */
  resolved: string;
  ext: string;
  mime: string;
  size: number;
}

function formatLimit(bytes: number): string {
  const MiB = 1024 * 1024;
  return bytes % MiB === 0 ? `${bytes / MiB} MiB` : `${Math.round(bytes / 1024)} KiB`;
}

/**
 * Refuse anything that is not plainly an image/video the tool is meant to
 * upload, BEFORE a byte of it leaves the machine (fleet-audit#248).
 *
 * The upload tools take a local path from the model, so a prompt-injected call
 * can name `~/.ssh/id_ed25519` or `~/.aws/credentials`; the confirm preview only
 * helps if something forces the round-trip, and nothing does. So: the extension
 * must be on the tool's allowlist (an extensionless path is refused — that is
 * what key and credential files look like), the path must be a regular file and
 * not a symlink, it must fit under `maxBytes` (the photo path buffers the whole
 * file), and its leading bytes must match the claimed type.
 */
export async function vetUploadFile(
  imagePath: string,
  opts: { mimeByExt: Record<string, string>; maxBytes: number },
): Promise<VettedUpload> {
  const resolved = resolve(imagePath);
  const ext = extname(resolved).slice(1).toLowerCase();
  const mime = opts.mimeByExt[ext];
  if (!mime) {
    const allowed = Object.keys(opts.mimeByExt).join(', ');
    throw new Error(
      `Refusing to upload ${resolved}: ${ext ? `.${ext}` : 'a file with no extension'} is not an allowed image/video type (allowed: ${allowed}).`,
    );
  }

  const st = await lstat(resolved);
  if (st.isSymbolicLink()) throw new Error(`Refusing to upload ${resolved}: it is a symbolic link. Pass the real file's path.`);
  if (!st.isFile()) throw new Error(`Refusing to upload ${resolved}: it is not a regular file.`);
  if (st.size > opts.maxBytes) {
    throw new Error(`Refusing to upload ${resolved}: ${st.size} bytes is over the ${formatLimit(opts.maxBytes)} upload limit.`);
  }

  // O_NOFOLLOW closes the lstat→open window for a final-component symlink swap.
  const fh = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  const head = Buffer.alloc(16);
  try {
    await fh.read(head, 0, 16, 0);
  } finally {
    await fh.close();
  }
  // An extension a tool allows but this module cannot sniff is refused, not waved through.
  const matches = SIGNATURES[ext];
  if (!matches || !matches(head)) {
    throw new Error(`Refusing to upload ${resolved}: the file does not look like a .${ext} image or video.`);
  }
  return { resolved, ext, mime, size: st.size };
}
