---
'@objectstack/spec': minor
'@object-ui/core': minor
'@object-ui/plugin-grid': minor
'@object-ui/plugin-list': minor
'@object-ui/plugin-report': minor
'@objectstack/platform-objects': patch
---

feat: an object's `userActions.exportCsv: false` hides the console's Export entry

Clause-②: yes
Metadata-protocol: semantic

`userActions.exportCsv` on an object now does what the Studio object form says it does. Set to `false`, the console offers no Export entry for downloading that object's data, in any of its formats (CSV, XLSX, JSON):

- the object grid hides its toolbar Export menu, and the table's own CSV button that `operations.export: true` turns on;
- the list view hides Export in both toolbar forms, the wide toolbar's button and the Display panel's export footer;
- a dataset report hides its Export control when the dataset's base object sets it.

A view's export of the picture it draws is not covered: a Gantt view's PNG and PDF buttons stay.

Every surface reads one verdict, the new `isObjectExportOffered(objectSchema, effectiveApiOperations)` from `@object-ui/core`: the authored `exportCsv` over the object's `managedBy` default, ANDed with the caller's effective `export` API operation. Before this change the grid's toolbar menu, the list view and the report read the effective operation but not the object's bit, and the grid's table CSV button read neither half (only `operations.export`), so `exportCsv: false` changed nothing. Export is a read, so the verdict is not a row of `AFFORDANCE_GRANTS` and asks no `can(object, verb)`: the caller's export grant reaches the console through the effective `export` operation, which the server derives from `list` and `allowExport`.

An object that does not author the key keeps its Export entries, since every `managedBy` bucket still defaults `exportCsv` to `true` (ADR-0103), with one change: the grid's table CSV button (`operations.export: true`) now also follows the effective `export` operation, as the toolbar menu beside it already did. So a viewer whose effective operations exclude `export` no longer sees that button, even on an object that authors nothing. The setting hides the entry and is not a permission: no export request is refused because of it, and who may export is still the permission set's `allowExport`. The report reads the base object's definition through the report's data source, and a report whose source cannot serve one keeps its Export control.

The spec's `exportCsv` description and the Studio form's help text now say this; the form's English help text bundle in `@objectstack/platform-objects` is regenerated to match, and the translated locales keep their wording. The liveness ledger grades `userActions.exportCsv` `live`, so an authored `exportCsv: true` no longer raises the `liveness-dead-property` warning at `os lint` / `os validate`. Nothing needs migrating.
