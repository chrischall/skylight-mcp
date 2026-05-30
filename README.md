# skylight-mcp

MCP server for [Skylight Calendar](https://www.ourskylight.com) — 21 tools across calendar events (read+write), shared lists (read+write), chores and rewards (read+write), and frame/device info (read).

**Meals are not supported.** Skylight does not expose a meals API on this account type — the meals endpoints return 404. There is no `meals.ts` module and no meals tools.

## Auth

Skylight uses an OAuth2 password grant. The server requires your Skylight email and password (set as env vars). No SSO/2FA. No paste-token shortcut — credentials are always email+password.

**Primary path (Node-direct):** `SKYLIGHT_EMAIL` + `SKYLIGHT_PASSWORD` → `POST https://app.ourskylight.com/api/oauth/token` with `grant_type=password` and `client_id=skylight-mobile` → bearer `access_token` + `refresh_token`. The client refreshes proactively (~60 s before expiry) and reactively on any 401. All API calls go directly from Node.

**Fetchproxy fallback:** If the OAuth token POST trips a bot wall (HTTP 403/429, Cloudflare/Akamai/captcha keyword in the error), the login POST is re-routed through your already-signed-in `ourskylight.com` browser tab via the [fetchproxy](https://github.com/chrischall/fetchproxy) browser extension (`@fetchproxy/server`). The login-proxy server closes immediately after the login succeeds (one-shot). After that, all API calls still go Node-direct with the acquired token. Token refresh is **not** supported via fetchproxy — if the token expires you must restart. Set `SKYLIGHT_DISABLE_FETCHPROXY=1` to skip the fallback entirely (turns a bot-wall error into a hard error — useful in headless CI). Skylight's API has no observed bot wall in practice, so the primary path normally suffices.

**No env vars → clean start:** if neither `SKYLIGHT_EMAIL` nor `SKYLIGHT_PASSWORD` is set the server still starts without error. Auth is deferred to the first tool call, so MCP hosts can complete install-time tool listing before credentials are configured.

## Frame model

All data in Skylight is scoped to a *frame* (the family hub device). On first use the client auto-discovers the single frame on the account. If the account has more than one frame, set `SKYLIGHT_FRAME_ID` to the frame ID you want. Every tool that reads frame-scoped data accepts an optional `frameId` arg to override the default.

## Tools

| Module | Tool | R/W | Description |
|---|---|---|---|
| frames | `skylight_list_frames` | R | List all frames on the account |
| frames | `skylight_get_frame` | R | Get details for a specific frame |
| frames | `skylight_list_frame_members` | R | List members associated with a frame |
| frames | `skylight_list_devices` | R | List physical devices linked to a frame |
| events | `skylight_list_events` | R | List calendar events within a date range |
| events | `skylight_get_event` | R | Get details for a specific event |
| events | `skylight_create_event` | W | Create a new calendar event |
| events | `skylight_update_event` | W | Update an existing calendar event |
| events | `skylight_delete_event` | W | Delete a calendar event |
| events | `skylight_list_categories` | R | List event categories for a frame |
| events | `skylight_list_source_calendars` | R | List external source calendars linked to a frame |
| lists | `skylight_list_lists` | R | List all shared lists on a frame |
| lists | `skylight_get_list_items` | R | Get items in a specific shared list |
| lists | `skylight_create_list` | W | Create a new shared list |
| lists | `skylight_add_list_item` | W | Add an item to a shared list |
| lists | `skylight_update_list_item` | W | Update an existing list item |
| lists | `skylight_delete_list_item` | W | Delete an item from a shared list |
| chores | `skylight_list_chores` | R | List chores within a date range |
| chores | `skylight_create_chore` | W | Create a new chore |
| chores | `skylight_complete_chore` | W | Mark a chore as complete for a member |
| chores | `skylight_list_rewards` | R | List rewards configured for a frame |

## Configuration

### Required

```
SKYLIGHT_EMAIL=you@example.com
SKYLIGHT_PASSWORD=your-password
```

### Optional

| Env var | Default | Purpose |
|---|---|---|
| `SKYLIGHT_FRAME_ID` | auto-discovered | Force a specific frame when the account has multiple |
| `SKYLIGHT_NAME` | *(none)* | Friendly label used in startup logs |
| `SKYLIGHT_BASE_URL` | `https://app.ourskylight.com/api` | Override the API base URL |
| `SKYLIGHT_DISABLE_FETCHPROXY` | unset | Set to `1` to skip the fetchproxy fallback |

Treat `.env` like a password file — it is gitignored, do not commit it.

## Local dev

```
npm install
npm run build
npm test
npm run dev   # requires .env with credentials
```

Tests: vitest, 100% line/branch/function/statement coverage enforced. All tests are mocked — no network calls in CI.

Developed and maintained by AI (Claude). Use at your own discretion.
