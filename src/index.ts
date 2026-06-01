#!/usr/bin/env node
import { runMcp, loadDotenvSafely } from '@chrischall/mcp-utils';
import { resolveAuth } from './auth.js';
import type { SkylightClient } from './client.js';
import { registerFrameTools } from './tools/frames.js';
import { registerSettingsTools } from './tools/settings.js';
import { registerCalendarTools } from './tools/calendars.js';
import { registerMemberTools } from './tools/members.js';
import { registerEventTools } from './tools/events.js';
import { registerListTools } from './tools/lists.js';
import { registerChoreTools } from './tools/chores.js';
import { registerMealTools } from './tools/meals.js';
import { registerMessageTools } from './tools/messages.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerRewardTools } from './tools/rewards.js';

await loadDotenvSafely();

// Deferred-config-error pattern: the server boots before credentials exist so
// the host's first `tools/list` always succeeds. `getClient` resolves auth
// lazily on the first tool call and caches the (one-time) config error so every
// later call surfaces the same actionable message instead of re-running login.
let client: SkylightClient | undefined;
let configError: string | undefined;
const getClient = async (): Promise<SkylightClient> => {
  if (client) return client;
  if (configError) throw new Error(configError);
  try {
    ({ client } = await resolveAuth());
    return client!;
  } catch (e) {
    configError = e instanceof Error ? e.message : String(e);
    throw new Error(configError);
  }
};

await runMcp<typeof getClient>({
  name: 'skylight-mcp',
  version: '0.3.0', // x-release-please-version
  banner: 'skylight-mcp ready',
  deps: getClient,
  tools: [
    registerFrameTools,
    registerSettingsTools,
    registerCalendarTools,
    registerMemberTools,
    registerEventTools,
    registerListTools,
    registerChoreTools,
    registerMealTools,
    registerMessageTools,
    registerTaskTools,
    registerRewardTools,
  ],
});
