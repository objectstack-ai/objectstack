---
'@objectstack/spec': patch
---

docs(spec): a promoted bulk action's lookup param carries its field's picker settings, and the spec now says so

Clause-②: no
Metadata-protocol: none

A promoted bulk action's field-backed lookup param now brings the field's `lookupFilters`, `lookupColumns`, `lookupPageSize` and `descriptionField` to the selection bar's picker, the same as the single-record dialog. The text that still said those four are dropped on the bulk path is corrected: the `bulkActionDefs[].params[]` refusal for the widget-config keys, and the upgrade guidance of the `ui-bulk-action-param-unknown-keys-refused` migration entry. Both now name `accept`, `maxSize` and those four as the keys that reach the bulk dialog when declared on the field. `idField` and `titleFormat` still do not travel. The accepted keys do not change.
