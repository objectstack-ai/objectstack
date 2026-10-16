---
'@objectstack/runtime': minor
---

fix(runtime)!: the runtime dispatcher's `PATCH /data/:object/:id` honours a body `expectedVersion` and `If-Match` as its `RestServer` twin does, so an update carrying a stale version is refused instead of applied

`RestServer`'s `PATCH /data/:object/:id` reads an optimistic-concurrency token from the body's `expectedVersion`, else from the `If-Match` header. It strips `expectedVersion` out of the patch and hands the token to the protocol's `updateData`, which refuses an update whose record has moved past it. The runtime dispatcher's `/data` domain read neither and handed the whole body over as the patch, and its shared `callData` update arm forwarded no token. So on a host whose `/data` routes the dispatcher serves (a `createHonoApp` host), an update carrying a stale `If-Match` wrote the record and answered `200`, the same answer an update carrying no token gets. A body `expectedVersion` reached the engine as a field and was refused as an unknown one. The domain now reads the token the way `RestServer` does, and `callData` forwards it to `updateData`.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of one runtime dispatcher route: an update whose version token is stale, or sent to a host that cannot judge it, is now refused where it was applied, and the remedy is in the request a caller sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

What changes for you, wherever the runtime dispatcher serves `PATCH /data/:object/:id`. Where `@objectstack/rest` is mounted it serves this route itself and already answered each of these, so the standalone server's answers do not move.

- FROM an update with a stale `If-Match` that wrote the record and answered `200`, TO a refusal with the record unchanged: the protocol's `409 CONCURRENT_UPDATE`, thrown out of `dispatch()` for the host's exit to render, as every other refusal `updateData` throws is. A `@objectstack/hono` `createHonoApp` host still renders that refusal as `500` (the record is unchanged): its catch-all reads only an error's `statusCode`, and rendering the declared `409` is a separate fix.
- FROM a body `expectedVersion` that reached the engine as a field and was refused as unknown (`Unknown field 'expectedVersion'`, nothing written), TO the update's version token. It is stripped from the patch and never written as a field. The update is applied when the token names the current version and refused as above when it is stale. A body `expectedVersion` is read before `If-Match`, in `RestServer`'s order.
- FROM an update carrying a token on a host whose protocol has no `updateData` (the ObjectQL fallback), which updated unguarded, TO `501 NOT_IMPLEMENTED`, before anything is read or written. An update with no token reaches the fallback as before.

To update over a version you read, send that version (the record's `updated_at`) as the body's `expectedVersion` or as `If-Match`. An update with no token is unchanged. The `@objectstack/client` SDK's `data.update(object, id, data)` sends `data` as the body, so an SDK caller whose `data` carries `expectedVersion` now gets, through the dispatcher, the guard it asked for.
