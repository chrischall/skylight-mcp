import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerMemberTools } from '../../src/tools/members.js';
import { makeClient, NO_ELICIT_CTX, confirmed, phaseOne } from './_setup.js';
import { fileBlob } from '@chrischall/mcp-utils';
import { extname } from 'node:path';
import { vetUploadFile } from '../../src/upload-guard.js';

// Partial-mock @chrischall/mcp-utils so only fileBlob is stubbed (avatar upload
// streams the file via a file-backed Blob); the mock returns a Blob carrying the
// requested type. Everything else (textResult, flattenJsonApi, …) stays real.
vi.mock('@chrischall/mcp-utils', async (orig) => ({
  ...(await orig<typeof import('@chrischall/mcp-utils')>()),
  fileBlob: vi.fn(),
}));
const fileBlobMock = vi.mocked(fileBlob);
// The guard's rules are exercised against real files in upload-guard.test.ts;
// stubbed here so these tests stay about what the avatar tool does with its verdict.
vi.mock('../../src/upload-guard.js', () => ({ vetUploadFile: vi.fn() }));
const vetMock = vi.mocked(vetUploadFile);
const STUB_MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png' };
beforeEach(() => {
  fileBlobMock
    .mockReset()
    .mockImplementation(async (_path: string, opts?: { type?: string }) =>
      new Blob([Buffer.from('imgbytes')], opts),
    );
  vetMock.mockReset().mockImplementation(async (p: string) => {
    const ext = extname(p).slice(1).toLowerCase();
    return { resolved: `/abs${p}`, ext, mime: STUB_MIME[ext]!, size: 8 };
  });
});

function harness() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  // Minimal `registerTool(name, config, handler)` stand-in: this harness only
  // needs the handler, so the config is ignored here. `tool-annotations.test.ts`
  // is what reads the config and holds every tool to declaring `readOnlyHint`.
  const server = { registerTool: (name: string, _cfg: any, cb: any) => { tools[name] = (a: any) => cb(a, NO_ELICIT_CTX); } } as any;
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
    const out = await confirmed(tools.skylight_invite_user, { email: 'a@b.com' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/users', { body: { email: 'a@b.com' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '9', type: 'frame_user', email: 'a@b.com' });
  });

  it('invite_user with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'frame_user', attributes: {} } });
    await confirmed(tools.skylight_invite_user, { email: 'c@d.com', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/users', { body: { email: 'c@d.com' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_approve_user ────────────────────────────────────────────────

  it('approve_user POSTs and flattens a returned doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'frame_user', attributes: { status: 'active' } } });
    const out = await confirmed(tools.skylight_approve_user, { id: '9' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/users/9/approve');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '9', type: 'frame_user', status: 'active' });
  });

  it('approve_user returns {approved:id} when no doc is returned', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await confirmed(tools.skylight_approve_user, { id: '9' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/users/9/approve');
    expect(JSON.parse(out.content[0].text)).toEqual({ approved: '9' });
  });

  it('approve_user with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await confirmed(tools.skylight_approve_user, { id: '9', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/users/9/approve');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── access grants are confirm-gated (fleet-audit#246) ────────────────────

  it('invite_user phase 1 returns a preview naming the email and frame, and makes NO request', async () => {
    const { tools, request } = harness();
    const out = phaseOne(await tools.skylight_invite_user({ email: 'helper@attacker.example' }));
    expect(request).not.toHaveBeenCalled();
    expect(out.status).toBe('confirmation-required');
    expect(out.preview).toMatchObject({
      method: 'POST',
      path: '/frames/3435252/users',
      willSend: { email: 'helper@attacker.example' },
    });
    expect(out.preview.description).toMatch(/helper@attacker\.example/);
    expect(out.preview.description).toMatch(/3435252/);
  });

  it('approve_user phase 1 returns a preview naming the user, and makes NO request', async () => {
    const { tools, request } = harness();
    const out = phaseOne(await tools.skylight_approve_user({ id: '9' }));
    expect(request).not.toHaveBeenCalled();
    expect(out.status).toBe('confirmation-required');
    expect(out.preview).toMatchObject({ method: 'POST', path: '/frames/3435252/users/9/approve' });
    expect(out.preview.description).toMatch(/user 9/);
  });

  // ── skylight_remove_user (confirm-gated, fleet-audit#963) ────────────────

  /** GET /frames/{f}/users → the member list the preview names people from. */
  const MEMBERS = {
    data: [
      { id: '9', type: 'frame_user', attributes: { name: 'Grandma', email: 'gran@example.test', status: 'active' } },
      { id: '10', type: 'frame_user', attributes: { email: 'sitter@example.test', status: 'pending' } },
    ],
  };
  function membersThenDelete(request: ReturnType<typeof harness>['request']) {
    request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && /\/users$/.test(path)) return MEMBERS;
      return undefined;
    });
  }

  it('remove_user phase 1 names the member (not just the id) and the frame, and issues NO DELETE', async () => {
    const { tools, request } = harness();
    membersThenDelete(request);
    const out = phaseOne(await tools.skylight_remove_user({ id: '9' }));
    expect(out.status).toBe('confirmation-required');
    expect(out.action).toBe('user.remove');
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/users');
    expect(request.mock.calls.filter((c) => c[0] === 'DELETE')).toEqual([]);
    expect(out.preview).toMatchObject({
      method: 'DELETE',
      path: '/frames/3435252/users/9',
      willSend: { id: '9', user: 'Grandma (gran@example.test)' },
    });
    expect(out.preview.description).toMatch(/Grandma/);
    expect(out.preview.description).toMatch(/gran@example\.test/);
    expect(out.preview.description).toMatch(/3435252/);
    expect(out.preview.description).toMatch(/access/i);
  });

  it('remove_user names a member by email when there is no name, and says when the id is not a member at all', async () => {
    const { tools, request } = harness();
    membersThenDelete(request);
    const known = phaseOne(await tools.skylight_remove_user({ id: 10 }));
    expect(known.preview.willSend).toEqual({ id: 10, user: 'sitter@example.test' });

    const unknown = phaseOne(await tools.skylight_remove_user({ id: '4821' }));
    expect(unknown.preview.willSend).toEqual({ id: '4821', user: null });
    expect(unknown.preview.description).toMatch(/not .*member/i);
    expect(request.mock.calls.filter((c) => c[0] === 'DELETE')).toEqual([]);
  });

  it('remove_user names a member by first/last name when there is no email, and says when neither is on record', async () => {
    const { tools, request } = harness();
    request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && /\/users$/.test(path)) {
        return {
          data: [
            { id: '11', type: 'frame_user', attributes: { first_name: 'Ada', last_name: ' Lovelace ', email: '  ' } },
            { id: '12', type: 'frame_user', attributes: { name: '', status: 'pending' } },
          ],
        };
      }
      return undefined;
    });
    const named = phaseOne(await tools.skylight_remove_user({ id: '11' }));
    expect(named.preview.willSend).toEqual({ id: '11', user: 'Ada Lovelace' });
    const blank = phaseOne(await tools.skylight_remove_user({ id: '12' }));
    expect(blank.preview.willSend).toEqual({ id: '12', user: '(no name or email on record)' });
    expect(blank.preview.description).toMatch(/no name or email on record/);
  });

  it('remove_user deletes by id only on the confirmed call and returns removed id', async () => {
    const { tools, request } = harness();
    membersThenDelete(request);
    const out = await confirmed(tools.skylight_remove_user, { id: '9' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/users/9');
    expect(request.mock.calls.filter((c) => c[0] === 'DELETE')).toHaveLength(1);
    expect(JSON.parse(out.content[0].text)).toEqual({ removed: '9' });
  });

  it('remove_user with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    membersThenDelete(request);
    await confirmed(tools.skylight_remove_user, { id: 9, frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/users');
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/users/9');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_category (confirm-gated, fleet-audit#963) ────────────

  const CATEGORIES = {
    data: [
      { id: '3', type: 'category', attributes: { label: 'Emma' } },
      { id: '4', type: 'category', attributes: { label: 'Dad' } },
    ],
  };
  function categoriesThenDelete(request: ReturnType<typeof harness>['request']) {
    request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && /\/categories$/.test(path)) return CATEGORIES;
      return undefined;
    });
  }

  it('delete_category phase 1 names the member by label, warns about orphaned items, and issues NO DELETE', async () => {
    const { tools, request } = harness();
    categoriesThenDelete(request);
    const out = phaseOne(await tools.skylight_delete_category({ id: '3' }));
    expect(out.status).toBe('confirmation-required');
    expect(out.action).toBe('category.delete');
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/categories');
    expect(request.mock.calls.filter((c) => c[0] === 'DELETE')).toEqual([]);
    expect(out.preview).toMatchObject({
      method: 'DELETE',
      path: '/frames/3435252/categories/3',
      willSend: { id: '3', label: 'Emma' },
    });
    expect(out.preview.willSend).not.toHaveProperty('reassign_to_category_id');
    expect(out.preview.description).toMatch(/"Emma"/);
    expect(out.preview.description).toMatch(/orphan/i);
    expect(out.preview.description).toMatch(/reassign_to_category_id/);
  });

  it('delete_category phase 1 names the destination member when reassign_to_category_id is given', async () => {
    const { tools, request } = harness();
    categoriesThenDelete(request);
    const out = phaseOne(await tools.skylight_delete_category({ id: '3', reassign_to_category_id: '4' }));
    expect(out.preview.willSend).toEqual({ id: '3', label: 'Emma', reassign_to_category_id: '4', reassign_to_label: 'Dad' });
    expect(out.preview.description).toMatch(/"Emma"/);
    expect(out.preview.description).toMatch(/"Dad"/);
    expect(out.preview.description).not.toMatch(/orphan/i);
  });

  it('delete_category says so when the id is not one of the frame\'s categories', async () => {
    const { tools, request } = harness();
    categoriesThenDelete(request);
    const out = phaseOne(await tools.skylight_delete_category({ id: '7' }));
    expect(out.preview.willSend).toEqual({ id: '7', label: null });
    expect(out.preview.description).toMatch(/not .*categor/i);
    expect(request.mock.calls.filter((c) => c[0] === 'DELETE')).toEqual([]);
  });

  it('delete_category shows a category with no label as an empty label, and flags an unknown reassignment target', async () => {
    const { tools, request } = harness();
    request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && /\/categories$/.test(path)) return { data: [{ id: '5', type: 'category', attributes: {} }] };
      return undefined;
    });
    const out = phaseOne(await tools.skylight_delete_category({ id: '5', reassign_to_category_id: '8' }));
    expect(out.preview.willSend).toEqual({ id: '5', label: '', reassign_to_category_id: '8', reassign_to_label: null });
    expect(out.preview.description).toMatch(/"" \(category 5\)/);
    expect(out.preview.description).toMatch(/category 8 \(NOT one of the frame's categories/);
  });

  it('delete_category deletes by id with no body when reassign omitted — only on the confirmed call', async () => {
    const { tools, request } = harness();
    categoriesThenDelete(request);
    const out = await confirmed(tools.skylight_delete_category, { id: '3' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/categories/3', {});
    expect(request.mock.calls.filter((c) => c[0] === 'DELETE')).toHaveLength(1);
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '3' });
  });

  it('delete_category passes reassign_to_category_id as the request body when provided', async () => {
    const { tools, request } = harness();
    categoriesThenDelete(request);
    const out = await confirmed(tools.skylight_delete_category, { id: '3', reassign_to_category_id: '4' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/categories/3', {
      body: { reassign_to_category_id: '4' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '3' });
  });

  it('delete_category with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    categoriesThenDelete(request);
    await confirmed(tools.skylight_delete_category, { id: 3, frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/categories');
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

  it('set_member_avatar phase 1 returns a preview + confirmToken and makes NO network/file call', async () => {
    const { tools, request } = harness();
    const out = phaseOne(await tools.skylight_set_member_avatar({ id: '9', image_path: '/tmp/secret.png' }));
    expect(fileBlobMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(out.status).toBe('confirmation-required');
    expect(out.confirmToken).toEqual(expect.any(String));
    expect(out.preview.willSend).toEqual({ id: '9', image_path: '/abs/tmp/secret.png', mime: 'image/png', bytes: 8 });
  });

  it('set_member_avatar PUTs the image as multipart profile_picture (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'category', attributes: { profile_picture_urls: { original: 'https://cdn/x.png' } } } });
    const out = await confirmed(tools.skylight_set_member_avatar, { id: '9', image_path: '/tmp/face.png' });

    expect(fileBlobMock).toHaveBeenCalledWith('/abs/tmp/face.png', { type: 'image/png' });
    const [method, path, opts] = request.mock.calls[0];
    expect(method).toBe('PUT');
    expect(path).toBe('/frames/3435252/categories/9');
    expect(opts.formData).toBeInstanceOf(FormData);
    const file = opts.formData.get('profile_picture') as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe('image/png');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '9', type: 'category', profile_picture_urls: { original: 'https://cdn/x.png' } });
  });

  it('set_member_avatar confines the file read to SKYLIGHT_UPLOAD_DIR when the guard vetted against it', async () => {
    const { tools, request } = harness();
    vetMock.mockResolvedValue({ resolved: '/inbox/face.png', ext: 'png', mime: 'image/png', size: 8, allowedRoots: ['/inbox'] });
    request.mockResolvedValue({ data: { id: '9', type: 'category', attributes: {} } });
    await confirmed(tools.skylight_set_member_avatar, { id: '9', image_path: '/inbox/face.png' });
    expect(fileBlobMock).toHaveBeenCalledWith('/inbox/face.png', { type: 'image/png', allowedRoots: ['/inbox'] });
  });

  it('set_member_avatar derives content-type from the extension (jpg) and respects frameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'category', attributes: {} } });
    await confirmed(tools.skylight_set_member_avatar, { id: '9', image_path: '/tmp/face.JPG', frameId: '99' });
    expect(request.mock.calls[0][1]).toBe('/frames/99/categories/9');
    expect((request.mock.calls[0][2].formData.get('profile_picture') as File).type).toBe('image/jpeg');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  it('set_member_avatar vets the path against the image allowlist and a size cap', async () => {
    const { tools } = harness();
    await tools.skylight_set_member_avatar({ id: '9', image_path: '/tmp/face.png' });
    expect(vetMock).toHaveBeenCalledWith('/tmp/face.png', {
      mimeByExt: expect.objectContaining({ png: 'image/png', jpg: 'image/jpeg' }),
      maxBytes: 20 * 1024 * 1024,
    });
    expect(vetMock.mock.calls[0]![1].mimeByExt).not.toHaveProperty('mp4');
  });

  it('set_member_avatar uploads nothing when the guard refuses the file, even on the confirmed call', async () => {
    const { tools, request } = harness();
    vetMock.mockRejectedValueOnce(new Error('Refusing to upload /home/u/.aws/credentials'));
    await expect(confirmed(tools.skylight_set_member_avatar, { id: '9', image_path: '~/.aws/credentials' }))
      .rejects.toThrow(/Refusing to upload/);
    expect(fileBlobMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
