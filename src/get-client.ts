import { CookieSessionManager } from '@chrischall/mcp-utils/session';
import { resolveAuth, type ResolvedAuth } from './auth.js';
import { NO_ENV_CONFIG_MARKER } from './config.js';
import type { SkylightClient } from './client.js';

/**
 * Skylight has no cookie-session-expiry/replay path at this layer: token
 * lifecycle (proactive refresh + reactive 401-replay) is owned by
 * `SkylightClient`/`TokenManager`, so {@link CookieSessionManager.withSession}
 * is never used and a response is never treated as an expired session here.
 */
export const isSessionExpired = (): boolean => false;

/**
 * Deferred-config-error pattern: the server boots before credentials exist so
 * the host's first `tools/list` always succeeds. The returned `getClient`
 * resolves auth lazily on the first tool call.
 *
 * The single-flight initial login + permanent-vs-transient caching is owned by
 * {@link CookieSessionManager} (`@chrischall/mcp-utils/session`):
 *
 * - `login` runs `resolveAuth()` once and yields the {@link SkylightClient} as
 *   the cookie session. Non-Error rejections are normalized to `Error` so the
 *   public surface always rejects with an `Error`.
 * - `isPermanentError` flags a genuine missing-config error (message carrying
 *   {@link NO_ENV_CONFIG_MARKER}); the manager caches it and rethrows on every
 *   subsequent call without re-attempting the login. Transient login failures
 *   (network blip, 5xx, login rate-limit) are not cached — the next call retries.
 * - Concurrent first calls share the manager's single in-flight login instead of
 *   running N parallel 4-step logins against an endpoint that rate-limits.
 *
 * Skylight's re-auth on token expiry lives inside `SkylightClient`/`TokenManager`
 * (proactive refresh + reactive 401-replay), so there is no per-request
 * cookie-expiry/replay path here — `ensure()` is all this layer needs, and
 * `isExpired` is a never-exercised stub.
 */
export function makeGetClient(
  resolveAuthFn: () => Promise<ResolvedAuth> = resolveAuth,
): () => Promise<SkylightClient> {
  const manager = new CookieSessionManager<SkylightClient>({
    login: async () => {
      try {
        return (await resolveAuthFn()).client;
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    isExpired: isSessionExpired,
    isPermanentError: (err) =>
      err instanceof Error && err.message.includes(NO_ENV_CONFIG_MARKER),
  });

  return () => manager.ensure();
}
