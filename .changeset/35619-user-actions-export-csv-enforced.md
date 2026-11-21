---
'@objectstack/spec': minor
'@object-ui/plugin-grid': minor
'@object-ui/plugin-list': minor
'@object-ui/plugin-report': minor
---

feat: an object's `userActions.exportCsv: false` hides the console's Export entry

Clause-②: no
Metadata-protocol: semantic

`userActions.exportCsv` on an object now does what the Studio object form says it does. Set to `false`, the console offers no Export entry for that object's records, in any format:

- the object grid hides its toolbar Export menu, and the table's own CSV button that `operations.export: true` turns on;
- the list view hides Export in both toolbar forms, the wide toolbar's button and the Display panel's export footer;
- a dataset report hides its Export control when the dataset's base object sets it.

Every surface reads one verdict, `resolveEffectiveCrudAffordances(objectSchema, effectiveApiOperations).exportCsv` from `@object-ui/core`: the authored `exportCsv` over the object's `managedBy` default, ANDed with the caller's effective `export` API operation. Before this change the surfaces read only the effective operation, so `exportCsv: false` changed nothing.

Nothing changes for an object that does not author the key: every `managedBy` bucket still defaults `exportCsv` to `true` (ADR-0103), so its Export entry stays. The setting hides the entry and is not a permission: no export request is refused because of it, and who may export is still the permission set's `allowExport`. The report reads the base object's definition through the report's data source, and a report whose source cannot serve one keeps its Export control.

The spec's `exportCsv` description and the Studio form's help text now say this. The liveness ledger grades `userActions.exportCsv` `live`, so an authored `exportCsv: true` no longer raises the `liveness-dead-property` warning at `os lint` / `os validate`. Nothing needs migrating.
