import type { McpServer } from '@modelcontextprotocol/server';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import { loadAccount as defaultLoadAccount, NO_ENV_CONFIG_MARKER, type Account } from '../config.js';
import type { GetClient } from './_shared.js';
import { VERIFICATION_CODE_MARKER } from '../auth-session-login.js';

/**
 * `skylight_healthcheck` — the one call that answers "is this connector
 * working?", and the only tool here that reports a failure as DATA rather
 * than throwing.
 *
 * Skylight had none. The other 114 tools are functional operations, so the
 * closest stand-in was `skylight_list_frames` — a frames query, which is the
 * problem: an empty or failed result reads as a data problem ("no frames on
 * this account") when the real cause is that nothing ever authenticated.
 *
 * That ambiguity has a cost on record. When Skylight's OAuth server began
 * requiring PKCE (v0.8.2), every login failed at the authorize step with
 * valid credentials, and separating "wrong password" from "the OAuth contract
 * changed" took a live probe of `/oauth/authorize`. {@link classifySkylightError}
 * encodes that distinction so the next contract change names itself.
 */

/** Which env credential is configured — never its value. */
function credentialSource(account: Account): string {
  return account.refreshToken ? 'SKYLIGHT_REFRESH_TOKEN' : 'SKYLIGHT_EMAIL+SKYLIGHT_PASSWORD';
}

/**
 * Map a login failure onto an arm the reader can act on.
 *
 * The three cases below are indistinguishable in the raw message but have
 * different fixes: change the credential, wait out a rate limit, or fix the
 * client. Anything unrecognised falls through to the helper's own
 * classification rather than being guessed at.
 */
export function classifySkylightError(err: unknown): { kind: string; hint?: string } | undefined {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes(NO_ENV_CONFIG_MARKER)) {
    return { kind: 'no_credential' };
  }
  // The password was accepted; Skylight wants the code it emailed (#276).
  if (msg.includes(VERIFICATION_CODE_MARKER)) {
    return {
      kind: 'verification_code_required',
      hint:
        'Skylight accepted the password and emailed a 6-digit login code to SKYLIGHT_EMAIL. Ask the user for it ' +
        'and call skylight_submit_login_code. Only needed once — the token is cached afterwards.',
    };
  }
  // Step 2 ended somewhere other than a signed-in session or a known challenge.
  if (msg.includes('did not complete at the password step')) {
    return {
      kind: 'login_step_changed',
      hint: 'Skylight answered the password with a sign-in step this client does not recognise. Check for a newer skylight-mcp.',
    };
  }
  // Step 3 rejected the request itself — not the credential. This is what a
  // server-side OAuth change looks like from here.
  if (msg.includes('could not extract authorization code')) {
    return {
      kind: 'oauth_contract_changed',
      hint:
        'The password step succeeded, but /oauth/authorize then issued no code — the credential was not the problem. ' +
        'Skylight changed the authorization contract (it began requiring a PKCE code_challenge in 0.8.2). ' +
        'Check for a newer skylight-mcp, and see the flow in CLAUDE.md "Auth resolution".',
    };
  }
  // Step 1 parsed but carried no CSRF token — a markup/interstitial change.
  if (msg.includes('could not find authenticity_token')) {
    return {
      kind: 'login_page_changed',
      hint: 'The Skylight login page no longer exposes a CSRF token where the client looks for it. Check for a newer skylight-mcp.',
    };
  }
  // Rate limiting shares this message with genuinely wrong credentials; say so
  // rather than sending someone to rotate a password that is fine.
  if (msg.includes('check SKYLIGHT_EMAIL/SKYLIGHT_PASSWORD')) {
    return {
      kind: 'credential_rejected',
      hint:
        'Skylight rejected the login. Verify SKYLIGHT_EMAIL / SKYLIGHT_PASSWORD — or, if they are known good, ' +
        'wait a few minutes: the login endpoint rate-limits after repeated attempts.',
    };
  }
  return undefined;
}

export function registerHealthcheckTools(
  server: McpServer,
  getClient: GetClient,
  /** Seam: injectable so tests need no env. */
  loadAccount: () => Account = defaultLoadAccount,
): void {
  registerCredentialHealthcheckTool({
    server,
    prefix: 'skylight',
    hostLabel: 'app.ourskylight.com',
    // Cheap, authenticated, and it changes nothing — a healthcheck that wrote
    // to a family's calendar would be worse than no healthcheck.
    probePath: '/api/frames',
    resolveCredential: async () => {
      const account = loadAccount();
      return { source: credentialSource(account) };
    },
    // Resolves auth through the same lazy path the real tools use, so a
    // passing healthcheck means the real tools work.
    probeFn: async () => (await getClient()).request('GET', '/frames'),
    classifyThrown: classifySkylightError,
  });
}
