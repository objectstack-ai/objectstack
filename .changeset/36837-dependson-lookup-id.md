---
'@object-ui/fields': patch
---

fix(fields): a dependent lookup filters by its parent's id when the parent arrives populated

Clause-②: no
Metadata-protocol: none

A lookup with `dependsOn` naming another lookup now scopes its candidates by that parent's id when the record holds the parent as a populated row, as a record page does. Before, the filter carried the stringified object (`"[object Object]"`), so the picker on a record page — for example a quote's contact, scoped by the quote's account — always answered "No options found". The quick-select list, the full picker, the people picker and the create-new seed all use the same filter, so all four are fixed. A parent held as a bare id is unchanged.
