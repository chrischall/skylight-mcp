const CLIENT_ID = 'skylight-mobile';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** ms until the access token expires (relative). */
  expiresInMs: number;
}

/** Abstracts the POST so Node-direct and fetchproxy share this builder. */
export type TokenPoster = (
  url: string,
  formBody: string,
) => Promise<{ status: number; json: unknown }>;

function tokenUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/oauth/token`;
}

function normalize(status: number, json: unknown): Tokens {
  if (status < 200 || status >= 300) {
    throw new Error(`Skylight login failed (HTTP ${status}): ${JSON.stringify(json)}`);
  }
  const j = json as Record<string, unknown>;
  const accessToken = j.access_token as string | undefined;
  const refreshToken = j.refresh_token as string | undefined;
  if (!accessToken) throw new Error(`Skylight login failed: no access_token in response ${JSON.stringify(json)}`);
  const expiresInSec = typeof j.expires_in === 'number' ? j.expires_in : 604800;
  return { accessToken, refreshToken: refreshToken ?? '', expiresInMs: expiresInSec * 1000 };
}

export async function oauthPasswordGrant(
  opts: { baseUrl: string; email: string; password: string },
  post: TokenPoster,
): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'password',
    username: opts.email,
    password: opts.password,
    client_id: CLIENT_ID,
  }).toString();
  const { status, json } = await post(tokenUrl(opts.baseUrl), body);
  return normalize(status, json);
}

export async function oauthRefresh(
  opts: { baseUrl: string; refreshToken: string },
  post: TokenPoster,
): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: CLIENT_ID,
  }).toString();
  const { status, json } = await post(tokenUrl(opts.baseUrl), body);
  return normalize(status, json);
}
