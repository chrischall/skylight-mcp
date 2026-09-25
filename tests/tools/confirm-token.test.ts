import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestHarness, parseToolResult, type TestHarness } from '@chrischall/mcp-utils/test';
import { fileBlob } from '@chrischall/mcp-utils';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { registerPhotoTools } from '../../src/tools/photos.js';
import { registerSettingsTools } from '../../src/tools/settings.js';
import { registerMealTools } from '../../src/tools/meals.js';
import { registerChoreTools } from '../../src/tools/chores.js';
import { registerMemberTools } from '../../src/tools/members.js';
import { registerCalendarTools } from '../../src/tools/calendars.js';
import { registerMessageTools } from '../../src/tools/messages.js';
import { registerListTools } from '../../src/tools/lists.js';
import { s3Upload } from '../../src/s3-upload.js';
import { vetUploadFile } from '../../src/upload-guard.js';
import { makeClient } from './_setup.js';

// Drives every confirm-gated tool through the REAL MCP RPC path. A harness
// created without an elicitation handler is a client that cannot be prompted
// (claude.ai, Claude Desktop), so the default MCP_CONFIRM_MODE (ask-user) runs
// the two-phase preview-token flow.

vi.mock('@chrischall/mcp-utils', async (orig) => ({
  ...(await orig<typeof import('@chrischall/mcp-utils')>()),
  fileBlob: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('../../src/s3-upload.js', () => ({ s3Upload: vi.fn() }));
vi.mock('../../src/upload-guard.js', () => ({ vetUploadFile: vi.fn() }));

const fileBlobMock = vi.mocked(fileBlob);
const readFileMock = vi.mocked(readFile);
const s3UploadMock = vi.mocked(s3Upload);
const vetMock = vi.mocked(vetUploadFile);
const STUB_MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png' };

const CREDS_DOC = {
  data: {
    credentials: { access_key_id: 'AKID', secret_access_key: 's', session_token: 't' },
    region: 'us-east-1', bucket: 'b', key_prefix: 'uploads/1/',
  },
};

const ENV_KEYS = ['MCP_CONFIRM_MODE', 'MCP_CONFIRM_TTL_SECONDS', 'MCP_CONFIRM_SECRET', 'SKYLIGHT_APPLE_APP_PASSWORD', 'SKYLIGHT_APPLE_ID'] as const;
// Synthetic, in Apple's xxxx-xxxx-xxxx-xxxx shape. Not a real credential.
const APPLE_SECRET = 'abcd-efgh-ijkl-mnop';
let savedEnv: Record<string, string | undefined>;
let h: TestHarness | undefined;
let request: ReturnType<typeof makeClient>['request'];

async function open(options?: Parameters<typeof createTestHarness>[1]): Promise<TestHarness> {
  const made = makeClient();
  request = made.request;
  request.mockImplementation(async (_method: string, path: string) => {
    if (path === '/messages/cloud_upload_credentials') return CREDS_DOC;
    if (path === '/messages/uploads') return { data: { message_ids: [1] } };
    // The reads a preview names its target from (a member, a category, a
    // caption, a list item) — a GET here is not a write.
    if (_method === 'GET' && path === '/frames/3435252/users') return { data: [{ id: '9', type: 'frame_user', attributes: { email: 'gran@example.test' } }] };
    if (_method === 'GET' && path === '/frames/3435252/categories') return { data: [{ id: '3', type: 'category', attributes: { label: 'Emma' } }] };
    if (_method === 'GET' && path === '/frames/3435252/messages') return { data: [{ id: '1', type: 'message', attributes: { caption: 'Beach day' } }] };
    if (_method === 'GET' && path === '/frames/3435252/lists/7/list_items') return { data: [{ id: '101', type: 'list_item', attributes: { label: 'Milk' } }] };
    return { data: { id: '1', type: 'thing', attributes: {} } };
  });
  const getClient = async () => made.client;
  h = await createTestHarness((server) => {
    registerPhotoTools(server, getClient);
    registerSettingsTools(server, getClient);
    registerMealTools(server, getClient);
    registerChoreTools(server, getClient);
    registerMemberTools(server, getClient);
    registerCalendarTools(server, getClient);
    registerMessageTools(server, getClient);
    registerListTools(server, getClient);
  }, options);
  return h;
}

/** Every call that changes something: a non-GET API request or an S3 PUT. */
function writes(): number {
  return request.mock.calls.filter((c) => c[0] !== 'GET').length + s3UploadMock.mock.calls.length;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SKYLIGHT_APPLE_APP_PASSWORD = APPLE_SECRET;
  fileBlobMock.mockReset().mockImplementation(async (_p: string, o?: { type?: string }) => new Blob([Buffer.from('img')], o));
  readFileMock.mockReset().mockResolvedValue(Buffer.from('img') as never);
  s3UploadMock.mockReset().mockResolvedValue('"etag"');
  vetMock.mockReset().mockImplementation(async (p: string) => {
    const ext = extname(p).slice(1).toLowerCase();
    return { resolved: `/abs${p}`, ext, mime: STUB_MIME[ext]!, size: 8 };
  });
});

afterEach(async () => {
  await h?.close();
  h = undefined;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

interface Phase1 { status: string; action: string; preview: Record<string, unknown>; confirmToken: string }

const GATED: Array<{ tool: string; action: string; args: Record<string, unknown>; preview: Record<string, unknown> }> = [
  {
    tool: 'skylight_upload_photo', action: 'photo.upload',
    args: { image_path: '/tmp/pic.jpg', caption: 'Hi' },
    preview: { method: 'POST', path: '/messages/uploads', willSend: { caption: 'Hi', image_path: '/abs/tmp/pic.jpg', mime: 'image/jpeg', bytes: 8 } },
  },
  {
    tool: 'skylight_import_events_from_photo', action: 'photo.import_events',
    args: { image_path: '/tmp/flyer.png', category_ids: ['5'] },
    preview: { method: 'POST', path: '/frames/{frame}/auto_creation_intents', willSend: { category_ids: ['5'], image_path: '/abs/tmp/flyer.png', mime: 'image/png', bytes: 8 } },
  },
  {
    tool: 'skylight_update_frame', action: 'frame.open_to_public',
    args: { open_to_public: true, brightness: 3 },
    preview: { method: 'PUT', path: '/frames/3435252', willSend: { open_to_public: true, brightness: 3 } },
  },
  {
    tool: 'skylight_update_meal', action: 'meal.update',
    args: { id: '42', instance_date: '2026-09-08', apply_to: 'all', rrule: 'FREQ=WEEKLY' },
    preview: { method: 'PATCH', path: '/frames/{frame}/meals/sittings/42/instances/2026-09-08?apply_to=all', willSend: { rrule: 'FREQ=WEEKLY' } },
  },
  {
    tool: 'skylight_delete_meal', action: 'meal.delete',
    args: { id: '42', instance_date: '2026-09-08', apply_to: 'future' },
    preview: { method: 'DELETE', path: '/frames/{frame}/meals/sittings/42/instances/2026-09-08?apply_to=future', willSend: { id: '42', instance_date: '2026-09-08', apply_to: 'future' } },
  },
  {
    tool: 'skylight_update_chore', action: 'chore.update',
    args: { id: '5', summary: 'Dishes', apply_to: 'all' },
    preview: { method: 'PUT', path: '/frames/{frame}/chores/5', willSend: { summary: 'Dishes', apply_to: 'all' } },
  },
  {
    tool: 'skylight_delete_chore', action: 'chore.delete',
    args: { id: '5', apply_to: 'all' },
    preview: { method: 'DELETE', path: '/frames/{frame}/chores/5?apply_to=all', willSend: { id: '5', apply_to: 'all' } },
  },
  {
    tool: 'skylight_invite_user', action: 'user.invite',
    args: { email: 'a@b.com' },
    preview: { method: 'POST', path: '/frames/3435252/users', willSend: { email: 'a@b.com' } },
  },
  {
    tool: 'skylight_approve_user', action: 'user.approve',
    args: { id: '9' },
    preview: { method: 'POST', path: '/frames/3435252/users/9/approve' },
  },
  {
    tool: 'skylight_set_member_avatar', action: 'member.set_avatar',
    args: { id: '9', image_path: '/tmp/face.png' },
    preview: { method: 'PUT', path: '/frames/{frame}/categories/9', willSend: { id: '9', image_path: '/abs/tmp/face.png', mime: 'image/png', bytes: 8 } },
  },
  // fleet-audit#963: revoking access / destroying a member's record.
  {
    tool: 'skylight_remove_user', action: 'user.remove',
    args: { id: '9' },
    preview: { method: 'DELETE', path: '/frames/3435252/users/9', willSend: { id: '9', user: 'gran@example.test' } },
  },
  {
    tool: 'skylight_delete_category', action: 'category.delete',
    args: { id: '3' },
    preview: { method: 'DELETE', path: '/frames/3435252/categories/3', willSend: { id: '3', label: 'Emma' } },
  },
  // fleet-audit#964: bulk hard deletes bind the exact set they destroy.
  {
    tool: 'skylight_delete_messages', action: 'message.delete_multiple',
    args: { message_ids: ['1'] },
    preview: { method: 'DELETE', path: '/frames/3435252/messages/destroy_multiple', willSend: { message_ids: ['1'], messages: [{ id: '1', caption: 'Beach day' }] } },
  },
  {
    tool: 'skylight_clear_list', action: 'list.clear',
    args: { listId: '7' },
    preview: { method: 'DELETE', path: '/frames/3435252/lists/7/list_items/bulk_destroy', willSend: { listId: '7', ids: ['101'], items: [{ id: '101', label: 'Milk' }] } },
  },
  // fleet-audit#962: hands Skylight persistent access to an iCloud account; the credential comes from env.
  {
    tool: 'skylight_link_apple_calendar', action: 'calendar.link_apple',
    args: { email: 'apple-id@example.test' },
    preview: { method: 'POST', path: '/frames/3435252/calendars/apple', willSend: { email: 'apple-id@example.test' } },
  },
];

describe('confirm-token flow — every gated tool', () => {
  it.each(GATED)('$tool: phase 1 previews and writes nothing; phase 2 writes exactly once', async ({ tool, action, args, preview }) => {
    const harness = await open();

    const first = await harness.callTool(tool, args);
    expect(first.isError).toBeFalsy();
    const body = parseToolResult<Phase1>(first);
    expect(body.status).toBe('confirmation-required');
    expect(body.action).toBe(action);
    expect(body.preview).toMatchObject(preview);
    expect(typeof body.preview.description).toBe('string');
    expect(body.confirmToken).toEqual(expect.any(String));
    // A preview may READ to name its target; it must not have written.
    expect(writes()).toBe(0);
    expect(s3UploadMock).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalled();
    expect(fileBlobMock).not.toHaveBeenCalled();

    const second = await harness.callTool(tool, { ...args, confirmToken: body.confirmToken });
    expect(second.isError).toBeFalsy();
    expect(writes()).toBe(1 + (tool === 'skylight_upload_photo' || tool === 'skylight_import_events_from_photo' ? 1 : 0));
  });

  it('the Apple app-specific password never appears in either phase of link_apple_calendar', async () => {
    const harness = await open();
    const args = { email: 'apple-id@example.test' };
    const first = await harness.callTool('skylight_link_apple_calendar', args);
    expect(JSON.stringify(first)).not.toContain(APPLE_SECRET);
    const { confirmToken } = parseToolResult<Phase1>(first);
    const second = await harness.callTool('skylight_link_apple_calendar', { ...args, confirmToken });
    expect(JSON.stringify(second)).not.toContain(APPLE_SECRET);
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/calendars/apple', { body: { ...args, app_specific_password: APPLE_SECRET } });
  });

  it('no gated tool still accepts a `confirm` parameter', async () => {
    const harness = await open();
    const { tools } = await harness.client.listTools();
    for (const { tool } of GATED) {
      const t = tools.find((x) => x.name === tool)!;
      expect(Object.keys(t.inputSchema.properties ?? {}), tool).not.toContain('confirm');
      expect(Object.keys(t.inputSchema.properties ?? {}), tool).toContain('confirmToken');
      expect(t.description, tool).not.toMatch(/confirm: ?true/);
    }
  });
});

describe('confirm-token flow — refusals', () => {
  it('replaying a used token is TOKEN_REUSED and writes nothing more', async () => {
    const harness = await open();
    const { confirmToken } = parseToolResult<Phase1>(await harness.callTool('skylight_invite_user', { email: 'a@b.com' }));
    await harness.callTool('skylight_invite_user', { email: 'a@b.com', confirmToken });
    expect(writes()).toBe(1);

    const replay = await harness.callTool('skylight_invite_user', { email: 'a@b.com', confirmToken });
    expect(replay.isError).toBe(true);
    expect(parseToolResult<{ error: string }>(replay).error).toBe('TOKEN_REUSED');
    expect(writes()).toBe(1);
  });

  it('changing an argument between the phases is DRAFT_CHANGED and writes nothing', async () => {
    const harness = await open();
    const args = { id: '5', summary: 'Dishes', apply_to: 'all' };
    const { confirmToken } = parseToolResult<Phase1>(await harness.callTool('skylight_update_chore', args));

    const changed = await harness.callTool('skylight_update_chore', { ...args, summary: 'Laundry', confirmToken });
    expect(changed.isError).toBe(true);
    const body = parseToolResult<{ error: string; preview: { willSend: unknown } }>(changed);
    expect(body.error).toBe('DRAFT_CHANGED');
    expect(body.preview.willSend).toEqual({ summary: 'Laundry', apply_to: 'all' });
    expect(writes()).toBe(0);
  });

  it('changing the caption of an upload between the phases is DRAFT_CHANGED', async () => {
    const harness = await open();
    const { confirmToken } = parseToolResult<Phase1>(await harness.callTool('skylight_upload_photo', { image_path: '/tmp/pic.jpg', caption: 'Hi' }));
    const changed = await harness.callTool('skylight_upload_photo', { image_path: '/tmp/pic.jpg', caption: 'Bye', confirmToken });
    expect(parseToolResult<{ error: string }>(changed).error).toBe('DRAFT_CHANGED');
    expect(writes()).toBe(0);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('MCP_CONFIRM_MODE=refuse refuses on a client that cannot be prompted, and writes nothing', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    const harness = await open();
    const out = await harness.callTool('skylight_delete_chore', { id: '5', apply_to: 'all' });
    expect(parseToolResult<{ reason: string }>(out).reason).toBe('confirmation-unsupported');
    expect(writes()).toBe(0);
  });
});

describe('confirm-token flow — a client that can be prompted', () => {
  it('accepting the elicitation writes', async () => {
    const elicitation = vi.fn(async () => ({ action: 'accept' as const, content: { confirmed: true } }));
    const harness = await open({ elicitation });
    const out = await harness.callTool('skylight_invite_user', { email: 'a@b.com' });
    expect(out.isError).toBeFalsy();
    expect(elicitation).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/users', { body: { email: 'a@b.com' } });
    expect(writes()).toBe(1);
  });

  it('declining the elicitation writes nothing', async () => {
    const harness = await open({ elicitation: async () => ({ action: 'decline' as const }) });
    const out = await harness.callTool('skylight_invite_user', { email: 'a@b.com' });
    expect(parseToolResult<{ confirmed: boolean }>(out).confirmed).toBe(false);
    expect(writes()).toBe(0);
  });
});
