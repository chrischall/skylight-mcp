import { login, refresh } from '../../../src/auth-session-login.js';
import type { State, Token } from './model.js';
export const scopes =
  'https://graph.microsoft.com/User.Read https://graph.microsoft.com/Calendars.ReadWrite offline_access';
const deviceVerificationUris = new Set([
  'https://microsoft.com/devicelogin',
  'https://www.microsoft.com/link',
]);
export function isMicrosoftDeviceVerificationUri(value: unknown): value is string {
  return typeof value === 'string' && deviceVerificationUris.has(value);
}
const authBase = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
export async function microsoftPost(
  path: 'token' | 'devicecode',
  body: Record<string, string>,
  http: typeof fetch = fetch,
) {
  let r: Response;
  try {
    r = await http(authBase + '/' + path, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new Error('MICROSOFT_AUTH_NETWORK');
  }
  const j = await r.json();
  if (!r.ok) {
    const known = [
      'authorization_pending',
      'slow_down',
      'authorization_declined',
      'expired_token',
      'invalid_grant',
    ];
    throw new Error(known.includes(j.error) ? j.error : 'MICROSOFT_AUTH_FAILED');
  }
  return j;
}
export function tokenFrom(j: any, previous = ''): Token {
  if (
    typeof j.access_token !== 'string' ||
    !Number.isFinite(j.expires_in) ||
    j.expires_in <= 0 ||
    !(j.refresh_token || previous)
  )
    throw new Error('TOKEN_SHAPE');
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || previous,
    expiresAt: Date.now() + j.expires_in * 1000,
  };
}
export class MicrosoftAuth {
  constructor(
    private clientId: string,
    private s: State,
    private save: () => Promise<void>,
    private http: typeof fetch = fetch,
  ) {}
  async token() {
    if (!this.s.microsoft) throw new Error('MICROSOFT_CONNECT_REQUIRED');
    if (Date.now() < this.s.microsoft.expiresAt - 120000) return this.s.microsoft.accessToken;
    const j = await microsoftPost(
      'token',
      {
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: this.s.microsoft.refreshToken,
        scope: scopes,
      },
      this.http,
    );
    this.s.microsoft = tokenFrom(j, this.s.microsoft.refreshToken);
    await this.save();
    return this.s.microsoft.accessToken;
  }
}
export class SkylightAuth {
  constructor(
    private s: State,
    private save: () => Promise<void>,
    private http: typeof fetch = fetch,
  ) {}
  async token() {
    if (!this.s.skylight) throw new Error('SKYLIGHT_CONNECT_REQUIRED');
    if (Date.now() < this.s.skylight.expiresAt - 120000) return this.s.skylight.accessToken;
    try {
      const t = await refresh(
        { authBaseUrl: 'https://app.ourskylight.com', refreshToken: this.s.skylight.refreshToken },
        this.guarded,
      );
      this.s.skylight = {
        accessToken: t.accessToken,
        refreshToken: t.refreshToken || this.s.skylight.refreshToken,
        expiresAt: Date.now() + t.expiresInMs,
      };
    } catch {
      throw new Error('SKYLIGHT_RECONNECT_REQUIRED');
    }
    await this.save();
    return this.s.skylight.accessToken;
  }
  private guarded = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    if (u.origin !== 'https://app.ourskylight.com' || u.username || u.password || u.hash)
      throw new Error('AUTH_DESTINATION');
    return this.http(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  };
  async connect(email: string, password: string) {
    try {
      const t = await login(
        { authBaseUrl: 'https://app.ourskylight.com', email, password },
        this.guarded,
      );
      this.s.skylight = {
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        expiresAt: Date.now() + t.expiresInMs,
      };
    } catch {
      throw new Error('SKYLIGHT_LOGIN_FAILED');
    }
  }
}
