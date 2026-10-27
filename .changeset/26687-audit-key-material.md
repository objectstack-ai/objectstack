---
'@objectstack/cli': patch
---

feat(cli): `os migrate audit-key-material` removes the encrypted key-material columns from the audit-ledger copies 18.2.0 and earlier wrote

Clause-②: no
Metadata-protocol: none

**Run `os migrate audit-key-material --apply` once after upgrading from 18.2.0 or earlier.** The audit writer no longer copies the encrypted key-material column of a secret-store or settings row into `sys_audit_log` (`new_value`, `old_value`) or `sys_activity` (both halves of `metadata`). Copies written before that still carry it.

- **The command.** `os migrate audit-key-material` removes those columns with the writer's own helper, through `@objectstack/plugin-audit`'s `migrateKeyMaterialCopies` (the hot tables) and `migrateArchivedKeyMaterialCopies` (the archive datasource `sys_audit_log` archives to). It is a dry run by default (counts, writes no row), `--apply` writes, and its flags are `os migrate audit-mail-bodies`'s, one for one (`--database-url`, `--apply`, `--yes`, `--force`, `--json`). The report is counts only, per table, and never prints a value.
- **What changes in a row.** Only the key-material keys of the copy are removed. Every other key of the copy and every other column of the row stay byte-identical, the row's `updated_at` included. A column of the same name in a copy of any other object is left alone.
- **Idempotent.** A copy without the columns has nothing to remove, so a second run rewrites nothing; re-running finishes an interrupted run. A failed read or write exits `1`, and so does an archive datasource the run could not examine (`not-connected` / `unknown` in the `--json` document's `archive` entries, as for `audit-mail-bodies`).
