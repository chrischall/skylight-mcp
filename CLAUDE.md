# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## TL;DR

MCP server for Skylight Calendar — 109 tools across calendar events (read+write), shared lists (read+write), chores and rewards (read+write), task-box items (read+write), meals (read+write), AI auto-creation (meal-plan + activity-idea generators with draft review/approve), messages and albums (read+write), photo/video upload, and frame/device/account settings + calendar + member/category management (read+write, incl. preset and custom-photo avatars).

Every request carries the `skylight-api-version: 2026-05-01` header (`src/client.ts`), matching the official mobile app — without it some features 422 with "API version does not support …".

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
- `src/index.ts` — entry point. Boots `McpServer`, wires lazy `getClient`, registers the thirteen tool modules.
- `src/tools/` — one file per domain: `frames.ts`, `settings.ts`, `calendars.ts`, `members.ts`, `events.ts`, `lists.ts`, `chores.ts`, `rewards.ts`, `meals.ts`, `messages.ts`, `tasks.ts`, `ai.ts`, `photos.ts`, plus `_shared.ts` for `textContent()`, `flattenJsonApi()`, and other helpers. `src/s3-upload.ts` holds the dependency-free SigV4 multipart S3 upload used by `photos.ts`.
- `tests/` — mirrors `src/`. Tool tests are in `tests/tools/<name>.test.ts`.

## JSON:API flattening convention

The Skylight API returns JSON:API envelopes (`{ data: { id, type, attributes, relationships }, ... }` or array). `flattenJsonApi()` in `src/tools/_shared.ts` collapses these to plain objects before returning to the LLM. All tool handlers call `flattenJsonApi(doc)` on raw API responses.

## Tool surface

109 tools total. The former monolithic `frames.ts` (24 tools) is now split into four focused modules: `frames.ts` (8 core frame/device/account reads + the device-album write + device rename), `settings.ts` (5 frame-settings writes incl. the global reminder profile), `calendars.ts` (10 calendar + reminder tools), and `members.ts` (10 people/category tools). Counts: 9 frame + 5 settings + 10 calendar + 10 member, 10 event tools (incl. both notification-settings read+write), 12 list tools (2R+10W), 10 chore tools (3R+7W), 7 reward tools (1R+6W), 8 meal tools (3R+5W), 14 message/album tools (3R+11W), 4 task-box tools (1R+3W), 8 AI auto-creation tools (4R+4W), 2 photo tools (`skylight_upload_photo`, `skylight_import_events_from_photo`).

| Module | Tools |
|---|---|
| frames.ts | `skylight_list_frames`, `skylight_get_frame`, `skylight_list_frame_members`, `skylight_list_devices`, `skylight_get_plus_access`, `skylight_get_reward_points`, `skylight_get_household_config`, `skylight_set_device_album` *(inferred)*, `skylight_rename_device` |
| settings.ts | `skylight_update_frame`, `skylight_rename_frame`, `skylight_update_profile`, `skylight_update_household_config`, `skylight_set_reminder_profile` |
| calendars.ts | `skylight_list_calendars`, `skylight_get_calendar`, `skylight_add_webcal`, `skylight_update_calendar`, `skylight_delete_source_calendar`, `skylight_set_default_calendar`, `skylight_list_nudges`, `skylight_link_apple_calendar`, `skylight_categorize_source_calendar`, `skylight_create_source_calendar` |
| members.ts | `skylight_resolve_member`, `skylight_invite_user`, `skylight_approve_user`, `skylight_remove_user`, `skylight_list_avatars`, `skylight_set_member_avatar`, `skylight_create_category`, `skylight_delete_category` (gained `reassign_to_category_id`, inferred), `skylight_update_family_member`, `skylight_update_category` |
| events.ts | `skylight_list_events`, `skylight_get_event`, `skylight_create_event`, `skylight_update_event`, `skylight_delete_event`, `skylight_list_categories`, `skylight_list_source_calendars`, `skylight_list_recent_invited_emails`, `skylight_get_event_notification_settings`, `skylight_update_event_notification_settings` |
| lists.ts | `skylight_list_lists`, `skylight_get_list_items`, `skylight_create_list`, `skylight_update_list`, `skylight_delete_list`, `skylight_add_list_item`, `skylight_update_list_item`, `skylight_delete_list_item`, `skylight_delete_list_items`, `skylight_move_list_item`, `skylight_clear_list`, `skylight_set_list_item_section` |
| chores.ts | `skylight_list_chores`, `skylight_search_chores`, `skylight_create_chore`, `skylight_create_recurring_chore`, `skylight_complete_chore`, `skylight_uncomplete_chore`, `skylight_update_chore`, `skylight_complete_chore_instance`, `skylight_delete_chore`, `skylight_list_rewards` |
| rewards.ts | `skylight_get_reward`, `skylight_create_reward`, `skylight_update_reward`, `skylight_delete_reward`, `skylight_redeem_reward`, `skylight_unredeem_reward`, `skylight_add_reward_points` |
| meals.ts | `skylight_list_recipes`, `skylight_list_meal_categories`, `skylight_get_recipe`, `skylight_create_recipe`, `skylight_update_recipe`, `skylight_delete_recipe`, `skylight_add_recipe_to_grocery_list`, `skylight_plan_meal` |
| messages.ts | `skylight_list_messages`, `skylight_list_albums`, `skylight_get_message`, `skylight_create_album`, `skylight_update_album`, `skylight_delete_album`, `skylight_add_to_album`, `skylight_remove_from_album`, `skylight_add_message_comment`, `skylight_set_message_caption`, `skylight_like_message`, `skylight_unlike_message`, `skylight_delete_message`, `skylight_delete_messages` |
| tasks.ts | `skylight_list_tasks`, `skylight_create_task`, `skylight_update_task`, `skylight_delete_task` |
| ai.ts | `skylight_generate_meal_plan`, `skylight_generate_activity_ideas`, `skylight_get_auto_creation_intent`, `skylight_list_auto_creation_intents`, `skylight_list_auto_creation_drafts`, `skylight_list_auto_creation_items`, `skylight_approve_auto_creation`, `skylight_undo_auto_creation` |
| photos.ts | `skylight_upload_photo`, `skylight_import_events_from_photo` *(best-effort)* |

### Known unknowns — write payload shapes

Write-tool payload shapes have been partially verified live:

- `skylight_create_event` and `skylight_delete_event` — **live-confirmed**: flat top-level params (e.g. `{ summary, starts_at, ... }`) return 200; the `{ calendar_event: { ... } }` JSON:API wrapper returns 422.
- `skylight_update_event` — **LIVE-VERIFIED**: uses `PUT /frames/{f}/calendar_events/{id}` (not PATCH — PATCH did not update); flat body.
- `skylight_create_event` / `skylight_update_event` — both accept an optional `category_ids` array (family-member category ids) to assign the event to members; it flows through the flat body. Matches the Skylight web app's `create_event` payload (`{summary, kind, category_ids, starts_at, ...}`).
- `skylight_create_list` — **LIVE-VERIFIED**: requires flat `{ label, color, kind }`. `color` is a hex string (e.g. `#42D792`); `kind` is a strict enum — valid values include `shopping` and `to_do` (others like `checklist` return HTTP 500). Both `color` and `kind` are required.
- `skylight_update_list_item` — **LIVE-VERIFIED**: list items carry a `status` field (`pending` default, `completed` = checked), NOT a `checked` field. The tool exposes a friendly `checked` boolean that maps to `status` (`completed`/`pending`). `PATCH` confirmed 200.
- `skylight_update_list` — **LIVE-VERIFIED**: `PUT /frames/{f}/lists/{id}` with flat `{ label?, color?, kind? }` renames/recolors/retypes a list.
- `skylight_delete_list` — **LIVE-VERIFIED**: `DELETE /frames/{f}/lists/{id}`.
- `skylight_create_chore` — **LIVE-VERIFIED**: flat `{ summary, category_id }` body; `category_id` is **required** (422 "Category is required" without it). The field was previously named `name` — that was wrong. Optional fields: `start`, `description`, `reward_points`.
- `skylight_complete_chore` — **LIVE-VERIFIED**: `PUT /frames/{f}/chores/{id}/completions` with body `{ status: 'complete' }` returns 200 and flips the chore's `status` to `complete` (`completed_on` becomes today). The old `POST /complete` was 404 and the prior `PATCH /frames/{f}/chores/{id}` was a no-op (status stayed pending).
- `skylight_complete_chore_instance` / `skylight_uncomplete_chore` — **LIVE-VERIFIED** per-occurrence completion of a recurring chore: `PUT /frames/{f}/chores/{id}/completions` with `{ status: 'complete', instance_date }` (status is `complete`, NOT `completed`). `category_id` must be **omitted** for a normally-assigned chore (sending it 422s `"category_id must be blank"`); supply it only for an up-for-grabs/shared chore. Add `instance_time` for a time-of-day routine occurrence. Un-complete an occurrence by passing `instance_date` to `skylight_uncomplete_chore` (`{ status: 'pending', instance_date }`).
- `skylight_uncomplete_chore` — **LIVE-VERIFIED**: `PUT /frames/{f}/chores/{id}/completions` with body `{ status: 'pending' }` reopens a completed chore (the reverse of `skylight_complete_chore`).
- `skylight_create_recurring_chore` — **LIVE-VERIFIED**: recurring chores + routines are created via `POST /frames/{f}/chores/create_multiple` with the chore object directly (NOT an array, NOT `{chores:[]}`). `recurrence_set` is an **array of `"RRULE:…"` strings** (e.g. `["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR"]`) — this is what flips `recurring:true`. Routines = the same call with `routine:true` (use `BYHOUR` in the RRULE for time-of-day). `up_for_grabs:true` works because of the `skylight-api-version` header. Response is `{ data: [ {chore} ] }` (array). The tool takes a friendly `recurrence` (RRULE without the `RRULE:` prefix) and prepends the prefix.
- `skylight_update_chore` — **series edit is `PUT /frames/{f}/chores/{id}`** with the full chore body (`apply_to` is NOT needed for a whole-series edit; it's only for occurrence-specific ops). The tool now also accepts `recurrence` (RRULE without prefix → `recurrence_set: ["RRULE:…"]`), `start_time`, `recurring_until`, and `emoji_icon`.
- `skylight_delete_chore` — **series-scoped delete**: `DELETE /frames/{f}/chores/{id}?apply_to=one|all` (`one` = just this occurrence, `all` = whole series; omit `apply_to` for a plain delete). Returns HTTP 200 with no body → tool falls back to `{ deleted: id }`.
- `skylight_search_chores` — `GET /frames/{f}/chores/search?search_query=…&include_up_for_grabs=…&limit=…&ended_chore_lookback_days=…` finds unscheduled/template chores the date-range list can't return. Booleans/numbers (incl. `false`/`0`) are passed through; only `undefined` query keys are dropped.
- `skylight_set_list_item_section` — **LIVE-VERIFIED**: `PUT /frames/{f}/lists/{id}/list_items/bulk_update_section` with body `{ item_ids, section }` returns 200, moving items into a named section (`section: null` clears it).
- `skylight_clear_list` — **FIXED (live-verified body)**: `bulk_destroy` takes a flat `{ ids: [...] }` body (captured from the mobile app). Now GETs the list-item ids and issues a single `DELETE .../list_items/bulk_destroy { ids }`, returning `{ cleared, removed }` (no DELETE when the list is empty). `skylight_delete_list_items` exposes the same endpoint for bulk-deleting specific items → `{ deleted: n }`.
- `skylight_update_list_item` — also accepts an optional `section` (string or `null` to clear), captured from the mobile list-item update body `{ label, status, section }`.
- `skylight_update_family_member` — **live-verified fields**: `PUT /frames/{f}/categories/{id}/family_member` with `compact({ birthday, dietary_preferences })`. The member's *name* is the category `label` — set it via `skylight_update_category` (NOT here).
- `skylight_update_category` — **live-verified (JSON, not multipart)**: `PUT /frames/{f}/categories/{id}` with `compact({ label, color, linked_to_profile, selected_for_chore_chart, avatar_id })`. Set `linked_to_profile: true` (usually with `selected_for_chore_chart: true`) to convert a basic label into a full family-member profile.
- `skylight_create_reward` — **live-verified fields**: `POST /frames/{f}/rewards` with `compact({ name, description, point_value, respawn_on_redemption, category_ids })`. `respawn_on_redemption: true` lets the reward be redeemed repeatedly.
- `skylight_delete_category` — gained an **inferred** `reassign_to_category_id`: when provided it is sent as the DELETE request body so the member's items move to another category instead of being orphaned. Inferred from the app bundle.
- `skylight_set_device_album` — **inferred (from bundle)**: `PUT /frames/{f}/devices/{id}` with `{ current_album_id }` sets which photo album a device displays. Other device fields are not yet exposed.
- `skylight_categorize_source_calendar` — **LIVE-VERIFIED**: `PUT /frames/{f}/source_calendars/{id}/source_calendar_categorizations` with body `{ categorizations: [{ category_id }, …] }` returns 200, attributing the calendar's events to those family-member categories.
- `skylight_link_apple_calendar` — **not CI-live-verified**: `POST /frames/{f}/calendars/apple` with `{ email, app_specific_password }`. Needs a real Apple ID + app-specific password (generated at appleid.apple.com) to exercise live; the payload shape is unverified.
- `skylight_create_source_calendar` — generic passthrough: `POST /frames/{f}/source_calendars` with `{ attributes }`. Provider-specific attribute shape is not validated by the tool.
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
