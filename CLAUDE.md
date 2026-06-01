# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## TL;DR

MCP server for Skylight Calendar — 44 tools across calendar events (read+write), shared lists (read+write), chores and rewards (read+write), task-box items (read+write), meals (read), messages and albums (read), and frame/device/account info (read).

Auth resolution lives in `src/auth.ts`. There is one auth path: headless email+password OAuth2 authorization-code flow (Node-direct). See "Auth resolution" below.

## Auth resolution

`src/auth.ts` implements a single headless email+password OAuth2 authorization-code flow. (Skylight rejects `grant_type=password` with `unsupported_grant_type`; no browser-bridge proxy is needed — no observed bot wall.)

The flow `resolveAuth()` → `login()` performs all steps against `https://app.ourskylight.com`:

1. `GET /auth/session/new` — scrape the Rails `authenticity_token`, hold the `_skylight_cloud_session` cookie.
2. `POST /auth/session` (form: authenticity_token, email, password; `Origin`/`Referer` = app.ourskylight.com) — 302 to `/auth/session/success` on success. Login **must** happen before the OAuth authorize step — hitting authorize first poisons the CSRF/session state.
3. `GET /oauth/authorize?client_id=skylight-mobile&response_type=code&scope=everything&redirect_uri=https://ourskylight.com/welcome` — 302 to `https://ourskylight.com/welcome?code=…`.
4. `POST /oauth/token` (grant_type=authorization_code, client_id=skylight-mobile, scope=everything, code, redirect_uri, `skylight_api_client_device_*` device params, source=js-mobile) — returns `{ access_token, refresh_token, expires_in: 604800 (7d), token_type: Bearer }`.

No bot wall has been observed; the headless flow works directly. The server logs in once per process start, then relies on token refresh.

- `src/auth.ts` — `resolveAuth()`: resolves credentials via `loadAccount()`, runs the authorization-code login, returns a `SkylightClient` ready to make API calls.
- `src/auth-session-login.ts` — `login()`: implements the four-step headless authorization-code flow above.
- `src/config.ts` — `loadAccount()`: reads `SKYLIGHT_EMAIL`, `SKYLIGHT_PASSWORD`, optional `SKYLIGHT_FRAME_ID`, `SKYLIGHT_NAME`, `SKYLIGHT_BASE_URL` from env. Exposes both `baseUrl` (the `/api` base) and `authBaseUrl` (the origin). Returns an `Account` or throws with an actionable message. No partial-config fallthrough — both email and password are required.
- `src/client.ts` — `SkylightClient`: accepts a `refreshFn` (POST `/oauth/token` grant_type=refresh_token) for proactive (~60 s before expiry) and reactive (on 401, one retry) token refresh. All API calls are Node-direct. Note: the refresh grant follows the standard Doorkeeper contract; it was not live-verified due to login rate-limiting during testing.

**No env vars → clean start:** `resolveAuth()` is called lazily (on first tool invocation). Missing credentials are deferred to tool-call time via a `configError` sentinel in `src/index.ts` — the server starts without error so MCP hosts can list tools before credentials are configured.

## Commands

- `npm test` — vitest, all mocked, no network. Must stay green.
- `npm run test:watch` — vitest watch mode.
- `npx vitest run tests/tools/<name>.test.ts` — run one tool test file.
- `npx vitest run -t '<substring>'` — run one test by name.
- `npm run build` — `tsc` typecheck + esbuild bundle → `dist/bundle.js`.
- `npm run dev` — runs `dist/index.js` with `--env-file=.env` (build first).

`vitest.config.ts` enforces **100% lines/branches/functions/statements** on `src/**` (excluding `src/index.ts`). Coverage gaps fail CI — write the failing test first, then the code.

## Code layout

- `src/auth.ts` — `resolveAuth()`: credentials → authorization-code login → `SkylightClient`.
- `src/auth-session-login.ts` — `login()`: headless four-step authorization-code flow.
- `src/config.ts` — `loadAccount()`: env-var resolution, exposes `baseUrl` and `authBaseUrl`.
- `src/client.ts` — `SkylightClient`: HTTP client with proactive + reactive token refresh via `refreshFn`, JSON:API response flattening, `resolveFrameId()` for frame auto-discovery.
- `src/index.ts` — entry point. Boots `McpServer`, wires lazy `getClient`, registers the seven tool modules.
- `src/tools/` — one file per domain: `frames.ts`, `events.ts`, `lists.ts`, `chores.ts`, `meals.ts`, `messages.ts`, `tasks.ts`, plus `_shared.ts` for `textContent()`, `flattenJsonApi()`, and other helpers.
- `tests/` — mirrors `src/`. Tool tests are in `tests/tools/<name>.test.ts`.

## JSON:API flattening convention

The Skylight API returns JSON:API envelopes (`{ data: { id, type, attributes, relationships }, ... }` or array). `flattenJsonApi()` in `src/tools/_shared.ts` collapses these to plain objects before returning to the LLM. All tool handlers call `flattenJsonApi(doc)` on raw API responses.

## Tool surface

44 tools total. 12 read-only frame/device/account tools, 8 event tools, 10 list tools (2R+8W), 4 chore/reward tools (2R+2W), 3 meal tools (3R), 3 message/album tools (3R), 4 task-box tools (1R+3W).

| Module | Tools |
|---|---|
| frames.ts | `skylight_list_frames`, `skylight_get_frame`, `skylight_list_frame_members`, `skylight_list_devices`, `skylight_get_plus_access`, `skylight_get_reward_points`, `skylight_get_household_config`, `skylight_list_calendars`, `skylight_get_event_notification_settings`, `skylight_resolve_member`, `skylight_get_calendar`, `skylight_list_nudges` |
| events.ts | `skylight_list_events`, `skylight_get_event`, `skylight_create_event`, `skylight_update_event`, `skylight_delete_event`, `skylight_list_categories`, `skylight_list_source_calendars`, `skylight_list_recent_invited_emails` |
| lists.ts | `skylight_list_lists`, `skylight_get_list_items`, `skylight_create_list`, `skylight_update_list`, `skylight_delete_list`, `skylight_add_list_item`, `skylight_update_list_item`, `skylight_delete_list_item`, `skylight_move_list_item`, `skylight_clear_list` |
| chores.ts | `skylight_list_chores`, `skylight_create_chore`, `skylight_complete_chore`, `skylight_list_rewards` |
| meals.ts | `skylight_list_recipes`, `skylight_list_meal_categories`, `skylight_get_recipe` |
| messages.ts | `skylight_list_messages`, `skylight_list_albums`, `skylight_get_message` |
| tasks.ts | `skylight_list_tasks`, `skylight_create_task`, `skylight_update_task`, `skylight_delete_task` |

### Known unknowns — write payload shapes

Write-tool payload shapes have been partially verified live:

- `skylight_create_event` and `skylight_delete_event` — **live-confirmed**: flat top-level params (e.g. `{ summary, starts_at, ... }`) return 200; the `{ calendar_event: { ... } }` JSON:API wrapper returns 422.
- `skylight_update_event` — **LIVE-VERIFIED**: uses `PUT /frames/{f}/calendar_events/{id}` (not PATCH — PATCH did not update); flat body.
- `skylight_create_list` — **LIVE-VERIFIED**: requires flat `{ label, color, kind }`. `color` is a hex string (e.g. `#42D792`); `kind` is a strict enum — valid values include `shopping` and `to_do` (others like `checklist` return HTTP 500). Both `color` and `kind` are required.
- `skylight_update_list_item` — **LIVE-VERIFIED**: list items carry a `status` field (`pending` default, `completed` = checked), NOT a `checked` field. The tool exposes a friendly `checked` boolean that maps to `status` (`completed`/`pending`). `PATCH` confirmed 200.
- `skylight_update_list` — **LIVE-VERIFIED**: `PUT /frames/{f}/lists/{id}` with flat `{ label?, color?, kind? }` renames/recolors/retypes a list.
- `skylight_delete_list` — **LIVE-VERIFIED**: `DELETE /frames/{f}/lists/{id}`.
- `skylight_create_chore` — **LIVE-VERIFIED**: flat `{ summary, category_id }` body; `category_id` is **required** (422 "Category is required" without it). The field was previously named `name` — that was wrong. Optional fields: `start`, `description`, `reward_points`.
- `skylight_complete_chore` — **LIVE-VERIFIED**: `PUT /frames/{f}/chores/{id}/completions` with body `{ status: 'complete' }` returns 200 and flips the chore's `status` to `complete` (`completed_on` becomes today). The old `POST /complete` was 404 and the prior `PATCH /frames/{f}/chores/{id}` was a no-op (status stayed pending). Completing a specific recurring *instance* (via `instance_date` + `category_id` in the completions body) is intentionally not exposed — only the simple whole-chore completion.
- `SkylightClient.request()` — **fixed**: now tolerates 2xx responses with an empty body (e.g. chore DELETE returns HTTP 200 with no body). Previously would throw "Unexpected end of JSON input".

When verifying or fixing write tools: run `npm test` to confirm the mock-based tests still pass, then verify against the live API with real credentials and update both the implementation and the tests.

## Conventions

- All tools are `skylight_*`-prefixed.
- Tool return shape: `{ content: [{ type: 'text', text: JSON.stringify(..., null, 2) }] }`.
- Write a failing test before implementation (TDD). Tool tests live in `tests/tools/<name>.test.ts` and mock `SkylightClient.request`.
- Auth tests mock `login()` and `refreshFn` at the module boundary — don't paste real cookies or tokens into tests.

## Publishing constraints

The MCP Registry's [server.schema.json](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json) caps `server.json`'s `description` at **100 characters**. Values over that fail `mcp-publisher publish` with HTTP 422. Check before committing:

```bash
jq -r '.description | length' server.json
```

The other description fields (`manifest.json`) have no published length constraint.

## Versioning

Version appears in several places — all must match: `package.json`, `package-lock.json`, `src/index.ts` (the `McpServer` constructor call, annotated with `// x-release-please-version`), `manifest.json`, `server.json`. The `tests/version-sync.test.ts` file asserts this. Don't bump manually unless explicitly asked — versioning is automated via release-please.

## Pull requests & release notes

**Default workflow: branch + PR, even for solo work.** Direct pushes to `main` skip review and auto-generated release notes.

For every PR, apply exactly one label:

| Label | Section in release notes |
|---|---|
| `enhancement` | Features |
| `bug` | Bug Fixes |
| `security` | Security |
| `refactor` | Refactor |
| `documentation` | Documentation |
| `test` | Tests |
| `dependencies` | Dependencies |
| `ci` / `github_actions` | CI & Build |
| *(none / unmatched)* | Other Changes |
| `ignore-for-release` | Hidden from notes |

### How PRs merge

**Don't run `gh pr merge` yourself.** The automation does it:

1. `pr-auto-review.yml` runs a Claude review on every PR (except release PRs). On a `pass` verdict it adds `ready-to-merge`.
2. `auto-merge.yml` arms `gh pr merge --auto --squash` on `ready-to-merge`. The moment CI is green the PR squash-merges itself.

Only open a PR when the feature is genuinely complete — PRs auto-merge as soon as auto-review passes, so there's no draft-PR safety net for half-baked work (unless you use `gh pr create --draft`).

**Release PRs** are the one manual touch — release-please opens them; add `ready-to-merge` yourself when ready to ship.

The repo allows squash-merge only — `--merge` and `--rebase` are blocked.

## What to not do

- Don't add a browser-bridge or login-proxy dependency. The headless authorization-code flow works directly — no bot wall has been observed, and per-request proxying is not needed.
- Don't paste real credentials or cookies into tests. Mock `login()` and `SkylightClient.request` at the module boundary.
- Don't break the "no env vars" smoke path. The server must start cleanly with no credentials set — `resolveAuth()` errors are deferred to tool-call time.
- Don't self-merge PRs. Don't add `ready-to-merge` unless the auto-review verdict was `warn`/`fail` and you've explicitly decided to override it (surface the findings to the user first).
