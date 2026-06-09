import { resolveAuth, type ResolvedAuth } from './auth.js';
import { NO_ENV_CONFIG_MARKER } from './config.js';
import type { SkylightClient } from './client.js';

/**
 * Deferred-config-error pattern: the server boots before credentials exist so
 * the host's first `tools/list` always succeeds. The returned `getClient`
 * resolves auth lazily on the first tool call.
 *
 * - Only a genuine missing-config error (carrying {@link NO_ENV_CONFIG_MARKER})
 *   is cached and rethrown — transient login failures (network blip, 5xx,
 *   login rate-limit) leave state unset so the next tool call retries.
 * - Concurrent first calls share a single in-flight login (cleared on
 *   rejection) instead of running N parallel 4-step logins against an
 *   endpoint that rate-limits.
 */
export function makeGetClient(
  resolveAuthFn: () => Promise<ResolvedAuth> = resolveAuth,
): () => Promise<SkylightClient> {
  let client: SkylightClient | undefined;
  let configError: string | undefined;
  let inFlight: Promise<SkylightClient> | undefined;

  return async (): Promise<SkylightClient> => {
    if (client) return client;
    if (configError) throw new Error(configError);
    inFlight ??= (async () => {
      try {
        ({ client } = await resolveAuthFn());
        return client;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes(NO_ENV_CONFIG_MARKER)) configError = message;
        throw new Error(message);
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };
}
