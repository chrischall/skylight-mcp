import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textContent, flattenJsonApi, pruneUndefined, frameScoped, type GetClient, type JsonApiDoc } from './_shared.js';

export function registerTaskTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_list_tasks',
    {
      description: "List task-box items (the frame's task list).",
      inputSchema: {
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', `/frames/${f}/task_box/items`)))),
  );

  server.registerTool(
    'skylight_create_task',
    {
      description: 'Create a task-box item.',
      inputSchema: {
        summary: z.string().describe('Task title.'),
        emoji_icon: z.string().optional(),
        reward_points: z.number().optional(),
        routine: z.boolean().optional(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { summary, emoji_icon, reward_points, routine }: { summary: string; emoji_icon?: string; reward_points?: number; routine?: boolean; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('POST', `/frames/${f}/task_box/items`, { body: pruneUndefined({ summary, emoji_icon, reward_points, routine }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_update_task',
    {
      description: 'Update a task-box item.',
      inputSchema: {
        id: z.string(),
        summary: z.string().optional(),
        emoji_icon: z.string().optional(),
        reward_points: z.number().optional(),
        routine: z.boolean().optional(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id, summary, emoji_icon, reward_points, routine }: { id: string; summary?: string; emoji_icon?: string; reward_points?: number; routine?: boolean; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc>('PATCH', `/frames/${f}/task_box/items/${id}`, { body: pruneUndefined({ summary, emoji_icon, reward_points, routine }) });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_delete_task',
    {
      description: 'Delete a task-box item.',
      inputSchema: {
        id: z.string(),
        frameId: z.string().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      await c.request('DELETE', `/frames/${f}/task_box/items/${id}`);
      return textContent({ deleted: id });
    }),
  );
}
