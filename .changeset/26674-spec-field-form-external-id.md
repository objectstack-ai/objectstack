---
'@objectstack/spec': patch
---

fix(spec): the field metadata form no longer offers `externalId`

Clause-②: no
Metadata-protocol: none

`field.externalId` is graded `dead`: no upsert, import or seed matches on it. The field form's Advanced section still offered it with the help text "Mark as external ID for upsert operations", so an author who switched it on for an import key got duplicates on re-import and an `os lint` warning on the flag the form had offered. The row is removed from `fieldForm`. The key itself is unchanged: `FieldSchema` still parses `externalId`, and a field that carries it stays valid metadata. To match records on a field, name it in a seed dataset's `externalId` or in an import mapping's `upsertKey`.
