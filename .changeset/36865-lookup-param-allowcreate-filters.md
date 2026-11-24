---
'@object-ui/core': patch
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(fields): an action's lookup param honours the borrowed field's `allowCreate: false`, and a record created in a filtered picker that fails the filters is not selected

Clause-②: yes (widening)
Metadata-protocol: none

- **A field-backed lookup param reads the field's `allowCreate`.** A param written `{ field, objectOverride }` already took the field's `lookupFilters`, `lookupColumns`, `lookupPageSize` and `descriptionField`, but not `allowCreate`. As a result, a field declaring `allowCreate: false` still showed "+ New" in an action's picker. `resolveActionParams` now copies it, app-shell's `paramToField` forwards it to the record-header dialog's picker, and the selection toolbar's dialog carries it through `resolvePromotedBulkParams`. Both the desktop popover and the phone drawer honour it. `@object-ui/core`'s `ActionParamDef` gains the optional `allowCreate` member it travels on. An author who writes `allowCreate` on a raw param is warned by name in development, like the other inherited picker keys: the spec's `ActionParamSchema` does not declare it.
- **A quick-created record is selected only if the picker could have offered it.** The create form accepts whatever the user enters, so the new record can fail the field's `lookupFilters`, for example a `draft` where the field asks for `approved`. The picker used to select it anyway, and the save or action that read the field then refused it. The picker now re-reads the new id through its own filter, the field's `lookupFilters` and `dependsOn` scope combined with the id. If the server does not return the record, it is not selected, and the picker reopens with the line `lookup.createdOutsideFilters` ("The record was created, but it does not match this field's filters, so it cannot be chosen here."), in every shipped locale. A picker with no filter selects the new record as before, without the extra read.
