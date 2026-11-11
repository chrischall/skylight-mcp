import { describe, it, expect, vi } from 'vitest';
import { registerLoginTools } from '../../src/tools/login.js';

function harness(pendingLogin?: { submit: unknown; resend: unknown }, frames: unknown = { data: [{ id: '1' }] }) {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const server = { registerTool: (name: string, _cfg: unknown, cb: any) => { tools[name] = cb; } } as any;
  const request = vi.fn(async () => frames);
  registerLoginTools(server, async () => ({ request, pendingLogin }) as any);
  return { call: tools.skylight_submit_login_code, request };
}
const parse = (out: any) => JSON.parse(out.content[0].text);

describe('skylight_submit_login_code', () => {
  it('submits the code, then proves the session with a frames read', async () => {
    const pending = { submit: vi.fn(async () => {}), resend: vi.fn() };
    const { call, request } = harness(pending);
    expect(parse(await call({ code: '123456' }))).toEqual({ status: 'signed-in', frames: 1 });
    expect(pending.submit).toHaveBeenCalledWith('123456');
    expect(request).toHaveBeenCalledWith('GET', '/frames');
  });

  it('reports zero frames when the read has no data array', async () => {
    const { call } = harness({ submit: vi.fn(async () => {}), resend: vi.fn() }, null);
    expect(parse(await call({ code: '123456' })).frames).toBe(0);
  });

  it('resends instead of submitting when asked', async () => {
    const pending = { submit: vi.fn(), resend: vi.fn(async () => {}) };
    const { call } = harness(pending);
    expect(parse(await call({ resend: true })).status).toBe('code-resent');
    expect(pending.submit).not.toHaveBeenCalled();
  });

  it('asks for a code when given neither', async () => {
    const { call } = harness({ submit: vi.fn(), resend: vi.fn() });
    await expect(call({})).rejects.toThrow(/6-digit code/);
  });

  it('explains a refresh-token deployment never needs a code', async () => {
    const { call } = harness(undefined);
    await expect(call({ code: '123456' })).rejects.toThrow(/SKYLIGHT_REFRESH_TOKEN/);
  });
});
