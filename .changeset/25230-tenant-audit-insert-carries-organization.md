---
'@objectstack/driver-sql': patch
---

fix(driver-sql): the `[tenant-audit]` warning no longer fires for an insert whose rows carry their organization

Clause-②: no
Metadata-protocol: none

A `create` or `bulkCreate` that reaches the SQL driver with no `options.tenantId` used to print `[tenant-audit] … without options.tenantId` even when every row already named its organization in its tenant column (`organization_id`). Such an insert is confined to the organizations its rows name, so the line had nothing to report. A walled boot (`OS_TENANCY_POSTURE=isolated`) printed one for every elevated seed insert: 32 of its 55 lines.

The line is now skipped when every inserted row carries a non-empty tenant column. It still fires for an insert where any row lacks the column, and for every `update`, `delete`, `updateMany`, `deleteMany`, `bulkDelete` and `upsert` with no `tenantId`, whatever the payload says: there the column is a value being written, not the statement's scope. The line's text and prefix are unchanged.

Diagnostics only: no write changes. Turso's local face and the SQLite WASM driver inherit the change; the in-memory and MongoDB drivers have no such warning.
