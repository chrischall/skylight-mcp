import { readEnvVar } from '@chrischall/mcp-utils';

export interface SessionAccount {
  mode: 'session';
  name: string;
  baseUrl: string;
  /** Origin of baseUrl, used for auth endpoints (e.g. https://app.ourskylight.com). */
  authBaseUrl: string;
  email: string;
  password: string;
  /** Optional explicit frame id; when unset the client discovers it. */
  frameId?: string;
}

export type Account = SessionAccount;

const DEFAULT_BASE_URL = 'https://app.ourskylight.com/api';
// Shared prefix of every config error — getClient() caches errors carrying it
// as permanent (vs transient login failures, which are retried per call).
const NO_CONFIG_MARKER = 'Missing Skylight auth config';
const NO_CONFIG = `${NO_CONFIG_MARKER}. Set SKYLIGHT_EMAIL + SKYLIGHT_PASSWORD.`;

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

  if (!email && !password) throw new Error(NO_CONFIG);
  if (!email || !password) {
    const missing = email ? 'SKYLIGHT_PASSWORD' : 'SKYLIGHT_EMAIL';
    throw new Error(`${NO_CONFIG_MARKER} — missing: ${missing}. Set both SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD.`);
  }

  const baseUrl = (readVar(env, 'SKYLIGHT_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const authBaseUrl = new URL(baseUrl).origin;
  return {
    mode: 'session',
    name: readVar(env, 'SKYLIGHT_NAME') ?? email,
    baseUrl,
    authBaseUrl,
    email,
    password,
    frameId: readVar(env, 'SKYLIGHT_FRAME_ID'),
  };
}
