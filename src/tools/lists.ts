import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { apiPath, textContent, flattenJsonApi, pruneUndefined, frameScoped, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';
import { confirmTokenParam, confirmWrite, nameSome } from './_confirm.js';

export function registerListTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_list_lists',
    {
      description: 'List all lists on a Skylight frame.',
      inputSchema: z.object({
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', apiPath`/frames/${f}/lists`)))),
  );

  server.registerTool(
    'skylight_get_list_items',
    {
      description: 'Get all items in a specific list on a Skylight frame.',
      inputSchema: z.object({
        listId: z.string(),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f, { listId }: { listId: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', apiPath`/frames/${f}/lists/${listId}/list_items`)))),
  );

  server.registerTool(
    'skylight_create_list',
    {
      description: 'Create a new list on a Skylight frame.',
      inputSchema: z.object({
        label: z.string(),
        color: z.string().describe('Hex color, e.g. #42D792 (required).'),
        kind: z.enum(['shopping', 'to_do']).describe('List type (required).'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { label, color, kind }: { label: string; color: string; kind: 'shopping' | 'to_do'; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', apiPath`/frames/${f}/lists`, { body: pruneUndefined({ label, color, kind }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_add_list_item',
    {
      description: 'Add an item to a list on a Skylight frame.',
      inputSchema: z.object({
        listId: z.string(),
        label: z.string(),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { listId, label }: { listId: string; label: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', apiPath`/frames/${f}/lists/${listId}/list_items`, { body: pruneUndefined({ label }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_update_list_item',
    {
      description: 'Update a list item on a Skylight frame.',
      inputSchema: z.object({
        listId: z.string(),
        itemId: z.string(),
        label: z.string().optional(),
        checked: z.boolean().optional().describe('true marks the item completed, false reopens it.'),
        section: z.string().nullable().optional().describe('Section name (null to clear).'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { listId, itemId, label, checked, section }: { listId: string; itemId: string; label?: string; checked?: boolean; section?: string | null; frameId?: string }) => {
      const status = checked === undefined ? undefined : (checked ? 'completed' : 'pending');
      const doc = await c.request<JsonApiDoc>('PATCH', apiPath`/frames/${f}/lists/${listId}/list_items/${itemId}`, { body: pruneUndefined({ label, status, section }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_delete_list_item',
    {
      description: 'Delete a list item from a Skylight frame.',
      inputSchema: z.object({
        listId: z.string(),
        itemId: z.string(),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    frameScoped(getClient, async (c, f, { listId, itemId }: { listId: string; itemId: string; frameId?: string }) => {
      await c.request('DELETE', apiPath`/frames/${f}/lists/${listId}/list_items/${itemId}`);
      return textContent({ deleted: itemId });
    }),
  );

  server.registerTool(
    'skylight_update_list',
    {
      description: "Update a Skylight list's name, color, or type.",
      inputSchema: z.object({
        listId: z.string(),
        label: z.string().optional(),
        color: z.string().optional(),
        kind: z.enum(['shopping', 'to_do']).optional(),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { listId, label, color, kind }: { listId: string; label?: string; color?: string; kind?: 'shopping' | 'to_do'; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PUT', apiPath`/frames/${f}/lists/${listId}`, { body: pruneUndefined({ label, color, kind }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_delete_list',
    {
      description: 'Delete a Skylight list.',
      inputSchema: z.object({
        listId: z.string(),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    frameScoped(getClient, async (c, f, { listId }: { listId: string; frameId?: string }) => {
      await c.request('DELETE', apiPath`/frames/${f}/lists/${listId}`);
      return textContent({ deleted: listId });
    }),
  );

  server.registerTool(
    'skylight_move_list_item',
    {
      description: 'Reorder a list item.',
      inputSchema: z.object({
        listId: z.string(),
        itemId: z.string(),
        afterItemId: z.string().optional().describe('Place after this item id; omit to move to the top.'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { listId, itemId, afterItemId }: { listId: string; itemId: string; afterItemId?: string; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', apiPath`/frames/${f}/lists/${listId}/list_items/${itemId}/move`, { body: { after_item_id: afterItemId ?? null } });
      return doc ? textContent(flattenJsonApi(doc)) : textContent({ moved: itemId });
    }),
  );

  // LIVE-VERIFIED: bulk_destroy takes a flat { ids: [...] } body. Fetch the
  // current item ids, then issue a single bulk DELETE.
  server.registerTool(
    'skylight_clear_list',
    {
      description: 'Remove all items from a list — permanent. Asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token proceeds (see MCP_CONFIRM_MODE). The preview lists every item that would go, by label, and the token binds that exact set. An already-empty list needs no confirmation.',
      inputSchema: z.object({
        listId: z.string(),
        frameId: z.string().optional(),
        confirmToken: confirmTokenParam,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    // Gated (fleet-audit#964): the caller named a list, not the items in it.
    // The items are read on both phases, so the preview names what is about to
    // go and the token binds that exact set — an item added between the two
    // calls is DRAFT_CHANGED, not silently deleted.
    frameScoped(getClient, async (c, f, { listId, confirmToken }: { listId: string; frameId?: string; confirmToken?: string }, ctx) => {
      const doc = await c.request<{ data?: Array<{ id: string; attributes?: { label?: unknown } }> }>('GET', apiPath`/frames/${f}/lists/${listId}/list_items`);
      const items = (doc?.data ?? []).map((i) => ({ id: i.id, label: String(i.attributes?.label ?? '') }));
      const ids = items.map((i) => i.id);
      if (ids.length === 0) return textContent({ cleared: listId, removed: 0 });
      const path = apiPath`/frames/${f}/lists/${listId}/list_items/bulk_destroy`;
      const gate = await confirmWrite(ctx, {
        tool: 'skylight_clear_list',
        action: 'list.clear',
        description: `Permanently remove all ${ids.length} items from list ${listId} on frame ${f}: ${nameSome(items.map((i) => `"${i.label}"`))}`,
        target: listId,
        method: 'DELETE',
        path,
        body: { listId, ids, items },
        confirmToken,
      });
      if (gate) return gate;
      await c.request('DELETE', path, { body: { ids } });
      return textContent({ cleared: listId, removed: ids.length });
    }),
  );

  server.registerTool(
    'skylight_delete_list_items',
    {
      description: 'Bulk-delete specific list items.',
      inputSchema: z.object({
        listId: z.string(),
        item_ids: idArrayParam.describe('List-item ids to delete.'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    frameScoped(getClient, async (c, f, { listId, item_ids }: { listId: string; item_ids: Array<string | number>; frameId?: string }) => {
      await c.request('DELETE', apiPath`/frames/${f}/lists/${listId}/list_items/bulk_destroy`, { body: { ids: item_ids } });
      return textContent({ deleted: item_ids.length });
    }),
  );

  // LIVE-VERIFIED: bulk_update_section moves list items into a named section (200).
  server.registerTool(
    'skylight_set_list_item_section',
    {
      description: 'Move list items into a named section (or clear it).',
      inputSchema: z.object({
        listId: z.string(),
        item_ids: idArrayParam.describe('List-item ids to move.'),
        section: z.string().nullable().optional().describe('Section name to assign (null/omit to clear the section).'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { listId, item_ids, section }: { listId: string; item_ids: Array<string | number>; section?: string | null; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PUT', apiPath`/frames/${f}/lists/${listId}/list_items/bulk_update_section`, { body: { item_ids, section: section ?? null } });
      return textContent(flattenJsonApi(doc));
    }),
  );
}
