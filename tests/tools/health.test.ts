import { describe, it, expect, vi } from 'vitest';
import { registerHealthcheckTools } from '../../src/tools/health.js';

/**
 * The helper registers via `server.registerTool` (not `server.tool`, which the
 * other tool modules use), so this harness differs from `_setup.ts`'s.
 */
function harness(opts: {
  account?: unknown;
  probe?: () => Promise<unknown>;
} = {}) {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const server = {
    registerTool: (name: string, _cfg: any, cb: any) => { tools[name] = cb; },
  } as any;
  const loadAccount = vi.fn(() => {
    if (opts.account instanceof Error) throw opts.account;
    return (opts.account ?? { refreshToken: undefined, email: 'a@b.com', password: 'pw' }) as any;
  });
  const probe = opts.probe ?? (async () => ({ data: [{ id: '3435252' }] }));
  const request = vi.fn(probe);
  const getClient = async () => ({ request }) as any;
  registerHealthcheckTools(server, getClient, loadAccount as any);
  return { tools, loadAccount, request };
}

const run = async (h: ReturnType<typeof harness>) =>
  JSON.parse((await h.tools.skylight_healthcheck({})).content[0].text);

describe('skylight_healthcheck', () => {
  it('registers under the fleet-standard name', () => {
    expect(Object.keys(harness().tools)).toEqual(['skylight_healthcheck']);
  });

  it('reports ok when the credential resolves and the probe succeeds', async () => {
    const out = await run(harness());
    expect(out.ok).toBe(true);
    expect(out.credential.resolved).toBe(true);
  });

  it('names the login pair as the credential source', async () => {
    const out = await run(harness());
    expect(out.credential.source).toBe('SKYLIGHT_EMAIL+SKYLIGHT_PASSWORD');
  });

  it('names a supplied refresh token as the credential source', async () => {
    const out = await run(harness({ account: { refreshToken: 'RT' } }));
    expect(out.credential.source).toBe('SKYLIGHT_REFRESH_TOKEN');
  });

  it('never echoes the credential itself', async () => {
    const out = await run(harness({ account: { refreshToken: 'SUPER-SECRET-TOKEN' } }));
    expect(JSON.stringify(out)).not.toContain('SUPER-SECRET-TOKEN');
  });

  it('reports missing config as no_credential, not a rejected credential', async () => {
    const out = await run(harness({ account: new Error('Missing Skylight auth config. Set SKYLIGHT_REFRESH_TOKEN …') }));
    expect(out.ok).toBe(false);
    expect(out.error.kind).toBe('no_credential');
  });

  it('reports bad credentials as credential_rejected', async () => {
    const out = await run(harness({
      probe: async () => { throw new Error('Skylight login failed — check SKYLIGHT_EMAIL/SKYLIGHT_PASSWORD (or you may be temporarily rate-limited after repeated attempts).'); },
    }));
    expect(out.ok).toBe(false);
    expect(out.error.kind).toBe('credential_rejected');
  });

  // The regression this tool exists for: a valid password, a working network,
  // and an OAuth step the server changed underneath us. Reported as a
  // credential problem, it costs a round-trip to diagnose.
  it('distinguishes an OAuth contract change from a bad password', async () => {
    const out = await run(harness({
      probe: async () => { throw new Error('Skylight login failed: could not extract authorization code from /oauth/authorize (last response HTTP 400). The authorization request was rejected — the OAuth contract may have changed.'); },
    }));
    expect(out.ok).toBe(false);
    expect(out.error.kind).toBe('oauth_contract_changed');
    expect(out.hint).toMatch(/authorize/i);
    expect(out.error.kind).not.toBe('credential_rejected');
  });

  it('flags a changed login page distinctly', async () => {
    const out = await run(harness({
      probe: async () => { throw new Error('Skylight login failed: could not find authenticity_token in /auth/session/new response (HTTP 200, 900 bytes of HTML — the login page markup may have changed).'); },
    }));
    expect(out.error.kind).toBe('login_page_changed');
  });

  it('classifies a non-Error throw without crashing', async () => {
    // Rejecting with a bare string is legal and would otherwise hit
    // `err.message` on a value that has none.
    const out = await run(harness({
      probe: async () => { throw 'Missing Skylight auth config'; },
    }));
    expect(out.ok).toBe(false);
    expect(out.error.kind).toBe('no_credential');
  });

  it('leaves an unrecognised failure to the helper defaults', async () => {
    const out = await run(harness({ probe: async () => { throw new Error('socket hang up'); } }));
    expect(out.ok).toBe(false);
    expect(out.error.kind).not.toBe('oauth_contract_changed');
  });
});
