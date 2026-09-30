---
'@objectstack/spec': patch
---

Four conversion summaries now state their decision in words instead of citing a tracker number

Clause-②: no

The `summary` of four ADR-0087 conversions (`datasource-driver-mongo-to-mongodb`,
`translation-component-submit-label-removed`, `mapping-lookup-params-removed` and
`connector-error-mapping-removed`) cited a GitHub issue that no longer exists. That
text is what `os migrate meta`, `spec-changes.json` and the protocol upgrade guide show
an author, so each now says what was decided and why: one driver id for driver and
config contract, retire rather than re-anchor `submitLabel`, remove rather than
implement the import lookup params, and delete `errorMapping` to end its `userMessage`
collision without a rename. Wording only: no conversion id, surface, retirement state,
transform, schema, export or runtime behaviour changes.
