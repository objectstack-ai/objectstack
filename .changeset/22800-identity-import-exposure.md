---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the identity import asks each lookup target its declared exposure before matching a cell, like every other `runImport` caller (#22800)

Clause-②: no

The identity import (`runAdminImportUsers`) parses its payload with `prepareImportRequest` and runs its rows through `runImport`, with a run protocol of its own that writes through better-auth. Its `sys_user` field map, which decides which cells are references, is read through the import's declaration reader (`IdentityImportDeps.getMetaItem`).

**FROM.** The run protocol was built without that reader, so `runImport`'s `servesReferenceTarget` answered "served" without asking: a lookup cell was matched against its TARGET object even when the target's declaration refuses `list` (`enable.apiEnabled: false`, or an `apiMethods` whitelist without `list`). A cell naming an existing record resolved and a cell naming none answered `reference_not_found`, so the row report told the two apart.

**TO.** The run protocol carries the same reader the parser is handed (one binding, so whenever a cell is a reference its target is judged). A target the spec's decision (`canServeApiOperation`, for `list`) does not serve answers every cell, naming a record or not, a pasted id included, `reference_not_found`, and nothing of the target is read. A target with no `enable` block, or a whitelist that grants `list`, resolves exactly as before. The decision takes no caller, so the system identity the import's reads run under is answered like any other caller. No new error code, no status change.

**Measured producers.** `sys_user` declares two lookups: `manager_id` into `sys_user` (the import strips that column before `runImport`; its own second pass links managers) and `primary_business_unit_id` into `sys_business_unit`. Both targets serve `list`, and the registry injects no columns into `sys_user` (`managedBy: 'better-auth'`), so no shipped import answer changes. Deployed object extensions of `sys_user` were NOT MEASURED.

**Fix, if an import relied on the old answer:** the target's own declaration decides. Grant `list` in its `enable.apiMethods`, or drop `enable.apiEnabled: false`, if the object is meant to be matched by import.
