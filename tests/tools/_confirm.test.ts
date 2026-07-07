import { describe, it, expect } from 'vitest';
import { previewUnlessConfirmed, previewFileUploadUnlessConfirmed } from '../../src/tools/_confirm.js';

const MIME = { jpg: 'image/jpeg', png: 'image/png' };

describe('previewUnlessConfirmed', () => {
  it('returns null (proceed) when confirm is true', () => {
    expect(previewUnlessConfirmed(true, 'act', 'POST', '/x', { a: 1 })).toBeNull();
  });

  it('returns a dry-run preview with willSend when a body is given', () => {
    const out = previewUnlessConfirmed(false, 'act', 'POST', '/x', { a: 1 });
    expect(out).not.toBeNull();
    expect(JSON.parse(out!.content[0].text as string)).toEqual({
      dryRun: true, action: 'act', method: 'POST', path: '/x', willSend: { a: 1 },
      note: 'Re-run with confirm: true to execute.',
    });
  });

  it('omits willSend when no body is given', () => {
    const out = previewUnlessConfirmed(undefined, 'act', 'DELETE', '/y');
    expect(JSON.parse(out!.content[0].text as string)).toEqual({
      dryRun: true, action: 'act', method: 'DELETE', path: '/y',
      note: 'Re-run with confirm: true to execute.',
    });
  });
});

describe('previewFileUploadUnlessConfirmed', () => {
  it('returns null (proceed) when confirm is true', () => {
    expect(previewFileUploadUnlessConfirmed(true, '/tmp/pic.jpg', 'Upload', 'POST', '/u', MIME, 'jpg')).toBeNull();
  });

  it('echoes the resolved absolute path + detected mime as a dry-run (no side effects)', () => {
    const out = previewFileUploadUnlessConfirmed(undefined, '/tmp/pic.jpg', 'Upload', 'POST', '/u', MIME, 'jpg');
    expect(JSON.parse(out!.content[0].text as string)).toEqual({
      dryRun: true, action: 'Upload', method: 'POST', path: '/u',
      willSend: { image_path: '/tmp/pic.jpg', mime: 'image/jpeg' },
      note: 'Re-run with confirm: true to execute.',
    });
  });

  it('resolves a relative path to an absolute one', () => {
    const out = previewFileUploadUnlessConfirmed(undefined, 'sub/pic.png', 'Upload', 'POST', '/u', MIME, 'jpg');
    const sent = JSON.parse(out!.content[0].text as string).willSend;
    expect(sent.image_path).toBe(`${process.cwd()}/sub/pic.png`);
    expect(sent.mime).toBe('image/png');
  });

  it('falls back to the default extension for an extensionless path', () => {
    const out = previewFileUploadUnlessConfirmed(undefined, '/tmp/rawphoto', 'Upload', 'POST', '/u', MIME, 'jpg');
    expect(JSON.parse(out!.content[0].text as string).willSend.mime).toBe('image/jpeg');
  });

  it('uses octet-stream for an unrecognized extension', () => {
    const out = previewFileUploadUnlessConfirmed(undefined, '/tmp/scan.xyz', 'Upload', 'POST', '/u', MIME, 'jpg');
    expect(JSON.parse(out!.content[0].text as string).willSend.mime).toBe('application/octet-stream');
  });

  it('merges extra fields (e.g. the target id) into willSend', () => {
    const out = previewFileUploadUnlessConfirmed(undefined, '/tmp/pic.jpg', 'Upload', 'PUT', '/u', MIME, 'jpg', { id: '9' });
    expect(JSON.parse(out!.content[0].text as string).willSend).toEqual({
      id: '9', image_path: '/tmp/pic.jpg', mime: 'image/jpeg',
    });
  });
});
