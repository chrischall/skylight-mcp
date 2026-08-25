/**
 * Library entry point — the package's importable surface.
 *
 * `src/index.ts` is the executable: it has a top-level `await runMcp(...)`, so
 * importing it *starts a stdio MCP server*. That makes it unusable as a library
 * entry, which is why this module exists and why `exports["."]` points here
 * rather than there. Nothing in this file may import `./index.js`.
 *
 * What this is for: registering the same tool surface against a server the
 * caller owns — a different transport, a subset of the tool modules, or a host
 * that supplies its own client. The registrars take `(server, getClient)` and
 * are transport-agnostic; only `src/index.ts` chooses stdio.
 *
 *   import { registerMealTools, makeGetClient } from 'skylight-mcp';
 *
 * `makeGetClient()` accepts a custom `resolveAuthFn`, so a caller that stores
 * tokens elsewhere can construct a `SkylightClient` from them directly (its
 * constructor takes `{ account, tokens, refreshFn }`) instead of running the
 * four-step login on every process start — which matters for hosts that boot
 * often and would otherwise hammer a login endpoint that rate-limits.
 */

// ── Tool registrars ────────────────────────────────────────────────────────
export { registerFrameTools } from './tools/frames.js';
export { registerSettingsTools } from './tools/settings.js';
export { registerCalendarTools } from './tools/calendars.js';
export { registerMemberTools } from './tools/members.js';
export { registerEventTools } from './tools/events.js';
export { registerListTools } from './tools/lists.js';
export { registerChoreTools } from './tools/chores.js';
export { registerMealTools } from './tools/meals.js';
export { registerMessageTools } from './tools/messages.js';
export { registerTaskTools } from './tools/tasks.js';
export { registerRewardTools } from './tools/rewards.js';
export { registerAiTools } from './tools/ai.js';
export { registerPhotoTools } from './tools/photos.js';

// ── Client + auth ──────────────────────────────────────────────────────────
export { SkylightClient, type SkylightClientOpts, type RequestOpts, type HttpFetch } from './client.js';
export { makeGetClient } from './get-client.js';
export { resolveAuth, type ResolvedAuth } from './auth.js';
export { login, refresh, type Tokens } from './auth-session-login.js';
export { loadAccount, NO_ENV_CONFIG_MARKER, type Account, type SessionAccount } from './config.js';

// ── Helpers for callers registering their own tools alongside these ────────
export {
  textContent,
  flattenJsonApi,
  pruneUndefined,
  frameScoped,
  idParam,
  idArrayParam,
  type GetClient,
  type JsonApiDoc,
  type JsonApiResource,
} from './tools/_shared.js';
export { previewUnlessConfirmed, previewFileUploadUnlessConfirmed, schemaConfirm } from './tools/_confirm.js';
