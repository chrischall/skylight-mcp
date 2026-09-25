import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerCalendarTools } from '../../src/tools/calendars.js';
import { makeClient, NO_ELICIT_CTX, confirmed, phaseOne } from './_setup.js';

function harness() {
  const tools: Record<string, (args: any) => Promise<any>> = {};
  const schemas: Record<string, any> = {};
  // Handlers get the context of a client that cannot be prompted, so the
  // confirm-gated Apple link runs the two-phase token flow.
  const server = { registerTool: (name: string, cfg: any, cb: any) => { schemas[name] = cfg.inputSchema; tools[name] = (a: any) => cb(a, NO_ELICIT_CTX); } } as any;
  const { client, request, resolveFrameId } = makeClient();
  registerCalendarTools(server, async () => client);
  return { tools, schemas, request, resolveFrameId };
}

describe('calendar tools', () => {
  // ── skylight_list_calendars ──────────────────────────────────────────────

  it('list_calendars fetches calendars with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'calendar', attributes: { name: 'Google' } }] });
    const out = await tools.skylight_list_calendars({});
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/calendars');
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'calendar', name: 'Google' }]);
  });

  it('list_calendars with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_calendars({ frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/calendars');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_get_calendar ────────────────────────────────────────────────

  it('get_calendar fetches one calendar account with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar', attributes: { name: 'Google' } } });
    const out = await tools.skylight_get_calendar({ id: '5' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/calendars/5');
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'calendar', name: 'Google' });
  });

  it('get_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar', attributes: {} } });
    await tools.skylight_get_calendar({ id: '5', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/calendars/5');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_list_nudges ─────────────────────────────────────────────────

  it('list_nudges passes after/before query with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: [{ id: '1', type: 'nudge', attributes: { summary: 'Reminder' } }] });
    const out = await tools.skylight_list_nudges({ after: '2026-01-01', before: '2026-01-31' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/3435252/nudges', {
      query: { after: '2026-01-01', before: '2026-01-31' },
    });
    expect(JSON.parse(out.content[0].text)).toEqual([{ id: '1', type: 'nudge', summary: 'Reminder' }]);
  });

  it('list_nudges with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: [] });
    await tools.skylight_list_nudges({ after: '2026-01-01', before: '2026-01-31', frameId: '99' });
    expect(request).toHaveBeenCalledWith('GET', '/frames/99/nudges', {
      query: { after: '2026-01-01', before: '2026-01-31' },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_add_webcal ──────────────────────────────────────────────────

  it('add_webcal POSTs sync_url with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'webcal_account', attributes: { sync_url: 'webcal://x' } } });
    const out = await tools.skylight_add_webcal({ sync_url: 'webcal://x' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/webcal_accounts', { body: { sync_url: 'webcal://x' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'webcal_account', sync_url: 'webcal://x' });
  });

  it('add_webcal with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '1', type: 'webcal_account', attributes: {} } });
    await tools.skylight_add_webcal({ sync_url: 'https://x.ics', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/webcal_accounts', { body: { sync_url: 'https://x.ics' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_update_calendar ─────────────────────────────────────────────

  it('update_calendar PUTs active_calendars with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar', attributes: { name: 'Google' } } });
    const out = await tools.skylight_update_calendar({ id: '5', active_calendars: ['a', 2] });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/calendars/5', { body: { active_calendars: ['a', 2] } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '5', type: 'calendar', name: 'Google' });
  });

  it('update_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '5', type: 'calendar', attributes: {} } });
    await tools.skylight_update_calendar({ id: '5', active_calendars: [1], frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/calendars/5', { body: { active_calendars: [1] } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_delete_source_calendar ──────────────────────────────────────

  it('delete_source_calendar deletes by id and returns deleted id', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_delete_source_calendar({ id: '7' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/3435252/source_calendars/7');
    expect(JSON.parse(out.content[0].text)).toEqual({ deleted: '7' });
  });

  it('delete_source_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_delete_source_calendar({ id: '7', frameId: '99' });
    expect(request).toHaveBeenCalledWith('DELETE', '/frames/99/source_calendars/7');
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_set_default_calendar ────────────────────────────────────────

  it('set_default_calendar POSTs id and flattens a returned doc', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'source_calendar', attributes: { is_default: true } } });
    const out = await tools.skylight_set_default_calendar({ id: '7' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/source_calendars/set_default_for_new_events', { body: { id: '7' } });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '7', type: 'source_calendar', is_default: true });
  });

  it('set_default_calendar returns {default:id} when no doc is returned', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue(undefined);
    const out = await tools.skylight_set_default_calendar({ id: 7 });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/source_calendars/set_default_for_new_events', { body: { id: 7 } });
    expect(JSON.parse(out.content[0].text)).toEqual({ default: 7 });
  });

  it('set_default_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue(undefined);
    await tools.skylight_set_default_calendar({ id: '7', frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/source_calendars/set_default_for_new_events', { body: { id: '7' } });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_link_apple_calendar (env credential + confirm gate, fleet-audit#962 / #732) ──

  describe('link_apple_calendar', () => {
    // A synthetic app-specific password in Apple's xxxx-xxxx-xxxx-xxxx shape. Not a real one.
    const SECRET = 'abcd-efgh-ijkl-mnop';
    const APPLE_KEYS = ['SKYLIGHT_APPLE_APP_PASSWORD', 'SKYLIGHT_APPLE_ID'] as const;
    let saved: Record<string, string | undefined>;
    beforeEach(() => {
      saved = Object.fromEntries(APPLE_KEYS.map((k) => [k, process.env[k]]));
      for (const k of APPLE_KEYS) delete process.env[k];
      process.env.SKYLIGHT_APPLE_APP_PASSWORD = SECRET;
    });
    afterEach(() => {
      for (const k of APPLE_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('no longer accepts the app-specific password as a tool argument', () => {
      const { schemas } = harness();
      const keys = Object.keys(schemas.skylight_link_apple_calendar.shape);
      expect(keys).not.toContain('app_specific_password');
      expect(keys).toContain('confirmToken');
    });

    it('refuses, before any request, when SKYLIGHT_APPLE_APP_PASSWORD is not set — and the error names the variable', async () => {
      delete process.env.SKYLIGHT_APPLE_APP_PASSWORD;
      const { tools, request } = harness();
      await expect(tools.skylight_link_apple_calendar({ email: 'apple-id@example.test' }))
        .rejects.toThrow(/SKYLIGHT_APPLE_APP_PASSWORD/);
      expect(request).not.toHaveBeenCalled();
    });

    it('refuses when no Apple ID email is given and SKYLIGHT_APPLE_ID is unset', async () => {
      const { tools, request } = harness();
      await expect(tools.skylight_link_apple_calendar({})).rejects.toThrow(/SKYLIGHT_APPLE_ID/);
      expect(request).not.toHaveBeenCalled();
    });

    it('phase 1 previews the Apple ID and frame with the password fingerprinted, never revealed, and makes NO request', async () => {
      const { tools, request } = harness();
      const out = phaseOne(await tools.skylight_link_apple_calendar({ email: 'apple-id@example.test' }));
      expect(request).not.toHaveBeenCalled();
      expect(out.status).toBe('confirmation-required');
      expect(out.action).toBe('calendar.link_apple');
      expect(out.preview).toMatchObject({ method: 'POST', path: '/frames/3435252/calendars/apple' });
      expect(out.preview.willSend.email).toBe('apple-id@example.test');
      expect(typeof out.preview.willSend.app_specific_password).toBe('string');
      expect(out.preview.willSend.app_specific_password).toMatch(/SKYLIGHT_APPLE_APP_PASSWORD/);
      expect(out.preview.description).toMatch(/apple-id@example\.test/);
      expect(out.preview.description).toMatch(/3435252/);
      expect(out.preview.description).toMatch(/iCloud|Apple/);
      expect(JSON.stringify(out)).not.toContain(SECRET);
      expect(JSON.stringify(out)).not.toContain('mnop');
    });

    it('a changed SKYLIGHT_APPLE_APP_PASSWORD between the phases changes the preview (the token binds the credential)', async () => {
      const { tools } = harness();
      const first = phaseOne(await tools.skylight_link_apple_calendar({ email: 'apple-id@example.test' }));
      process.env.SKYLIGHT_APPLE_APP_PASSWORD = 'qrst-uvwx-yzab-cdef';
      const second = phaseOne(await tools.skylight_link_apple_calendar({ email: 'apple-id@example.test' }));
      expect(second.preview.willSend.app_specific_password).not.toBe(first.preview.willSend.app_specific_password);
    });

    it('the confirmed call POSTs the env password with the Apple ID, using the default frame', async () => {
      const { tools, request } = harness();
      request.mockResolvedValue({ data: { id: '1', type: 'calendar', attributes: { name: 'iCloud' } } });
      const out = await confirmed(tools.skylight_link_apple_calendar, { email: 'apple-id@example.test' });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/calendars/apple', {
        body: { email: 'apple-id@example.test', app_specific_password: SECRET },
      });
      expect(JSON.parse(out.content[0].text)).toEqual({ id: '1', type: 'calendar', name: 'iCloud' });
    });

    it('defaults the Apple ID to SKYLIGHT_APPLE_ID when the email argument is omitted', async () => {
      process.env.SKYLIGHT_APPLE_ID = 'env-apple-id@example.test';
      const { tools, request } = harness();
      request.mockResolvedValue({ data: { id: '1', type: 'calendar', attributes: {} } });
      const preview = phaseOne(await tools.skylight_link_apple_calendar({}));
      expect(preview.preview.willSend.email).toBe('env-apple-id@example.test');
      await confirmed(tools.skylight_link_apple_calendar, {});
      expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/calendars/apple', {
        body: { email: 'env-apple-id@example.test', app_specific_password: SECRET },
      });
    });

    it('with explicit frameId uses it and skips resolveFrameId', async () => {
      const { tools, request, resolveFrameId } = harness();
      request.mockResolvedValue({ data: { id: '1', type: 'calendar', attributes: {} } });
      await confirmed(tools.skylight_link_apple_calendar, { email: 'apple-id@example.test', frameId: '99' });
      expect(request).toHaveBeenCalledWith('POST', '/frames/99/calendars/apple', {
        body: { email: 'apple-id@example.test', app_specific_password: SECRET },
      });
      expect(resolveFrameId).not.toHaveBeenCalled();
    });

    it('scrubs the password from a response that echoes it', async () => {
      const { tools, request } = harness();
      request.mockResolvedValue({
        data: { id: '1', type: 'calendar', attributes: { email: 'apple-id@example.test', app_specific_password: SECRET, note: `sent ${SECRET} upstream` } },
      });
      const out = await confirmed(tools.skylight_link_apple_calendar, { email: 'apple-id@example.test' });
      const text: string = out.content[0].text;
      expect(text).not.toContain(SECRET);
      expect(JSON.parse(text)).toMatchObject({ id: '1', email: 'apple-id@example.test' });
    });

    it('scrubs the password from an upstream error that echoes the request body', async () => {
      const { tools, request } = harness();
      request.mockRejectedValue(new Error(`Skylight 422: {"email":"apple-id@example.test","app_specific_password":"${SECRET}"}`));
      let caught: unknown;
      try {
        await confirmed(tools.skylight_link_apple_calendar, { email: 'apple-id@example.test' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/422/);
      expect((caught as Error).message).not.toContain(SECRET);
    });

    it('rethrows a non-Error rejection untouched (there is no message to scrub)', async () => {
      const { tools, request } = harness();
      const rejection = { status: 503 };
      request.mockRejectedValue(rejection);
      await expect(confirmed(tools.skylight_link_apple_calendar, { email: 'apple-id@example.test' })).rejects.toBe(rejection);
    });

    it('returns the scrubbed text as a string when scrubbing a password made of JSON syntax leaves invalid JSON', async () => {
      // A password of `","` matches the separator between two string fields, so
      // redacting it splices the object into text JSON.parse rejects. The text is
      // still returned (scrubbed) rather than the call throwing.
      process.env.SKYLIGHT_APPLE_APP_PASSWORD = '","';
      const { tools, request } = harness();
      request.mockResolvedValue({ data: { id: '1', type: 'calendar', attributes: { name: 'iCloud' } } });
      const out = await confirmed(tools.skylight_link_apple_calendar, { email: 'apple-id@example.test' });
      // The unparseable scrubbed JSON comes back as a single string value.
      const body: unknown = JSON.parse(out.content[0].text);
      expect(typeof body).toBe('string');
      expect(() => JSON.parse(body as string)).toThrow();
      expect(body).toContain('[REDACTED]');
      expect(body).not.toContain('","');
    });
  });

  // ── skylight_categorize_source_calendar ──────────────────────────────────

  it('categorize_source_calendar PUTs categorizations with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '7', type: 'source_calendar', attributes: { name: 'Work' } } });
    const out = await tools.skylight_categorize_source_calendar({ id: '7', category_ids: ['10901869', 7] });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/3435252/source_calendars/7/source_calendar_categorizations', {
      body: { categorizations: [{ category_id: '10901869' }, { category_id: 7 }] },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '7', type: 'source_calendar', name: 'Work' });
  });

  it('categorize_source_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '8', type: 'source_calendar', attributes: {} } });
    await tools.skylight_categorize_source_calendar({ id: 8, category_ids: ['10901869', 7], frameId: '99' });
    expect(request).toHaveBeenCalledWith('PUT', '/frames/99/source_calendars/8/source_calendar_categorizations', {
      body: { categorizations: [{ category_id: '10901869' }, { category_id: 7 }] },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });

  // ── skylight_create_source_calendar ──────────────────────────────────────

  it('create_source_calendar POSTs raw attributes with default frame', async () => {
    const { tools, request } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'source_calendar', attributes: { provider: 'custom' } } });
    const out = await tools.skylight_create_source_calendar({ attributes: { provider: 'custom', sync_url: 'x' } });
    expect(request).toHaveBeenCalledWith('POST', '/frames/3435252/source_calendars', {
      body: { attributes: { provider: 'custom', sync_url: 'x' } },
    });
    expect(JSON.parse(out.content[0].text)).toEqual({ id: '9', type: 'source_calendar', provider: 'custom' });
  });

  it('create_source_calendar with explicit frameId uses it and skips resolveFrameId', async () => {
    const { tools, request, resolveFrameId } = harness();
    request.mockResolvedValue({ data: { id: '9', type: 'source_calendar', attributes: {} } });
    await tools.skylight_create_source_calendar({ attributes: { provider: 'custom' }, frameId: '99' });
    expect(request).toHaveBeenCalledWith('POST', '/frames/99/source_calendars', {
      body: { attributes: { provider: 'custom' } },
    });
    expect(resolveFrameId).not.toHaveBeenCalled();
  });
});
