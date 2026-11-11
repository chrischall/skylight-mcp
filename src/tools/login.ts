import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { textContent, type GetClient } from './_shared.js';
import { familyMeta } from './hints.js';

/**
 * `skylight_submit_login_code` — finishes a login Skylight paused for an
 * emailed one-time code (#276).
 *
 * The code reaches the user out of band, so it cannot be collected inside the
 * call that triggered it on every client (Claude Desktop and claude.ai do not
 * elicit). Any tool that needs a fresh login fails with a message naming this
 * tool; the user reads the email and the model calls this with the digits.
 */
export function registerLoginTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_submit_login_code',
    {
      description:
        'Finish signing in to Skylight with the 6-digit login code Skylight emailed to the account. ' +
        'Use only after a Skylight tool reported that a login code was emailed; ask the user for the code — ' +
        'never guess one. Pass resend: true (without a code) to have Skylight email a new code.',
      inputSchema: z.object({
        code: z.string().optional().describe('The 6-digit code from the Skylight email.'),
        resend: z.boolean().optional().describe('Email a new code instead of submitting one.'),
      }),
      // Writes no frame data, but it does sign this server in (a new device
      // session on the account), so it is not a read.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: familyMeta('other', { aliases: ['login code', 'verification code', 'sign in'] }),
    },
    async ({ code, resend }: { code?: string; resend?: boolean }) => {
      const client = await getClient();
      const pending = client.pendingLogin;
      if (!pending) {
        throw new Error('This Skylight server signs in with SKYLIGHT_REFRESH_TOKEN, so it never needs a login code.');
      }
      if (resend) {
        await pending.resend();
        return textContent({ status: 'code-resent', next: 'Ask the user for the new code from the latest Skylight email.' });
      }
      if (!code) throw new Error('Pass the 6-digit code from the Skylight email, or resend: true for a new one.');
      await pending.submit(code);
      // Hand the minted pair to the token cache now, and prove it works.
      const frames = await client.request<{ data?: unknown[] }>('GET', '/frames');
      return textContent({ status: 'signed-in', frames: frames?.data?.length ?? 0 });
    },
  );
}
