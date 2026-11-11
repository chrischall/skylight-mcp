import { createHash, randomBytes } from 'node:crypto';
import {
  CookieJar,
  EdgeBlockedError,
  createOAuth2Refresher,
  detectEdgeBlock,
  truncateErrorMessage,
} from '@chrischall/mcp-utils';

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
// PKCE (RFC 7636) — REQUIRED by Skylight's Doorkeeper as of 2026-08-31
// ---------------------------------------------------------------------------

/**
 * Mint a PKCE verifier/challenge pair for one login.
 *
 * Skylight's authorization server enforces PKCE: a /oauth/authorize carrying
 * no `code_challenge` answers HTTP 400 "Code challenge is required." and
 * issues no code at all, so the login died at step 3 with the generic
 * "could not extract authorization code" error. Reported and reproduced live
 * on 2026-08-31.
 *
 * S256, not `plain`: the challenge travels in a URL (logs, Referer, history)
 * while the verifier stays in the POST body, which is the whole point of the
 * exchange. 32 random bytes base64url-encode to 43 chars, inside RFC 7636's
 * 43–128 range with no padding to strip.
 */
function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

// ---------------------------------------------------------------------------
// CDN/WAF refusals (chrischall/mcp-host#1015)
// ---------------------------------------------------------------------------

/**
 * Throw {@link EdgeBlockedError} when a CDN/WAF refusal page answered instead
 * of Skylight. Such a page arrives as a 4xx with no CSRF token, no code and no
 * token JSON, so each auth step would otherwise blame the credential or the
 * login contract — and a refresh grant read as "revoked" makes TokenManager
 * clear the token cache, discarding the only copy of a rotated refresh token.
 * The body is only scanned, never echoed.
 */
function throwIfEdgeBlocked(res: Response, body: string, method: string, path: string): void {
  if (res.status < 400) return;
  const edge = detectEdgeBlock({ body, headers: res.headers, status: res.status });
  if (edge) throw new EdgeBlockedError(res.status, edge.vendor, { service: 'Skylight', method, path });
}

/** A response body for scanning, without consuming the caller's copy. */
async function peekBody(res: Response): Promise<string> {
  try {
    return await (typeof res.clone === 'function' ? res.clone() : res).text();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Token normalization (login step 4)
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

/** Default transport; swapped out wholesale in tests. */
function globalFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

// ---------------------------------------------------------------------------
// CSRF token discovery (login step 1)
// ---------------------------------------------------------------------------

/**
 * Pull the Rails CSRF token out of the /auth/session/new page.
 *
 * Two sources, in preference order — the page currently serves both, with
 * *different* values, and the POST is validated against the form one:
 *
 *   <input type="hidden" name="authenticity_token" value="…" />   ← preferred
 *   <meta name="csrf-token" content="…" />                        ← fallback
 *
 * The match is deliberately attribute-order- and quote-agnostic. The previous
 * single regex required `name` immediately before `value`, both double-quoted
 * — none of which is a contract, all of which is Rails markup detail.
 *
 * On failure the thrown error names the concrete reason (status, redirect,
 * empty body, or parsed-but-tokenless) instead of the blanket "the login page
 * may have changed", which is what made #88 un-triageable from the report.
 * The page body is NEVER echoed: it carries session state, and this error
 * surfaces through MCP tool results.
 */
function extractAuthenticityToken(html: string, res: Response, page = '/auth/session/new'): string {
  const attr = (name: string, value: string) =>
    new RegExp(`<[^>]*\\b${name}\\s*=\\s*["']authenticity_token["'][^>]*\\b${value}\\s*=\\s*["']([^"']+)["']`, 'i');
  // The form token, in either attribute order.
  const form = html.match(attr('name', 'value'))
    ?? html.match(new RegExp(`<[^>]*\\bvalue\\s*=\\s*["']([^"']+)["'][^>]*\\bname\\s*=\\s*["']authenticity_token["']`, 'i'));
  if (form) return form[1];
  // Fallback: the <meta name="csrf-token" content="…"> Rails also emits.
  const meta = html.match(/<meta[^>]*\bname\s*=\s*["']csrf-token["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bname\s*=\s*["']csrf-token["']/i);
  if (meta) return meta[1];

  const why = describeTokenlessResponse(html, res);
  throw new Error(
    `Skylight login failed: could not find authenticity_token in ${page} response (${why}). ` +
    'Neither the hidden form input nor the csrf-token meta tag was present.',
  );
}

/** Why step 1 yielded no token — status/redirect/shape only, never content. */
function describeTokenlessResponse(html: string, res: Response): string {
  const status = res.status;
  if (status >= 300 && status < 400) {
    // login() uses redirect:"manual", so a 3xx arrives with an empty body.
    // An interstitial, maintenance page or region redirect lands here and
    // would otherwise be indistinguishable from a markup change.
    const location = res.headers.get('location');
    return `HTTP ${status} redirect to ${location ?? '(no Location header)'} — the login page was not served`;
  }
  if (status < 200 || status >= 300) return `HTTP ${status}`;
  if (html.trim() === '') return `HTTP ${status} with an empty body`;
  // Real UTF-8 bytes, not `html.length` (UTF-16 code units): the label says
  // bytes, and a page of multibyte content would otherwise be understated —
  // which matters precisely when the size is being used to spot truncation.
  // Encoding on an error path only, so the cost is irrelevant.
  const bytes = new TextEncoder().encode(html).length;
  return `HTTP ${status}, ${bytes} bytes of HTML — the login page markup may have changed`;
}

/**
 * Perform a full OAuth2 authorization-code login against Skylight.
 *
 * IMPORTANT ORDERING: steps must be performed in order 1→2→3→4.
 * Hitting /oauth/authorize before /auth/session poisons CSRF/session state.
 *
 * Step 3 carries a mandatory S256 PKCE challenge and step 4 the matching
 * verifier; see {@link createPkcePair}.
 *
 * @param opts.authBaseUrl  Origin of the Skylight app, e.g. https://app.ourskylight.com
 * @param opts.email        Skylight account email
 * @param opts.password     Skylight account password
 * @param opts.deviceFingerprint  UUID to identify this "device"; generated if not supplied
 * @param httpFetch  Injectable fetch (defaults to global fetch). Must support redirect:"manual".
 */
export async function login(
  opts: { authBaseUrl: string; email: string; password: string; deviceFingerprint?: string },
  httpFetch: HttpFetch = globalFetch,
): Promise<Tokens> {
  const { authBaseUrl, email, password } = opts;
  const deviceFingerprint = opts.deviceFingerprint ?? crypto.randomUUID();

  // Stateful jar from mcp-utils: accumulates Set-Cookie across the 4 login
  // steps (later wins, deletion markers remove), rendered via .header().
  const jar = new CookieJar();

  function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': USER_AGENT, ...extra };
    const cookieStr = jar.header();
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
  jar.absorb(step1.headers);

  const html = await step1.text();
  throwIfEdgeBlocked(step1, html, 'GET', '/auth/session/new');
  const authenticityToken = extractAuthenticityToken(html, step1);

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
  jar.absorb(step2.headers);
  // A refusal here never reached Skylight, so it says nothing about the
  // password — and carrying on to step 3 would only spend another request
  // behind the same edge.
  if (step2.status >= 400) throwIfEdgeBlocked(step2, await peekBody(step2), 'POST', '/auth/session');

  // Only a redirect to /auth/session/success means the session is signed in.
  // Anything else used to fall through to step 3, where an unauthenticated
  // /oauth/authorize answered 200 with no code and the failure was reported
  // as an OAuth contract change (#276).
  const step2Path = sameOriginRedirectPath(step2, `${authBaseUrl}/auth/session`, authBaseUrl);
  if (step2Path === '/auth/session/success') {
    return finishLogin({ authBaseUrl, deviceFingerprint, httpFetch, buildHeaders, jar });
  }
  if (step2Path?.startsWith('/auth/session/new')) {
    throw new Error(CREDENTIALS_REJECTED);
  }
  if (step2Path?.startsWith('/auth/mfa_challenge')) {
    // Skylight emailed a one-time code (LIVE-VERIFIED 2026-11-11, #276):
    // /auth/mfa_challenge/start sends the mail and redirects to
    // /auth/mfa_challenge/new, a form POSTing `code` to /auth/mfa_challenge.
    // Hold the signed-in-but-unverified session open for the caller.
    const challenge = await openChallenge({
      authBaseUrl, deviceFingerprint, httpFetch, buildHeaders, jar,
      startUrl: new URL(step2.headers.get('location')!, `${authBaseUrl}/auth/session`).href,
    });
    throw new VerificationCodeRequiredError(challenge);
  }
  // A re-rendered sign-in form (200/422 carrying a password field) is a
  // rejected credential that did not bother redirecting.
  if (step2Path === null && /\bname\s*=\s*["']password["']/i.test(await peekBody(step2))) {
    throw new Error(CREDENTIALS_REJECTED);
  }
  throw new Error(
    `Skylight login did not complete at the password step (${describeStep(step2, step2Path)}): ` +
    'expected a redirect to /auth/session/success. Skylight may have added a sign-in step this client does not handle.',
  );
}

const CREDENTIALS_REJECTED =
  'Skylight login failed — check SKYLIGHT_EMAIL/SKYLIGHT_PASSWORD ' +
  '(or you may be temporarily rate-limited after repeated attempts).';

/** Marker carried by every "a login code is needed" message (healthcheck keys on it). */
export const VERIFICATION_CODE_MARKER = 'Skylight emailed a login verification code';

/**
 * Skylight answered the password with an emailed one-time code (#276). The
 * session it opened is held by {@link challenge}: submit the code there to
 * finish the login, without resending the password or spending another mail.
 */
export class VerificationCodeRequiredError extends Error {
  constructor(readonly challenge: LoginChallenge) {
    super(
      `${VERIFICATION_CODE_MARKER} to SKYLIGHT_EMAIL. Call skylight_submit_login_code with the 6-digit code ` +
      'from that email to finish signing in (it is only needed once; the token is cached afterwards).',
    );
    this.name = 'VerificationCodeRequiredError';
  }
}

/** The code was wrong or expired; the challenge is still open for another try. */
export class InvalidVerificationCodeError extends Error {
  constructor(
    message = 'Skylight rejected that login code — it may be mistyped or expired. Check the latest email and try again, ' +
      'or call skylight_submit_login_code with resend: true for a new code.',
  ) {
    super(message);
    this.name = 'InvalidVerificationCodeError';
  }
}

/** An open emailed-code challenge: one signed-in-but-unverified session. */
export interface LoginChallenge {
  /** Verify the code and finish the login. Rejects with {@link InvalidVerificationCodeError} on a bad code. */
  submit(code: string): Promise<Tokens>;
  /** Ask Skylight to email a fresh code. */
  resend(): Promise<void>;
}

interface LoginState {
  authBaseUrl: string;
  deviceFingerprint: string;
  httpFetch: HttpFetch;
  buildHeaders: (extra?: Record<string, string>) => Record<string, string>;
  jar: CookieJar;
}

/**
 * The same-origin path a redirect points at, or `null` when the response is
 * not a redirect. A redirect off the auth origin is refused outright: the
 * session cookie must never follow it.
 */
function sameOriginRedirectPath(res: Response, requestUrl: string, authBaseUrl: string): string | null {
  const loc = res.headers.get('location');
  if (res.status < 300 || res.status >= 400 || !loc) return null;
  let dest: URL;
  try {
    dest = new URL(loc, requestUrl);
  } catch {
    throw new Error('Skylight login failed: unsafe redirect');
  }
  if (dest.origin !== new URL(authBaseUrl).origin || dest.username || dest.password) {
    throw new Error('Skylight login failed: unsafe redirect');
  }
  return dest.pathname;
}

/** Status and redirect path only — never the query, which can carry state. */
function describeStep(res: Response, path: string | null): string {
  return path === null ? `HTTP ${res.status}` : `HTTP ${res.status} redirect to ${path}`;
}

/**
 * GET the challenge start URL (which sends the email), follow its same-origin
 * redirects to the code form, and return a {@link LoginChallenge} bound to
 * that form's CSRF token and this login's cookie jar.
 */
async function openChallenge(state: LoginState & { startUrl: string }): Promise<LoginChallenge> {
  const { authBaseUrl, httpFetch, buildHeaders, jar } = state;
  let formToken = await loadChallengeForm(state, state.startUrl);

  return {
    async submit(code: string): Promise<Tokens> {
      const trimmed = code.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(trimmed)) {
        throw new InvalidVerificationCodeError('A Skylight login code is 6 digits — check the email and try again.');
      }
      const res = await httpFetch(`${authBaseUrl}/auth/mfa_challenge`, {
        method: 'POST',
        redirect: 'manual',
        headers: buildHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': authBaseUrl,
          'Referer': `${authBaseUrl}/auth/mfa_challenge/new`,
        }),
        body: new URLSearchParams({ authenticity_token: formToken, code: trimmed }).toString(),
      });
      jar.absorb(res.headers);
      if (res.status >= 400) throwIfEdgeBlocked(res, await peekBody(res), 'POST', '/auth/mfa_challenge');
      const path = sameOriginRedirectPath(res, `${authBaseUrl}/auth/mfa_challenge`, authBaseUrl);
      if (path === '/auth/session/success') return finishLogin(state);
      // LIVE-VERIFIED 2026-11-11: a wrong code redirects back to the form.
      if (path?.startsWith('/auth/mfa_challenge')) {
        formToken = await loadChallengeForm(state, `${authBaseUrl}${path}`);
        throw new InvalidVerificationCodeError();
      }
      if (path?.startsWith('/auth/session/new')) {
        throw new Error(
          'Skylight ended the sign-in before the code was accepted (too many attempts or the session expired). ' +
          'Retry any Skylight tool to start a new login; a new code will be emailed.',
        );
      }
      throw new Error(
        `Skylight login did not complete at the verification-code step (${describeStep(res, path)}).`,
      );
    },
    async resend(): Promise<void> {
      formToken = await loadChallengeForm(state, `${authBaseUrl}/auth/mfa_challenge/start?resend=true`);
    },
  };
}

/** Follow same-origin redirects (at most 3) to the code form; return its CSRF token. */
async function loadChallengeForm(state: LoginState, url: string): Promise<string> {
  const { authBaseUrl, httpFetch, buildHeaders, jar } = state;
  let next = url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await httpFetch(next, { redirect: 'manual', headers: buildHeaders() });
    jar.absorb(res.headers);
    const path = sameOriginRedirectPath(res, next, authBaseUrl);
    if (path === null) {
      const html = await res.text();
      throwIfEdgeBlocked(res, html, 'GET', '/auth/mfa_challenge/new');
      return extractAuthenticityToken(html, res, '/auth/mfa_challenge/new');
    }
    if (path.startsWith('/auth/session/new')) {
      throw new Error(
        'Skylight ended the sign-in before a code could be entered (the session expired). ' +
        'Retry any Skylight tool to start a new login.',
      );
    }
    next = new URL(res.headers.get('location')!, next).href;
  }
  throw new Error('Skylight login failed: too many redirects loading the verification-code form.');
}

/** Steps 3–4: trade the signed-in session for an authorization code, then tokens. */
async function finishLogin(state: LoginState): Promise<Tokens> {
  const { authBaseUrl, deviceFingerprint, httpFetch, buildHeaders, jar } = state;
  // -------------------------------------------------------------------------
  // Step 3: GET /oauth/authorize — exchange session for authorization code.
  // The PKCE challenge is mandatory here; without it Doorkeeper 400s.
  // Follow up to 3 redirects, scanning each Location for a `code` param.
  // -------------------------------------------------------------------------
  const { verifier, challenge } = createPkcePair();
  const authorizeUrl =
    `${authBaseUrl}/oauth/authorize` +
    `?client_id=${CLIENT_ID}&response_type=code&scope=${SCOPE}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;

  let code: string | null = null;
  let nextUrl: string | null = authorizeUrl;
  let hops = 0;
  let lastStatus = 0;
  while (nextUrl !== null && hops < 4) {
    const step3 = await httpFetch(nextUrl, {
      redirect: 'manual',
      headers: buildHeaders(),
    });
    jar.absorb(step3.headers);
    lastStatus = step3.status;
    const loc = step3.headers.get('location');
    if (step3.status < 300 || step3.status >= 400 || !loc) {
      throwIfEdgeBlocked(step3, step3.status >= 400 ? await peekBody(step3) : '', 'GET', '/oauth/authorize');
      break;
    }
    const unsafeRedirect = () => new Error('Skylight login failed: unsafe authorization redirect');
    let destination: URL;
    try {
      destination = new URL(loc, nextUrl);
    } catch {
      throw unsafeRedirect();
    }
    if (destination.username || destination.password || destination.hash) throw unsafeRedirect();
    const callback = new URL(REDIRECT_URI);
    if (destination.origin === callback.origin && destination.pathname === callback.pathname) {
      code = destination.searchParams.get('code');
      break;
    }
    if (destination.protocol !== 'https:' || destination.origin !== new URL(authBaseUrl).origin) {
      throw unsafeRedirect();
    }
    nextUrl = destination.href;
    hops++;
  }

  if (!code) {
    // Name the status. A bare "no code" reads as a credential problem, but the
    // server answers a rejected *request* with 4xx and no redirect at all —
    // which is how the PKCE requirement presented, and why diagnosing it took
    // a live probe of the authorize step rather than a reading of the error.
    throw new Error(
      `Skylight login failed: could not extract authorization code from /oauth/authorize ` +
      `(last response HTTP ${lastStatus}). The authorization request was rejected — ` +
      `the OAuth contract may have changed.`,
    );
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
    // Proves this exchange belongs to the same client that made step 3's
    // request; omitting it against a PKCE-enforcing server yields invalid_grant.
    code_verifier: verifier,
  }).toString();

  const step4 = await httpFetch(`${authBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: step4Body,
  });
  // Without this the block page's HTML fails JSON parsing as an unexplained
  // SyntaxError, reported as an unknown login failure.
  if (step4.status >= 400) throwIfEdgeBlocked(step4, await peekBody(step4), 'POST', '/oauth/token');
  // Parse it ourselves: an HTML outage/WAF page that is not an edge block
  // would otherwise escape as a raw SyntaxError carrying a fragment of the
  // upstream body and no status (fleet-audit#728).
  const tokenText = await step4.text();
  let tokenJson: unknown;
  try {
    tokenJson = JSON.parse(tokenText);
  } catch {
    throw new Error(`Skylight token request failed (HTTP ${step4.status}): ${truncateErrorMessage(tokenText)}`);
  }
  return normalizeTokenResponse(step4.status, tokenJson);
}

// ---------------------------------------------------------------------------
// refresh() — OAuth2 refresh_token grant (LIVE-VERIFIED 2026-08-31: returns a
// new access token and rotates the refresh token; needs no PKCE verifier).
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
  // Shared refresh_token-grant skeleton from mcp-utils. It posts the
  // form-encoded grant, redacts + truncates upstream error bodies
  // (truncateErrorMessage), and single-flights concurrent exchanges.
  // The refresher is built per call because Skylight rotates refresh tokens —
  // TokenManager passes the *current* token each time; it also owns the
  // cross-call single-flight, so nothing is lost by not reusing the refresher.
  const doRefresh = createOAuth2Refresher({
    endpoint: `${opts.authBaseUrl}/oauth/token`,
    refreshToken: opts.refreshToken,
    params: { client_id: CLIENT_ID },
    // The refresher always supplies an init (method/headers/body), so the
    // cast is safe — no fallback branch needed.
    fetchImpl: async (input, init) => {
      const res = await httpFetch(String(input), init as RequestInit);
      if (!res.ok) throwIfEdgeBlocked(res, await peekBody(res), 'POST', '/oauth/token');
      return res;
    },
  });
  const result = await doRefresh();
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken ?? '',
    expiresInMs: (result.expiresIn ?? 604800) * 1000,
  };
}
