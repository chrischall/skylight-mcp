import { configSchema, daytime, horizon } from './model.js';
import { GitHubStore } from './store.js';
import { MicrosoftAuth, SkylightAuth } from './auth.js';
import { Source } from './source.js';
import { Graph } from './graph.js';
import { sync } from './engine.js';
export function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error('CONFIG_MISSING_' + name);
  return v;
}
class SkylightApi {
  constructor(
    private auth: SkylightAuth,
    private http: typeof fetch = fetch,
  ) {}
  async request(method: string, path: string, opts: { query?: Record<string, string> } = {}) {
    const url = new URL('https://app.ourskylight.com/api' + path);
    for (const [key, value] of Object.entries(opts.query || {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.http(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${await this.auth.token()}`,
          'skylight-api-version': '2026-05-01',
        },
      });
    } catch {
      throw new Error('SKYLIGHT_NETWORK');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('SKYLIGHT_HTTP_' + response.status);
    }
    return response.json();
  }
}
async function main() {
  const c = configSchema.parse(JSON.parse(required('SYNC_CONFIG'))),
    now = new Date();
  if (process.env.GITHUB_EVENT_NAME === 'schedule' && !daytime(now, c)) {
    console.log(JSON.stringify({ status: 'outside_daytime' }));
    return;
  }
  const store = new GitHubStore(
    required('GITHUB_REPOSITORY'),
    required('GH_TOKEN'),
    required('SYNC_STATE_KEY'),
  );
  const s = await store.load(),
    save = () => store.save(s);
  const source = new Source(new SkylightApi(new SkylightAuth(s, save)), c);
  const graph = new Graph(new MicrosoftAuth(required('MICROSOFT_CLIENT_ID'), s, save), c);
  await graph.verifyAccount();
  const result = await sync(
    c,
    s,
    source,
    graph,
    save,
    horizon(now, c.timezone),
    process.env.SYNC_APPLY === 'true',
    now,
  );
  console.log(JSON.stringify(result));
}
main().catch((error) => {
  const code =
    error instanceof Error && /^[A-Z][A-Z_0-9]+$/.test(error.message)
      ? error.message
      : 'SYNC_FAILED';
  console.error(code);
  console.error(
    'Sync stopped safely. No further writes were attempted. Inspect configuration, sign-in status, and encrypted checkpoint; run a dry check before resuming.',
  );
  process.exitCode = 1;
});
