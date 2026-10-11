---
'@objectstack/cli': patch
---

fix(cli): `os migrate plan` / `apply` plan each object in the database it lives in, the `telemetry` sibling included (#22579)

A development `os serve` boot on a file-backed SQLite database, and any boot with `OS_TELEMETRY_DB=<path>`, keeps lifecycle-classed system data (audit, telemetry and event objects such as `sys_audit_log`, `sys_activity`, `sys_metadata_audit`, `sys_job_run`, `sys_notification`) in a sibling `telemetry` database. The one-shot boot `os migrate` runs never opened that sibling, so every one of those objects resolved to the primary database: after a development boot, `os migrate plan` listed each as a table to create, and `os migrate apply` created each in the primary — empty tables beside the ones the served boot uses.

The migrate boot now provisions the sibling exactly when the serving boot would, through the same helper and under the same rule: `--dev` or `NODE_ENV=development` on a file-backed SQLite primary, or `OS_TELEMETRY_DB=<path>`, and never with `OS_TELEMETRY_DB=0`. `plan` and `apply` diff and apply every object against the database it lives in, and print the sibling under the database line (`Telemetry database: …`); in `--json` it is the new `telemetryDatabase` field, present only when a sibling is planned. `apply`'s confirmation names both databases. A `plan` against a sibling that does not exist yet lists its tables to create and creates no file. `os migrate unmapped-columns` reads a lifecycle-classed object from the sibling, and names it as the database.

A deployment with no sibling — production without `OS_TELEMETRY_DB`, or `OS_TELEMETRY_DB=0` — is unchanged. Run the migration with the `NODE_ENV` the deployment is served with: without `NODE_ENV=development` the plan describes a production `os serve`. Tables an earlier `os migrate apply` created in the primary for these objects are not removed.

This supersedes the "Known limit" in this release's `os migrate plan` / `apply` composition entry: the migration boot now provisions the `telemetry` database.

`os serve` loads the project's `.env*` files through the same function `os migrate` does; which files it reads, and in which mode, is unchanged.
