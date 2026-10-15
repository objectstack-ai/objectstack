---
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

fix(rest,runtime)!: both `/data` write doors validate the request as the caller sent it: a `PATCH` or `POST` create whose body is not a record, and a `PATCH` whose `expectedVersion` is a number, are refused `400 VALIDATION_FAILED` on both doors before the engine is asked

`RestServer` validates `PATCH /data/:object/:id` against `UpdateDataRequestSchema` and `POST /data/:object` against `CreateDataRequestSchema`. The runtime dispatcher's `/data` domain, the only answer on a host that mounts just the `@objectstack/hono` catch-all, validated neither, so a body that is not a record reached the engine. On a `PATCH` it answered `500` with the engine's own error. On a `POST`, an array created one row per element and a number created an empty row, both answered `201`. `RestServer`'s own `PATCH` gate parsed a coerced copy of the request: it read a JSON `null` body as `{}`, and it read a numeric `expectedVersion` as its string. Both doors now validate the assembled request as the caller sent it, and they answer each case alike.

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of two HTTP routes on two doors: a write whose body is not the record the request schema declares, or whose body version token is a number where the schema declares a string, is now refused where it was applied or judged, and the remedy is in the request a caller sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

What changes for you, wherever `@objectstack/rest` or the runtime dispatcher serves these routes:

- `RestServer`, `PATCH /data/:object/:id` with a JSON `null` body: FROM `200`, an update that changed no field and still moved the record's `updated_at` (so every other holder of the old version saw a conflict on its next guarded save), TO `400 VALIDATION_FAILED` naming `data`, the record unchanged. The runtime dispatcher answers the same.
- The runtime dispatcher, `PATCH /data/:object/:id` with an array, a string, a number or `null` as the body: FROM `500` carrying the engine's own error text, nothing written, TO `400 VALIDATION_FAILED` naming `data`, before the engine is asked. `RestServer` already answered `400` for the first three.
- The runtime dispatcher, `POST /data/:object` with an array, a string or a number as the body: FROM `201` with one row created per array element, `201` with an empty row for a number, and the engine's own `400 INVALID_FIELD` for a string, TO `400 VALIDATION_FAILED` naming `data`, with no row created. `RestServer` already answered this.
- Both doors, `PATCH /data/:object/:id` with a body `expectedVersion` that is a number (`5`, `0`): FROM judged as its string (`'5'`) and answered `409 CONCURRENT_UPDATE`, TO `400 VALIDATION_FAILED` before the protocol is asked, whatever `If-Match` is sent beside it. The request schema declares the token a string, and a number is now one of the token shapes that can never carry a version.

How it renders: `RestServer` answers `{ error, code: 'VALIDATION_FAILED', fields, object }`, the envelope its request gate already used. The runtime dispatcher returns its own `400 VALIDATION_FAILED` envelope, `fields` under `error.details`, instead of throwing, so a `@objectstack/hono` `createHonoApp` host renders it as `400`.

Unchanged: a record body, `{}` included; a string `expectedVersion` (judged; `409` on a mismatch); `If-Match` and the `DELETE`'s `?expectedVersion`, which are strings by transport; and a JSON `null` body on a `POST` create, which both doors still read as an empty record and answer `201`.

To send a patch or a row, send the fields as a JSON object. To guard a write, send the version you read (the record's `updated_at`) as a string. The `@objectstack/client` SDK's `data.update` sends the version as an `If-Match` header string, so an SDK caller is affected only when the `data` it passes is not an object, or carries a number `expectedVersion`.
