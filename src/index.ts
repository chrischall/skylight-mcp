#!/usr/bin/env node
import { createMcpServer, loadDotenvSafely } from '@chrischall/mcp-utils';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
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
import { registerHealthcheckTools } from './tools/health.js';

await loadDotenvSafely();

// Deferred-config-error pattern: the server boots before credentials exist so
// the host's first `tools/list` always succeeds. `makeGetClient` resolves auth
// lazily on the first tool call, caches only genuine missing-config errors
// (transient login failures are retried), and single-flights concurrent logins.
const getClient = makeGetClient();

// `serveStdio` is SYNCHRONOUS — it returns a `StdioServerHandle`, not a promise —
// so there is nothing here to `await`, and no unhandled rejection to guard
// against: the entry already wraps every async arm in
// `.catch(error => reportError(toError(error)))`, the factory call included
// (`await factory({ era })` sits inside one of those chains).
//
// What that leaves is the opposite hazard, and it is the one worth closing.
// `reportError` is `try { options.onerror?.(error) } catch {}`, so with no
// `onerror` supplied a transport failure or a factory rejection is caught and
// then DISCARDED IN SILENCE — the process would sit there having never attached,
// saying nothing on either channel. stderr is where it goes because stdout is
// the MCP wire, and it is where `banner` already writes.
serveStdio(() => createMcpServer<typeof getClient>({
  name: 'skylight-mcp',
  version: '1.0.1', // x-release-please-version
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
    registerHealthcheckTools,
  ],
}), {
  onerror: (error) => {
    console.error('skylight-mcp: stdio serving error —', error);
  },
});
