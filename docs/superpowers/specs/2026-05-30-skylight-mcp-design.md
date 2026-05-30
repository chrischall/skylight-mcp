# skylight-mcp — Design

**Date:** 2026-05-30
**Status:** Approved
**Starting version:** 0.1.0

## Summary

An MCP server for Skylight Calendar (ourskylight.com) — read and write calendar
events, chores/rewards, and shared lists for a family "frame". Follows the
canonical **Pattern A** auth/structure shape used across the MCP family
(`signupgenius-mcp`, `infinitecampus-mcp`, `canvas-parent-mcp`, …): TypeScript,
`@modelcontextprotocol/sdk`, `zod`, `vitest` at 100% coverage on `src/**`,
esbuild bundle, release-please.

Repo: `/Users/chris/git/skylight-mcp`.

## API recon (captured live from a signed-in session)

- **API base:** `https://app.ourskylight.com/api`
- **Resource model:** everything is scoped under a **frame** (the family hub /
  device). Example: frame id `3435252`, name "clthalls", owner
  `chris.c.hall@gmail.com`, `userId` `10730517`.
- **Auth:** pure **OAuth2 bearer token**.
  - `Authorization: Bearer <accessToken>` with `credentials:'omit'` → `200`.
  - Cookies alone → `401`. The token is **not** a cookie — the web app keeps it
    in `localStorage` (MMKV key `mmkv.default\auth-storage`):
    `{ userId, accessToken, refreshToken, accessTokenLifeSpan: 604800000,
    accessTokenExpiry, uniqueId }`. Access token ~43 chars, 7-day lifespan.
  - Token endpoint: `oauth/token` (OAuth2). `grant_type=password` to log in,
    `grant_type=refresh_token` to refresh. A `oauth/legacy_token` variant also
    exists (not used).
- **No bot wall observed on the API** — a plain `fetch` with the bearer and
  `credentials:'omit'` returns clean `200`s. The "use fetchproxy entirely"
  scenario is therefore unlikely to be forced, but is kept as an escalation hook.
- **Serialization:** JSON:API (`{ data: [{ id, type, attributes, relationships
  }] }`) for `lists`, `users`, `calendar_events`, etc.

### Confirmed endpoints (read)

| Endpoint | Notes |
|---|---|
| `GET /api/plus_access` | subscription / plus access |
| `GET /api/frames/{frame}` | frame detail |
| `GET /api/frames/{frame}/devices` | physical devices on the frame |
| `GET /api/frames/{frame}/users` | type `frame_user` — attrs `status`, `is_owner` |
| `GET /api/frames/{frame}/categories` | calendar/chore categories |
| `GET /api/frames/{frame}/source_calendars` | linked source calendars (Google, …) |
| `GET /api/frames/{frame}/calendar_events?date_min&date_max&timezone&include=categories,calendar_account,event_notification_setting` | type `calendar_event` |
| `GET /api/frames/{frame}/lists` | type `list` — attrs `label`, `color`, `kind`, `hide_on_device`, `default_grocery_list` |
| `GET /api/frames/{frame}/lists/{id}/list_items` | list items |
| `GET /api/frames/{frame}/chores?…` | exists but `422` until the correct filter param is supplied (TBD in impl) |
| `GET /api/frames/{frame}/rewards?redeemed_at_min&redeemed_at_max` | rewards / stars |

`/api/frames/{frame}/meals` and `/tasks` returned `404` on this frame — meals may
be unprovisioned here or named differently; confirmed during implementation.

### `calendar_event` attributes (observed)

`uid`, `summary`, `invited_emails`, `status`, `all_day`, `timezone`,
`starts_at`, `ends_at`, `recurring`, `recurring_config`, `rrule`,
`master_event_id`, `description`, `location`, `lat`, `lng`, `source`, `kind`,
`editable`, `countdown_enabled`, `owner_email`, `calendar_id`, … (truncated).

## Auth resolution (`src/auth.ts`, Pattern A)

`resolveAuth()` selects a path in priority order. Keep it flat, path-selection
explicit, error messages actionable.

1. **Primary — password (Node-direct).** `SKYLIGHT_EMAIL` + `SKYLIGHT_PASSWORD`
   → `POST /api/oauth/token` (`grant_type=password`) via Node `fetch` →
   `{ accessToken, refreshToken, expiry }`. All API calls go out Node-direct with
   `Authorization: Bearer`.
2. **Alternate — fetchproxy login-proxy.** Same `SKYLIGHT_EMAIL` +
   `SKYLIGHT_PASSWORD`, but the `oauth/token` POST is routed through the user's
   signed-in browser tab via `@fetchproxy/server` (`FetchproxyServer.postJson()`).
   Engages when Node-direct login trips a bot wall (detected via fetchproxy's
   `classifyBotWall`). After login the bearer is used Node-direct for API calls —
   fetchproxy is **not** in the request hot path.
   - `SKYLIGHT_DISABLE_FETCHPROXY=1` (`1|true|yes|on`) skips this path.
   - **Escalation hook (flagged, not default):** if API calls themselves get
     walled, the client can route every call through `FetchproxyServer.fetch()`
     with the bearer header attached — the "use fetchproxy entirely" path.
3. **No paste-token mode.** There is intentionally no `SKYLIGHT_ACCESS_TOKEN`
   env path. Credentials are always email+password; fetchproxy only changes the
   *origin* of the login request, not the credential source.

Partial credentials (one of email/password without the other) throw rather than
silently falling through — masking typos is worse than failing loudly. With no
env vars set the server must still **start cleanly** (deferred `configError`, as
in the family) so MCP hosts can complete install-time tool listing; the auth
error surfaces at tool-call time.

`@fetchproxy/server` is mocked at the module boundary in `tests/auth.test.ts`.
Other test files exercise `SkylightClient` directly and never import it.

## Token lifecycle (`src/client.ts`)

`SkylightClient` holds `accessToken` + `refreshToken` + `expiry` and a single
`request()` chokepoint:

- **Proactive refresh:** ~60s before `expiry`, exchange `grant_type=refresh_token`
  for a fresh token before issuing the call.
- **Reactive refresh:** on a `401`, force exactly one refresh + retry, then give
  up with an actionable error. Concurrent refreshes are de-duplicated
  (`refreshInFlight`).
- Refresh goes out the **same channel** login used (Node-direct, or fetchproxy
  login-proxy).
- Note on refresh-token rotation: if Skylight rotates the refresh token on each
  refresh, the in-memory token chain stays valid for the process lifetime; a
  process restart re-runs the password grant. (No env writeback needed because
  the primary credential is the password, not a stored token.)

## Frame resolution

All data hangs off `/frames/{frameId}`. `SkylightClient` resolves the frame id
once (lazily) via `GET /api/frames`:

- `SKYLIGHT_FRAME_ID` env selects explicitly when set.
- Otherwise use the only frame; if multiple and none selected, surface an error
  listing the available frames (id + name).
- `skylight_list_frames` exposes the list so the user can discover ids.

## Tool surface (read + write)

One file per domain under `src/tools/`, tests mirrored under `tests/tools/`. All
tools `skylight_*`-prefixed. Return shape:
`{ content: [{ type: 'text', text: JSON.stringify(…, null, 2) }] }`.

| File | Tools |
|---|---|
| `frames.ts` | `skylight_list_frames`, `skylight_get_frame`, `skylight_list_frame_members`, `skylight_list_devices` |
| `events.ts` | `skylight_list_events`, `skylight_get_event`, `skylight_create_event`, `skylight_update_event`, `skylight_delete_event`, `skylight_list_categories`, `skylight_list_source_calendars` |
| `lists.ts` | `skylight_list_lists`, `skylight_get_list_items`, `skylight_create_list`, `skylight_add_list_item`, `skylight_update_list_item` (check/uncheck), `skylight_delete_list_item` |
| `chores.ts` | `skylight_list_chores`, `skylight_create_chore`, `skylight_complete_chore`, `skylight_list_rewards` |
| `meals.ts` | **conditional** — implement only if a meals endpoint is confirmed on some frame; otherwise omit |
| `_shared.ts` | `textContent()`, JSON:API flattener (`data.attributes` → flat object), frame-id resolution, date/timezone helpers |

**Writes:** bearer-token API with no cookie session ⇒ **no CSRF token needed**.
Writes are authed `POST`/`PATCH`/`DELETE`. JSON:API resources (lists, chores)
take `{ data: { type, attributes } }` bodies; `calendar_events` uses its own
attribute shape. Exact write payloads captured from the app's own POST/PATCH
traffic during implementation.

## Code layout

```
src/
  index.ts                 # entry; boots McpServer, resolveAuth(), wires tool modules, stdio transport
  auth.ts                  # resolveAuth(): password → fetchproxy login-proxy. Pattern A
  auth-session-login.ts    # oauth/token password + refresh grant (Node-direct), isolated for mocking
  config.ts                # loadAccount(): SKYLIGHT_* env resolution → Account | throws
  client.ts                # SkylightClient: bearer, frame resolution, refresh, 401-retry, request() chokepoint
  tools/                   # one file per domain (see table) + _shared.ts
tests/
  auth.test.ts             # mocks @fetchproxy/server at module boundary
  auth-session-login.test.ts
  config.test.ts
  client.test.ts
  version-sync.test.ts     # package.json / index.ts / manifest.json / server.json versions match
  tools/                   # mirrors src/tools, mocks SkylightClient.request
```

Infra cloned from `signupgenius-mcp` and renamed: `package.json` (name
`skylight-mcp`, `mcpName io.github.chrischall/skylight-mcp`, **version 0.1.0**,
bin `skylight-mcp`), `tsconfig.json`, `vitest.config.ts` (100% gate),
esbuild bundle script, `.env.example`, `manifest.json`, `server.json`
(description ≤100 chars), `.claude-plugin/`, `.github/`, release-please config
(`.release-please-manifest.json` → `0.1.0`).

## Conventions (inherited from the family)

- TDD: write the failing test first, then the code. 100% lines/branches/
  functions/statements on `src/**` (excl. `src/index.ts`).
- Tool tests mock `SkylightClient.request`; never paste real tokens into tests.
- No WS-server / protocol-frame logic here — that lives in `@fetchproxy/server`.
- Branch + PR per change; one release-notes label per PR; don't self-merge
  (automation arms `ready-to-merge` on a passing auto-review).
- Don't break the "no env vars set" smoke-start path.

## Open items resolved during implementation (live recon)

1. Exact `oauth/token` request payload — `client_id`? `username` vs `email`
   field — and whether the login endpoint has a bot wall.
2. The required `chores` filter param (422 until found).
3. Whether a `meals` endpoint exists on any frame.
4. `GET /api/frames` response shape + multi-frame handling.
5. Write payload shapes for create event / add list item / complete chore,
   captured from the app's own traffic.

## Build order

scaffold + password auth + frame resolution + events (read+write) → lists →
chores/rewards → fetchproxy alternate route → meals (conditional).
