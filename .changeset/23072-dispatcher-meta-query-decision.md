---
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

fix(runtime)!: the runtime dispatcher's by-name `/meta` doors ask the query decision `RestServer` asks, so `?member=` is honoured on the item read and refused where it is not read, never dropped

`@objectstack/rest` exports one portable decision for the query a by-name `/meta` door accepts, `metaItemQueryRefusal(door, query)`, and the bundle member selector's one reading, `metaMemberSelector(query)`. Both transports call them, so a door's closed set, its sentences and their order are one answer. On a host whose `/meta` is answered by the runtime dispatcher alone (the `@objectstack/hono` `createHonoApp` catch-all), the item read, `PUT`, `/layers` and `/published` declared no closed query set: `GET /meta/email_template/x?member=zh-CN` was answered with the canonical member, a misspelling such as `?memeber=` the same, and `PUT ?member=zh-CN` beside an `en-US` body wrote `en-US`.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed. `@objectstack/rest` gains two exports (`metaItemQueryRefusal`, `metaMemberSelector`), and the module constants that moved beside them are still exported, unchanged, from `rest-server.ts`. No stored row or package source changes, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is four runtime doors' query accept sets on the runtime dispatcher (`GET` and `PUT /meta/:type/:name`, `/layers`, `/published`): a query parameter those doors dropped now answers a located `400 VALIDATION_ERROR`, and the remedy is in the request a caller sends to that door, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

What each runtime dispatcher door accepts now, and what to do when it refuses. The answers are `RestServer`'s, in the dispatcher's own envelope, `{ success: false, error: { code: 'VALIDATION_ERROR', message } }`, and the message names the refused parameter:

- `GET /meta/:type/:name` accepts `layers`, `state`, `preview`, `package`, `locale` and `member`, the six names `RestServer`'s item read accepts. `?member=` now reads that member of a bundled type (an `email_template`'s `zh-CN`); a member the bundle does not hold is `404`, and a selector on a type with no members is the protocol's located `400`. A single-valued name supplied twice is refused, and `?member=` beside `?layers=` is refused (the layered view shows the canonical member's layers). Read one member with `?member=` alone.
- `PUT /meta/:type/:name` accepts `package` and `mode`. It takes no `force`: this door never honoured one, and its `409` remedy already says so. Drop `?force=`, and send a body that keeps what the stored item carries. A save is addressed by its body: to save one member of a bundled type, put that member's own discriminator in the body and drop `?member=`.
- `GET /meta/:type/:name/layers` accepts `package`. Read one member with `GET /meta/:type/:name?member=…`.
- `GET /meta/:type/:name/published` accepts no query parameter. Send none.

A request that sends only names the door reads is answered as before, except that `?member=` on the item read is now honoured. `RestServer`'s item read asks the same decision, and its answers are byte for byte what they were. Every name the `@objectstack/client` SDK and the Studio metadata client send to these doors is accepted, except `force` on a save: the SDK sends it only when its caller passes `force: true`, and Studio only to retry a save after a `409 DESTRUCTIVE_CHANGE`. On a dispatcher-only host that retry already failed with the same `409`, and it now answers the located `400` that names `force`.
