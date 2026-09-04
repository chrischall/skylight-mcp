import { z } from 'zod';
import { extname } from 'node:path';
import { fileBlob } from '@chrischall/mcp-utils';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, idParam, type GetClient, type JsonApiDoc } from './_shared.js';
import { previewFileUploadUnlessConfirmed, schemaConfirm } from './_confirm.js';

const AVATAR_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', gif: 'image/gif', webp: 'image/webp',
};

export function registerMemberTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_resolve_member',
    {
      description: 'Resolve a family-member name to its category id (used by chores/rewards). On a name match returns { matched: true, members }; if nothing matches it returns { matched: false, members, note } listing all members.',
      inputSchema: {
        name: z.string().describe('Family-member name (or partial) to resolve to a category id.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
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
    }),
  );

  server.registerTool(
    'skylight_invite_user',
    {
      description: 'Invite a user to the frame by email.',
      inputSchema: {
        email: z.string().describe('Email to invite to the frame.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { email }: { email: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/users`, { body: { email } })))),
  );

  server.registerTool(
    'skylight_approve_user',
    {
      description: 'Approve a pending frame user.',
      inputSchema: { id: z.string(), frameId: z.string().optional() },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/users/${id}/approve`);
      return textContent(doc ? flattenJsonApi(doc) : { approved: id });
    }),
  );

  server.registerTool(
    'skylight_remove_user',
    {
      description: 'Remove a user from the frame.',
      inputSchema: { id: idParam, frameId: z.string().optional() },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/users/${id}`);
      return textContent({ removed: id });
    }),
  );

  // NOTE: reassign_to_category_id passthrough inferred from the app bundle.
  server.registerTool(
    'skylight_delete_category',
    {
      description: 'Delete a category / family member.',
      inputSchema: {
        id: idParam,
        reassign_to_category_id: idParam.optional().describe("Move this member's items to another category id instead of orphaning them."),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, reassign_to_category_id }: { id: string | number; reassign_to_category_id?: string | number; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/categories/${id}`, reassign_to_category_id !== undefined ? { body: { reassign_to_category_id } } : {});
      return textContent({ deleted: id });
    }),
  );

  server.registerTool(
    'skylight_update_family_member',
    {
      description: "Update a family member's profile (birthday, dietary preferences). The member's name is the category label — set it via skylight_update_category.",
      inputSchema: {
        id: idParam.describe('Category/member id.'),
        birthday: z.string().optional().describe('YYYY-MM-DD'),
        dietary_preferences: z.string().optional(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, birthday, dietary_preferences }: { id: string | number; birthday?: string; dietary_preferences?: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/categories/${id}/family_member`, { body: pruneUndefined({ birthday, dietary_preferences }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_list_avatars',
    {
      description: "List the preset avatar library (emoji/icon images). Use an avatar id with skylight_create_category / skylight_update_category to set a member's avatar without uploading a custom photo.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => textContent(flattenJsonApi(await (await getClient()).request<JsonApiDoc>('GET', '/avatars'))),
  );

  // LIVE-VERIFIED: a custom photo avatar is a multipart/form-data PUT to the category with a
  // `profile_picture` file part (NOT the S3 cloud-upload flow); the server pushes it to Cloudinary
  // and fills in `profile_picture_urls`. Preset emoji avatars use `avatar_id` instead (no upload).
  const setMemberAvatar = frameScoped(getClient, async (c, f, { id, image_path }: { id: string | number; image_path: string; frameId?: string }) => {
    const ext = extname(image_path).slice(1).toLowerCase() || 'png';
    const formData = new FormData();
    // fileBlob streams the file off disk (file-backed Blob) instead of buffering it.
    formData.append('profile_picture', await fileBlob(image_path, { type: AVATAR_MIME[ext] ?? 'application/octet-stream' }), `avatar.${ext}`);
    const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/categories/${id}`, { formData });
    return textContent(flattenJsonApi(doc));
  });

  server.registerTool(
    'skylight_set_member_avatar',
    {
      description: "Set a family member's avatar to a custom photo from a local image file (uploaded as multipart/form-data). For a preset emoji avatar, use skylight_list_avatars + the avatar_id on create/update instead. Without confirm:true it returns a dry-run preview echoing the resolved absolute image_path + detected mime and makes NO network call; with confirm:true it uploads.",
      inputSchema: {
        id: idParam.describe('Category/member id.'),
        image_path: z.string().describe('Absolute path to a local image file (jpg, png, heic, …).'),
        frameId: z.string().optional(),
        confirm: schemaConfirm,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args: { id: string | number; image_path: string; frameId?: string; confirm?: boolean }) => {
      const gate = previewFileUploadUnlessConfirmed(args.confirm, args.image_path, "Upload a local file as a member's avatar", 'PUT', '/frames/{frame}/categories/{id}', AVATAR_MIME, 'png', { id: args.id });
      if (gate) return gate;
      return setMemberAvatar(args);
    },
  );

  server.registerTool(
    'skylight_create_category',
    {
      description: 'Create a category / family member on the frame. Set linked_to_profile + selected_for_chore_chart to make it a full chore-chart member; pick avatar_id from skylight_list_avatars, or set a custom photo afterward with skylight_set_member_avatar.',
      inputSchema: {
        label: z.string().describe('Display name for the member/category.'),
        color: z.string().optional().describe('Hex color, e.g. "#82D7DD".'),
        linked_to_profile: z.boolean().optional().describe('Make this a full family-member profile (vs a basic label).'),
        selected_for_chore_chart: z.boolean().optional().describe('Show this member on the chore chart.'),
        avatar_id: idParam.optional().describe('Preset avatar id from skylight_list_avatars.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { label, color, linked_to_profile, selected_for_chore_chart, avatar_id }: { label: string; color?: string; linked_to_profile?: boolean; selected_for_chore_chart?: boolean; avatar_id?: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/categories`, { body: pruneUndefined({ label, color, linked_to_profile, selected_for_chore_chart, avatar_id }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_update_category',
    {
      description: 'Update a category — rename/recolor, or convert a label into a family-member profile (linked_to_profile).',
      inputSchema: {
        id: idParam.describe('Category id.'),
        label: z.string().optional().describe('Display name.'),
        color: z.string().optional().describe('Hex color.'),
        linked_to_profile: z.boolean().optional().describe('Set true to convert a basic label into a full family-member profile.'),
        selected_for_chore_chart: z.boolean().optional(),
        avatar_id: idParam.optional(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, label, color, linked_to_profile, selected_for_chore_chart, avatar_id }: { id: string | number; label?: string; color?: string; linked_to_profile?: boolean; selected_for_chore_chart?: boolean; avatar_id?: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/categories/${id}`, { body: pruneUndefined({ label, color, linked_to_profile, selected_for_chore_chart, avatar_id }) });
      return textContent(flattenJsonApi(doc));
    }),
  );
}
