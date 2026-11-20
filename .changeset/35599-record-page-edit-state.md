---
'@objectstack/plugin-approvals': patch
'@object-ui/plugin-form': patch
'@object-ui/i18n': patch
---

feat: edit a record and its line tables together, and lock a record's lines while an approval locks the record

Clause-②: no
Metadata-protocol: none

**A locked record's lines are locked too.** While a record is held by an approval that locks it, writes to its master-detail child rows are refused with `RECORD_LOCKED` (409), the same answer a write to the record itself gets: inserting a row under it, updating or deleting one of its rows, and moving a row into it or out of it (both ends of a reparent are checked). A multi-row write that touches any such row is refused as a whole, and a row whose parent cannot be read is refused when the parent object has a locking approval the writer's run does not own. The approval's own exemptions carry over: system writes and the flow run that opened the approval still write. The refusal names the record by its object's label ("This Opportunity is locked while an approval is in progress, …"). Lookup children are not affected. `@objectstack/plugin-approvals` binds the new `bindDetailRowLockHook` beside the record lock it already binds.

**`@object-ui/plugin-form` exports the record-page body-table editor.** `RecordBodyTableEditor` draws a master-detail body table as editable lines (the `LineItemsField` grid, with the child columns, field permissions and add / remove rules the master-detail form uses) for a host's edit session (`RecordEditSessionContext`). `buildRecordEditBatch` folds a record's field changes and every table's lines into one batch (the `buildMasterDetailEditBatch` diff, table by table), and `attributeRecordEditRefusal` places a refused batch's reasons on the record's field or on the line whose write carried the refused field.

**`@object-ui/i18n`** adds `detail.bodyTableRow` and `detail.bodyTablesReadOnlyBulk` to every built-in pack.

In the console, Edit on a record page that draws master-detail body tables now opens the page's edit state: the fields become inputs, the body tables editable lines, and one Save writes all of it in one batch. Those pages no longer offer per-field inline edit outside the edit state.
