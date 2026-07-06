import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerMemberTools } from '../../src/tools/members.js';
import { makeClient } from './_setup.js';
import { fileBlob } from '@chrischall/mcp-utils';

// Partial-mock @chrischall/mcp-utils so only fileBlob is stubbed (avatar upload
// streams the file via a file-backed Blob); the mock returns a Blob carrying the
// requested type. Everything else (textResult, flattenJsonApi, …) stays real.
vi.mock('@chrischall/mcp-utils', async (orig) => ({
  ...(await orig<typeof import('@chrischall/mcp-utils')>()),
  fileBlob: vi.fn(),
}));
const fileBlobMock = vi.mocked(fileBlob);
beforeEach(() =>
  fileBlobMock
    .mockReset()
    .mockImplementation(async (_path: string, opts?: { type?: string }) =>
      new Blob([Buffer.from('imgbytes')], opts),
    ),
);

function harness() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  // Tools register with an optional annotations arg before the callback
  // (server.tool(name, desc, schema[, annotations], cb)); the handler is always last.
  const server = { tool: (name: string, ...rest: any[]) => { tools[name] = rest[rest.length - 1]; } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerMemberTools(server, async () => client);
  return { tools, request, resolveFrameId };
}

describe('member tools', () => {
  // ── skylight_resolve_member ──────────────────────────────────────────────

  it('resolve_member returns only categories whose label matches (case-insensitive)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [
        { id: '1', type: 'category', attributes: { label: 'Mom' } },
        { id: '2', type: 'category', attributes: { label: 'Dad' } },
        { id: '3', type: 'category', attributes: { label: 'Emma' } },
      ],
    });
    const out = await tools.skylight_resolve_member({ name: 'mo' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/categories');
    expect(JSON.parse(out.content[0].text)).toEqual({ matched: true, members: [{ id: '1', label: 'Mom' }] });
  });

  it('resolve_member returns all categories when none match', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({
      data: [
        { id: '1', type: 'category', attributes: { label: 'Mom' } },
        { id: '2', type: 'category', attributes: { label: 'Dad' } },
        { id: '3', type: 'category' },
      ],
    });
    const out = await tools.skylight_resolve_member({ name: 'zzz' });
    expect(JSON.parse(out.content[0].text)).toEqual({
      matched: false,
      members: [
        { id: '1', label: 'Mom' },
        { id: '2', label: 'Dad' },
        { id: '3' },
      ],
      note: 'No name match; returning all members.',
    });
  });

  it('resolve_member with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'category', attributes: { label: 'Mom' } }] });
    await tools.skylight_resolve_member({ name: 'mom', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/categories');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_invite_user ─────────────────────────────────────────────────

  it('invite_user POSTs email with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'frame_user', attributes: { email: 'a@b.com' } } });
    const out = await tools.skylight_invite_user({ email: 'a@b.com' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/users', { body: { email: 'a@b.com' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '9', type: 'frame_user', email: 'a@b.com' });
  });

  it('invite_user with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'frame_user', attributes: {} } });
    await tools.skylight_invite_user({ email: 'c@d.com', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/users', { body: { email: 'c@d.com' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_approve_user ────────────────────────────────────────────────

  it('approve_user POSTs and flattens a returned doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'frame_user', attributes: { status: 'active' } } });
    const out = await tools.skylight_approve_user({ id: '9' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/users/9/approve');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '9', type: 'frame_user', status: 'active' });
  });

  it('approve_user returns {approved:id} when no doc is returned', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_approve_user({ id: '9' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/users/9/approve');
    expect(JSON.parse(out.content[0].text)).toEqual({ approved: '9' });
  });

  it('approve_user with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_approve_user({ id: '9', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/users/9/approve');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_remove_user ─────────────────────────────────────────────────

  it('remove_user deletes by id and returns removed id', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_remove_user({ id: '9' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/users/9');
    expect(JSON.parse(out.content[0].text)).toEqual({ removed: '9' });
  });

  it('remove_user with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_remove_user({ id: 9, frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/users/9');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_category ─────────────────────────────────────────────

  it('delete_category deletes by id with no body when reassign omitted', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_category({ id: '3' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/categories/3', {});
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '3' });
  });

  it('delete_category passes reassign_to_category_id as the request body when provided', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_category({ id: '3', reassign_to_category_id: '4' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/categories/3', {
      body: { reassign_to_category_id: '4' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '3' });
  });

  it('delete_category with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_category({ id: 3, frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/categories/3', {});
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_family_member ────────────────────────────────────────

  it('update_family_member PUTs compacted {birthday, dietary_preferences} to family_member (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: { label: 'Emma' } } });
    const out = await tools.skylight_update_family_member({ id: '3', birthday: '2015-04-01', dietary_preferences: 'vegetarian' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/categories/3/family_member', {
      body: { birthday: '2015-04-01', dietary_preferences: 'vegetarian' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '3', type: 'category', label: 'Emma' });
  });

  it('update_family_member omits undefined fields (compact)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: {} } });
    await tools.skylight_update_family_member({ id: '3', birthday: '2015-04-01' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/categories/3/family_member', {
      body: { birthday: '2015-04-01' },
    });
    const body = request.mock.calls[0][2].body;
    expect(body).not.toHaveProperty('dietary_preferences');
  });

  it('update_family_member with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: {} } });
    await tools.skylight_update_family_member({ id: 3, dietary_preferences: 'none', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/categories/3/family_member', {
      body: { dietary_preferences: 'none' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_category ─────────────────────────────────────────────

  it('update_category PUTs compacted body and flattens the returned doc (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: { label: 'Emma' } } });
    const out = await tools.skylight_update_category({ id: '3', label: 'Emma', color: '#FF0000' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/categories/3', {
      body: { label: 'Emma', color: '#FF0000' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '3', type: 'category', label: 'Emma' });
  });

  it('update_category converts a label into a profile (linked_to_profile + selected_for_chore_chart + avatar_id)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: {} } });
    await tools.skylight_update_category({ id: '3', linked_to_profile: true, selected_for_chore_chart: true, avatar_id: 9 });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/categories/3', {
      body: { linked_to_profile: true, selected_for_chore_chart: true, avatar_id: 9 },
    });
  });

  it('update_category omits undefined fields (compact)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: {} } });
    await tools.skylight_update_category({ id: '3', label: 'Dad' });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ label: 'Dad' });
    expect(body).not.toHaveProperty('color');
  });

  it('update_category with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: {} } });
    await tools.skylight_update_category({ id: 3, label: 'Mom', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/categories/3', {
      body: { label: 'Mom' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_create_category ─────────────────────────────────────────────

  it('create_category POSTs a compacted body with the default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'category', attributes: { label: 'Grandma', color: '#82D7DD' } } });
    const out = await tools.skylight_create_category({
      label: 'Grandma', color: '#82D7DD', linked_to_profile: true, selected_for_chore_chart: true, avatar_id: '79',
    });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/categories', {
      body: { label: 'Grandma', color: '#82D7DD', linked_to_profile: true, selected_for_chore_chart: true, avatar_id: '79' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '7', type: 'category', label: 'Grandma', color: '#82D7DD' });
  });

  it('create_category omits undefined fields (compact) — label only', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'category', attributes: {} } });
    await tools.skylight_create_category({ label: 'Sitter' });
    const body = request.mock.calls[0][2].body;
    expect(body).toEqual({ label: 'Sitter' });
    expect(body).not.toHaveProperty('color');
    expect(body).not.toHaveProperty('avatar_id');
  });

  it('create_category with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'category', attributes: {} } });
    await tools.skylight_create_category({ label: 'Dog', color: '#A2845E', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/categories', {
      body: { label: 'Dog', color: '#A2845E' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_avatars ────────────────────────────────────────────────

  it('list_avatars GETs the global /avatars library and flattens it', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({
      data: [{ id: '79', type: 'avatar', attributes: { name: 'cake', image_url: 'https://x/cake.png', kind: 'emoji' } }],
    });
    const out = await tools.skylight_list_avatars({});
    expect(request).toHaveBeenCalledWith('GET', '/avatars');
    expect(resolveFrameId).not.toHaveBeenCalled();
    expect(JSON.parse(out.content[0].text)).toEqual([
      { id: '79', type: 'avatar', name: 'cake', image_url: 'https://x/cake.png', kind: 'emoji' },
    ]);
  });

  // ── skylight_set_member_avatar ───────────────────────────────────────────

  it('set_member_avatar without confirm returns a dry-run preview and makes NO network/file call', async () => {
    const { tools, request } = harness();
    const out = await tools.skylight_set_member_avatar({ id: '9', image_path: '/tmp/secret.png' });
    expect(fileBlobMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    const preview = JSON.parse(out.content[0].text);
    expect(preview.dryRun).toBe(true);
    expect(preview.willSend).toEqual({ image_path: '/tmp/secret.png', mime: 'image/png' });
    expect(preview.note).toMatch(/confirm: true/);
  });

  it('set_member_avatar PUTs the image as multipart profile_picture (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'category', attributes: { profile_picture_urls: { original: 'https://cdn/x.png' } } } });
    const out = await tools.skylight_set_member_avatar({ id: '9', image_path: '/tmp/face.png', confirm: true });

    expect(fileBlobMock).toHaveBeenCalledWith('/tmp/face.png', { type: 'image/png' });
    const [method, path, opts] = request.mock.calls[0];
    expect(method).toBe('PUT');
    expect(path).toBe('/frames/3435252/categories/9');
    expect(opts.formData).toBeInstanceOf(FormData);
    const file = opts.formData.get('profile_picture') as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe('image/png');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '9', type: 'category', profile_picture_urls: { original: 'https://cdn/x.png' } });
  });

  it('set_member_avatar derives content-type from the extension (jpg) and respects frameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'category', attributes: {} } });
    await tools.skylight_set_member_avatar({ id: '9', image_path: '/tmp/face.JPG', frameId: '99', confirm: true });
    expect(request.mock.calls[0][1]).toBe('/frames/99/categories/9');
    expect((request.mock.calls[0][2].formData.get('profile_picture') as File).type).toBe('image/jpeg');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  it('set_member_avatar defaults an extensionless path to a png part', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'category', attributes: {} } });
    await tools.skylight_set_member_avatar({ id: '9', image_path: '/tmp/rawface', confirm: true });
    const file = request.mock.calls[0][2].formData.get('profile_picture') as File;
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('avatar.png');
  });

  it('set_member_avatar uses octet-stream for an unrecognized extension', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'category', attributes: {} } });
    await tools.skylight_set_member_avatar({ id: '9', image_path: '/tmp/face.bmp', confirm: true });
    expect((request.mock.calls[0][2].formData.get('profile_picture') as File).type).toBe('application/octet-stream');
  });
});
