import { describe, it, expect, vi, afterEach } from 'vitest';
import { SkylightClient } from '../src/client.js';
import type { SessionAccount } from '../src/config.js';

const account: SessionAccount = {
  mode: 'session', name: 'x', baseUrl: 'https://app.ourskylight.com/api', email: 'a@b.com', password: 'pw',
};

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SkylightClient.request', () => {
  it('attaches the bearer token and returns parsed JSON', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: '1' }] }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster: vi.fn() });
    const out = await c.request('GET', '/frames/3/lists');
    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe('https://app.ourskylight.com/api/frames/3/lists');
    expect((init.headers as Record<string,string>).Authorization).toBe('Bearer AT');
    expect(out).toEqual({ data: [{ id: '1' }] });
  });

  it('refreshes once on a 401 then retries', async () => {
    const httpFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: 'ok' }));
    const tokenPoster = vi.fn().mockResolvedValue({ status: 200, json: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 600 } });
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster });
    const out = await c.request('GET', '/frames/3/lists');
    expect(tokenPoster).toHaveBeenCalledOnce();
    expect((httpFetch.mock.calls[1][1].headers as Record<string,string>).Authorization).toBe('Bearer AT2');
    expect(out).toEqual({ data: 'ok' });
  });

  it('throws after a second 401', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'nope' }));
    const tokenPoster = vi.fn().mockResolvedValue({ status: 200, json: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 600 } });
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster });
    await expect(c.request('GET', '/x')).rejects.toThrow(/401/);
  });

  it('proactively refreshes when the token is near expiry', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const tokenPoster = vi.fn().mockResolvedValue({ status: 200, json: { access_token: 'FRESH', refresh_token: 'RT2', expires_in: 600 } });
    const c = new SkylightClient({ account, tokens: { accessToken: 'OLD', refreshToken: 'RT', expiresInMs: -1 }, httpFetch, tokenPoster });
    await c.request('GET', '/x');
    expect(tokenPoster).toHaveBeenCalledOnce();
    expect((httpFetch.mock.calls[0][1].headers as Record<string,string>).Authorization).toBe('Bearer FRESH');
  });

  it('throws with HTTP 500 message on non-2xx non-401', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'server error' }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster: vi.fn() });
    await expect(c.request('GET', '/x')).rejects.toThrow(/HTTP 500/);
  });

  it('handles text() rejection in error path gracefully', async () => {
    const badResponse = {
      status: 500,
      ok: false,
      json: async () => { throw new Error('no json'); },
      text: async () => { throw new Error('no text'); },
    } as unknown as Response;
    const httpFetch = vi.fn().mockResolvedValue(badResponse);
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster: vi.fn() });
    await expect(c.request('GET', '/x')).rejects.toThrow(/HTTP 500/);
  });

  it('returns undefined for 204 no-content responses', async () => {
    const response = {
      status: 204,
      ok: true,
      json: vi.fn(),
      text: async () => '',
    } as unknown as Response;
    const httpFetch = vi.fn().mockResolvedValue(response);
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster: vi.fn() });
    const result = await c.request('DELETE', '/x');
    expect(result).toBeUndefined();
    expect((response as unknown as { json: ReturnType<typeof vi.fn> }).json).not.toHaveBeenCalled();
  });

  it('sends body as JSON and sets Content-Type header', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { created: true }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster: vi.fn() });
    await c.request('POST', '/items', { body: { name: 'test', value: 42 } });
    const [, init] = httpFetch.mock.calls[0];
    expect((init.headers as Record<string,string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'test', value: 42 }));
  });

  it('filters undefined query params and includes defined ones', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, httpFetch, tokenPoster: vi.fn() });
    await c.request('GET', '/items', { query: { a: '1', b: undefined } });
    const [url] = httpFetch.mock.calls[0];
    expect(url).toContain('a=1');
    expect(url).not.toContain('b=');
  });

  it('uses the global fetch when httpFetch is not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', mockFetch);
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 999999 }, tokenPoster: vi.fn() });
    await c.request('GET', '/x');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('keeps old refreshToken when refresh response omits it', async () => {
    const httpFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: 'ok' }));
    // refresh_token is empty string — normalize() returns '' for refreshToken
    const tokenPoster = vi.fn().mockResolvedValue({ status: 200, json: { access_token: 'AT2', refresh_token: '', expires_in: 600 } });
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'OLDRT', expiresInMs: 999999 }, httpFetch, tokenPoster });
    await c.request('GET', '/x');
    // After refresh, new token AT2 should be used
    expect((httpFetch.mock.calls[1][1].headers as Record<string,string>).Authorization).toBe('Bearer AT2');
  });

  it('coalesces concurrent refresh calls into a single token request', async () => {
    // Both requests are near-expiry, so both will call refresh() concurrently.
    // The second call should reuse the in-flight promise rather than issuing a second token POST.
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((res) => { resolveRefresh = res; });
    const tokenPoster = vi.fn().mockImplementation(async () => {
      await refreshPromise;
      return { status: 200, json: { access_token: 'NEWAT', refresh_token: 'NEWRT', expires_in: 600 } };
    });
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'OLD', refreshToken: 'RT', expiresInMs: -1 }, httpFetch, tokenPoster });

    // Start two concurrent requests; both will hit the proactive-refresh branch simultaneously
    const p1 = c.request('GET', '/a');
    const p2 = c.request('GET', '/b');
    resolveRefresh();
    await Promise.all([p1, p2]);

    // tokenPoster should only have been called once despite two concurrent callers
    expect(tokenPoster).toHaveBeenCalledOnce();
  });
});

describe('SkylightClient.resolveFrameId', () => {
  it('returns the configured frame id without a network call', async () => {
    const httpFetch = vi.fn();
    const c = new SkylightClient({ account: { ...account, frameId: '77' }, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 9e9 }, httpFetch, tokenPoster: vi.fn() });
    expect(await c.resolveFrameId()).toBe('77');
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it('discovers the only frame from GET /frames', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: '3435252', type: 'approved_viewer_frame', attributes: { name: 'home', timezone: 'America/New_York' } }] }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 9e9 }, httpFetch, tokenPoster: vi.fn() });
    expect(await c.resolveFrameId()).toBe('3435252');
    await c.resolveFrameId();
    expect(httpFetch).toHaveBeenCalledOnce();
  });

  it('throws listing frames when multiple and none chosen', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { data: [
      { id: '1', attributes: { name: 'A' } }, { id: '2', attributes: { name: 'B' } },
    ] }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 9e9 }, httpFetch, tokenPoster: vi.fn() });
    await expect(c.resolveFrameId()).rejects.toThrow(/multiple frames.*1 \(A\).*2 \(B\)/s);
  });

  it('throws when /frames returns no data key', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 9e9 }, httpFetch, tokenPoster: vi.fn() });
    await expect(c.resolveFrameId()).rejects.toThrow(/No Skylight frames/);
  });

  it('lists frame with unknown name as ? when attributes is absent', async () => {
    const httpFetch = vi.fn().mockResolvedValue(jsonResponse(200, { data: [
      { id: '1' }, { id: '2' },
    ] }));
    const c = new SkylightClient({ account, tokens: { accessToken: 'AT', refreshToken: 'RT', expiresInMs: 9e9 }, httpFetch, tokenPoster: vi.fn() });
    await expect(c.resolveFrameId()).rejects.toThrow(/1 \(\?\).*2 \(\?\)/s);
  });
});
