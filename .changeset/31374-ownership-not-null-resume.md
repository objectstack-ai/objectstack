---
'@objectstack/cli': patch
---

fix(cli): the organization-ownership ceremony's not-null step runs again on a resumed apply, so a table it left nullable receives NOT NULL once that is possible

Clause-②: no
Metadata-protocol: none

`os migrate organization-ownership --apply` recorded its not-null step as done even when it left tables nullable: tables the booted composition declared no object for (`notDeclared`), and tables still holding a NULL row the operator had to resolve by hand. A later apply then read the checkpoint and skipped the step. Re-running under a composition that declares those tables, or after fixing the rows (apply, fix rows, plan, apply), certified the database with `organization_id` still nullable on them, although the step's own advice said such a re-run applies it.

On a resumed apply that has a schema door, the step now runs again. A table that is declared and has no NULL row receives NOT NULL. A column that is already NOT NULL is answered `already-not-null`, read from the database's catalog, and is never rebuilt. A re-run with nothing left to tighten stays `checkpointed`, exactly as before. A re-run whose NOT NULL fails blocks the run and is no longer recorded as done, the same as on a first run. A first run is unchanged.
