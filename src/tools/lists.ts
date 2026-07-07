import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerListTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_lists', 'List all lists on a Skylight frame.', {
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f) =>
    textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/lists`)))));

  server.tool('skylight_get_list_items', 'Get all items in a specific list on a Skylight frame.', {
    listId: z.string(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId }: { listId: string; frameId?: string }) =>
    textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/lists/${listId}/list_items`)))));

  server.tool('skylight_create_list', 'Create a new list on a Skylight frame.', {
    label: z.string(),
    color: z.string().describe('Hex color, e.g. #42D792 (required).'),
    kind: z.enum(['shopping', 'to_do']).describe('List type (required).'),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { label, color, kind }: { label: string; color: string; kind: 'shopping' | 'to_do'; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/lists`, { body: pruneUndefined({ label, color, kind }) });
    return textContent(flattenJsonApi(doc));
  }));

  server.tool('skylight_add_list_item', 'Add an item to a list on a Skylight frame.', {
    listId: z.string(),
    label: z.string(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId, label }: { listId: string; label: string; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/lists/${listId}/list_items`, { body: pruneUndefined({ label }) });
    return textContent(flattenJsonApi(doc));
  }));

  server.tool('skylight_update_list_item', 'Update a list item on a Skylight frame.', {
    listId: z.string(),
    itemId: z.string(),
    label: z.string().optional(),
    checked: z.boolean().optional().describe('true marks the item completed, false reopens it.'),
    section: z.string().nullable().optional().describe('Section name (null to clear).'),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId, itemId, label, checked, section }: { listId: string; itemId: string; label?: string; checked?: boolean; section?: string | null; frameId?: string }) => {
    const status = checked === undefined ? undefined : (checked ? 'completed' : 'pending');
    const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/lists/${listId}/list_items/${itemId}`, { body: pruneUndefined({ label, status, section }) });
    return textContent(flattenJsonApi(doc));
  }));

  server.tool('skylight_delete_list_item', 'Delete a list item from a Skylight frame.', {
    listId: z.string(),
    itemId: z.string(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId, itemId }: { listId: string; itemId: string; frameId?: string }) => {
    await c.request('DELETE', `/frames/${f}/lists/${listId}/list_items/${itemId}`);
    return textContent({ deleted: itemId });
  }));

  server.tool('skylight_update_list', "Update a Skylight list's name, color, or type.", {
    listId: z.string(),
    label: z.string().optional(),
    color: z.string().optional(),
    kind: z.enum(['shopping', 'to_do']).optional(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId, label, color, kind }: { listId: string; label?: string; color?: string; kind?: 'shopping' | 'to_do'; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/lists/${listId}`, { body: pruneUndefined({ label, color, kind }) });
    return textContent(flattenJsonApi(doc));
  }));

  server.tool('skylight_delete_list', 'Delete a Skylight list.', {
    listId: z.string(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId }: { listId: string; frameId?: string }) => {
    await c.request('DELETE', `/frames/${f}/lists/${listId}`);
    return textContent({ deleted: listId });
  }));

  server.tool('skylight_move_list_item', 'Reorder a list item.', {
    listId: z.string(),
    itemId: z.string(),
    afterItemId: z.string().optional().describe('Place after this item id; omit to move to the top.'),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId, itemId, afterItemId }: { listId: string; itemId: string; afterItemId?: string; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc | undefined>('POST', `/frames/${f}/lists/${listId}/list_items/${itemId}/move`, { body: { after_item_id: afterItemId ?? null } });
    return doc ? textContent(flattenJsonApi(doc)) : textContent({ moved: itemId });
  }));

  // LIVE-VERIFIED: bulk_destroy takes a flat { ids: [...] } body. Fetch the
  // current item ids, then issue a single bulk DELETE.
  server.tool('skylight_clear_list', 'Remove all items from a list.', {
    listId: z.string(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId }: { listId: string; frameId?: string }) => {
    const doc = await c.request<{ data?: Array<{ id: string }> }>('GET', `/frames/${f}/lists/${listId}/list_items`);
    const ids = (doc?.data ?? []).map((i) => i.id);
    if (ids.length) await c.request('DELETE', `/frames/${f}/lists/${listId}/list_items/bulk_destroy`, { body: { ids } });
    return textContent({ cleared: listId, removed: ids.length });
  }));

  server.tool('skylight_delete_list_items', 'Bulk-delete specific list items.', {
    listId: z.string(),
    item_ids: idArrayParam.describe('List-item ids to delete.'),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId, item_ids }: { listId: string; item_ids: Array<string | number>; frameId?: string }) => {
    await c.request('DELETE', `/frames/${f}/lists/${listId}/list_items/bulk_destroy`, { body: { ids: item_ids } });
    return textContent({ deleted: item_ids.length });
  }));

  // LIVE-VERIFIED: bulk_update_section moves list items into a named section (200).
  server.tool('skylight_set_list_item_section', 'Move list items into a named section (or clear it).', {
    listId: z.string(),
    item_ids: idArrayParam.describe('List-item ids to move.'),
    section: z.string().nullable().optional().describe('Section name to assign (null/omit to clear the section).'),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { listId, item_ids, section }: { listId: string; item_ids: Array<string | number>; section?: string | null; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc>('PUT', `/frames/${f}/lists/${listId}/list_items/bulk_update_section`, { body: { item_ids, section: section ?? null } });
    return textContent(flattenJsonApi(doc));
  }));
}
