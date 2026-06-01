# skylight-mcp

MCP server for [Skylight Calendar](https://www.ourskylight.com) — 88 tools across calendar events (read+write), shared lists (read+write), chores and rewards (read+write), task-box items (read+write), meals (read+write), messages and albums (read+write), and frame/device/account settings + calendar + member management (read+write).

Every API request carries the `skylight-api-version: 2026-05-01` header (matching the official mobile app); without it some features 422 with "API version does not support …".

## Auth

The server uses a headless email+password OAuth2 authorization-code flow — no SSO, no 2FA, no browser extension required. Credentials are always `SKYLIGHT_EMAIL` + `SKYLIGHT_PASSWORD`.

On first tool call, the server performs four steps against `https://app.ourskylight.com`:
1. `GET /auth/session/new` — fetch the Rails CSRF token and session cookie.
2. `POST /auth/session` — log in with email + password (must happen before OAuth authorize).
3. `GET /oauth/authorize` — receive the one-time authorization code via redirect.
4. `POST /oauth/token` — exchange the code for a bearer `access_token` + `refresh_token` (7-day expiry).

The client then refreshes the token proactively (~60 s before expiry) and reactively on any 401. No bot wall has been observed — the headless flow works directly from Node.

**No env vars → clean start:** if credentials are not set, the server still starts without error. Auth is deferred to the first tool call, so MCP hosts can complete install-time tool listing before credentials are configured.

## Frame model

All data in Skylight is scoped to a *frame* (the family hub device). On first use the client auto-discovers the single frame on the account. If the account has more than one frame, set `SKYLIGHT_FRAME_ID` to the frame ID you want. Every tool that reads frame-scoped data accepts an optional `frameId` arg to override the default.

## Tools

| Module | Tool | R/W | Description |
|---|---|---|---|
| frames | `skylight_list_frames` | R | List all frames on the account |
| frames | `skylight_get_frame` | R | Get details for a specific frame |
| frames | `skylight_list_frame_members` | R | List members associated with a frame |
| frames | `skylight_list_devices` | R | List physical devices linked to a frame |
| frames | `skylight_get_plus_access` | R | Get Skylight Plus subscription / entitlement status |
| frames | `skylight_get_reward_points` | R | Get reward-point balances per family member |
| frames | `skylight_get_household_config` | R | Get household configuration for the frame |
| frames | `skylight_list_calendars` | R | List the frame's calendar accounts and active calendars |
| frames | `skylight_get_event_notification_settings` | R | Get the frame's calendar-event notification settings |
| frames | `skylight_resolve_member` | R | Resolve a family-member name to its category id |
| frames | `skylight_get_calendar` | R | Get one calendar account |
| frames | `skylight_list_nudges` | R | List nudges (reminders) in a date range |
| frames | `skylight_update_frame` | W | Update frame display/sleep settings |
| frames | `skylight_rename_frame` | W | Rename a frame |
| frames | `skylight_update_profile` | W | Update the frame profile (name, birthday) |
| frames | `skylight_update_household_config` | W | Update household configuration |
| frames | `skylight_add_webcal` | W | Subscribe the frame to a webcal/ICS calendar URL |
| frames | `skylight_update_calendar` | W | Set which sub-calendars of a connected account are active |
| frames | `skylight_delete_source_calendar` | W | Remove a connected source calendar (incl. webcal subscriptions) |
| frames | `skylight_set_default_calendar` | W | Set the default source calendar for new events |
| frames | `skylight_link_apple_calendar` | W | Link an Apple/iCloud calendar using an app-specific password |
| frames | `skylight_categorize_source_calendar` | W | Attribute a source calendar's events to one or more family members |
| frames | `skylight_create_source_calendar` | W | Create a source calendar from raw provider attributes (advanced) |
| frames | `skylight_invite_user` | W | Invite a user to the frame by email |
| frames | `skylight_approve_user` | W | Approve a pending frame user |
| frames | `skylight_remove_user` | W | Remove a user from the frame |
| frames | `skylight_delete_category` | W | Delete a category / family member (optional `reassign_to_category_id`, inferred) |
| frames | `skylight_update_family_member` | W | Update a family member's profile — birthday, dietary preferences (the name is the category label; set via `skylight_update_category`) |
| frames | `skylight_update_category` | W | Update a category — rename/recolor, or convert a label into a family-member profile (`linked_to_profile`) |
| frames | `skylight_set_device_album` | W | Set which photo album a device displays (inferred) |
| events | `skylight_list_events` | R | List calendar events within a date range |
| events | `skylight_get_event` | R | Get details for a specific event |
| events | `skylight_create_event` | W | Create a new calendar event (optional `category_ids` assigns members) |
| events | `skylight_update_event` | W | Update an existing calendar event (optional `category_ids` assigns members) |
| events | `skylight_delete_event` | W | Delete a calendar event |
| events | `skylight_list_categories` | R | List event categories for a frame |
| events | `skylight_list_source_calendars` | R | List external source calendars linked to a frame |
| events | `skylight_list_recent_invited_emails` | R | List recently-invited email addresses |
| events | `skylight_update_event_notification_settings` | W | Update calendar-event notification settings |
| lists | `skylight_list_lists` | R | List all shared lists on a frame |
| lists | `skylight_get_list_items` | R | Get items in a specific shared list |
| lists | `skylight_create_list` | W | Create a new shared list (label + color + kind) |
| lists | `skylight_update_list` | W | Update a list's name, color, or type |
| lists | `skylight_delete_list` | W | Delete a shared list |
| lists | `skylight_add_list_item` | W | Add an item to a shared list |
| lists | `skylight_update_list_item` | W | Rename a list item, check/uncheck it, or set its section |
| lists | `skylight_delete_list_item` | W | Delete an item from a shared list |
| lists | `skylight_delete_list_items` | W | Bulk-delete specific list items |
| lists | `skylight_move_list_item` | W | Reorder a list item |
| lists | `skylight_clear_list` | W | Remove all items from a list (single bulk delete) |
| lists | `skylight_set_list_item_section` | W | Move list items into a named section (or clear it) |
| chores | `skylight_list_chores` | R | List chores within a date range |
| chores | `skylight_create_chore` | W | Create a new chore (summary + category) |
| chores | `skylight_complete_chore` | W | Mark a chore complete |
| chores | `skylight_uncomplete_chore` | W | Reopen (un-complete) a chore |
| chores | `skylight_update_chore` | W | Update a chore (supports recurring `apply_to`) |
| chores | `skylight_complete_chore_instance` | W | Mark a specific recurring-chore occurrence complete |
| chores | `skylight_list_rewards` | R | List rewards configured for a frame |
| rewards | `skylight_get_reward` | R | Get one reward |
| rewards | `skylight_create_reward` | W | Create a reward (name + description + point_value + respawn_on_redemption + category_ids) |
| rewards | `skylight_update_reward` | W | Update a reward |
| rewards | `skylight_delete_reward` | W | Delete a reward |
| rewards | `skylight_redeem_reward` | W | Redeem a reward |
| rewards | `skylight_unredeem_reward` | W | Reverse a reward redemption |
| rewards | `skylight_add_reward_points` | W | Grant or deduct reward points to members |
| meals | `skylight_list_recipes` | R | List meal recipes for the frame |
| meals | `skylight_list_meal_categories` | R | List meal categories for the frame |
| meals | `skylight_get_recipe` | R | Get one meal recipe |
| meals | `skylight_create_recipe` | W | Create a meal recipe (meal_category_id + summary) |
| meals | `skylight_update_recipe` | W | Update a meal recipe |
| meals | `skylight_delete_recipe` | W | Delete a meal recipe |
| meals | `skylight_add_recipe_to_grocery_list` | W | Add a recipe's ingredients to a grocery list |
| messages | `skylight_list_messages` | R | List messages posted to the frame |
| messages | `skylight_list_albums` | R | List photo albums on the frame |
| messages | `skylight_get_message` | R | Get one frame message |
| messages | `skylight_create_album` | W | Create a photo album |
| messages | `skylight_delete_album` | W | Delete a photo album |
| messages | `skylight_add_to_album` | W | Add messages/photos to albums |
| messages | `skylight_remove_from_album` | W | Remove messages/photos from albums |
| messages | `skylight_add_message_comment` | W | Comment on a frame message/photo |
| messages | `skylight_set_message_caption` | W | Set a message/photo caption |
| messages | `skylight_like_message` | W | Like a frame message/photo |
| messages | `skylight_unlike_message` | W | Remove a like from a message/photo |
| messages | `skylight_delete_message` | W | Delete a frame message/photo |
| tasks | `skylight_list_tasks` | R | List task-box items |
| tasks | `skylight_create_task` | W | Create a task-box item |
| tasks | `skylight_update_task` | W | Update a task-box item |
| tasks | `skylight_delete_task` | W | Delete a task-box item |

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
