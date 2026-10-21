---
'@objectstack/cli': minor
'@objectstack/objectql': minor
---

feat(cli, objectql): `os db orphans` — report the detail rows whose required master-detail master does not exist, and delete them only behind `--delete`, after a pre-delete export

Clause-②: yes (widening)

**What was wrong.** A system-context write is exempt from the write-time reference check, so an elevated writer could store a master-detail id that names no master. Such a row's access derives from that master, so every user door answered 404 for it, the administrator's `GET` and `DELETE` included, and a list query left it out. The integrity audit reported the row and, by design, never rewrites it. No door existed to remove it, so it stayed until someone edited the database by hand.

**`os db orphans` (new command).** An explicit operator command. Nothing on any boot, upgrade, migrate or lifecycle path runs it.

- **The default run is a report** that writes no row or table and creates no file. It boots read-only, as `os migrate plan` does. It lists each detail row whose required `master_detail` master does not exist, with its object, record id, field and missing master id. It also lists the deeper detail rows that the delete's cascade removes with it. `--json` prints one document, `{ mode: 'report', plan }`.
- **What is never deleted, and is said.** A reference whose target object could not be checked (not registered, no driver, or a failed read) is counted as `undetermined`. Unknown is not missing. A dangling reference on the same objects through a field that is not a required master-detail is listed in `otherDangling`. An orphan whose cascade could not be read is listed as `withheld`, with the reason. A scan bounded by `--max-rows` (default 100000) names every object it could not read in full.
- **`--delete` requires `--export <path>`.** The export holds every record the run deletes, as the driver stores it. It is written owner-only, is created rather than overwritten, and is read back before the first delete. If it cannot be written or does not hold every record, the run refuses with nothing deleted. Just before deleting, the run reads the report again and skips an orphan whose master now exists, or whose cascade now reaches a record the export does not hold. Each delete is the engine's own system-context delete, so the master-detail's cascade removes the deeper details. A `restrict` dependent refuses the delete, and a cascade on one datasource is one unit of work, so nothing of that orphan is removed. A `set_null` reference to a deleted row is cleared. A roll-up on the missing master cannot be recomputed, and the run notes this rather than failing. Each delete is judged by reading its records back.
- **Refusals**, each exit 1 with nothing deleted, and the code under `--json` as `error`: `export_required`, `export_exists`, `export_failed`, `export_incomplete`, `confirmation_required` (`--json` without `--yes`), `boot_failed`, `no_engine` and `scan_failed`.

**`@objectstack/objectql`: `ObjectQL.inspectCascadeDelete(object, id)` (new method).** A read-only method that returns every record a by-id `delete()` of that record removes, root first. It is the cascade set the delete collects for itself, read through the same walk. It writes nothing, runs no hook, and files no reference-check elevation record, because no delete happens. It reads as the system with no organization. `restrict` and `set_null` relations are not listed, because neither removes a record. A dependents probe that fails propagates.

Nothing that ran before changes: the audit still reports and never rewrites, and the system-write exemption is unchanged.
