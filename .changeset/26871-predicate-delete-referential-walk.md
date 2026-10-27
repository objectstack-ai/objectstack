---
'@objectstack/objectql': patch
---

fix(objectql)!: a predicate delete (`multi: true` with a filter) honours `deleteBehavior` for every row it matches: a `restrict` refuses, a `master_detail` cascades, a `set_null` clears (#26871)

Clause-②: no (narrowing) — a predicate delete (`engine.delete(object, { where, multi: true })`, which a flow's `delete_record` node with `multi: true` and a filter reaches) refuses with 409 `DELETE_RESTRICTED` where it succeeded: when a row it matches is held by a `restrict` reference (authored, or a required lookup's `set_null`, which is refused as `restrict`). Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a declared deleteBehavior is now honoured on the predicate delete path too. The refusal is the existing DELETE_RESTRICTED, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the predicate delete (`@objectstack/objectql`), served by every caller of `delete` with `multi: true` and a filter, the flow `delete_record` node among them.

- **Before.** A predicate delete went straight to the driver's bulk delete and ran no referential walk. No `restrict` refused it, the matched rows' `master_detail` children were left behind, and `set_null` lookups kept pointing at deleted rows. The same rows deleted one at a time by id (`DELETE /api/v1/data/:object/:id`, the bulk `deleteManyData` door) refused or cascaded.
- **Now.** When any relation of the delete family (`master_detail`, `lookup`, `tree`) points at the object, the predicate delete reads the rows it matches under the caller's scope, runs the by-id delete's referential walk for each, and then deletes exactly those rows, all in one unit of work on a single datasource. A `restrict` on any matched row refuses the whole delete with the existing `409 DELETE_RESTRICTED`, and nothing is deleted; `master_detail` children (and every `cascade`) are deleted; `set_null` references are cleared. The answer is still the count of rows the delete removed.
- **Unchanged.** An object no relation points at keeps the single bulk delete: no row is read and no transaction is opened. A cascade that reaches another datasource runs without a transaction and warns once, as the by-id delete does. A predicate delete of `sys_organization` is still refused.
- **Who sees it.** A flow (or in-process caller) that bulk-deletes rows held by a `restrict` reference now fails instead of deleting them; one that bulk-deletes masters now deletes their details and clears their lookups instead of leaving them dangling.

**The remedy.** Delete or reassign the restricting rows first, then run the bulk delete. If the referencing rows are meant to go with the rows deleted, declare `deleteBehavior: 'cascade'` on that reference.
