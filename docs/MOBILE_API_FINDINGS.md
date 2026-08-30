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

- **Create category: `POST /frames/{f}/categories { label, color, linked_to_profile, selected_for_chore_chart, avatar_id }`** (verified live; returns the new category with `profile_picture_urls`). `DELETE /frames/{f}/categories/{id}` removes it.
- Update category (JSON, NOT multipart): `PUT /frames/{f}/categories/{id} { label, color, avatar_id, profile_picture, linked_to_profile, selected_for_chore_chart }`.
  - Convert a label → profile: set `linked_to_profile:true` (+ usually `selected_for_chore_chart:true`).
- **Preset avatars: `GET /avatars`** (global, not frame-scoped) → 62 `{ id, name, image_url, kind:"emoji" }`. Assign one via `avatar_id` on create/update — no upload needed.
- **Custom-photo avatar (verified live): `PUT /frames/{f}/categories/{id}` as `multipart/form-data` with a `profile_picture` file part** — NOT the S3 cloud-upload flow. The server pushes the image to Cloudinary and fills in `profile_picture_urls` (`{ original, xl, large, medium, small }`, Cloudinary URLs under `profile-pictures-production/`). Implemented as `skylight_set_member_avatar`.
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

- Read planned sittings (LIVE-VERIFIED): `GET /frames/{f}/meals/sittings?date_min=YYYY-MM-DD&date_max=YYYY-MM-DD`.
  - **Both** bounds are required — each is its own 422: `{"errors":["Date min is required."]}` / `{"errors":["Date max is required."]}`.
  - Supports `include=meal_category,meal_recipe,profiles`, which sideloads those resources into the document's `included` array. All three are requested by `skylight_list_meals` (verified `200` for the combined three-way include).
  - **`include` is validated server-side, and an unknown relationship is a `500`, not a `400`** (probed live): `include=bogus_relationship` and the near-miss `include=profiless` both return `{"status":500,"error":"Internal Server Error"}`, while `meal_category`, `meal_recipe` and `profiles` each return `200` individually and together. Read a `500` here as "that relationship name is wrong", not a server fault — the `500`/`200` split is what confirms `profiles` is a real sitting relationship.
  - Sitting attributes: `summary`, `description`, `note`, `rrule`, `draft`, `recurring`, `instances` (array of `YYYY-MM-DD` — this is where the date lives). Relationships: `meal_category`, `meal_recipe`, `profiles`.
  - **There is no profiles collection to resolve a `profile` ref against** — `GET /frames/{f}/profiles` and `GET /profiles` both `404`, and a `category_detail` exposes no profile link, so it is unverified whether a profile id is the same id space as the family-member category ids `skylight_resolve_member` returns. Sideloading via `include=profiles` is the only way to get from an assigned member ref to its name, which is why it is in the include rather than left to the caller.
  - `GET /frames/{f}/meals/sittings/{id}` returns 404, but that is not the whole story: the single-sitting read lives one level down at `GET /frames/{f}/meals/sittings/{id}/instances` (LIVE-VERIFIED 200). See the RESOLVED section below.
- Plan a sitting: `POST /frames/{f}/meals/sittings { meal_recipe_id, meal_category_id, date, rrule:"FREQ=DAILY;…UNTIL=…", summary, description, add_to_grocery_list, note, saveToRecipeBox }`.
  - NOTE: meal sittings use a plain `rrule` **string** (unlike chores' array).
  - **LIVE-VERIFIED 422:** when `meal_recipe_id` is supplied, `summary` must be **blank** — sending both returns `{"errors":{"summary":["must be blank"]}}`. Pass `summary: ""` and the sitting inherits its name from the linked recipe.
- Add recipe to grocery: `POST /frames/{f}/meals/recipes/{id}/add_to_grocery_list` (existing).

### Meal sittings ARE editable and deletable — RESOLVED 2026-08-24 (supersedes the earlier negative result)

The routes exist. They are **members one level below the sitting**, under
`/instances/{instanceISO}` — which is exactly why the 2026-07-30 sweep missed
them: every path probed then targeted the sitting itself
(`/meals/sittings/{id}`) or the `/instances` *collection*, and none targeted an
instance member.

```
GET    /frames/{f}/meals/sittings/{id}/instances?date_min=…&date_max=…&include=meal_category,meal_recipe
PATCH  /frames/{f}/meals/sittings/{id}/instances/{instanceISO}?apply_to=…
DELETE /frames/{f}/meals/sittings/{id}/instances/{instanceISO}?apply_to=…
POST   /frames/{f}/meals/sittings/migrate
```

`instanceISO` is the `YYYY-MM-DD` of the occurrence being acted on and must be
one of that sitting's `instances`. PATCH body is the flat sitting shape
(`summary`, `description`, `note`, `date`, `rrule`, `meal_category_id`,
`meal_recipe_id`).

This also corrects the "no single-sitting read" line above: `GET
/meals/sittings/{id}` does 404, but `GET /meals/sittings/{id}/instances` returns
the sitting (live-verified 200).

**`apply_to` is the app-wide recurrence scope**, not a meal-specific parameter —
it is the same `ScheduledItemUpdateApplyTo` the client uses for calendar events:

| value | constant | semantics (each verified live) |
|---|---|---|
| `one` | `This` | Splits that occurrence out into its own standalone sitting (new id, `rrule: null`) and drops the date from the original series. |
| `future` | `Future` | Truncates the original series' rrule `UNTIL` to just before the occurrence, and creates a **new independent sitting** for the remainder. |
| `all` | `All` | Applies to / deletes the entire series, including occurrences previously split off it. |

Two behaviours worth calling out, both observed:

- After `apply_to=future`, the new tail sitting is **not** reachable from the
  original sitting's `/instances` endpoint. Re-list the date range with
  `GET /meals/sittings` to find it, or the tail looks like it silently vanished.
- `DELETE … ?apply_to=all` also removes sittings that were previously split off
  that series by `apply_to=one`; a follow-up delete of the split-off id then
  returns the controller-level `{"errors":["Record not found"]}`.

**How this was found — and why the earlier sweep was sound but incomplete.** Blind
path guessing was, as the previous note said, the wrong tool. The routes came out
of the **web client bundle**
(`ourskylight.com/_expo/static/js/web/index-*.js`), which contains the API layer
in readable-enough minified form — `_e.updateMeal`, `_e.deleteMeal`, `_e.getMeal`
and `_e.migrateDinnerPlans` sit next to each other, and the `apply_to` enum is a
plain object literal (`t.This="one",t.Future="future",t.All="all"`). Bundle
inspection needs no auth, no mutation and no traffic capture; it is the cheapest
first move for any route this document is missing. Every route above was then
exercised against the live API on a throwaway series before being written down.

**Note on the 404-body technique.** The routing-404 vs record-404 discrimination
documented below still works, but only when the request sets
`Accept: application/json`. Without it Rails serves an HTML error page for both
cases and the two become indistinguishable.

**Distinguishing "no such route" from "routed, record missing".** The two 404s have different bodies, which makes route existence testable against a nonexistent id without touching real data:

| Body | Meaning |
|---|---|
| `{"errors":["Record not found"]}` | route exists, the record does not (controller-level) |
| `{"status":404,"error":"Not Found"}` | no such route (routing-level) |

Control: all four of `GET`/`PATCH`/`PUT`/`DELETE /frames/{f}/meals/recipes/{ghost-id}` return `Record not found` — member routes that do exist.

Probed against a ghost id on 2026-07-30 and confirmed dead (retained so nobody re-runs them):

- Member routes directly on the sitting: `GET`, `PUT`, `PATCH`, `DELETE /frames/{f}/meals/sittings/{id}`.
- Collection-level bulk patterns borrowed from elsewhere in this API: `DELETE …/meals/sittings/bulk_destroy { ids }`, `DELETE …/meals/sittings/destroy_multiple?sitting_ids[]=` and `?ids[]=`, `DELETE …/meals/sittings { ids }`.
- Alternate resource names: `/frames/{f}/meal_sittings/{id}`, `/frames/{f}/meals/meal_sittings/{id}`.
- Instance-scoped **collection**: `DELETE` and `PUT …/meals/sittings/{id}/instances`. Note the working routes are the instance **member** (`…/instances/{instanceISO}`) — the collection itself only answers `GET`.

## Frame / device / reminders

- Frame: `PUT /frames/{f} { household_name, brightness, sleeps_at, wakes_at, … }` (household_name confirmed settable).
- Device: `PUT /frames/{f}/devices/{id} { name, current_album_id, … remote settings }` (rename + album + remote settings).
- **Reminder profile (global, not frame-scoped): `PUT /reminder_profile { interval_weeks }`**.

## Photo upload (issue #12) — SOLVED: MULTIPART upload + register

Verified end-to-end live (upload → register → photo reaches `downloaded` on the frame). It must be a
**multipart upload completed with a signed `If-None-Match: *`** — a single `PutObject` does NOT work
(see "two gotchas" below).

1. `GET /api/messages/cloud_upload_credentials` → `{ data: { credentials:{access_key_id, secret_access_key, session_token}, region:"us-east-1", bucket, key_prefix, credentials_expire_at } }`.
   - NB: fields sit directly on `data` (no JSON:API `attributes` wrapper).
2. Multipart-upload the bytes to `https://{bucket}.s3.{region}.amazonaws.com/{key}` where
   `key = {key_prefix}{uuid}.{ext}` (`key_prefix` already ends in `/`), SigV4-signed with the temp STS creds:
   - `POST …/{key}?uploads` → `<UploadId>` (sign `content-type`).
   - `PUT …/{key}?partNumber=N&uploadId=…` per ≥5 MiB chunk → part `ETag` (response header).
   - `POST …/{key}?uploadId=…` with the `<CompleteMultipartUpload>` part list, **signing
     `if-none-match: *`** → final object `ETag` (`"…-N"`). S3 may return HTTP 200 with an `<Error>` body.
3. Register: `POST /api/messages/uploads { file_upload:{ bucket, key, etag }, frame_ids:[...], caption, ext }`
   → `{ data: { message_ids:[id] } }`. The photo transcodes server-side (feed shows it as
   `type:"message_status" status:"processing"` → `awaiting_download` → `downloaded`), moved to the
   `darkroom-production` bucket and served via CloudFront.
   - Read the feed with pagination: `GET /frames/{f}/messages?page_token=__START__` (without `page_token`
     it returns empty); subsequent polls use `?sync_token=…`. A message is only deletable once it leaves
     `processing` (DELETE 404s while processing).

### Two gotchas, both verified the hard way (2026-06-01)
1. **It must be multipart, not `PutObject`.** A single `PutObject` (even with `If-None-Match`) lands the
   object and register returns a `message_id`, but it **sticks in `processing` forever** — Skylight's
   image processing is triggered by the S3 `CompleteMultipartUpload` event, which a plain PUT never fires.
   `CreateMultipartUpload` + `UploadPart` + `CompleteMultipartUpload` reaches `downloaded` in seconds.
2. **`If-None-Match: *` must be signed** on the create operation. Without it, `s3:PutObject` (which
   `CompleteMultipartUpload` also requires) is denied — `no identity-based policy allows the s3:PutObject
   action` — because the bucket IAM Allow is conditioned on the conditional-create header.

Not a signing bug — the official `@aws-sdk/client-s3` reproduces both (`Upload` only sends `If-None-Match`
when you pass `IfNoneMatch`, and uses `PutObject` for sub-5 MiB bodies, which then stick). Implemented
hand-rolled (no SDK dep) in `src/s3-upload.ts` / `src/tools/photos.ts`.

> Debugging note: the original mitmproxy capture addon hard-filtered to `ourskylight.com`, silently
> dropping every S3 request — which is why the mechanism stayed hidden. `/tmp/skylight_capture2.py`
> captures the S3/Cloudinary hosts and response bodies.

## Still gated (not addable)

- Device **alarms** — `422 "Device must be a buddy device"` (Buddy hardware only; no header fixes it).
