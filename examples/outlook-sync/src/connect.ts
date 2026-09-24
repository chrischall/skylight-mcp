/** Interactive local bootstrap only. Never used by the hourly workflow. */
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { configSchema, binding, type State } from './model.js';
import { encrypt, decrypt, GitHubStore } from './store.js';
import {
  microsoftPost,
  scopes,
  tokenFrom,
  SkylightAuth,
  MicrosoftAuth,
  isMicrosoftDeviceVerificationUri,
} from './auth.js';
import { Graph } from './graph.js';
function need(k: string) {
  if (!process.env[k]) throw new Error('MISSING_' + k);
  return process.env[k]!;
}
async function main() {
  await mkdir('.sync', { recursive: true, mode: 0o700 });
  await chmod('.sync', 0o700);
  let key: string;
  try {
    key = (await readFile('.sync/state-key', 'utf8')).trim();
  } catch {
    key = randomBytes(32).toString('hex');
    await writeFile('.sync/state-key', key, { mode: 0o600, flag: 'wx' });
  }
  if (process.argv.includes('--microsoft')) {
    const client = need('MICROSOFT_CLIENT_ID');
    const d = await microsoftPost('devicecode', { client_id: client, scope: scopes });
    if (typeof d.device_code !== 'string' || !isMicrosoftDeviceVerificationUri(d.verification_uri))
      throw new Error('DEVICE_RESPONSE_INVALID');
    console.log(
      `Open ${d.verification_uri} and enter ${d.user_code}. Consent only to your own calendar sync app. This requests calendar read/write and renewable access.`,
    );
    let interval = Math.max(5, d.interval || 5) * 1000;
    const deadline = Date.now() + Math.min(d.expires_in || 900, 900) * 1000;
    let token;
    while (Date.now() < deadline) {
      await wait(interval);
      try {
        token = tokenFrom(
          await microsoftPost('token', {
            client_id: client,
            device_code: d.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        );
        break;
      } catch (e) {
        if (e instanceof Error && e.message === 'authorization_pending') continue;
        if (e instanceof Error && e.message === 'slow_down') {
          interval += 5000;
          continue;
        }
        throw e;
      }
    }
    if (!token) throw new Error('DEVICE_LOGIN_EXPIRED');
    const s: State = {
      version: 1,
      binding: 'bootstrap',
      mappings: {},
      legacy: [],
      microsoft: token,
    };
    await writeFile('.sync/bootstrap.enc', encrypt(s, key), { mode: 0o600 });
    const c = configSchema.parse({
      syncId: '00000000-0000-4000-8000-000000000001',
      frameId: '1',
      account: need('EXPECTED_OUTLOOK_ACCOUNT'),
      calendarId: 'discovery',
      excludedCategoryIds: ['placeholder'],
      excludedCalendarAccountIds: ['placeholder'],
    });
    const graph = new Graph(
      new MicrosoftAuth(client, s, async () =>
        writeFile('.sync/bootstrap.enc', encrypt(s, key), { mode: 0o600 }),
      ),
      c,
    );
    const me = await graph.request(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
    );
    if (
      ![me.mail, me.userPrincipalName].some(
        (x) => typeof x === 'string' && x.toLowerCase() === c.account.toLowerCase(),
      )
    )
      throw new Error('WRONG_MICROSOFT_ACCOUNT');
    const calendars = await graph.request(
      'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,canEdit',
    );
    console.log(JSON.stringify({ connectedAccount: c.account, calendars: calendars.value }));
    return;
  }
  const c = configSchema.parse(JSON.parse(need('SYNC_CONFIG')));
  const s = decrypt(await readFile('.sync/bootstrap.enc', 'utf8'), key);
  s.binding = binding(c);
  if (process.argv.includes('--prepare')) {
    await new SkylightAuth(s, async () => {}).connect(
      need('SKYLIGHT_EMAIL'),
      need('SKYLIGHT_PASSWORD'),
    );
    if (process.env.LEGACY_EVENTS_PATH) {
      const events = JSON.parse(await readFile(process.env.LEGACY_EVENTS_PATH, 'utf8')); // The import manifest supplies UTC values; never reconstruct local offsets.
      const parse = (x: string) =>
        x.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6.000Z');
      s.legacy = events.map((e: any) => ({
        title: e.title,
        start: parse(e.start_utc),
        end: parse(e.end_utc),
        uid:
          createHash('sha256')
            .update(e.title + '|' + e.start_utc + '|' + e.end_utc)
            .digest('hex') + '@skylight-copy.local',
      }));
    }
    await writeFile('.sync/ready.enc', encrypt(s, key), { mode: 0o600 });
    console.log('Prepared encrypted state locally. Nothing uploaded.');
    return;
  }
  if (process.argv.includes('--upload')) {
    const ready = decrypt(await readFile('.sync/ready.enc', 'utf8'), key);
    if (ready.binding !== binding(c)) throw new Error('STATE_ACCOUNT_BINDING_MISMATCH');
    await new GitHubStore(need('GITHUB_REPOSITORY'), need('GH_TOKEN'), key).initialize(ready);
    console.log('Encrypted state initialized in private repository.');
    return;
  }
  throw new Error('USE_MICROSOFT_PREPARE_OR_UPLOAD');
}
main().catch((error) => {
  const code =
    error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'UNKNOWN_SETUP_ERROR';
  console.error(
    `Setup stopped (${code}). Check local configuration and sign-in; no credentials are printed.`,
  );
  process.exitCode = 1;
});
