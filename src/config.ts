import { readEnvVar } from '@chrischall/mcp-utils';

export interface SessionAccount {
  mode: 'session';
  name: string;
  baseUrl: string;
  /** Origin of baseUrl, used for auth endpoints (e.g. https://app.ourskylight.com). */
  authBaseUrl: string;
  /**
   * The login pair. Optional because a consumer may supply {@link refreshToken}
   * instead — a scoped, revocable credential rather than the unscoped one that
   * mints it. Present alongside a token when the operator wants a stale token
   * to recover by logging in again.
   */
  email?: string;
  password?: string;
  /**
   * An OAuth refresh token the consumer already holds (`SKYLIGHT_REFRESH_TOKEN`).
   * When set, the four-step login is skipped entirely — which also means the
   * rate-limited login endpoint is never touched on a cold start.
   */
  refreshToken?: string;
  /** Optional explicit frame id; when unset the client discovers it. */
  frameId?: string;
}

export type Account = SessionAccount;

const DEFAULT_BASE_URL = 'https://app.ourskylight.com/api';
// Shared prefix of every config error — getClient() caches errors carrying it
// as permanent (vs transient login failures, which are retried per call).
const NO_CONFIG_MARKER = 'Missing Skylight auth config';
const NO_CONFIG =
  `${NO_CONFIG_MARKER}. Set SKYLIGHT_REFRESH_TOKEN (a token you already hold — no password needed), ` +
  `or SKYLIGHT_EMAIL + SKYLIGHT_PASSWORD to log in for one.`;

/**
 * Read an env var, treating empty/placeholder values as unset. Some MCP hosts
 * stringify undefined user_config refs (Claude Desktop emits the literal
 * "undefined"; others leave the `${user_config.foo}` placeholder intact), and a
 * Bearer-style header built from those would silently authenticate as the wrong
 * identity or fail upstream with a confusing 403. `readEnvVar` from
 * @chrischall/mcp-utils applies the same trim + reject `''`/`undefined`/`null`/
 * `${...}` filtering the local `readVar` did.
 */
function readVar(env: Record<string, string | undefined>, key: string): string | undefined {
  return readEnvVar(key, { env });
}

export const NO_ENV_CONFIG_MARKER = NO_CONFIG_MARKER;

export function loadAccount(env: Record<string, string | undefined> = process.env): Account {
  const email = readVar(env, 'SKYLIGHT_EMAIL');
  const password = readVar(env, 'SKYLIGHT_PASSWORD');
  const refreshToken = readVar(env, 'SKYLIGHT_REFRESH_TOKEN');

  // A supplied token is a complete configuration on its own. The login pair
  // stays optional beside it: present, it becomes the recovery path when the
  // token goes stale; absent, nothing here needs a password at all.
  if (!refreshToken) {
    if (!email && !password) throw new Error(NO_CONFIG);
    if (!email || !password) {
      const missing = email ? 'SKYLIGHT_PASSWORD' : 'SKYLIGHT_EMAIL';
      throw new Error(
        `${NO_CONFIG_MARKER} — missing: ${missing}. Set both SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD, ` +
          `or SKYLIGHT_REFRESH_TOKEN instead.`,
      );
    }
  }

  const baseUrl = (readVar(env, 'SKYLIGHT_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const authBaseUrl = new URL(baseUrl).origin;
  return {
    mode: 'session',
    name: readVar(env, 'SKYLIGHT_NAME') ?? email ?? 'skylight',
    baseUrl,
    authBaseUrl,
    email,
    password,
    refreshToken,
    frameId: readVar(env, 'SKYLIGHT_FRAME_ID'),
  };
}

/** Env var holding the Apple app-specific password `skylight_link_apple_calendar` sends. */
export const APPLE_APP_PASSWORD_VAR = 'SKYLIGHT_APPLE_APP_PASSWORD';
/** Env var holding the Apple ID email, overridable by the tool's `email` argument. */
export const APPLE_ID_VAR = 'SKYLIGHT_APPLE_ID';

/**
 * The Apple/iCloud credential `skylight_link_apple_calendar` hands to Skylight.
 *
 * It lives in the environment, like every other secret the fleet handles, and
 * is deliberately NOT a tool argument (fleet-audit#962, #732): an argument
 * passes through the model, the chat transcript, the host's tool-call log and
 * any client-side history — and an app-specific password grants CalDAV access
 * to the whole iCloud account, which Skylight then keeps server-side.
 * Independent of the Skylight login config: both fields are simply undefined
 * when unset, and the tool reports which one is missing.
 */
export interface AppleCalendarCredential {
  /** `SKYLIGHT_APPLE_ID` — the Apple ID email. */
  email?: string;
  /** `SKYLIGHT_APPLE_APP_PASSWORD` — an app-specific password from appleid.apple.com. */
  appSpecificPassword?: string;
}

export function loadAppleCalendarCredential(env: Record<string, string | undefined> = process.env): AppleCalendarCredential {
  return { email: readVar(env, APPLE_ID_VAR), appSpecificPassword: readVar(env, APPLE_APP_PASSWORD_VAR) };
}
