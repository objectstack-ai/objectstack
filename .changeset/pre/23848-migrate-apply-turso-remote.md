---
'@objectstack/cli': minor
'@objectstack/driver-turso': minor
---

fix(cli,driver-turso): `os migrate plan` and `os migrate apply` run on a Turso REMOTE database, and the apply names every drift entry it could not apply

Clause-②: yes

On a primary reached over the Turso REMOTE transport (`libsql://…`, every hosted tenant), `os migrate plan` and `os migrate apply` used to stop at their boot with `Deferred schema DDL is not supported by the Turso REMOTE transport`, so the remedy the drift report and the `OS_ARTIFACT_URL` boot gate print for destructive drift, `os migrate apply --allow-destructive`, could not run there at all. Both commands now boot the way `os migrate organization-ownership` does on that transport: with schema sync skipped instead of deferred. What an operator on a remote primary now sees:

- **The drift half runs.** `os migrate plan` lists the drift; `os migrate apply` applies what the transport can express, after the same confirmation: a column drop (with the indexes keyed on it, in one transaction) and every index entry. Nothing is written before the prompt, as before.
- **The additive half is reported as NOT examined, never as "nothing to create".** Both commands print a warning under the database line saying that tables and columns the metadata declares and the database lacks are neither listed nor created by this run, and that the serving boot (`os serve` / `os start`) creates them on this transport. The `--json` documents carry `schemaSync: "skipped"`, so their `pending: []` reads as not examined; an apply with no drift answers `message: "in_sync_partial"`, not `"in_sync"`.
- **Every entry the driver did not apply is named,** by table, column and kind, in both faces (`--json`: a new `notApplied` array on the post-apply document). The REMOTE transport runs no SQLite table rebuild, so a tightening, a relaxed NOT NULL, a width change or a dropped DEFAULT is not applied there.
- **A destructive entry confirmed with `--allow-destructive` that was not applied makes the run PARTIAL:** the human face ends `PARTIAL apply: …` and the command exits `1`; `--json` carries `message: "partial"` and exits `1`. A non-destructive entry that was not applied is named and the exit stays `0`.

On every other database the apply behaves as before, with one difference in the same direction: a destructive change confirmed with `--allow-destructive` that the driver could not apply (its DDL failed, or the dialect cannot perform it) now exits `1` and is named, where the run used to exit `0` with a count. Its human line for the entries held back without `--allow-destructive` now reads `Skipped N destructive change(s) (re-run with --allow-destructive to include them)`.

`@objectstack/driver-turso`: the REMOTE face's `driftReportCaveat` no longer says a destructive entry has no remedy on this transport; it says `os migrate apply --allow-destructive` applies a column drop or an index change there and names the rest.

The other `os migrate` commands whose dry run arms deferred DDL (`duplicates`, `account-issuer`, `unmapped-columns`, `multi-value-columns`, and the dry runs of the data commands) still refuse on the REMOTE transport, unchanged.
