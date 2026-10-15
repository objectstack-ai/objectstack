---
'@objectstack/cli': patch
---

fix(cli): the read-only `os migrate` arms say they write no row or table, and that opening a SQLite file can still switch its journal mode, instead of saying they write nothing

**What was wrong.** These arms boot read-only: no DDL, no seed, SELECT statements only. But the boot still opens the database through the SQL driver, and the driver's connect switches a SQLite file to the journal mode it asks for: WAL, unless `OS_DATABASE_SQLITE_JOURNAL_MODE=delete` is set in the command's own environment or the project's `.env` (then a WAL file is switched back to a rollback journal). On a file still on a rollback journal, a plan or a dry run therefore rewrote the file's header (the journal-mode bytes and the change counter) while saying "writes nothing" or "nothing in the database was changed". No row or table changed, and nothing was lost.

**What changed.** Each sentence below now claims no row or table, and is followed by one shared note: "Opening a SQLite file can still switch its journal mode (to WAL by default), which changes its header only."

- `os migrate organization-ownership` (the plan), beside a process holding the file. FROM: "The plan below writes nothing, but --apply will refuse until the database is free." This sentence has not been published: it arrives in this same release, with the occupancy gate the ceremony's `--apply` now takes. TO: "The plan below writes no row or table, but --apply will refuse until the database is free." and the note.
- Its closing line. FROM: "Plan written to FILE — nothing in the database was changed." TO: "Plan written to FILE — no row or table in the database was changed." On a SQLite target the note follows; on PostgreSQL or MySQL the line ends there.
- `os migrate plan`, beside a holder. FROM: "The plan below is still accurate — nothing is written — but "os migrate apply" will refuse until it is free (or you pass --force)." TO: "The plan below is still accurate — it writes no row or table — but …", the rest unchanged, and the note.
- The dry runs of `os migrate audit-metadata-bodies`, `comment-reactions`, `files-to-references` and `summary-nulls`, beside a holder. FROM: "The dry run below writes nothing, but its counts may shift while that process is running." TO: "The dry run below writes no row or table, but its counts may shift while that process is running." and the note.
- The dry run of `os migrate multi-value-columns`, beside a holder. FROM: "The dry run below writes nothing." TO: "The dry run below writes no row or table." and the note.
- The preview of `os migrate meta --stored`, beside a holder. FROM: "The preview below writes nothing, but a live process may be saving metadata while it runs." TO: "The preview below writes no row or table, but a live process may be saving metadata while it runs." and the note.

**Unchanged.** No exit code, `--json` document or refusal changes; the warnings are still printed in the text output only. What the driver does on connect is unchanged: once a file is in the mode the driver asks for, a read-only run leaves it byte-identical.
