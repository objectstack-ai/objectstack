---
'@objectstack/runtime': minor
---

fix(runtime)!: the runtime dispatcher's `DELETE /data/:object/:id` honours `?expectedVersion` and `If-Match` as its `RestServer` twin does, so a delete carrying a stale version is refused instead of applied

`RestServer`'s `DELETE /data/:object/:id` reads an optimistic-concurrency token from `?expectedVersion`, else from the `If-Match` header, refuses the query name supplied more than once, and hands the token to the protocol's `deleteData`, which refuses a delete whose record has moved past it. The runtime dispatcher's `/data` domain read neither, and its shared `callData` delete arm forwarded only the object and the id. So on a host whose `/data` routes the dispatcher serves (a `createHonoApp` host), a delete carrying a stale token deleted the record and answered `200`, the same answer a delete carrying no token gets. The domain now reads the token the way `RestServer` does and `callData` forwards it to `deleteData`.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of one runtime dispatcher route: a delete whose version token is stale, repeated, or sent to a host that cannot judge it is now refused where it was applied, and the remedy is in the request a caller sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

What changes for you, wherever the runtime dispatcher serves `DELETE /data/:object/:id`. Where `@objectstack/rest` is mounted it serves this route itself and already answered each of these, so the standalone server's answers do not move.

- FROM a delete with a stale `?expectedVersion` or `If-Match` that deleted the record and answered `200`, TO a refusal with the record kept: the protocol's `409 CONCURRENT_UPDATE`, thrown out of `dispatch()` for the host's exit to render, as every other refusal `deleteData` throws is. A `@objectstack/hono` `createHonoApp` host still renders that refusal as `500` (the record is kept): its catch-all reads only an error's `statusCode`, and rendering the declared `409` is a separate fix.
- FROM a repeated `?expectedVersion` that was ignored (the record deleted, `200`), TO `400 VALIDATION_ERROR` in the dispatcher's envelope with the sentence `RestServer` answers ("The "expectedVersion" query parameter was supplied N times…"), before the protocol is asked. A one-element array is read as the one token it encodes.
- FROM a delete carrying a token on a host whose protocol has no `deleteData` (the ObjectQL fallback), which deleted unguarded, TO `501 NOT_IMPLEMENTED`, before anything is read or deleted. A delete with no token reaches the fallback as before.

To delete over a version you read, send that version (the record's `updated_at`) once, as `?expectedVersion` or `If-Match`; `?expectedVersion` is judged when both are sent. A delete with no token is unchanged. The `@objectstack/client` SDK's `data.delete(object, id, { ifMatch })` sends `If-Match`, so an SDK caller that passes `ifMatch` now gets, through the dispatcher, the guard it asked for.
