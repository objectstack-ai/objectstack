---
'@objectstack/core': minor
---

feat(core): the bulk-import runner, its row coercion, the mapping apply and the field-meta map now live in `@objectstack/core`, beside `bulkWrite` (#20919)

`runImport` (with `sanitizeRowError` and its option/result types), the cell
coercion (`coerceRow`, `coerceFieldValue`, `parseDateCell`, `parseNumberCell`,
`parseBooleanCell`, `matchOption`, `splitMulti`, `isBlank`), the `mapping`
artifact pipeline (`applyMappingToRows`, `refuseUnknownMappingTargets`,
`MappingArtifactLike`, `MappingFailure`, `ApplyMappingOptions`) and the field
metadata map (`buildFieldMetaMap`, `ExportFieldMeta`) are exported from
`@objectstack/core`. They moved here unchanged from `@objectstack/rest` so the
connector sync executor in `@objectstack/service-automation` writes through the
same runner as the HTTP import door without depending on the HTTP layer. Nothing
to change for consumers: `@objectstack/rest` re-exports every name it exported
before.
