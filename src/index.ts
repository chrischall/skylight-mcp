#!/usr/bin/env node
import { runMcp, loadDotenvSafely } from '@chrischall/mcp-utils';
import { makeGetClient } from './get-client.js';
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
import { registerAiTools } from './tools/ai.js';
import { registerPhotoTools } from './tools/photos.js';

await loadDotenvSafely();

// Deferred-config-error pattern: the server boots before credentials exist so
// the host's first `tools/list` always succeeds. `makeGetClient` resolves auth
// lazily on the first tool call, caches only genuine missing-config errors
// (transient login failures are retried), and single-flights concurrent logins.
const getClient = makeGetClient();

await runMcp<typeof getClient>({
  name: 'skylight-mcp',
  version: '0.4.0', // x-release-please-version
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
    registerAiTools,
    registerPhotoTools,
  ],
});
