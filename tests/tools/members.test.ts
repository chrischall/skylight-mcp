import { describe, it, expect } from 'vitest';
import { registerMemberTools } from '../../src/tools/members.js';
import { makeClient } from './_setup.js';

function harness() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const server = { tool: (name: string, _desc: string, _schema: any, cb: any) => { tools[name] = cb; } } as any;
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

  it('update_family_member PUTs compacted {name, birthday} to family_member (default frame)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: { label: 'Emma' } } });
    const out = await tools.skylight_update_family_member({ id: '3', name: 'Emma', birthday: '2015-04-01' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/categories/3/family_member', {
      body: { name: 'Emma', birthday: '2015-04-01' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '3', type: 'category', label: 'Emma' });
  });

  it('update_family_member omits undefined fields (compact)', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: {} } });
    await tools.skylight_update_family_member({ id: '3', name: 'Emma' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/categories/3/family_member', {
      body: { name: 'Emma' },
    });
    const body = request.mock.calls[0][2].body;
    expect(body).not.toHaveProperty('birthday');
  });

  it('update_family_member with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '3', type: 'category', attributes: {} } });
    await tools.skylight_update_family_member({ id: 3, birthday: '2015-04-01', frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/categories/3/family_member', {
      body: { birthday: '2015-04-01' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
