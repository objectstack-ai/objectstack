---
'@objectstack/cli': minor
---

fix(cli)!: `os migrate organization-ownership --apply` refuses to run beside a process holding the SQLite database open, as its sibling migrate commands do, and the plan warns

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is rewritten, converted or deleted, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one CLI invocation: the ceremony's --apply run against a SQLite file another process holds open is refused before the database is opened; the remedy is stopping that process, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

**FROM.** `os migrate organization-ownership --apply` opened a SQLite database that another process held open (a running `os dev` or `os serve`, or a runtime's pooled connection) without checking for it, and ran the ceremony beside that process. `os migrate apply` and the other data migrations probe the database first; this command did not. One measured run of the plan and then `--apply` beside a runtime holding a connection left that runtime writing to a deleted `-wal` file, and a row it wrote afterwards never reached the database.

**TO.** Before it boots the stack, the command probes the database the way its siblings do. Beside a holder, `--apply` is refused with exit 1: the ceremony boots nothing and writes nothing (the probe itself opens the file only briefly, to check). The check runs first, so a busy `--apply` that also lacks its plan file or its backup acknowledgement answers reason `database-busy` rather than `plan-file-required` or `backup-unacknowledged`; it is refused either way. The text output names the file and, when the probe can tell, the process holding it, then the remedy: stop the process using it and re-run. With `--json` the refusal uses this command's own envelope: `{ "error": "apply_refused", "reason": "database-busy", "database", "signal", "detail", "hint" }`. There is no `--force`: the ceremony has no flag that skips its reviewed plan or its backup either, and its refusal never names one. The plan (no `--apply`) writes no row or table, so it still runs. Its text output warns that `--apply` will refuse until the database is free, and its `--json` document is unchanged.

**Unchanged.** A PostgreSQL, MySQL or remote libSQL target is not probed. A probe that cannot tell (for example, the database file cannot be read) warns in the text output and proceeds; under `--json` it is silent. The probe reads the project's `.env` files, as the run itself does.

**Remedy.** Stop the process that holds the database file, then re-run `--apply`.
