---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): the compliance ledger keeps no copy of secret-store key material

Clause-②: no
Metadata-protocol: none

The audit writer copies each audited row into `sys_audit_log` (`new_value` / `old_value`) and into `sys_activity.metadata`. For the secret store and the two settings holders, that copy carried the encrypted key-material column. Every new copy now omits those columns, the way a field declared `internal` is omitted:

- **What is still recorded.** Each create, update and delete of those rows keeps its ledger and activity row: which record, its producer-scoped label, key id, algorithm and version, who changed it and when. A write that changes only the key material still records its row, with the material on neither side.
- **Which columns.** The list is closed, held by the writer (`KEY_MATERIAL_COPY_COLUMNS`), and keyed by the platform-object definitions' own names. A column of the same name on any other object is recorded as before.
- **Copies already written.** `migrateKeyMaterialCopies(engine, logger, { apply })` and `migrateArchivedKeyMaterialCopies(driver, logger, { apply })` remove the columns from copies stored before this release, in the hot `sys_audit_log` / `sys_activity` tables and in an archive datasource. Both runs are dry by default, idempotent, change only the copy column, and keep each row's stored `updated_at`. Their reports hold counts only. The pure planners `planKeyMaterialAuditRowPatch` and `planKeyMaterialActivityRowPatch` are exported with them.
