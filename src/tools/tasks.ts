import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, compact, frameScoped, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerTaskTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_tasks', "List task-box items (the frame's task list).", {
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f) =>
    textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/task_box/items`)))));

  server.tool('skylight_create_task', 'Create a task-box item.', {
    summary: z.string().describe('Task title.'),
    emoji_icon: z.string().optional(),
    reward_points: z.number().optional(),
    routine: z.boolean().optional(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { summary, emoji_icon, reward_points, routine }: { summary: string; emoji_icon?: string; reward_points?: number; routine?: boolean; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/task_box/items`, { body: compact({ summary, emoji_icon, reward_points, routine }) });
    return textContent(flattenJsonApi(doc));
  }));

  server.tool('skylight_update_task', 'Update a task-box item.', {
    id: z.string(),
    summary: z.string().optional(),
    emoji_icon: z.string().optional(),
    reward_points: z.number().optional(),
    routine: z.boolean().optional(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { id, summary, emoji_icon, reward_points, routine }: { id: string; summary?: string; emoji_icon?: string; reward_points?: number; routine?: boolean; frameId?: string }) => {
    const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/task_box/items/${id}`, { body: compact({ summary, emoji_icon, reward_points, routine }) });
    return textContent(flattenJsonApi(doc));
  }));

  server.tool('skylight_delete_task', 'Delete a task-box item.', {
    id: z.string(),
    frameId: z.string().optional(),
  }, frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
    await c.request('DELETE', `/frames/${f}/task_box/items/${id}`);
    return textContent({ deleted: id });
  }));
}
