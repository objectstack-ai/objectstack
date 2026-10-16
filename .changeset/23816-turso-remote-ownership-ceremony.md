---
'@objectstack/driver-turso': minor
'@objectstack/cli': minor
'@objectstack/runtime': minor
---

feat(driver-turso,cli): the v18 organization-ownership ceremony runs on a Turso remote database

Clause-②: yes (widening)

`os migrate organization-ownership`, the plan and `--apply --backup-taken`, now completes against a Turso database reached over the remote transport (`libsql://…`), the transport hosted environments use. Before, the plan stopped at its boot with `Deferred schema DDL is not supported by the Turso REMOTE transport`, and the apply's column drops had no remote path either.

- **`@objectstack/driver-turso`**, remote face:
  - `detectManagedDrift()` answers instead of refusing with `NOT_IMPLEMENTED` / 501. The verdict is the shared differ's, the one the local face runs; the physical schema it diffs is read from the remote catalog (`pragma_table_info`, `sqlite_master`, `pragma_index_list` / `pragma_index_info`, and the ADR-0120 D4 duplicate probe). The declarations it diffs against are recorded by every remote schema door and by the DDL-free `registerObjectMetadata`, so a boot that skipped schema sync is covered too.
  - `applyMigrationEntries()` applies `drop_index`, `create_index`, `recreate_index`, `replace_unique_index` and `drop_column` instead of refusing. Each entry runs as one libSQL `write` batch, so it lands whole or not at all: a `drop_column` drops the column's indexes with it in the same transaction, and a re-created index that fails to build leaves the old one in place. An entry is reported `applied` only once a read-back shows its target state. Every other column entry (nullability, width, a dropped DEFAULT) needs the SQLite table rebuild, which this transport does not run, so it is reported `skipped` and logged, as the in-place dialects report an op they cannot perform.
  - The remote face declares `driftReportCaveat`: a sentence saying its drift report is for reading only and naming the reason. The OS_ARTIFACT_URL boot gate reads it (below). The local and embedded-replica faces declare `null`.
  - The remote driver's `config` now carries its `url`, so the CLI labels a remote database by its URL (credential-free) instead of `better-sqlite3`. The ceremony writes that label into its plan and refuses an apply whose plan names another database; that refusal can now tell two remote databases apart.
- **`@objectstack/cli`**: the ceremony's plan and apply boots skip schema sync, instead of arming deferred DDL, when the primary datasource is a Turso remote one. No DDL is attempted, so the plan stays read-only, and every other datasource the boot connects is still deferred. The environment's own boot has already run the additive sync the ceremony reads. Every other `os migrate` command keeps refusing on that transport: their dry runs list held-back schema work, which a boot that holds nothing back cannot list.
- **`@objectstack/runtime`**: `createStandaloneStack` takes `skipSchemaSync`, passed to `ObjectQLPlugin` as the option `OS_SKIP_SCHEMA_SYNC=1` names. Unset, the plugin reads the variable as before.

On a Turso remote primary, the `OS_ARTIFACT_URL` boot migration gate on `os serve` keeps its earlier answer: cannot judge, warn and boot. It applies no drift and refuses no boot. Only its warning's wording changes, from `Could not check the physical schema` to `Did not check the physical schema against the artifact: …`, followed by the driver's reason. The gate now decides this from a capability the driver declares (`driftReportCaveat`, a string on the remote face and `null` on the local and embedded-replica faces), not from a refusal it catches. Two follow-ups have to land before that gate may act on a remote report:
- the remote transport's schema sync honours `storage.notNull`, so the report stops naming a tightening its own sync produced;
- `os migrate apply` gains a remedy on that transport for the destructive drift the gate would refuse on.
