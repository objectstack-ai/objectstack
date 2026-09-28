---
'@objectstack/rest': minor
'@objectstack/runtime': patch
---

fix(rest, runtime): the runtime dispatcher serves the layered view, `GET /meta/:type/:name/layers` and the deprecated `?layers=` flag, as `RestServer` serves it (#20478)

Clause-②: yes (widening) — `@objectstack/rest`'s root entry gains three value exports (`createMetaLayeredAnswer`, `wantsMetaItemLayers`, `metaItemLayersDeprecationHeaders`) and two type exports (`MetaLayeredAnswer`, `MetaLayeredRequest`). Nothing any published version exported is removed, renamed or narrowed. `@objectstack/runtime` publishes no new surface and stays a `patch`.

A host that mounts only the `${prefix}/*` catch-all (`createHonoApp`, and any
adapter written on the public `HttpDispatcher` API) serves `/meta` through the
runtime dispatcher. Until now, on such a host:

- **`GET /meta/:type/:name?layers=true` answered the plain read.** The body was
  `{ type, name, item }` with a `200`, so a client reading `code`, `overlay` or
  `effective` read `undefined`. There was no `Deprecation` header and no `Link`
  to the successor. An author (a caller the item's save door admits) was served
  the app pruned, where the layered view serves them every layer whole.
- **`GET /meta/:type/:name/layers` was no route.** It answered a located
  `404 ROUTE_NOT_FOUND`.

Both spellings now answer what `RestServer` answers: the three layers, each
judged by the per-caller read gate under the stored-version doors' policy
(whole for a caller who may save the item, pruned as the plain read prunes it
for everyone else), each projected through the object-schema field mask, and
`private, no-store` when the caller's field visibility could not be determined.
The read is scoped to the caller's vetted organization and to `?package=`. The
flag's answers, refusals included, carry `Deprecation: true`, and a `Link` to
`/layers` built from the request's own URL (every `createHonoApp` request
carries one; a host that hands `dispatch()` no URL gets `Deprecation` alone). The route answers `501 NOT_IMPLEMENTED` where the protocol has no
layered read, and the flag is then the plain read, on both transports.

**What changed.** Everything `RestServer`'s layered helper does after the store
read moved, unchanged, into `createMetaLayeredAnswer`, and the flag's parse and
headers into `wantsMetaItemLayers` and `metaItemLayersDeprecationHeaders`. The
dispatcher's `/meta` domain calls all three. `RestServer`'s own answers are
unchanged: every existing REST test passes unedited.
