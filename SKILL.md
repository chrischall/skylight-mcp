---
name: skylight-mcp
description: Read and manage your Skylight Calendar family hub — calendar events, chores and reward stars, and shared lists (grocery/to-do). Triggers on phrases like "check Skylight", "what's on the family calendar", "add an event to Skylight", "what chores does [kid] have", "mark [chore] done", "add milk to the grocery list", "what's on our shopping list", "who's on the Skylight frame", or any request involving the Skylight frame, family calendar, chores, rewards, or shared lists. Works against your own signed-in Skylight account via email + password.
---

# skylight-mcp

MCP server for [Skylight Calendar](https://www.ourskylight.com) — 21 tools across calendar events, chores & rewards, shared lists, and frame/device info.

- **npm:** [npmjs.com/package/skylight-mcp](https://www.npmjs.com/package/skylight-mcp)
- **Source:** [github.com/chrischall/skylight-mcp](https://github.com/chrischall/skylight-mcp)

## Setup

Skylight authenticates with your account **email + password** (OAuth2 authorization-code flow under the hood — no browser extension or API key needed). Add an env block to `.mcp.json` (project) or `~/.claude/mcp.json` (global):

```json
{
  "mcpServers": {
    "skylight": {
      "command": "npx",
      "args": ["-y", "skylight-mcp"],
      "env": {
        "SKYLIGHT_EMAIL": "you@example.com",
        "SKYLIGHT_PASSWORD": "your-password"
      }
    }
  }
}
```

The server logs in once at startup, then talks to the Skylight API directly with the returned bearer token (refreshed automatically).

**Optional env:**

- `SKYLIGHT_FRAME_ID` — pick a frame when your account has more than one (see `skylight_list_frames`). Otherwise the single frame is auto-discovered.
- `SKYLIGHT_NAME` — friendly label shown in diagnostics (defaults to your email).

Requires a Skylight **email + password** login — Google/Apple/SSO-only accounts aren't supported.

## Tools

Everything is scoped to a **frame** (your family hub); pass an optional `frameId` to any tool, or let it auto-resolve.

| Domain | Tools |
| --- | --- |
| Frames & devices (read) | `skylight_list_frames`, `skylight_get_frame`, `skylight_list_frame_members`, `skylight_list_devices` |
| Calendar events | `skylight_list_events`, `skylight_get_event`, `skylight_create_event`, `skylight_update_event`, `skylight_delete_event`, `skylight_list_categories`, `skylight_list_source_calendars` |
| Shared lists | `skylight_list_lists`, `skylight_get_list_items`, `skylight_create_list`, `skylight_add_list_item`, `skylight_update_list_item`, `skylight_delete_list_item` |
| Chores & rewards | `skylight_list_chores`, `skylight_create_chore`, `skylight_complete_chore`, `skylight_list_rewards` |

## Notes

- **Meals are not supported** — Skylight does not expose a meals API.
- `skylight_complete_chore` marks a chore complete; completing a single occurrence of a recurring chore isn't separately exposed.
- `skylight_list_chores` requires `after` and `before` dates (chores are date-scoped).
