import { vi } from 'vitest';
import type { SkylightClient } from '../../src/client.js';

export function makeClient(overrides: Partial<Record<keyof SkylightClient, unknown>> = {}) {
  const request = vi.fn();
  const resolveFrameId = vi.fn().mockResolvedValue('3435252');
  return { client: { request, resolveFrameId, ...overrides } as unknown as SkylightClient, request, resolveFrameId };
}
