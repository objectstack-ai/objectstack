---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(metadata): two Studio Saves over one published item are no longer last-writer-wins

Clause-②: yes (widening) — two new optional members join what the API accepts and answers: `PublishMetaItemRequestSchema.parentVersion` (the `If-Match` / `If-None-Match: *` pin on `POST /meta/:type/:name/publish`) and `GetMetaItemLayeredResponseSchema.overlayVersion` (served on `GET /meta/:type/:name/layers`); nothing is removed or narrowed, and a publish that names no version behaves as before
Metadata-protocol: added

A Studio Save writes the item's draft and then publishes that one item, so it leaves no draft behind. Two admins who opened the same object with no pending draft both asserted "no draft" on their draft save, and the later Save published over the earlier one without a word: the published layer served no version a Save could pin.

- `GET /meta/:type/:name/layers` now answers `overlayVersion`: the version token of the stored active row at the read's address (`?package=`), the same keyed token the plain uncached read serves as `version` and a publish receipt serves as `version`; `null` when no active row is stored there.
- `POST /meta/:type/:name/publish` takes that token as `If-Match` (or `If-None-Match: *`, "no active row here"). A token that is not the current active row's is refused `409 METADATA_CONFLICT` with the current token as `currentVersion`, and nothing is promoted: the draft stays pending. The headers are read as the save door reads them, so `If-Match` beside `If-None-Match`, or an `If-None-Match` other than `*`, is refused `400 VALIDATION_ERROR`. A publish with neither header is unpinned, as before. The pin is checked by the store's own lock on the promoting write, not by a separate earlier read.
- `MetadataClient.publish` (`@object-ui/data-objectstack`) takes `ifMatch` / `ifNoneMatch`, sent as those headers.
- Studio's object page pins its Save's publish to the published row it was loaded at. When another editor published since, the Save shows the reload-or-overwrite dialog the draft conflict shows, worded for a live change: reload takes back the draft the Save wrote and re-reads the live object, overwrite (after a confirmation) publishes over the version the refusal names, and keep editing leaves the edits on the page, unsaved. New locale keys in the studio catalogue (en, zh): `engine.draftConflict.publishedTitle`, `engine.draftConflict.publishedDescription`, `engine.draftConflict.publishedOverwriteTitle`, `engine.draftConflict.publishedOverwriteDescription`.

The two members enter the authorable-surface ratchet (`api/GetMetaItemLayeredResponse:overlayVersion`, `api/PublishMetaItemRequest:parentVersion`), so `@objectstack/spec` takes `minor`; the other packages stay `patch`.

Nothing to migrate: a client that sends no version is unaffected.
