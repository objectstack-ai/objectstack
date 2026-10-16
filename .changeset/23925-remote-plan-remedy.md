---
'@objectstack/cli': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

fix(cli,driver-turso): `os migrate plan` on a Turso REMOTE database no longer offers `--allow-destructive` for a change that database cannot apply

Clause-②: no

On a primary reached over the Turso REMOTE transport (`libsql://…`), `os migrate plan` listed a NOT NULL tightening with the remedy `Run "os migrate apply --allow-destructive".` and closed with `(add --allow-destructive for drops / tightenings)`. That transport runs no SQLite table rebuild, so the apply then named the tightening as not applied and exited 1. The plan now says so before the apply: each change the database cannot apply (a tightened or relaxed NOT NULL, a dropped DEFAULT) is still listed, with its finding and `"os migrate apply" cannot apply it on this database: it needs the SQLite table rebuild, which the Turso REMOTE transport does not run.` in place of the remedy. The footer offers `--allow-destructive` only for the destructive changes the database can apply (a column drop, an index change) and says how many listed changes remain drift after the apply.

The plan reads this from the driver that reported each change, never from the dialect: `TursoDriver.driftApplyLimit(opType)` answers it, from the same declaration the REMOTE apply door dispatches by, and `driftFindingWithoutRemedy(entry)` (`@objectstack/driver-sql`) gives a finding without its `--allow-destructive` sentence. On every other database the plan reads exactly as before, and the `--json` document is unchanged on every database.
