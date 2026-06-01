import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi, compact, type JsonApiDoc } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

export function registerListTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_lists', 'List all lists on a Skylight frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/lists`)));
  });

  server.tool('skylight_get_list_items', 'Get all items in a specific list on a Skylight frame.', {
    listId: z.string(),
    frameId: z.string().optional(),
  }, async ({ listId, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/lists/${listId}/list_items`)));
  });

  server.tool('skylight_create_list', 'Create a new list on a Skylight frame.', {
    label: z.string(),
    color: z.string().describe('Hex color, e.g. #42D792 (required).'),
    kind: z.enum(['shopping', 'to_do']).describe('List type (required).'),
    frameId: z.string().optional(),
  }, async ({ label, color, kind, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/lists`, { body: compact({ label, color, kind }) });
    return textContent(flattenJsonApi(doc));
  });

  server.tool('skylight_add_list_item', 'Add an item to a list on a Skylight frame.', {
    listId: z.string(),
    label: z.string(),
    frameId: z.string().optional(),
  }, async ({ listId, label, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/lists/${listId}/list_items`, { body: compact({ label }) });
    return textContent(flattenJsonApi(doc));
  });

  server.tool('skylight_update_list_item', 'Update a list item on a Skylight frame.', {
    listId: z.string(),
    itemId: z.string(),
    label: z.string().optional(),
    checked: z.boolean().optional().describe('true marks the item completed, false reopens it.'),
    frameId: z.string().optional(),
  }, async ({ listId, itemId, label, checked, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const status = checked === undefined ? undefined : (checked ? 'completed' : 'pending');
    const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/lists/${listId}/list_items/${itemId}`, { body: compact({ label, status }) });
    return textContent(flattenJsonApi(doc));
  });

  server.tool('skylight_delete_list_item', 'Delete a list item from a Skylight frame.', {
    listId: z.string(),
    itemId: z.string(),
    frameId: z.string().optional(),
  }, async ({ listId, itemId, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    await c.request('DELETE', `/frames/${f}/lists/${listId}/list_items/${itemId}`);
    return textContent({ deleted: itemId });
  });

  server.tool('skylight_update_list', "Update a Skylight list's name, color, or type.", {
    listId: z.string(),
    label: z.string().optional(),
    color: z.string().optional(),
    kind: z.enum(['shopping', 'to_do']).optional(),
    frameId: z.string().optional(),
  }, async ({ listId, label, color, kind, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/lists/${listId}`, { body: compact({ label, color, kind }) });
    return textContent(flattenJsonApi(doc));
  });

  server.tool('skylight_delete_list', 'Delete a Skylight list.', {
    listId: z.string(),
    frameId: z.string().optional(),
  }, async ({ listId, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    await c.request('DELETE', `/frames/${f}/lists/${listId}`);
    return textContent({ deleted: listId });
  });

  server.tool('skylight_move_list_item', 'Reorder a list item.', {
    listId: z.string(),
    itemId: z.string(),
    afterItemId: z.string().optional().describe('Place after this item id; omit to move to the top.'),
    frameId: z.string().optional(),
  }, async ({ listId, itemId, afterItemId, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/lists/${listId}/list_items/${itemId}/move`, { body: { after_item_id: afterItemId ?? null } });
    return doc ? textContent(flattenJsonApi(doc)) : textContent({ moved: itemId });
  });

  server.tool('skylight_clear_list', 'Remove all items from a list.', {
    listId: z.string(),
    frameId: z.string().optional(),
  }, async ({ listId, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    await c.request('DELETE', `/frames/${f}/lists/${listId}/list_items/bulk_destroy`);
    return textContent({ cleared: listId });
  });
}
