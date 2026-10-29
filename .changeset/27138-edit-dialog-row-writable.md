---
'@object-ui/types': patch
'@object-ui/permissions': patch
'@object-ui/plugin-form': patch
'@object-ui/i18n': patch
---

fix(plugin-form): the record edit dialog draws a record the caller may read but not write as read-only, says why, and offers no Save

Clause-②: no
Metadata-protocol: none

On a record shared to the caller for reading only (sharing, ownership or row-level security), or held by a pending approval that locks it, the console's edit dialog used to open with every field live; the user filled it in and the server refused the save as a whole. The dialog now asks the server about the row itself:

- **The row's verdict.** `RecordFieldAccess` (`@object-ui/types`) carries the record projection's `writable`, which `DataSource.getRecordFieldAccess` already passes through. Below `RecordFieldAccessScope` (`@object-ui/permissions`), `writable: false` refuses `write` on every field of the record and `check(object, 'update')` with the reason `record-not-writable`; `read`, `create`, other objects and other records keep the enclosing answer, and an object grant the provider already refuses keeps its own reason. `writable: true` and an absent `writable` (an older server) change nothing.
- **The approval lock.** The projection leaves out the approvals record lock, which the server judges on the values a save sends. `RecordFieldAccessScope` takes `lockedBy: 'approval'` for a lock the host reads, answered the same way with the reason `record-locked-by-approval`, and `ModalForm` takes the same `lockedBy` prop. The console's edit dialog passes it from the approvals read and rule the record page uses.
- **What the form draws.** Every field gate (`gateFormFields`, the outbound write gate, the record page's inline edit) reads the scoped answer with no call-site change. `closedFormAffordance` reports `record` or `approval` for such a row, the form's notice says "You don't have permission to edit this record. The fields are read-only." (new key `form.noPermissionToEditRecord` in every pack) or the record page's approval-lock sentence, and `ModalForm` and `DrawerForm` offer no Save on it.
