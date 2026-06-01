# Mobile API findings (from intercepting the Skylight iOS app)

Reverse-engineered from the React Native / Hermes bundle + 415 captured live requests
(mitmproxy). Every shape below is from real app traffic or verified against the live API.
Base: `https://app.ourskylight.com/api`. All requests carry header
**`skylight-api-version: 2026-05-01`** — without it some features 422 ("API version does not support …").

## Client-level

- **Add header `skylight-api-version: 2026-05-01`** to every request in `src/client.ts`. Unlocks `up_for_grabs` chores and version-gated behavior.

## Chores / routines (one endpoint family)

- Create one-off: `POST /frames/{f}/chores { summary, category_id }` (existing).
- **Create recurring / routine / bulk: `POST /frames/{f}/chores/create_multiple`** with the chore object directly (NOT an array, NOT `{chores:[]}`):
  ```json
  { "summary": "...", "description": "...", "category_ids": ["..."],
    "recurrence_set": ["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR"],
    "routine": false, "up_for_grabs": false,
    "start": "2026-06-02", "start_time": "17:00",
    "recurring_until": null, "reward_points": 5, "emoji_icon": "😃", "timer_seconds": null }
  ```
  - `recurrence_set` is an **array of `"RRULE:…"` strings** (verified: this is what makes `recurring:true`). Routines = same call with `routine:true` (use `BYHOUR` in the RRULE for time-of-day). `up_for_grabs:true` needs the api-version header.
  - Response: `{ data: [ {chore} ] }`.
- **Edit a series: `PUT /frames/{f}/chores/{id}`** with the full chore body (same fields). `apply_to` is NOT sent for a whole-series edit; it's only for occurrence-specific ops.
- Complete (whole OR per-occurrence): `PUT /frames/{f}/chores/{id}/completions`
  - whole: `{ "status": "complete" }`
  - occurrence: `{ "status": "complete", "instance_date": "2026-06-01", "instance_time": "14:00", "category_id": "..." }`
  - un-complete: `{ "status": "pending", "instance_date": "..." }`
- Delete: `DELETE /frames/{f}/chores/{id}?apply_to=one|all`
- **Search: `GET /frames/{f}/chores/search?search_query=…&include_up_for_grabs=true&limit=…&ended_chore_lookback_days=…`** (finds unscheduled/template chores the date-range list can't).

## Rewards (fixes + completions)

- Create (real fields — current tool missing `description`/`respawn_on_redemption`):
  `POST /frames/{f}/rewards { name, description, point_value, respawn_on_redemption, category_ids:[...] }`
- Redeem / un-redeem: `POST /frames/{f}/rewards/{id}/redeem` and `/unredeem` (no body).
- Grant/deduct points: `POST /frames/{f}/reward_points { category_ids:[...], points }` — `points` may be **negative** to deduct.

## Lists (fixes)

- **`bulk_destroy` real body is `{ "ids": ["..."] }`** (current `clear_list` deletes one-by-one because we never had this). Endpoint: `DELETE /frames/{f}/lists/{id}/list_items/bulk_destroy { ids }`.
- List-item update: `PUT /frames/{f}/lists/{id}/list_items/{itemId} { label, status, section }` (status `pending|completed`; app uses PUT — current tool uses PATCH which also works; add `section`).
- Section move: `PUT /frames/{f}/lists/{id}/list_items/bulk_update_section { item_ids, section }` (existing).

## Members / categories (fixes — label↔profile)

- Update category (JSON, NOT multipart): `PUT /frames/{f}/categories/{id} { label, color, avatar_id, profile_picture, linked_to_profile, selected_for_chore_chart }`.
  - Convert a label → profile: set `linked_to_profile:true` (+ usually `selected_for_chore_chart:true`).
- **Update family member real fields: `PUT /frames/{f}/categories/{id}/family_member { birthday, dietary_preferences }`** (current tool wrongly sends `{name, birthday}`; name is the category `label`).

## Albums / messages

- Update album: `PATCH /frames/{f}/albums/{id} { title, exclude_from_slideshow }`.
- Bulk delete messages: `DELETE /frames/{f}/messages/destroy_multiple?message_ids[]=…`.

## AI auto-creation (issue #15) — `POST /frames/{f}/auto_creation_intents`

Three engines; then approve/undo the drafts:
- `event_importer` (photo → events): `{ ext:"jpg", engine:"event_importer", category_ids:[...], created_via:"app_photo_picker" }` (references a photo uploaded via the S3 flow).
- `meal_sittings_generator`: `{ engine:"meal_sittings_generator", text:"", meal_category_id:"...", created_via:"app_form", engine_inputs:{ meal_sitting_dates:[...], meal_recipe_source:"generate", meal_mouths_to_feed:4, add_to_grocery_list:true } }`.
- `activity_ideas_generator`: `{ engine:"activity_ideas_generator", category_ids:[...], created_via:"app_form", engine_inputs:{ physical_location, activity_kind:"local_event", budget:"$50", datetime_range_start, datetime_range_end }, draft_first:true }`.
- Approve drafts: `POST /frames/{f}/auto_creation_intents/{id}/created_events/bulk_approve { ids:[...] }`.
- Undo: `POST /frames/{f}/auto_creation_intents/{id}/undo`.
- Read drafts: `GET /frames/{f}/auto_creation_intents/{id}` + `…/created_items` / `…/created_events`.

## Meals

- Plan a sitting: `POST /frames/{f}/meals/sittings { meal_recipe_id, meal_category_id, date, rrule:"FREQ=DAILY;…UNTIL=…", summary, description, add_to_grocery_list, note, saveToRecipeBox }`.
  - NOTE: meal sittings use a plain `rrule` **string** (unlike chores' array).
- Add recipe to grocery: `POST /frames/{f}/meals/recipes/{id}/add_to_grocery_list` (existing).

## Frame / device / reminders

- Frame: `PUT /frames/{f} { household_name, brightness, sleeps_at, wakes_at, … }` (household_name confirmed settable).
- Device: `PUT /frames/{f}/devices/{id} { name, current_album_id, … remote settings }` (rename + album + remote settings).
- **Reminder profile (global, not frame-scoped): `PUT /reminder_profile { interval_weeks }`**.

## Photo upload (issue #12) — 2-step, needs AWS S3

1. `GET /api/messages/cloud_upload_credentials` → `{ data: { credentials:{access_key_id, secret_access_key, session_token}, region:"us-east-1", bucket, key_prefix, credentials_expire_at } }`.
   - NB: fields sit directly on `data` (no JSON:API `attributes` wrapper).
2. Upload the image binary to S3 (`s3://{bucket}/{key_prefix}{uuid}.{ext}`, `key_prefix` already ends in `/`) with SigV4 using those temp STS creds → get the ETag.
3. Register: `POST /api/messages/uploads { file_upload:{ bucket, key, etag }, frame_ids:[...], caption, ext }`.
   - Verified-captured register body: `{"file_upload":{"bucket":"production-cloud-useruploads…","etag":"\"<md5>\"","key":"uploads/10730517/<uuid>.heic"},"frame_ids":["3435252"],"caption":"…","ext":"heic"}`.

### Mechanism: it's a MULTIPART upload, not a single PutObject (2026-06-01)
Probing exactly which S3 actions the `cloud_upload_credentials` role permits (creds are **valid** — STS
`GetCallerIdentity` → 200, ARN `…ClientUploadRole2-…/message-upload-10730517`):

| S3 action | Result |
|---|---|
| `PutObject` | ❌ AccessDenied (`no identity-based policy allows s3:PutObject`) |
| **`CreateMultipartUpload`** | ✅ allowed |
| **`UploadPart`** | ✅ allowed (part ETag is a plain MD5 — matches the captured register `etag`) |
| `CompleteMultipartUpload` | ❌ AccessDenied (Complete needs `s3:PutObject`) |
| `GetObject` / `HeadObject` / `ListObjectsV2` / `PutObjectTagging` | ❌ AccessDenied (`s3:ListBucket`) |

So the client is scoped to **start a multipart upload and push parts only**; it cannot finalize it. The
captured register `etag` (`"<32-hex md5>"`, no `-N` suffix) is the single **part** ETag, confirming this.
This is **not a signing bug** — the official `@aws-sdk/client-s3` v3 reproduces every result above
identically. Ruled out for the PutObject path: SSE/ACL/content-type/key-shape/unsigned-payload/CRC32/
region/`?upload_type=` params.

**Open question (needs a real-app capture of `*.amazonaws.com` + the register POST):** how the upload is
*finalized*. The client can't `CompleteMultipartUpload`, so the Skylight server must complete it — but
replaying `CreateMultipartUpload` + `UploadPart` + `POST /messages/uploads {file_upload:{bucket,key,etag}}`
(with and without `upload_id`/`parts`) returns `{data:{message_ids:[id]}}` yet the photo never materializes
(frame shows 0 messages/0 albums; the `message_id` 404s under `/frames/{f}/messages/{id}`). The missing
piece is what the app sends that triggers server-side completion. The MCP signing code in `src/s3-upload.ts`
is correct; `src/tools/photos.ts` needs to be re-pointed at the multipart flow once finalization is known.

## Still gated (not addable)

- Device **alarms** — `422 "Device must be a buddy device"` (Buddy hardware only; no header fixes it).
