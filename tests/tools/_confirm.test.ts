import { describe, it, expect, afterEach } from 'vitest';
import { PREVIEW_NAMES_MAX, confirmFileUpload, confirmWrite, framePath, nameSome } from '../../src/tools/_confirm.js';
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

describe('confirmWrite', () => {
  const W = { tool: 't', action: 'thing.do', description: 'Do it', target: '1', method: 'POST', path: '/x' };

  it('phase 1 returns the preview, with willSend when a body is given', async () => {
    const out = phaseOne(await confirmWrite(ctx, { ...W, body: { a: 1 } }));
    expect(out.status).toBe('confirmation-required');
    expect(out.action).toBe('thing.do');
    expect(out.preview).toEqual({ description: 'Do it', method: 'POST', path: '/x', willSend: { a: 1 } });
  });

  it('omits willSend when there is no body', async () => {
    const out = phaseOne(await confirmWrite(ctx, W));
    expect(out.preview).toEqual({ description: 'Do it', method: 'POST', path: '/x' });
  });

  it('resolves undefined (proceed) for the matching phase-2 token', async () => {
    const { confirmToken } = phaseOne(await confirmWrite(ctx, { ...W, body: { a: 1 } }));
    expect(await confirmWrite(ctx, { ...W, body: { a: 1 }, confirmToken })).toBeUndefined();
  });

  it('binds the path: the same body at another path is DRAFT_CHANGED', async () => {
    const { confirmToken } = phaseOne(await confirmWrite(ctx, { ...W, body: { a: 1 } }));
    const out = await confirmWrite(ctx, { ...W, path: '/y', body: { a: 1 }, confirmToken });
    expect(JSON.parse((out as any).content[0].text).error).toBe('DRAFT_CHANGED');
  });

  it('refuses outright under MCP_CONFIRM_MODE=refuse', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    const out = await confirmWrite(ctx, W);
    expect(JSON.parse((out as any).content[0].text).reason).toBe('confirmation-unsupported');
  });
});

describe('confirmFileUpload', () => {
  const FILE = { resolved: '/tmp/pic.jpg', ext: 'jpg', mime: 'image/jpeg', size: 1234 };
  const W = { tool: 't', action: 'photo.upload', description: 'Upload', target: '/tmp/pic.jpg', method: 'POST', path: '/u' };

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
