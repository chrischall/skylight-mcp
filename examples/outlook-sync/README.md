# Skylight to Outlook cloud sync

This optional example mirrors Skylight calendar events into one Outlook calendar on an hourly GitHub Actions schedule. It is deterministic TypeScript: no LLM, browser, public MCP endpoint, or always-on computer is involved at runtime. It does not change the MCP server or expose an Outlook write tool.

The example starts disabled and dry-run only. It copies titles, times, all-day dates, plain-text descriptions, and locations for a rolling 12-month window. New Outlook items are private and busy, with reminders off and no attendees. It expands dated Skylight occurrences instead of guessing recurrence rules.

## Safety model

- Credentials and mappings are AES-256-GCM encrypted on a dedicated branch in a **private** deployment repository. The encryption key remains an Actions secret.
- State is bound to the sync ID, Skylight frame, Outlook account, and destination calendar. GitHub SHA compare-and-swap plus workflow concurrency prevents two writers from silently overwriting state.
- Every destination item carries a provenance marker. Updates and deletes recheck that marker, attendee absence, standalone-event type, and ETag immediately before writing.
- Creates use stable transaction IDs and recover uncertain responses by finding their provenance marker before retrying.
- Deletion is off by default. When enabled, it requires two missing observations at least one hour apart, a focused Skylight recheck, and configured change/deletion caps.
- Empty or incomplete source reads, unsupported pagination, missing loop filters, duplicate matches, changed legacy imports, and account/calendar mismatches stop the run.

Skylight's unofficial API does not publish a completeness contract. `sourceContractVerified` therefore starts false and blocks reconciliation. Compare a full snapshot against the Skylight app, including recurrence, DST, filters, and range boundaries before setting it true. Leave deletion disabled if silent source omissions are an unacceptable risk.

## Setup

1. Fork or copy this repository into a private deployment repository. Use the supported Node version and run `npm ci`, `npm run build:outlook-sync`, and `npx vitest run examples/outlook-sync/tests`.
2. Follow [Microsoft setup](docs/MICROSOFT_SETUP.md) to create a public-client app with delegated `User.Read`, `Calendars.ReadWrite`, and `offline_access` permissions. Do not create a client secret.
3. Put `MICROSOFT_CLIENT_ID` and `EXPECTED_OUTLOOK_ACCOUNT` in an ignored local `.env`. Build first, then run `node --env-file=.env examples/outlook-sync/dist/examples/outlook-sync/src/connect.js --microsoft`. Enter the displayed code only on Microsoft's device-login page and select the exact writable calendar returned by the command.
4. Copy [config.example.json](config.example.json) and replace every placeholder. Exclude the Outlook-backed Skylight source to prevent loops. Keep `allowDeletes` and `sourceContractVerified` false initially.
5. Add local `SKYLIGHT_EMAIL` and `SKYLIGHT_PASSWORD`, set `SYNC_CONFIG` to the JSON config, and run the built `connect.js --prepare`. The password is used only to mint renewable tokens into `.sync/ready.enc`; it is not uploaded.
6. Create a private GitHub deployment repository. Add `SYNC_STATE_KEY` and `SYNC_CONFIG` as Actions secrets and `MICROSOFT_CLIENT_ID` as a variable. Set local `GITHUB_REPOSITORY` and `GH_TOKEN`, then run `connect.js --upload`. Supply secrets through protected input or the GitHub UI, never command-line literals.
7. Copy [calendar-sync.example.yml](calendar-sync.example.yml) to `.github/workflows/calendar-sync.yml`. Set `SYNC_ENABLED=true`; keep `SYNC_APPLY_ENABLED=false`. Dispatch once with `apply=false` and inspect the proposed counts.
8. After source-contract validation, set `sourceContractVerified=true`. Test add/update/delete with synthetic events, including all-day and DST cases. Enable apply and deletion separately only after reviewing dry runs.

The workflow targets hourly execution during configured daytime hours. GitHub schedules are best effort and may be delayed. To pause, set `SYNC_ENABLED=false`; pausing never deletes Outlook copies. To retire the sync, also revoke Microsoft consent and Skylight tokens and remove the repository secrets.

For existing one-time imports, an optional private manifest can adopt exact title/time matches carrying a configured legacy marker. Keep that manifest out of Git. The adoption path refuses ambiguous matches and checkpoints each conversion.

## Files

- `src/engine.ts` — deterministic reconciliation and write-ahead checkpoints
- `src/source.ts` — Skylight normalization, exclusions, and completeness checks
- `src/graph.ts` — Microsoft Graph boundary and destination safeguards
- `src/store.ts` — encrypted state branch with compare-and-swap
- `src/connect.ts` — interactive local bootstrap only
- `src/run.ts` — non-interactive scheduled runner
- `tests/` — synthetic and mocked safety tests; no live credentials or calendars

Never commit `.env`, `.sync/`, `state.enc`, real IDs, calendar exports, or tokens.
