---
"@objectstack/cli": patch
"@objectstack/runtime": patch
---

`os migrate resume`, `os migrate recorded-by` and `os migrate value-shapes` answer a project whose database does not exist yet with empty work and exit 0, instead of exiting 1 with "The database refused to run this query" (#21529)

Clause-②: no

Each of these commands boots read-only by default: the schema sync is held back, and a missing SQLite file is opened as an empty in-memory stand-in. That boot already measures which tables the database lacks, because the held-back sync lists each one as a table to create. Each command then read the very tables it had just found missing. On a never-booted database (or a `--database-url` that points at one), every default run failed:

- `os migrate resume` exited 1, naming `sys_migration_journal`;
- `os migrate recorded-by` exited 1, naming `sys_metadata_history`;
- `os migrate value-shapes` reported every scanned object as unreadable, kept the gate closed and exited 1, over data that does not exist.

Each command now reads only the tables its boot found present. A table that does not exist holds nothing, so:

- `os migrate resume` lists no interrupted runs (`{"interrupted": [], "count": 0}`), exit 0;
- `os migrate recorded-by` reports `pending: 0`, nothing to convert, exit 0;
- `os migrate value-shapes` completes a clean scan of zero records, exit 0, and names the objects it did not read because they have no table yet (on stderr under `--json`).

Human mode says the table is not there yet, instead of implying the command looked through one. `--json` documents have the same shape as on a booted database with nothing to do. The write modes (`--run`, `--apply`) are unchanged: they boot with the schema sync, so their tables exist before they read.

`MigrationRecoveryPlugin` (`@objectstack/runtime`), which every one of these boots composes, scans the migration journal at boot. On such a database it logged "Migration journal scan failed; interrupted migrations (if any) were NOT detected" on every run. It now treats a missing journal table as "no runs" and says nothing. It recognises that case only with the shared `isMissingTableError` predicate, asked about `sys_migration_journal` itself. Any other failure of the scan still warns.

There is nothing to migrate.
