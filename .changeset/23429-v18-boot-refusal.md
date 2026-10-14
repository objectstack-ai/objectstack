---
'@objectstack/runtime': minor
'@objectstack/cli': minor
'@objectstack/spec': minor
---

feat(runtime,cli)!: `os serve` refuses to start against a database still in the v17 organization-ownership shape, and `os migrate apply` refuses to drop its `organization_id` columns, until `os migrate organization-ownership` has verified it (ADR-0131 D10 item 5)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (already-registered sys-audit-log-organization-column-retired, sys-flow-dispatch-organization-column-retired, sys-job-organization-column-retired, sys-job-queue-organization-column-retired, sys-job-run-organization-column-retired, sys-migration-journal-organization-column-retired, sys-migration-organization-column-retired, sys-presence-organization-column-retired) The step-18 D3 entries named here, registered before this change, record the retirement of each organization column this refusal reads, with the remedy that clears it; the metadata family's four entries land with its schema change, which this refusal ships beside. This change adds no authorable surface, moves no spec key and rewrites no stored row: it refuses to boot while a retired column is still physically present, and the remedy is the operator's own migration: the ceremony, whose column-drops step drops what those entries prescribe dropping. No new D3 entry and no D2 conversion. -->

**BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.

A v18 runtime no longer serves a database it was never migrated for. At `kernel:ready`, `os serve` (and so `os dev`) checks every table whose object declares no organization column (`systemFields.tenant: false`). If one still carries a physical `organization_id`, the boot is refused unless the `sys_migration` row `adr-0131-organization-ownership` is verified. The refusal names the tables and the command. It is thrown before `kernel:listening`, so no request is served. Its code is `ORGANIZATION_OWNERSHIP_MIGRATION_REQUIRED`.

FROM → TO:

- A 17.x database started by an 18.x `os serve` → run `os migrate organization-ownership`, review its plan, then `os migrate organization-ownership --apply`, and start again. To keep 17.x semantics on an unmigrated database, run a 17.x runtime.
- `os migrate apply --allow-destructive` on such a database (`@objectstack/cli`, BREAKING `minor`: the command narrows) → it now refuses to drop `organization_id` from any table in the ceremony's inventory (the D7 tables and the `sys_metadata` family) while the ceremony's marker is not verified. Before, the drift report offered each such column as an unmapped destructive column, and the apply dropped it. Dropped ahead of the ceremony, that column takes the ceremony's promotion and report steps with it, turns every legacy organization row into an environment row, and leaves the boot refusal no column to find. The refusal names `os migrate organization-ownership`, exits 1, and under `--json` answers `message: 'refused_organization_ownership_unmigrated'` with the `tables`, as the `sys_account.issuer` (#17440) and `sys_comment.reactions` (#23281) refusals do. The ceremony drops these columns itself once it verifies; any other destructive drop is unchanged.
- There is no escape hatch: no `OS_ALLOW_*` or `OS_SKIP_*` variable and no flag skips either check.

What does not change:

- A fresh database boots: no table it creates carries a retired column, so no marker is needed.
- A database whose ceremony verified boots, whatever its columns.
- The `os migrate` commands boot as before, the ceremony's own among them: the boot guard is composed by `os serve` only, never by the shared standalone stack (`createStandaloneStack`, which `bootSchemaStack` and every other CLI data and schema boot build on). Only `os migrate apply`'s drop of an inventory table's `organization_id` waits, as above.
- A driver with no physical columns to read (memory, MongoDB) is not checked.
- A host that composes its own kernel can add the guard itself: `OrganizationOwnershipBootGuardPlugin`, or `assertOrganizationOwnershipMigrated(engine)` from `@objectstack/runtime`. `ORGANIZATION_OWNERSHIP_MIGRATION_ID` is now exported from `@objectstack/spec/system`.
