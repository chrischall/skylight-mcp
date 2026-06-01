import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi, type JsonApiDoc } from './_shared.js';

const idParam = z.union([z.string(), z.number()]);
const idArray = z.array(z.union([z.string(), z.number()]));

type GetClient = () => Promise<SkylightClient>;

export function registerMessageTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_messages', 'List messages posted to the Skylight frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/messages`)));
  });

  server.tool('skylight_list_albums', 'List photo albums on the Skylight frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/albums`)));
  });

  server.tool('skylight_get_message', 'Get one frame message.', {
    id: z.string(),
    frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/messages/${id}`)));
  });

  server.tool('skylight_create_album', 'Create a photo album.', {
    title: z.string(),
    frameId: z.string().optional(),
  }, async ({ title, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/albums`, { body: { title } })));
  });

  server.tool('skylight_delete_album', 'Delete a photo album.', {
    id: idParam,
    frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    await c.request('DELETE', `/frames/${f}/albums/${id}`);
    return textContent({ deleted: id });
  });

  server.tool('skylight_add_to_album', 'Add messages/photos to albums.', {
    album_ids: idArray,
    message_ids: idArray,
    frameId: z.string().optional(),
  }, async ({ album_ids, message_ids, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/albums/add_to`, { body: { album_ids, message_ids } })));
  });

  server.tool('skylight_remove_from_album', 'Remove messages/photos from albums.', {
    album_ids: idArray,
    message_ids: idArray,
    frameId: z.string().optional(),
  }, async ({ album_ids, message_ids, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/albums/remove_from`, { body: { album_ids, message_ids } })));
  });

  server.tool('skylight_add_message_comment', 'Comment on a frame message/photo.', {
    id: z.string(),
    body: z.string().describe('Comment text.'),
    frameId: z.string().optional(),
  }, async ({ id, body, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', `/frames/${f}/messages/${id}/comments`, { body: { body } })));
  });

  server.tool('skylight_set_message_caption', 'Set a message/photo caption.', {
    id: z.string(),
    caption: z.string(),
    frameId: z.string().optional(),
  }, async ({ id, caption, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', `/frames/${f}/messages/${id}/caption`, { body: { caption } })));
  });

  server.tool('skylight_like_message', 'Like a frame message/photo.', {
    id: z.string(),
    frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/messages/${id}/likes`);
    return textContent(doc ? flattenJsonApi(doc) : { liked: id });
  });

  server.tool('skylight_unlike_message', 'Remove a like from a message/photo.', {
    id: idParam,
    frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    await c.request('DELETE', `/frames/${f}/messages/${id}/likes`);
    return textContent({ unliked: id });
  });

  server.tool('skylight_delete_message', 'Delete a frame message/photo.', {
    id: idParam,
    frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    await c.request('DELETE', `/frames/${f}/messages/${id}`);
    return textContent({ deleted: id });
  });
}
