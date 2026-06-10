import { describe, it, expect, vi } from 'vitest';
import { makeGetClient } from '../src/get-client.js';
import { NO_ENV_CONFIG_MARKER } from '../src/config.js';
import type { SkylightClient } from '../src/client.js';

const fakeClient = { request: vi.fn() } as unknown as SkylightClient;
const resolved = { client: fakeClient, source: 'env' as const };

describe('makeGetClient', () => {
  it('resolves auth once and caches the client', async () => {
    const resolveAuthFn = vi.fn().mockResolvedValue(resolved);
    const getClient = makeGetClient(resolveAuthFn);
    expect(await getClient()).toBe(fakeClient);
    expect(await getClient()).toBe(fakeClient);
    expect(resolveAuthFn).toHaveBeenCalledOnce();
  });

  it('retries after a transient login failure instead of caching it', async () => {
    const resolveAuthFn = vi.fn()
      .mockRejectedValueOnce(new Error('Skylight login failed: 503 Service Unavailable'))
      .mockResolvedValueOnce(resolved);
    const getClient = makeGetClient(resolveAuthFn);
    await expect(getClient()).rejects.toThrow(/503/);
    // The transient failure must NOT be cached — the next call retries and succeeds.
    expect(await getClient()).toBe(fakeClient);
    expect(resolveAuthFn).toHaveBeenCalledTimes(2);
  });

  it('caches a genuine missing-config error and rethrows it without retrying', async () => {
    const resolveAuthFn = vi.fn().mockRejectedValue(new Error(NO_ENV_CONFIG_MARKER));
    const getClient = makeGetClient(resolveAuthFn);
    await expect(getClient()).rejects.toThrow(NO_ENV_CONFIG_MARKER);
    await expect(getClient()).rejects.toThrow(NO_ENV_CONFIG_MARKER);
    expect(resolveAuthFn).toHaveBeenCalledOnce();
  });

  it('single-flights concurrent first calls into one login', async () => {
    let release!: (v: typeof resolved) => void;
    const resolveAuthFn = vi.fn().mockReturnValue(new Promise((r) => { release = r; }));
    const getClient = makeGetClient(resolveAuthFn);
    const calls = [getClient(), getClient(), getClient()];
    release(resolved);
    const clients = await Promise.all(calls);
    expect(clients).toEqual([fakeClient, fakeClient, fakeClient]);
    expect(resolveAuthFn).toHaveBeenCalledOnce();
  });

  it('clears the in-flight promise on rejection so concurrent waiters all fail but the next call retries', async () => {
    let reject!: (e: unknown) => void;
    const resolveAuthFn = vi.fn()
      .mockReturnValueOnce(new Promise((_r, rej) => { reject = rej; }))
      .mockResolvedValueOnce(resolved);
    const getClient = makeGetClient(resolveAuthFn);
    const a = getClient();
    const b = getClient();
    reject(new Error('rate limited'));
    await expect(a).rejects.toThrow('rate limited');
    await expect(b).rejects.toThrow('rate limited');
    expect(resolveAuthFn).toHaveBeenCalledOnce();
    expect(await getClient()).toBe(fakeClient);
    expect(resolveAuthFn).toHaveBeenCalledTimes(2);
  });

  it('stringifies non-Error rejections', async () => {
    const resolveAuthFn = vi.fn().mockRejectedValue('boom');
    const getClient = makeGetClient(resolveAuthFn);
    await expect(getClient()).rejects.toThrow('boom');
  });

  it('defaults to the real resolveAuth when no resolver is injected', () => {
    expect(makeGetClient()).toBeTypeOf('function');
  });
});
