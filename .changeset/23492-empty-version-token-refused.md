---
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

fix(rest,runtime)!: a `/data` `PATCH` or `DELETE` whose version token can never carry a version (`expectedVersion: ''` or `false`, `?expectedVersion=`, an empty `If-Match`) is refused `400 VALIDATION_FAILED` on both doors, instead of being applied unguarded beside a stale `If-Match`

Both doors of `PATCH /data/:object/:id` and `DELETE /data/:object/:id`, `RestServer` and the runtime dispatcher's `/data` domain, read an optimistic-concurrency token from the body's `expectedVersion` (`PATCH`) or `?expectedVersion` (`DELETE`), else from `If-Match`. They forwarded it to the protocol only when it was truthy. `''` and `false` are not nullish, so a stale `If-Match` beside them was never read, and they are not truthy, so no token was forwarded: the write ran unguarded and answered `200`. The protocol already refuses the quoted-empty tag `""` with `400 VALIDATION_FAILED`, under the ruling that a token shape that can never carry a version is refused, neither read as "no token" nor answered `409`. It never saw these tokens, because the door dropped them first, and it reads a blank string as no token. Both doors now judge every token a caller sends, or refuse it before the protocol is asked, and they answer each token alike.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of two HTTP routes on two doors: a write whose version token can never carry a version is now refused where it was applied or judged, and the remedy is in the request a caller sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

What changes for you, on both doors, wherever `@objectstack/rest` or the runtime dispatcher serves these routes:

- FROM a `PATCH` whose body `expectedVersion` is `''`, a blank string, `false` or an empty array, or a `DELETE` whose `?expectedVersion` is empty or blank, which wrote or deleted the record unguarded and answered `200` even beside a stale `If-Match`, TO `400 VALIDATION_FAILED` with the record unchanged, before the protocol is asked.
- FROM an empty `If-Match` sent with no body or query token, which wrote or deleted unguarded and answered `200`, TO the same `400 VALIDATION_FAILED`. An `If-Match` that is sent asks for a guard, and an empty one carries nothing to judge. A request that sends no `If-Match` at all is unchanged.
- FROM a body `expectedVersion` of `true`, an object or a non-empty array, which was judged as its string (`'true'`, `'[object Object]'`, the comma-joined elements), TO the same `400 VALIDATION_FAILED`.
- FROM a body `expectedVersion` of `0`, which was dropped like `''` and so wrote unguarded, TO a token judged as `'0'`, as every other number already was. On a real record that is `409 CONCURRENT_UPDATE`.

How it renders: `RestServer` answers `{ error, code: 'VALIDATION_FAILED', fields: [], object }`, the envelope it already gives the protocol's `""` refusal. The dispatcher returns its own `400 VALIDATION_FAILED` envelope instead of throwing, so a `@objectstack/hono` `createHonoApp` host renders it as `400`. That is unlike the refusals the protocol throws out of `dispatch()`, `409 CONCURRENT_UPDATE` and the `400` for `""`, which that host still renders as `500` (the record is unchanged), because its catch-all reads only an error's `statusCode`. Rendering their declared status is a separate fix.

Unchanged: a request with no token, a body `expectedVersion: null` (it is no token, so `If-Match` is read), a non-empty string or a non-zero number token (judged; `409` on a mismatch), and `""` (the protocol's own `400`). The body key is still stripped from the patch whatever its value.

To write over a version you read, send that version (the record's `updated_at`) as the token. To write unguarded, omit both `expectedVersion` and `If-Match` rather than sending either one empty. The `@objectstack/client` SDK's `data.update` and `data.delete` already omit `If-Match` when `ifMatch` is empty, so an SDK caller is affected only when its `data` carries an `expectedVersion` that can never carry a version.
