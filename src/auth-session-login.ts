import { truncateErrorMessage } from '@chrischall/mcp-utils';

export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** ms until the access token expires (relative). */
  expiresInMs: number;
}

// ---------------------------------------------------------------------------
// OAuth2 authorization-code flow constants (LIVE-VERIFIED)
// ---------------------------------------------------------------------------

const CLIENT_ID = 'skylight-mobile';
const SCOPE = 'everything';
const REDIRECT_URI = 'https://ourskylight.com/welcome';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const DEVICE_PARAMS = {
  skylight_api_client_device_platform: 'web',
  skylight_api_client_device_name: 'unknown',
  skylight_api_client_device_os_version: '10.15.7',
  skylight_api_client_device_app_version: 'unknown',
  skylight_api_client_device_hardware: 'Macintosh',
  source: 'js-mobile',
} as const;

// ---------------------------------------------------------------------------
// Internal cookie-jar helpers
// ---------------------------------------------------------------------------

type CookieJar = Map<string, string>;

function collectCookies(res: Response, jar: CookieJar): void {
  const raw: string[] = res.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [kv] = cookie.split(';');
    const eqIdx = kv.indexOf('=');
    if (eqIdx < 0) continue;
    jar.set(kv.slice(0, eqIdx).trim(), kv.slice(eqIdx + 1).trim());
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ---------------------------------------------------------------------------
// Token normalization (shared by login and refresh)
// ---------------------------------------------------------------------------

function normalizeTokenResponse(status: number, json: unknown): Tokens {
  // prevents credentials leaking into tool results via upstream error echo
  if (status < 200 || status >= 300) {
    throw new Error(`Skylight token request failed (HTTP ${status}): ${truncateErrorMessage(JSON.stringify(json))}`);
  }
  const j = json as Record<string, unknown>;
  const accessToken = j.access_token as string | undefined;
  if (!accessToken) {
    throw new Error(`Skylight token request failed: no access_token in response ${truncateErrorMessage(JSON.stringify(json))}`);
  }
  const refreshToken = (j.refresh_token as string | undefined) ?? '';
  const expiresInSec = typeof j.expires_in === 'number' ? j.expires_in : 604800;
  return { accessToken, refreshToken, expiresInMs: expiresInSec * 1000 };
}

// ---------------------------------------------------------------------------
// login() — OAuth2 authorization-code flow (LIVE-VERIFIED, 4 steps)
// ---------------------------------------------------------------------------

/**
 * Perform a full OAuth2 authorization-code login against Skylight.
 *
 * IMPORTANT ORDERING: steps must be performed in order 1→2→3→4.
 * Hitting /oauth/authorize before /auth/session poisons CSRF/session state.
 *
 * @param opts.authBaseUrl  Origin of the Skylight app, e.g. https://app.ourskylight.com
 * @param opts.email        Skylight account email
 * @param opts.password     Skylight account password
 * @param opts.deviceFingerprint  UUID to identify this "device"; generated if not supplied
 * @param httpFetch  Injectable fetch (defaults to global fetch). Must support redirect:"manual".
 */
function globalFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

export async function login(
  opts: { authBaseUrl: string; email: string; password: string; deviceFingerprint?: string },
  httpFetch: HttpFetch = globalFetch,
): Promise<Tokens> {
  const { authBaseUrl, email, password } = opts;
  const deviceFingerprint = opts.deviceFingerprint ?? crypto.randomUUID();

  const jar: CookieJar = new Map();

  function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': USER_AGENT, ...extra };
    const cookieStr = cookieHeader(jar);
    if (cookieStr) h['Cookie'] = cookieStr;
    return h;
  }

  // -------------------------------------------------------------------------
  // Step 1: GET /auth/session/new — get authenticity_token + session cookie
  // -------------------------------------------------------------------------
  const step1 = await httpFetch(`${authBaseUrl}/auth/session/new`, {
    redirect: 'manual',
    headers: buildHeaders(),
  });
  collectCookies(step1, jar);

  const html = await step1.text();
  const tokenMatch = html.match(/name="authenticity_token"\s+value="([^"]+)"/);
  if (!tokenMatch) {
    throw new Error(
      'Skylight login failed: could not find authenticity_token in /auth/session/new response. ' +
      'The Skylight login page may have changed.',
    );
  }
  const authenticityToken = tokenMatch[1];

  // -------------------------------------------------------------------------
  // Step 2: POST /auth/session — submit credentials
  // -------------------------------------------------------------------------
  const step2Body = new URLSearchParams({
    authenticity_token: authenticityToken,
    email,
    password,
  }).toString();

  const step2 = await httpFetch(`${authBaseUrl}/auth/session`, {
    method: 'POST',
    redirect: 'manual',
    headers: buildHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': authBaseUrl,
      'Referer': `${authBaseUrl}/auth/session/new`,
    }),
    body: step2Body,
  });
  collectCookies(step2, jar);

  const step2Location = step2.headers.get('location') ?? '';
  if (step2Location.includes('/auth/session/new')) {
    throw new Error(
      'Skylight login failed — check SKYLIGHT_EMAIL/SKYLIGHT_PASSWORD ' +
      '(or you may be temporarily rate-limited after repeated attempts).',
    );
  }

  // -------------------------------------------------------------------------
  // Step 3: GET /oauth/authorize — exchange session for authorization code
  // Follow up to 3 redirects, scanning each Location for a `code` param.
  // -------------------------------------------------------------------------
  const authorizeUrl =
    `${authBaseUrl}/oauth/authorize` +
    `?client_id=${CLIENT_ID}&response_type=code&scope=${SCOPE}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  let code: string | null = null;
  let nextUrl: string | null = authorizeUrl;
  let hops = 0;
  while (nextUrl !== null && hops < 4) {
    const step3 = await httpFetch(nextUrl, {
      redirect: 'manual',
      headers: buildHeaders(),
    });
    collectCookies(step3, jar);
    const loc = step3.headers.get('location') ?? '';
    const locParams = new URL(loc, authBaseUrl).searchParams;
    code = locParams.get('code');
    if (code) break;
    // No code yet — follow the redirect if there is one
    nextUrl = loc || null;
    hops++;
  }

  if (!code) {
    throw new Error('Skylight login failed: could not extract authorization code from /oauth/authorize redirect.');
  }

  // -------------------------------------------------------------------------
  // Step 4: POST /oauth/token — exchange code for tokens
  // -------------------------------------------------------------------------
  const step4Body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    scope: SCOPE,
    skylight_api_client_device_fingerprint: deviceFingerprint,
    ...DEVICE_PARAMS,
    redirect_uri: REDIRECT_URI,
    code,
  }).toString();

  const step4 = await httpFetch(`${authBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: step4Body,
  });
  const tokenJson = await step4.json();
  return normalizeTokenResponse(step4.status, tokenJson);
}

// ---------------------------------------------------------------------------
// refresh() — OAuth2 refresh_token grant
// NOTE: refresh grant implemented per OAuth2 standard; verify live when convenient.
// ---------------------------------------------------------------------------

/**
 * Exchange a refresh token for a new access token.
 *
 * @param opts.authBaseUrl  Origin of the Skylight app, e.g. https://app.ourskylight.com
 * @param opts.refreshToken The current refresh token
 * @param httpFetch  Injectable fetch (defaults to global fetch).
 */
export async function refresh(
  opts: { authBaseUrl: string; refreshToken: string },
  httpFetch: HttpFetch = globalFetch,
): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: opts.refreshToken,
  }).toString();

  const res = await httpFetch(`${opts.authBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body,
  });
  const json = await res.json();
  return normalizeTokenResponse(res.status, json);
}
