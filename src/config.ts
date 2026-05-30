export interface SessionAccount {
  mode: 'session';
  name: string;
  baseUrl: string;
  email: string;
  password: string;
  /** Optional explicit frame id; when unset the client discovers it. */
  frameId?: string;
}

export type Account = SessionAccount;

const DEFAULT_BASE_URL = 'https://app.ourskylight.com/api';
const NO_CONFIG = 'Missing Skylight auth config. Set SKYLIGHT_EMAIL + SKYLIGHT_PASSWORD.';

/**
 * Read an env var and treat empty/placeholder values as unset. Some MCP hosts
 * stringify undefined user_config refs (Claude Desktop emits the literal
 * "undefined"; others leave the `${user_config.foo}` placeholder intact), and
 * a Bearer-style header built from those would silently authenticate as the
 * wrong identity or fail upstream with a confusing 403.
 */
function readVar(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (t.length === 0 || t === 'undefined' || t === 'null') return undefined;
  if (/^\$\{[^}]*\}$/.test(t)) return undefined;
  return t;
}

export const NO_ENV_CONFIG_MARKER = NO_CONFIG;

export function loadAccount(env: Record<string, string | undefined> = process.env): Account {
  const email = readVar(env, 'SKYLIGHT_EMAIL');
  const password = readVar(env, 'SKYLIGHT_PASSWORD');

  if (!email && !password) throw new Error(NO_CONFIG);
  if (!email || !password) {
    const missing = email ? 'SKYLIGHT_PASSWORD' : 'SKYLIGHT_EMAIL';
    throw new Error(`Incomplete Skylight config — missing: ${missing}. Set both SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD.`);
  }

  const baseUrl = (readVar(env, 'SKYLIGHT_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  return {
    mode: 'session',
    name: readVar(env, 'SKYLIGHT_NAME') ?? email,
    baseUrl,
    email,
    password,
    frameId: readVar(env, 'SKYLIGHT_FRAME_ID'),
  };
}
