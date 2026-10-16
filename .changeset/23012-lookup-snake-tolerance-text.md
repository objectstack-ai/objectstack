---
'@objectstack/spec': patch
---

Clause-②: no

The docblock above `FieldSchema`'s lookup picker keys no longer says that objectui reads
`lookupColumns`, `lookupPageSize` and `allowCreate` with a snake_case alias first. objectui
retired those reads (objectui#12157), so the picker reads all seven keys (`displayField`,
`descriptionField`, `lookupColumns`, `lookupPageSize`, `lookupFilters`, `dependsOn`,
`allowCreate`) in camelCase only. A stored definition that spells one of them in snake_case is
folded onto the declared key when the console ingests it. The `lookupColumns`, `lookupPageSize`
and `allowCreate` rows in `liveness/field.json` carry the same reading, dated and pinned to the
objectui commit it was taken on. No key, schema or accepted value changes.
