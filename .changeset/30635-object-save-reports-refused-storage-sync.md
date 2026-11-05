---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an object save or publish whose storage sync the datasource refuses now says so on its answer

Clause-②: no
Metadata-protocol: none

`PUT /api/v1/meta/object/NAME` (a publish-mode save) and `POST /api/v1/meta/object/NAME/publish` sync the object's table after the item is written. When the datasource refused that sync, both answered `200` success with nothing about storage, and only the server log said the table was not created or altered. Both answers now carry one `warning` on their existing `advisories` key, with the rule id `object-storage-sync-refused`, naming the object and saying its storage did not follow. The datasource's own text is quoted when it declared a client refusal (a 4xx status); otherwise the advisory says the reason is in the server log, which keeps the `error` line it already printed. The status code and every other key are unchanged, the publish is still not failed, and an answer whose sync ran has no new key.

A client that groups or suppresses advisories by rule id sees one new id. The package-draft batch publish (`POST /api/v1/packages/:id/publish-drafts`) still reports a refused sync in the server log only.
