# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## TL;DR

MCP server for Skylight Calendar — 21 tools across calendar events (read+write), shared lists (read+write), chores and rewards (read+write), and frame/device info (read). **Meals are not supported** — Skylight does not expose a meals API on this account type (all meals endpoints return 404). Do not create a `meals.ts` module.

Auth resolution lives in `src/auth.ts`. There is one auth path: email+password OAuth2 password grant (Node-direct), with a fetchproxy bot-wall fallback. See "Auth resolution" below.

## Auth resolution (Pattern A template)

`src/auth.ts` is the "Node-direct OAuth + one-shot fetchproxy login fallback" shape used across our MCP family.

- `src/auth.ts` — `resolveAuth()`: resolves credentials via `loadAccount()`, then calls `oauthPasswordGrant()` Node-direct. If the login fails with a bot-wall signal (403/429/captcha/cloudflare/akamai), and `SKYLIGHT_DISABLE_FETCHPROXY` is not set, it retries the token POST through the `@fetchproxy/server` browser bridge (one-shot — the server closes after login). Returns a `SkylightClient` ready to make API calls.
- `src/auth-session-login.ts` — `oauthPasswordGrant()`: posts to `https://app.ourskylight.com/api/oauth/token` with `grant_type=password`, `client_id=skylight-mobile`, email, and password via the supplied `TokenPoster`. Returns `{ access_token, refresh_token, expires_in }`.
- `src/config.ts` — `loadAccount()`: reads `SKYLIGHT_EMAIL`, `SKYLIGHT_PASSWORD`, optional `SKYLIGHT_FRAME_ID`, `SKYLIGHT_NAME`, `SKYLIGHT_BASE_URL` from env. Returns an `Account` or throws with an actionable message. No partial-config fallthrough — both email and password are required.
- `src/client.ts` — `SkylightClient`: holds a `TokenPoster` for proactive (~60 s before expiry) and reactive (on 401) token refresh. All API calls go Node-direct after the initial login. In fetchproxy-backed login: the `tokenPoster` used for login is NOT reused for per-request refresh (the fetchproxy server closes after login); a 401 after fetchproxy login surfaces an error and requires a restart.

`@fetchproxy/server` is mocked at the module boundary in `tests/auth.test.ts`.

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

- `src/auth.ts` — `resolveAuth()`: credentials → `SkylightClient`.
- `src/auth-session-login.ts` — `oauthPasswordGrant()`: OAuth2 password grant POST.
- `src/config.ts` — `loadAccount()`: env-var resolution.
- `src/client.ts` — `SkylightClient`: HTTP client with proactive + reactive token refresh, JSON:API response flattening via `resolveFrameId()` for frame auto-discovery.
- `src/index.ts` — entry point. Boots `McpServer`, wires lazy `getClient`, registers the four tool modules.
- `src/tools/` — one file per domain: `frames.ts`, `events.ts`, `lists.ts`, `chores.ts`, plus `_shared.ts` for `textContent()`, `flattenJsonApi()`, and other helpers.
- `tests/` — mirrors `src/`. Tool tests are in `tests/tools/<name>.test.ts`.

## JSON:API flattening convention

The Skylight API returns JSON:API envelopes (`{ data: { id, type, attributes, relationships }, ... }` or array). `flattenJsonApi()` in `src/tools/_shared.ts` collapses these to plain objects before returning to the LLM. All tool handlers call `flattenJsonApi(doc)` on raw API responses.

## Tool surface

21 tools total. 4 read-only frame/device tools, 7 event tools (5R+2W... actually 4R+3W), 6 list tools (2R+4W), 4 chore/reward tools (2R+2W).

| Module | Tools |
|---|---|
| frames.ts | `skylight_list_frames`, `skylight_get_frame`, `skylight_list_frame_members`, `skylight_list_devices` |
| events.ts | `skylight_list_events`, `skylight_get_event`, `skylight_create_event`, `skylight_update_event`, `skylight_delete_event`, `skylight_list_categories`, `skylight_list_source_calendars` |
| lists.ts | `skylight_list_lists`, `skylight_get_list_items`, `skylight_create_list`, `skylight_add_list_item`, `skylight_update_list_item`, `skylight_delete_list_item` |
| chores.ts | `skylight_list_chores`, `skylight_create_chore`, `skylight_complete_chore`, `skylight_list_rewards` |

### Known unknowns — write payload shapes

Several write-tool payload envelopes are best-guess implementations pending live verification against the real Skylight API. There are `TODO(Task 13)` comments in `src/tools/chores.ts` marking the specific uncertainties:

- `skylight_create_chore` — the JSON:API envelope structure (type, attributes field names) is inferred, not confirmed.
- `skylight_complete_chore` — the HTTP verb and the payload structure for marking complete are guesses; the actual endpoint and body may differ.
- `skylight_create_event` and `skylight_create_list` — envelope shapes are also inferred from the GET response structure.

Calendar/list/event GET endpoints are confirmed from live API recon. List and event write endpoints use the same JSON:API envelope shape as sibling MCPs and are lower-risk guesses.

When verifying or fixing write tools: run `npm test` to confirm the mock-based tests still pass, then verify against the live API with real credentials and update both the implementation and the tests.

## Conventions

- All tools are `skylight_*`-prefixed.
- Tool return shape: `{ content: [{ type: 'text', text: JSON.stringify(..., null, 2) }] }`.
- Write a failing test before implementation (TDD). Tool tests live in `tests/tools/<name>.test.ts` and mock `SkylightClient.request`.
- Auth tests mock `@fetchproxy/server` at the module boundary — don't paste real cookies into tests.
- Don't add WS-server or protocol-frame logic here. That lives upstream in `@fetchproxy/server`.

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

- **Do not create `src/tools/meals.ts`.** Skylight does not expose a meals API on this account type. All meals endpoints return 404. If Skylight ever adds a meals surface, verify the endpoints live before implementing.
- Don't reintroduce a transport layer between `SkylightClient` and Node fetch. The fetchproxy bootstrap is a one-shot login; per-request proxying is not needed here.
- Don't paste real credentials or cookies into tests. Mock `@fetchproxy/server` and `SkylightClient.request` at the module boundary.
- Don't break the "no env vars" smoke path. The server must start cleanly with no credentials set — `resolveAuth()` errors are deferred to tool-call time.
- Don't self-merge PRs. Don't add `ready-to-merge` unless the auto-review verdict was `warn`/`fail` and you've explicitly decided to override it (surface the findings to the user first).
