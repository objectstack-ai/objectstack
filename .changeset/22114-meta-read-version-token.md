---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
"@objectstack/rest": minor
"@objectstack/types": minor
---

feat(meta): the `/meta` item read serves the ADR-0008 version token, `If-None-Match: *` pins a save that expects no row, and the 409 `METADATA_CONFLICT` body carries the current version as data

Clause-②: yes (widening)

ADR-0008's optimistic lock on `PUT /api/v1/meta/:type/:name` takes `If-Match: <version>`, but a client can only send a token it was served, and only a save receipt served one. So the first save after a load could not be pinned: two editors who each loaded an item and saved once overwrote each other. Three additions close that.

- **The read serves the token.** `GET /meta/:type/:name` now carries `version` (declared on `GetMetaItemResponseSchema`): the keyed token of the stored row a save to this item would compare against, at the read's scope (the caller's organization partition and `?package=`) and lifecycle (`?state=draft` for the draft row, the plain read for the active row). It is the same producer and the same row as the save receipt's `version`, so a read after a save serves the receipt's token byte for byte. Send it back as `If-Match`. `null` means no stored row is there (an item served from code or a package artifact, or from a row in a scope the save does not write), so the next save is a create. The cached published-value branch (the default plain read) and `?preview=draft` publish no `version`, as they publish no `lock`; their `ETag` stays the cache validator and is not the token.
- **"Expect no row" can be said.** `If-None-Match: *` on `PUT /meta/:type/:name` (with `?mode=draft` for a draft) saves only where no row of that lifecycle exists, and is refused `409 METADATA_CONFLICT` once one does. This is the `parentVersion: null` pin `SaveMetaItemRequestSchema` already declared, now reachable over HTTP. The header takes `*` alone: any other value, or `If-None-Match` beside `If-Match`, is refused `400 VALIDATION_ERROR` and nothing is written. No first-party client sends `If-None-Match` on a `PUT`. A save with neither header is last-writer-wins, as before.
- **The conflict body names the current version as data.** The 409 of the `/meta` item write doors (save, publish, rollback, reset) now carries `currentVersion` beside the unchanged `error` sentence: the token the sentence names, or `null` when no row of the target lifecycle exists (declared as `MetadataConflictErrorSchema`). On the save door it equals the token the next read at the same address serves, so a client offering "reload" or "overwrite" re-pins without parsing prose. The SDK already exposes it as `err.details.currentVersion`.
