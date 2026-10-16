---
'@objectstack/cli': patch
'@objectstack/service-storage': patch
'@objectstack/objectql': patch
---

Clause-②: no

fix(cli): `os storage orphans`, the `os secret rewrap` dry run and the `os migrate summary-nulls` dry run say they write no row or table, and that opening a SQLite file can still switch its journal mode, instead of saying nothing was written

**What was wrong.** Each of these runs boots through the SQL driver before it prints, and the driver's connect switches a SQLite file to the journal mode it asks for (WAL, unless `OS_DATABASE_SQLITE_JOURNAL_MODE=delete` is set in the command's own environment or the project's `.env`). Measured on a file still on a rollback journal, each run moved the header's journal-mode bytes (18 and 19, from 1,1 to 2,2) and its change counter, and changed no row or table, while printing "nothing was written". Nothing was lost.

**What changed.** Each sentence below now claims no row or table. Where the run opened a SQLite file, the report's line is followed by the note the other read-only arms already carry: "Opening a SQLite file can still switch its journal mode (to WAL by default), which changes its header only." On PostgreSQL or MySQL the line ends without it.

- `os storage orphans` (`formatStrandedOrphanInventory`, `@objectstack/service-storage`). FROM: "This pass is READ-ONLY: nothing was written, tombstoned or deleted." TO: "This pass is READ-ONLY: no row or table was written, tombstoned or deleted." and the note.
- `os secret rewrap` (the dry run's note, `REWRAP_NOTES.dryRun`, also in `--json` `report.notes`). FROM: "Dry run: every attributed row was opened, re-sealed and verified in memory, and nothing was written. Re-run with --apply to write." TO: "… and no row or table was written. Re-run with --apply to write." The note already follows the dry run's closing line on a SQLite file, so this sentence carries none.
- `os migrate summary-nulls` (the dry run that found NULL roll-ups, `formatSummaryBackfillReport`, `@objectstack/objectql`). FROM: "Dry run — nothing was written. Re-run with --apply to backfill." TO: "Dry run — no row or table was written. Re-run with --apply to backfill." and the note.

**Unchanged.** No exit code, flag, prompt, refusal or export signature changes, and no `--json` document gains a field; the note is printed in the text output only. What the driver does on connect is unchanged: once a file is in the mode the driver asks for, these runs leave it byte-identical.
