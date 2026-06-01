import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, compact, frameScoped, idParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerMemberTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_resolve_member', 'Resolve a family-member name to its category id (used by chores/rewards). On a name match returns { matched: true, members }; if nothing matches it returns { matched: false, members, note } listing all members.',
    {
      name: z.string().describe('Family-member name (or partial) to resolve to a category id.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { name }: { name: string; frameId?: string }) => {
      const cats = flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/categories`)) as Array<{ id: string; label?: string }>;
      const q = name.toLowerCase();
      const matches = cats.filter((cat) => String(cat.label ?? '').toLowerCase().includes(q));
      if (matches.length > 0) {
        return textContent({ matched: true, members: matches.map((cat) => ({ id: cat.id, label: cat.label })) });
      }
      return textContent({
        matched: false,
        members: cats.map((cat) => ({ id: cat.id, label: cat.label })),
        note: 'No name match; returning all members.',
      });
    }));

  server.tool('skylight_invite_user', 'Invite a user to the frame by email.',
    {
      email: z.string().describe('Email to invite to the frame.'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { email }: { email: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/users`, { body: { email } })))));

  server.tool('skylight_approve_user', 'Approve a pending frame user.',
    { id: z.string(), frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/users/${id}/approve`);
      return textContent(doc ? flattenJsonApi(doc) : { approved: id });
    }));

  server.tool('skylight_remove_user', 'Remove a user from the frame.',
    { id: idParam, frameId: z.string().optional() },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/users/${id}`);
      return textContent({ removed: id });
    }));

  // NOTE: reassign_to_category_id passthrough inferred from the app bundle.
  server.tool('skylight_delete_category', 'Delete a category / family member.',
    {
      id: idParam,
      reassign_to_category_id: idParam.optional().describe("Move this member's items to another category id instead of orphaning them."),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, reassign_to_category_id }: { id: string | number; reassign_to_category_id?: string | number; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/categories/${id}`, reassign_to_category_id !== undefined ? { body: { reassign_to_category_id } } : {});
      return textContent({ deleted: id });
    }));

  // NOTE: family_member field set (name/birthday) inferred from the app bundle, not live-verified.
  server.tool('skylight_update_family_member', "Update a family member's profile (name, birthday).",
    {
      id: idParam.describe('Category/member id.'),
      name: z.string().optional(),
      birthday: z.string().optional().describe('YYYY-MM-DD'),
      frameId: z.string().optional(),
    },
    frameScoped(getClient, async (c, f, { id, name, birthday }: { id: string | number; name?: string; birthday?: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/categories/${id}/family_member`, { body: compact({ name, birthday }) });
      return textContent(flattenJsonApi(doc));
    }));
}
