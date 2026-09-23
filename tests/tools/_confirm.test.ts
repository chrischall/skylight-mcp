import { describe, it, expect } from 'vitest';
import { previewUnlessConfirmed, previewFileUploadUnlessConfirmed } from '../../src/tools/_confirm.js';

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
  const FILE = { resolved: '/tmp/pic.jpg', ext: 'jpg', mime: 'image/jpeg', size: 1234 };

  it('returns null (proceed) when confirm is true', () => {
    expect(previewFileUploadUnlessConfirmed(true, FILE, 'Upload', 'POST', '/u')).toBeNull();
  });

  it('echoes the vetted absolute path, mime and size as a dry-run (no side effects)', () => {
    const out = previewFileUploadUnlessConfirmed(undefined, FILE, 'Upload', 'POST', '/u');
    expect(JSON.parse(out!.content[0].text as string)).toEqual({
      dryRun: true, action: 'Upload', method: 'POST', path: '/u',
      willSend: { image_path: '/tmp/pic.jpg', mime: 'image/jpeg', bytes: 1234 },
      note: 'Re-run with confirm: true to execute.',
    });
  });

  it('merges extra fields (e.g. the target id) into willSend', () => {
    const out = previewFileUploadUnlessConfirmed(undefined, FILE, 'Upload', 'PUT', '/u', { id: '9' });
    expect(JSON.parse(out!.content[0].text as string).willSend).toEqual({
      id: '9', image_path: '/tmp/pic.jpg', mime: 'image/jpeg', bytes: 1234,
    });
  });
});
