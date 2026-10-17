---
'@objectstack/cli': patch
'@objectstack/objectql': patch
---

Clause-②: no

fix(cli): `os migrate plan`, a refused `os migrate summary-nulls --recompute-undefined-on-empty` name and every `os secret rewrap` run say what they vouch for, and that opening a SQLite file can still switch its journal mode, instead of saying nothing was written

**What was wrong.** Each of these runs boots through the SQL driver before it prints, and the driver's connect switches a SQLite file to the journal mode it asks for (WAL, unless `OS_DATABASE_SQLITE_JOURNAL_MODE=delete` is set in the command's own environment or the project's `.env`). Measured on a file still on a rollback journal, each run moved the header's journal-mode bytes (18 and 19, from 1,1 to 2,2) and its change counter, and changed no row or table, while printing "a plan writes nothing", "nothing was written" or "a finished run writes nothing". Nothing was lost.

**What changed.** Each sentence below now names what it vouches for. On a SQLite file, its line is followed by the note the other read-only arms already carry: "Opening a SQLite file can still switch its journal mode (to WAL by default), which changes its header only." On PostgreSQL or MySQL the line ends without it.

- `os migrate plan`, the unmanaged-table section. FROM: "They are reported for information only — nothing here drops them, and a plan writes nothing." TO: "… and a plan writes no row or table." and the note.
- `os migrate plan`, the declaration boot's note when a plugin's write was refused. FROM: "Refused N write(s) during the declaration boot — a plan writes nothing: …" TO: "… — a plan writes no row or table: …", and the note at the end of that note's line.
- `os migrate plan`, the same note when a raw command was forwarded. FROM: "If those commands only read, nothing was written; if one wrote, it landed." TO: "If those commands only read, no row or table was written; if one wrote, it landed.", and the note at the end of that note's line.
- `os migrate summary-nulls --recompute-undefined-on-empty` naming a roll-up the run cannot find (`backfillSummaryNulls`, `@objectstack/objectql`), in either mode. FROM: "Refused before any row was read; nothing was written." TO: "Refused before the walk read or wrote any row." and the note. Under `--apply` the boot before it can also create a table a never-started database lacks, so the sentence speaks for the walk only.
- `os secret rewrap`, the "Re-running is safe" note, in both modes and in `--json` `report.notes`. FROM: "… and a finished run writes nothing." TO: "… and a finished run writes no sys_secret row." Under `--apply` the note follows it; a dry run's closing line already carries it. A finished `--apply` run on a database that has never been started also creates its tables, so the sentence names the rows the re-wrap writes.

**Unchanged.** No exit code, flag, prompt, refusal or export signature changes, and no `--json` document gains a field: the `--json` documents carry the changed sentences, and the note is printed in the text output only. What the driver does on connect is unchanged.
