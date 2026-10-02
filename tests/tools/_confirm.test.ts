import { describe, it, expect, afterEach } from 'vitest';
import { PREVIEW_NAMES_MAX, confirmFileUpload, framePath, nameSome } from '../../src/tools/_confirm.js';
import { NO_ELICIT_CTX, phaseOne } from './_setup.js';

const ctx = NO_ELICIT_CTX as any;
const saved = process.env.MCP_CONFIRM_MODE;
afterEach(() => {
  if (saved === undefined) delete process.env.MCP_CONFIRM_MODE;
  else process.env.MCP_CONFIRM_MODE = saved;
});

describe('framePath', () => {
  it('shows the {frame} placeholder when no frameId was passed', () => {
    expect(framePath(undefined)).toBe('/frames/{frame}');
  });

  it('shows (and encodes) an explicit frameId', () => {
    expect(framePath('9 9')).toBe('/frames/9%209');
  });
});

describe('nameSome', () => {
  it('joins a short list verbatim', () => {
    expect(nameSome(['"Milk"', '"Eggs"'])).toBe('"Milk", "Eggs"');
    expect(nameSome([])).toBe('');
  });

  it('spells out PREVIEW_NAMES_MAX names and counts the rest', () => {
    const names = Array.from({ length: PREVIEW_NAMES_MAX + 3 }, (_, i) => `n${i}`);
    const out = nameSome(names);
    expect(out).toContain(`n${PREVIEW_NAMES_MAX - 1}`);
    expect(out).not.toContain(`n${PREVIEW_NAMES_MAX}`);
    expect(out).toMatch(/, \+3 more$/);
  });
});

// The gate itself is the shared mcp-utils `confirmWrite` (its own suite covers
// binding, replay, refuse mode); these pin skylight's file-upload wrapper.
describe('confirmFileUpload', () => {
  const FILE = { resolved: '/tmp/pic.jpg', ext: 'jpg', mime: 'image/jpeg', size: 1234, allowedRoots: ['/tmp'] };
  const W = { tool: 't', action: 'photo.upload', summary: 'Upload', target: '/tmp/pic.jpg', method: 'POST', path: '/u', confirmToken: undefined };

  it('previews the shared confirmWrite shape: action, method, path, willSend', async () => {
    const out = phaseOne(await confirmFileUpload(ctx, FILE, W));
    expect(out.preview).toEqual({
      action: 'Upload', method: 'POST', path: '/u',
      willSend: { image_path: '/tmp/pic.jpg', mime: 'image/jpeg', bytes: 1234 },
    });
  });

  it('echoes the vetted absolute path, mime and size in willSend', async () => {
    const out = phaseOne(await confirmFileUpload(ctx, FILE, W));
    expect(out.preview.willSend).toEqual({ image_path: '/tmp/pic.jpg', mime: 'image/jpeg', bytes: 1234 });
  });

  it('merges extra fields (e.g. the target id) into willSend', async () => {
    const out = phaseOne(await confirmFileUpload(ctx, FILE, { ...W, extra: { id: '9' } }));
    expect(out.preview.willSend).toEqual({ id: '9', image_path: '/tmp/pic.jpg', mime: 'image/jpeg', bytes: 1234 });
  });

  it('binds the file size: a different file behind the same path is DRAFT_CHANGED', async () => {
    const { confirmToken } = phaseOne(await confirmFileUpload(ctx, FILE, W));
    const out = await confirmFileUpload(ctx, { ...FILE, size: 99 }, { ...W, confirmToken });
    expect(JSON.parse((out as any).content[0].text).error).toBe('DRAFT_CHANGED');
  });
});
