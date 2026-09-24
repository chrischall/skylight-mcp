import { createHash } from 'node:crypto';
import { z } from 'zod';
import { redactSecrets } from '@chrischall/mcp-utils';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { apiPath, textContent, flattenJsonApi, frameScoped, idParam, idArrayParam, type GetClient, type JsonApiDoc } from './_shared.js';
import { APPLE_APP_PASSWORD_VAR, APPLE_ID_VAR, loadAppleCalendarCredential } from '../config.js';
import { confirmTokenParam, confirmWrite } from './_confirm.js';

/**
 * Replace every occurrence of `secret` in `text` — raw, and as it would appear
 * JSON-escaped inside a stringified body — then run the fleet redactor over
 * whatever else an upstream echo might carry.
 */
function scrubSecret(text: string, secret: string): string {
  const escaped = JSON.stringify(secret).slice(1, -1);
  let out = text.split(secret).join('[REDACTED]');
  if (escaped !== secret) out = out.split(escaped).join('[REDACTED]');
  return redactSecrets(out);
}

/**
 * A short one-way fingerprint of the credential, so the confirm preview (and
 * the token, which hashes the preview) identify WHICH password will be sent
 * without revealing any of it. A 16-letter app-specific password is far past
 * brute force from 12 hex digits.
 */
function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

export function registerCalendarTools(server: McpServer, getClient: GetClient) {
  server.registerTool(
    'skylight_list_calendars',
    {
      description: "List the frame's calendar accounts (Google/Apple/etc.) and their active calendars.",
      inputSchema: z.object({ frameId: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f) => textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', apiPath`/frames/${f}/calendars`)))),
  );

  server.registerTool(
    'skylight_get_calendar',
    {
      description: 'Get one calendar account.',
      inputSchema: z.object({ id: z.string(), frameId: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', apiPath`/frames/${f}/calendars/${id}`)))),
  );

  server.registerTool(
    'skylight_list_nudges',
    {
      description: 'List nudges (reminders) in a date range.',
      inputSchema: z.object({
        after: z.string().describe('YYYY-MM-DD lower bound (required).'),
        before: z.string().describe('YYYY-MM-DD upper bound (required).'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    frameScoped(getClient, async (c, f, { after, before }: { after: string; before: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('GET', apiPath`/frames/${f}/nudges`, { query: { after, before } })))),
  );

  server.registerTool(
    'skylight_add_webcal',
    {
      description: 'Subscribe the frame to a webcal/ICS calendar URL.',
      inputSchema: z.object({
        sync_url: z.string().describe('Public webcal/ICS URL to subscribe the frame to.'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { sync_url }: { sync_url: string; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('POST', apiPath`/frames/${f}/webcal_accounts`, { body: { sync_url } })))),
  );

  server.registerTool(
    'skylight_update_calendar',
    {
      description: 'Set which sub-calendars of a connected account are active.',
      inputSchema: z.object({
        id: z.string(),
        active_calendars: idArrayParam.describe('Calendar ids to keep active.'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { id, active_calendars }: { id: string; active_calendars: Array<string | number>; frameId?: string }) =>
      textContent(flattenJsonApi(await c.request<JsonApiDoc>('PUT', apiPath`/frames/${f}/calendars/${id}`, { body: { active_calendars } })))),
  );

  server.registerTool(
    'skylight_delete_source_calendar',
    {
      description: 'Remove a connected source calendar (incl. webcal subscriptions).',
      inputSchema: z.object({ id: z.string(), frameId: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string; frameId?: string }) => {
      await c.request('DELETE', apiPath`/frames/${f}/source_calendars/${id}`);
      return textContent({ deleted: id });
    }),
  );

  server.registerTool(
    'skylight_set_default_calendar',
    {
      description: 'Set the default source calendar for new events.',
      inputSchema: z.object({
        id: idParam.describe('Source-calendar id to make the default for new events.'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { id }: { id: string | number; frameId?: string }) => {
      const doc = await c.request<JsonApiDoc | undefined>('POST', apiPath`/frames/${f}/source_calendars/set_default_for_new_events`, { body: { id } });
      return textContent(doc ? flattenJsonApi(doc) : { default: id });
    }),
  );

  const linkApple = frameScoped(getClient, async (c, f, { email, secret, confirmToken }: { email: string; secret: string; frameId?: string; confirmToken?: string }, ctx) => {
    const path = apiPath`/frames/${f}/calendars/apple`;
    const gate = await confirmWrite(ctx, {
      tool: 'skylight_link_apple_calendar',
      action: 'calendar.link_apple',
      description: `Link Apple ID ${email} to frame ${f} — hands Skylight persistent access to that iCloud account's calendars, using the app-specific password from ${APPLE_APP_PASSWORD_VAR}`,
      target: email,
      method: 'POST',
      path,
      // The preview must never carry the password; the fingerprint still binds
      // WHICH credential into the token, so a rotated env var between the two
      // phases is DRAFT_CHANGED rather than silently sent.
      body: { email, app_specific_password: `[from ${APPLE_APP_PASSWORD_VAR}, sha256 ${fingerprint(secret)}]` },
      confirmToken,
    });
    if (gate) return gate;
    let doc: JsonApiDoc;
    try {
      doc = await c.request<JsonApiDoc>('POST', path, { body: { email, app_specific_password: secret } });
    } catch (e) {
      // The shared client already redacts common secret shapes from upstream
      // error bodies; this credential's shape is not one of them, so a 422 that
      // echoes the request must be scrubbed here before it reaches the client.
      if (e instanceof Error) e.message = scrubSecret(e.message, secret);
      throw e;
    }
    const text = scrubSecret(JSON.stringify(flattenJsonApi(doc)), secret);
    try {
      return textContent(JSON.parse(text));
    } catch {
      return textContent(text);
    }
  });

  server.registerTool(
    'skylight_link_apple_calendar',
    {
      description: `Link an Apple/iCloud calendar to the frame. The app-specific password is read from the server's ${APPLE_APP_PASSWORD_VAR} environment variable — it is never a tool argument, so it never passes through the model or the transcript. Linking hands Skylight persistent access to that iCloud account's calendars, so it asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token proceeds (see MCP_CONFIRM_MODE). The preview names the Apple ID and frame and fingerprints (never shows) the password.`,
      inputSchema: z.object({
        email: z.string().optional().describe(`Apple ID email. Defaults to ${APPLE_ID_VAR} from the server's environment.`),
        frameId: z.string().optional(),
        confirmToken: confirmTokenParam,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    // fleet-audit#962 / #732: the credential comes from env, the write is gated
    // and the response/error are scrubbed. Config is checked BEFORE the client
    // is resolved so an unconfigured call fails fast without a login.
    async (args: { email?: string; frameId?: string; confirmToken?: string }, ctx: ServerContext) => {
      const cred = loadAppleCalendarCredential();
      if (!cred.appSpecificPassword) {
        throw new Error(
          `Missing ${APPLE_APP_PASSWORD_VAR}. Generate an app-specific password at appleid.apple.com and set it in the ` +
            "server's environment. It is deliberately not a tool argument, so it never passes through the model or the transcript.",
        );
      }
      const email = args.email ?? cred.email;
      if (!email) throw new Error(`Missing Apple ID: pass \`email\`, or set ${APPLE_ID_VAR} in the server's environment.`);
      return linkApple({ ...args, email, secret: cred.appSpecificPassword }, ctx);
    },
  );

  server.registerTool(
    'skylight_categorize_source_calendar',
    {
      description: "Attribute a source calendar's events to one or more family members.",
      inputSchema: z.object({
        id: idParam.describe('Source-calendar id (from skylight_list_source_calendars / skylight_list_calendars).'),
        category_ids: idArrayParam.describe("Family-member category ids whose members this calendar's events are attributed to."),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { id, category_ids }: { id: string | number; category_ids: Array<string | number>; frameId?: string }) => {
      const categorizations = category_ids.map((cid) => ({ category_id: cid }));
      const doc = await c.request<JsonApiDoc>('PUT', apiPath`/frames/${f}/source_calendars/${id}/source_calendar_categorizations`, { body: { categorizations } });
      return textContent(flattenJsonApi(doc));
    }),
  );

  server.registerTool(
    'skylight_create_source_calendar',
    {
      description: 'Create a source calendar from raw provider attributes (advanced).',
      inputSchema: z.object({
        attributes: z.record(z.string(), z.unknown()).describe('Provider-specific source-calendar attributes.'),
        frameId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    frameScoped(getClient, async (c, f, { attributes }: { attributes: Record<string, unknown>; frameId?: string }) => {
      // NOTE: generic passthrough; attribute shape is provider-specific.
      const doc = await c.request<JsonApiDoc>('POST', apiPath`/frames/${f}/source_calendars`, { body: { attributes } });
      return textContent(flattenJsonApi(doc));
    }),
  );
}
