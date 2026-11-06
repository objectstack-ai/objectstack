---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): the Setup → Audit Log drawer opens the selected row's own record page, which lists the other changes to the same record

Clause-②: yes (widening) — two new console keys (`console.system.auditLog.openEntryPage`, `console.system.auditLog.openEntryPageHint`) ship in every published `@object-ui/i18n` pack; nothing is narrowed.
Metadata-protocol: none

The Audit Log drawer gains an "Open entry page" link to the console's record route for `sys_audit_log` and the row's id, under the app the page is mounted in, carrying the way back to the Audit Log. The platform's record page for the ledger lists every row with the same `record_id`, so from a settings write's `config_change` row, which carries only a digest, an administrator now reaches the CRUD mirror's rows that hold the old and new value. On a row that names a record the drawer says so under the link. `@object-ui/i18n` ships the two strings in all ten built-in languages (`console.system.auditLog.openEntryPage`, `console.system.auditLog.openEntryPageHint`).
