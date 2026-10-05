---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/service-datasource': patch
---

fix(service-datasource): a destructive re-import's refusal names the remedies that work from the import route, instead of a `?force=true` that route never reads (#21841)

Clause-②: yes (widening)

- **What was wrong.** "Import as Object" (`POST /api/v1/datasources/:name/external/tables/:remote/import`) saves through the metadata door's own `saveMetaItem`. A re-import that would drop or retype a field the stored object still carries is refused by that save's destructive-change gate, and the import route relays the refusal as `400 EXTERNAL_IMPORT_ERROR`. The refusal ended `re-submit with ?force=true to proceed.` The import route reads no `force`, so a caller who did exactly that got the identical refusal back.
- **What the refusal says now.** The import states its own write face, and the refusal ends: this import cannot be forced, because the external-table import route accepts no `force`. Import the table under a new `name`, or save the changed definition through `PUT /api/v1/meta/object/:name?force=true`, which accepts the destructive change on purpose. Both remedies are measured on the showcase: each one answers `201` or `200` where the re-import answered `400`. The same words appear in this package's earlier changeset for the import.
- **What widens.** `SaveMetaItemRequestSchema.writeFace` (`@objectstack/spec`) and `saveMetaItem`'s `writeFace` parameter (`@objectstack/metadata-protocol`) gain one member, `'external-import'`. The member is stated by the server. No door reads it from a request body, and the import's own options cannot carry it, or a `force`, into the save. Nothing accepted today is refused.
- **What does not change.** The refusal itself stays: a destructive re-import is still `400 EXTERNAL_IMPORT_ERROR`, and the stored definition does not move. The import route gains no `force`. Acknowledging a destructive change stays on the metadata door. The other faces' wording is unchanged. A `422 INVALID_METADATA` relayed by the import keeps its full findings in the message, because the import route's envelope carries no `issues`.
