import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let child: ChildProcessWithoutNullStreams;
afterEach(() => child?.kill());

describe('production stdio entry point', () => {
  it('supports modern discovery, all 114 tools, and credential-free healthcheck', async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SKYLIGHT_')));
    // Stripping `SKYLIGHT_*` from the inherited env is not enough on its own:
    // `dist/index.js` calls `loadDotenvSafely()`, and `dotenv.config()` with no
    // explicit path resolves `.env` against the CHILD's cwd — so a developer's
    // repo-root `.env` puts the credentials straight back and this assertion
    // flips from `no_credential` to a live, authenticated request against
    // app.ourskylight.com. CI has no `.env`, so it only ever failed locally.
    // Spawning from an empty directory (with an absolute path to the entry)
    // closes it without depending on dotenv's internals or another env switch.
    const cwd = mkdtempSync(join(tmpdir(), 'skylight-stdio-'));
    child = spawn(process.execPath, [resolve('dist/index.js')], {env, cwd});
    child.stderr.resume();
    const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
    const rpc = async (method: string, params: Record<string, unknown> = {}) => {
      child.stdin.write(JSON.stringify({jsonrpc: '2.0', id: 1, method, params: {...params, _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': {name: 'test', version: '1'},
      }}}) + '\n');
      const line = await lines.next();
      expect(line.done).toBe(false);
      const response = JSON.parse(line.value!);
      expect(response.error).toBeUndefined();
      return response.result;
    };
    await rpc('server/discover');
    expect((await rpc('tools/list')).tools).toHaveLength(114);
    expect(JSON.stringify(await rpc('tools/call', {name: 'skylight_healthcheck', arguments: {}}))).toContain('no_credential');
  });

  it('reports an out-of-band serving error on stderr rather than discarding it', async () => {
    // `serveStdio` is synchronous and swallows every out-of-band failure:
    // `reportError` is `try { options.onerror?.(error) } catch {}`, so without
    // the entry's `onerror` a transport failure, a factory rejection or a
    // discarded message is caught and then lost on BOTH channels. That silence
    // is what this pins, and nothing else would fail if the handler were
    // deleted — the entry has no other observable behaviour here.
    //
    // The trigger is a NOTIFICATION carrying a malformed modern `_meta`
    // envelope before the era is negotiated. serveStdio has nowhere to answer
    // it (a notification takes no response), so it reports it out of band and
    // writes nothing to the wire — the one shape that is invisible unless
    // somebody is listening. stdout is the MCP wire, so the report must land on
    // stderr, where `banner` already writes.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SKYLIGHT_')));
    const cwd = mkdtempSync(join(tmpdir(), 'skylight-stdio-'));
    child = spawn(process.execPath, [resolve('dist/index.js')], {env, cwd});

    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    const reported = new Promise<string>((fulfil, reject) => {
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
        if (stderr.includes('stdio serving error')) fulfil(stderr);
      });
      // Below the `it` deadline below, so a silent entry fails with THIS
      // message and the stderr it did produce, rather than with vitest's bare
      // "test timed out" — the whole symptom being that nothing was said.
      setTimeout(() => reject(new Error(`no serving error reported on stderr; saw: ${JSON.stringify(stderr)}`)), 8_000);
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: {_meta: {'io.modelcontextprotocol/protocolVersion': '2026-07-28'}},
    }) + '\n');

    expect(await reported).toContain('skylight-mcp: stdio serving error');
    expect(await reported).toContain('malformed envelope');
    // Nothing may reach the MCP wire: a notification gets no response, and a
    // diagnostic written to stdout would corrupt the protocol stream.
    expect(stdout).toBe('');
  }, 15_000);
});
