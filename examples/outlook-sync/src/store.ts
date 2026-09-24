import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { State } from './model.js';
const aad = Buffer.from('skylight-outlook-sync/state/v1');
function key(raw: string) {
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error('STATE_KEY_INVALID');
  return Buffer.from(raw, 'hex');
}
export function encrypt(s: State, raw: string): string {
  const iv = randomBytes(12),
    c = createCipheriv('aes-256-gcm', key(raw), iv);
  c.setAAD(aad);
  const data = Buffer.concat([c.update(JSON.stringify(s)), c.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}
export function decrypt(text: string, raw: string): State {
  try {
    const x = JSON.parse(text);
    if (x.v !== 1) throw 0;
    const d = createDecipheriv('aes-256-gcm', key(raw), Buffer.from(x.iv, 'base64'));
    d.setAAD(aad);
    d.setAuthTag(Buffer.from(x.tag, 'base64'));
    const s = JSON.parse(
      Buffer.concat([d.update(Buffer.from(x.data, 'base64')), d.final()]).toString(),
    );
    if (s.version !== 1 || !s.binding || !s.mappings || !Array.isArray(s.legacy)) throw 0;
    return s;
  } catch {
    throw new Error('STATE_DECRYPT_FAILED');
  }
}
export interface Store {
  load(): Promise<State>;
  save(s: State): Promise<void>;
}
/** Dedicated private branch; SHA compare-and-swap detects conflicting writers. */
export class GitHubStore implements Store {
  private sha?: string;
  constructor(
    private repo: string,
    private token: string,
    private secret: string,
    private http: typeof fetch = fetch,
  ) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('REPOSITORY_INVALID');
  }
  private async request(path: string, method = 'GET', body?: unknown) {
    let r: Response;
    try {
      r = await this.http('https://api.github.com/repos/' + this.repo + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('STATE_NETWORK_FAILURE');
    }
    if (!r.ok) throw new Error('STATE_HTTP_' + r.status);
    return r.json();
  }
  async privateRepo() {
    const x = await this.request('');
    if (x.private !== true) throw new Error('PRIVATE_REPOSITORY_REQUIRED');
  }
  async load() {
    await this.privateRepo();
    const x = await this.request('/contents/state.enc?ref=sync-state');
    if (x.encoding !== 'base64' || typeof x.sha !== 'string') throw new Error('STATE_SHAPE');
    this.sha = x.sha;
    return decrypt(Buffer.from(x.content, 'base64').toString(), this.secret);
  }
  async save(s: State) {
    if (!this.sha) throw new Error('STATE_NOT_LOADED');
    const x = await this.request('/contents/state.enc', 'PUT', {
      branch: 'sync-state',
      sha: this.sha,
      message: 'Checkpoint encrypted calendar sync state',
      content: Buffer.from(encrypt(s, this.secret)).toString('base64'),
    });
    if (!x.content?.sha) throw new Error('STATE_SAVE_UNCONFIRMED');
    this.sha = x.content.sha;
  }
  async initialize(s: State) {
    await this.privateRepo();
    const repo = await this.request('');
    const ref = await this.request('/git/ref/heads/' + encodeURIComponent(repo.default_branch));
    await this.request('/git/refs', 'POST', { ref: 'refs/heads/sync-state', sha: ref.object.sha });
    const x = await this.request('/contents/state.enc', 'PUT', {
      branch: 'sync-state',
      message: 'Initialize encrypted calendar sync state',
      content: Buffer.from(encrypt(s, this.secret)).toString('base64'),
    });
    this.sha = x.content.sha;
  }
}
