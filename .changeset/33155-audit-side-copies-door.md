---
'@objectstack/cli': patch
'@objectstack/plugin-audit': patch
---

feat(cli): `os migrate audit-side-copies` runs the at-rest side-copy rewrite on the live audit tables and the archive

Clause-②: yes (widening)
Metadata-protocol: none

**Run `os migrate audit-side-copies` once after upgrading from 18.4.0 or earlier, a dry run first:**

```bash
os migrate audit-side-copies                         # dry run: counts per table and store, writes no row
os migrate audit-side-copies --object sys_audit_log  # only one copy table (repeatable)
os migrate audit-side-copies --apply                 # remove the columns (prompts; --yes skips the prompt)
os migrate audit-side-copies --apply --yes --json    # CI / scripts
```

The audit writer no longer copies a side-copy column (another record's field values, today an approval request's `payload_json`) into `sys_audit_log` (`new_value`, `old_value`) or `sys_activity` (both halves of `metadata`). Copies written before that still carry it. Until they are rewritten, the read-time redaction drops the column and the query guard treats a query naming it as reaching every object, so the command is cleanup, not a gate.

- **The command.** It drives `@objectstack/plugin-audit`'s `migrateSideCopies` (the live `sys_audit_log` and `sys_activity` rows) and `migrateArchivedSideCopies` (the archive datasource `sys_audit_log` archives to). It is a dry run by default and writes only with `--apply`. Its flags are `os migrate audit-key-material`'s (`--database-url`, `--apply`, `--yes`, `--force`, `--json`) plus `--object`, which takes `sys_audit_log` or `sys_activity` and narrows the run, hot and archive, to the tables it names. Any other name is refused with `OBJECT_NOT_FOUND`, exit 1, before anything is read. The report gives, per copy table, the copies read and the copies rewritten (or to rewrite), for the hot tables and for the archive each, and never prints a value. It is idempotent: a second `--apply` rewrites nothing. A failed read or write, a sealed row it had to refuse, or an archive it could not reach exits 1, as for its twins.
- **The rewrite's name (`@objectstack/plugin-audit`).** A sealed row the rewrite amends (ADR-0154 D7) now records `rewritten_by: 'os migrate audit-side-copies'`, the command that rewrote it, as `audit-mail-bodies`, `audit-key-material` and `audit-metadata-bodies` record theirs. It recorded `side-copy-migration` before; a row amended under that name keeps it.
