---
'@objectstack/cli': patch
'@objectstack/driver-sql': minor
'@objectstack/driver-turso': minor
---

fix(cli,driver-turso): `os migrate plan` and `os migrate apply` on a Turso REMOTE database no longer offer `--allow-destructive` for a change that database cannot apply

Clause-②: yes (widening)

On a primary reached over the Turso REMOTE transport (`libsql://…`), `os migrate plan` listed a NOT NULL tightening with the remedy `Run "os migrate apply --allow-destructive".` and closed with `(add --allow-destructive for drops / tightenings)`. That transport runs no SQLite table rebuild, so the apply then named the tightening as not applied and exited 1. The plan now says so before the apply: each change the database cannot apply (a tightened or relaxed NOT NULL, a dropped DEFAULT) is still listed, with its finding and `"os migrate apply" cannot apply it on this database: it needs the SQLite table rebuild, which the Turso REMOTE transport does not run.` in place of the remedy. The footer offers `--allow-destructive` only for the destructive changes the database can apply (a column drop, an index change) and says how many listed changes remain drift after the apply. The listing `os migrate apply` prints before its prompt reads the same way. Its count of held-back destructive changes offers a re-run with `--allow-destructive` only for the ones that re-run could apply, and names the rest as drift it cannot apply either. On every other database both commands read exactly as before, and their `--json` documents are unchanged on every database.

`@objectstack/driver-turso`: `TursoDriver.driftApplyLimit(opType)` is new. It returns why the driver's `applyMigrationEntries` cannot perform a drift op of that type on this face, or `null` when it can. It answers from the same per-op declaration the REMOTE apply door dispatches by, and returns `null` for every op on the local and embedded-replica faces. A driver that does not implement it is read as applying every op the differ means it to.

`@objectstack/driver-sql`: `driftFindingWithoutRemedy(entry)` is a new export. It returns a drift entry's finding without the `os migrate apply --allow-destructive` sentence that a destructive column entry's message ends with, and returns every other message unchanged; the messages themselves keep their exact text.
