import { vi } from 'vitest';
import type { SkylightClient } from '../../src/client.js';

export function makeClient(overrides: Partial<Record<keyof SkylightClient, unknown>> = {}) {
  const request = vi.fn();
  const resolveFrameId = vi.fn().mockResolvedValue('3435252');
  return { client: { request, resolveFrameId, ...overrides } as unknown as SkylightClient, request, resolveFrameId };
}

/**
 * The request context of a client that declares NO elicitation capability
 * (claude.ai, Claude Desktop) — so a confirm-gated tool runs the two-phase
 * confirm-token flow under the default MCP_CONFIRM_MODE (ask-user). Pass it as
 * the handler's second argument when calling a registered handler directly.
 */
export const NO_ELICIT_CTX = {
  mcpReq: { envelope: { 'io.modelcontextprotocol/clientCapabilities': {} } },
} as const;

type Handler = (args: any) => Promise<any>;

/**
 * Run a confirm-gated handler through both phases: the first call must come back
 * `confirmation-required` (and so has written nothing), then the same arguments
 * plus its `confirmToken` perform the write. Returns the phase-2 result.
 */
export async function confirmed(handler: Handler, args: Record<string, unknown>): Promise<any> {
  const first = await handler(args);
  const body = JSON.parse(first.content[0].text);
  if (body.status !== 'confirmation-required') {
    throw new Error(`expected a confirmation-required preview, got ${first.content[0].text}`);
  }
  return handler({ ...args, confirmToken: body.confirmToken });
}

/** Parse phase 1 of a confirm-gated call. */
export function phaseOne(out: any): { status: string; action: string; preview: Record<string, any>; confirmToken: string } {
  return JSON.parse(out.content[0].text);
}
