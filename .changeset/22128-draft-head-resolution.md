---
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
"@objectstack/spec": patch
---

fix(meta): a second unpinned draft save of a package-owned item is no longer refused 409, and the item read serves that draft's `version`

Clause-②: no

- **The second draft save is accepted.** Save an item into a package (`PUT /api/v1/meta/:type/:name?package=<id>`), then save a draft of it without `?package=` twice. The repository stores that draft in the item's package (the draft inheritance that keeps a pending change in the package it edits). The save door took its expected parent from the package-unbound draft row instead. It found none, so the second save, which sent no `If-Match`, was refused `409 METADATA_CONFLICT` ("Expected parent null but current is hmac-sha256:…"). ADR-0008 makes an unpinned save last-writer-wins, and it is accepted again.
- **One head row per write address.** `SysMetadataRepository.headAt(ref, { state, packageId })` answers the row a `put` at that address upserts, from the same resolution `put`'s optimistic lock runs. That resolution includes the draft inheritance and the adoption of a draft stored without a package. The save door's expected parent and the item read's `version` both come from it, so the token `GET /meta/:type/:name?state=draft` serves is the token a draft save at the same address accepts. Before this, that read served `version: null` while the inherited draft existed.
- **`?package=all` on the item read.** `GET /meta/:type/:name?package=all` now reads `all` as the save and publish doors read it: as naming no package. Before, the read forwarded the literal `all`. Its `version` was resolved at a package no save writes, so it served `null` beside a row the save then judged. Its `?state=draft` read answered `404 NO_DRAFT` for a draft stored in the item's package.
- **Descriptions only, in `@objectstack/spec`.** `SaveMetaItemRequestSchema.packageId` now states the draft inheritance, where it said "absent = env-local overlay". The `POST /meta/:type/:name/publish` route description spells the conflict code `METADATA_CONFLICT`, as the wire sends it.
- A stale `If-Match` is still refused `409`, and `If-None-Match: *` is still refused while a row exists. An item with no package binding is unchanged. No spec key, request field or response field is added or removed; `headAt` is the one new method, on the exported `SysMetadataRepository`.
