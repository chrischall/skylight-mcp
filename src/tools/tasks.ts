import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SkylightClient } from '../client.js';
import { textContent, flattenJsonApi, compact, type JsonApiDoc } from './_shared.js';

type GetClient = () => Promise<SkylightClient>;

export function registerTaskTools(server: McpServer, getClient: GetClient) {
  server.tool('skylight_list_tasks', "List task-box items (the frame's task list).", {
    frameId: z.string().optional(),
  }, async ({ frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    return textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/task_box/items`)));
  });

  server.tool('skylight_create_task', 'Create a task-box item.', {
    summary: z.string().describe('Task title.'),
    emoji_icon: z.string().optional(),
    reward_points: z.number().optional(),
    routine: z.boolean().optional(),
    frameId: z.string().optional(),
  }, async ({ summary, emoji_icon, reward_points, routine, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/task_box/items`, { body: compact({ summary, emoji_icon, reward_points, routine }) });
    return textContent(flattenJsonApi(doc));
  });

  server.tool('skylight_update_task', 'Update a task-box item.', {
    id: z.string(),
    summary: z.string().optional(),
    emoji_icon: z.string().optional(),
    reward_points: z.number().optional(),
    routine: z.boolean().optional(),
    frameId: z.string().optional(),
  }, async ({ id, summary, emoji_icon, reward_points, routine, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/task_box/items/${id}`, { body: compact({ summary, emoji_icon, reward_points, routine }) });
    return textContent(flattenJsonApi(doc));
  });

  server.tool('skylight_delete_task', 'Delete a task-box item.', {
    id: z.string(),
    frameId: z.string().optional(),
  }, async ({ id, frameId }) => {
    const c = await getClient();
    const f = frameId ?? (await c.resolveFrameId());
    await c.request('DELETE', `/frames/${f}/task_box/items/${id}`);
    return textContent({ deleted: id });
  });
}
