import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, idParam, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerMessageTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_list_messages',
    {
      description: 'List messages posted to the Skylight frame.',
      inputSchema: {
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/messages`)))),
  );

  server.registerTool(
    'skylight_list_albums',
    {
      description: 'List photo albums on the Skylight frame.',
      inputSchema: {
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/albums`)))),
  );

  server.registerTool(
    'skylight_get_message',
    {
      description: 'Get one frame message.',
      inputSchema: {
        id: z.string(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/messages/${id}`)))),
  );

  server.registerTool(
    'skylight_create_album',
    {
      description: 'Create a photo album.',
      inputSchema: {
        title: z.string(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { title }: { title: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/albums`, { body: { title } })))),
  );

  server.registerTool(
    'skylight_delete_album',
    {
      description: 'Delete a photo album.',
      inputSchema: {
        id: idParam,
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/albums/${id}`);
      return textContent({ deleted: id });
    }),
  );

  server.registerTool(
    'skylight_update_album',
    {
      description: 'Update a photo album (rename, hide from slideshow).',
      inputSchema: {
        id: idParam,
        title: z.string().optional(),
        exclude_from_slideshow: z.boolean().optional().describe('Hide this album from the frame slideshow.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, title, exclude_from_slideshow }: { id: string | number; title?: string; exclude_from_slideshow?: boolean; frameId?: string }) => {
      const body = pruneUndefined({ title, exclude_from_slideshow });
      return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PATCH', `/frames/${f}/albums/${id}`, { body })));
    }),
  );

  server.registerTool(
    'skylight_add_to_album',
    {
      description: 'Add messages/photos to albums.',
      inputSchema: {
        album_ids: idArrayParam,
        message_ids: idArrayParam,
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { album_ids, message_ids }: { album_ids: Array<string | number>; message_ids: Array<string | number>; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/albums/add_to`, { body: { album_ids, message_ids } })))),
  );

  server.registerTool(
    'skylight_remove_from_album',
    {
      description: 'Remove messages/photos from albums.',
      inputSchema: {
        album_ids: idArrayParam,
        message_ids: idArrayParam,
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { album_ids, message_ids }: { album_ids: Array<string | number>; message_ids: Array<string | number>; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/albums/remove_from`, { body: { album_ids, message_ids } })))),
  );

  server.registerTool(
    'skylight_copy_messages_to_frames',
    {
      description: 'Copy messages/photos from this frame to other frames on the account (inferred from the app bundle, not live-verified).',
      inputSchema: {
        message_ids: idArrayParam.describe('Message/photo ids to copy.'),
        new_frame_ids: idArrayParam.describe('Destination frame ids (see skylight_list_frames).'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { message_ids, new_frame_ids }: { message_ids: Array<string | number>; new_frame_ids: Array<string | number>; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/copy_to_frames`, { body: { message_ids, new_frame_ids } });
      return textContent(doc ? flattenJsonApi(doc) : { copied: message_ids.length, new_frame_ids });
    }),
  );

  server.registerTool(
    'skylight_add_message_comment',
    {
      description: 'Comment on a frame message/photo.',
      inputSchema: {
        id: z.string(),
        body: z.string().describe('Comment text.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, body }: { id: string; body: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/messages/${id}/comments`, { body: { body } })))),
  );

  server.registerTool(
    'skylight_set_message_caption',
    {
      description: 'Set a message/photo caption.',
      inputSchema: {
        id: z.string(),
        caption: z.string(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, caption }: { id: string; caption: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/messages/${id}/caption`, { body: { caption } })))),
  );

  server.registerTool(
    'skylight_like_message',
    {
      description: 'Like a frame message/photo.',
      inputSchema: {
        id: z.string(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/messages/${id}/likes`);
      return textContent(doc ? flattenJsonApi(doc) : { liked: id });
    }),
  );

  server.registerTool(
    'skylight_unlike_message',
    {
      description: 'Remove a like from a message/photo.',
      inputSchema: {
        id: idParam,
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/messages/${id}/likes`);
      return textContent({ unliked: id });
    }),
  );

  server.registerTool(
    'skylight_delete_messages',
    {
      description: 'Bulk-delete messages/photos from the frame.',
      inputSchema: {
        message_ids: idArrayParam.describe('Message/photo ids to delete.'),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { message_ids }: { message_ids: Array<string | number>; frameId?: string }) => {
      const qs = message_ids.map((id) => `message_ids[]=${encodeURIComponent(String(id))}`).join('&');
      await c.request('DELETE', `/frames/${f}/messages/destroy_multiple?${qs}`);
      return textContent({ deleted: message_ids.length });
    }),
  );

  server.registerTool(
    'skylight_delete_message',
    {
      description: 'Delete a frame message/photo.',
      inputSchema: {
        id: idParam,
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/messages/${id}`);
      return textContent({ deleted: id });
    }),
  );
}
