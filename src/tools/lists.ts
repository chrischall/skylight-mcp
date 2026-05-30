import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function registerListTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_lists', 'List all lists on a Skylight frame.', {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/lists`) as any));
  });

  server.tool('skylight_get_list_items', 'Get all items in a specific list on a Skylight frame.', {
    listId: z.string(),
    frameId: z.string().optional(),
  }, async ({ listId, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request('GET', `/frames/${f}/lists/${listId}/list_items`) as any));
  });

  server.tool('skylight_create_list', 'Create a new list on a Skylight frame.', {
    label: z.string(),
    color: z.string().optional(),
    kind: z.string().optional().describe('grocery|todo|... list kind'),
    frameId: z.string().optional(),
  }, async ({ label, color, kind, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request('POST', `/frames/${f}/lists`, { body: compact({ label, color, kind }) });
    return textContent(flattenJsonApi(doc as any));
  });

  server.tool('skylight_add_list_item', 'Add an item to a list on a Skylight frame.', {
    listId: z.string(),
    label: z.string(),
    frameId: z.string().optional(),
  }, async ({ listId, label, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request('POST', `/frames/${f}/lists/${listId}/list_items`, { body: compact({ label }) });
    return textContent(flattenJsonApi(doc as any));
  });

  server.tool('skylight_update_list_item', 'Update a list item on a Skylight frame.', {
    listId: z.string(),
    itemId: z.string(),
    label: z.string().optional(),
    checked: z.boolean().optional().describe('Mark the item checked/unchecked.'),
    frameId: z.string().optional(),
  }, async ({ listId, itemId, label, checked, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request('PATCH', `/frames/${f}/lists/${listId}/list_items/${itemId}`, { body: compact({ label, checked }) });
    return textContent(flattenJsonApi(doc as any));
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
}
