---
"@objectstack/cli": minor
"@objectstack/runtime": minor
---

The v18 organization-ownership ceremony now completes on a long-lived 17.x database, and `os dev` runs it for you on a local development database (ADR-0131, amendment 2026-10-16).

**`os dev` upgrades a v17-shape development database in place.** When the boot refuses a local SQLite development database that is still in the v17 organization-ownership shape, `os dev` first copies the database and its `telemetry` sibling (with `-wal` / `-shm`) into `<data dir>/backups/organization-ownership-<timestamp>/`. It then runs `os migrate organization-ownership --dev` (the plan), applies that plan, and starts the server again. The plan, the apply report and the ceremony's log are kept beside the copy. If a step blocks, `os dev` stops and prints the blocker, where the copy is, and how to resume. `os serve` / `os start`, and any database that is not a local SQLite file, keep the manual ceremony and the boot refusal unchanged.

**What the ceremony decides for you is printed as a warning before it writes anything.** The plan carries a `warnings` list. The plan prints it, `--apply` prints it again before its first write, and the apply report keeps it.

**The `telemetry` sibling is covered.** A development boot (or an `OS_TELEMETRY_DB` deployment) keeps `sys_audit_log`, `sys_job_run`, `sys_notification` and the other lifecycle objects in a sibling database. The ceremony now plans, attributes and drops columns for each object in the database it lives in, reading anchors across databases. Before, the boot refusal read those tables in the sibling while the ceremony only read the primary, so an upgraded database could still never boot. A copy of such a table that an older boot left in the primary is listed under `staleCopies`, warned about, and left untouched; it no longer blocks the column drops.

**The shipped permission sets an install seeded before 2026-08-15 are adopted.** Those installs store the eight shipped sets (`organization_admin`, `member_default`, …) as `managed_by: 'admin'` rows. The authored-conversion step used to refuse them with "rename the authored row". The ceremony now re-owns them as the platform seeds they are and deletes them as mirrors once every grant names its set, so the shipped definitions apply. The warning names each row; a Setup edit to one of them is not carried over, and the pre-upgrade backup keeps it.

**`os migrate organization-ownership --dev`** composes the stack as `os serve --dev` does: the development auth secret's fallback (so the security and audit plugins), the development `.env*` files, and the `telemetry` sibling. A development boot's refusal now names the command with `--dev`, and every refusal now names an apply the ceremony accepts: `--out PLAN` first, then `--apply --plan-file PLAN --backup-taken`. A bare `--apply` is refused without a reviewed plan file. Before, running the ceremony from a shell without `NODE_ENV=development` composed neither plugin, and its apply blocked on the shipped permission sets and on `sys_audit_log`.

`OrganizationOwnershipBootGuardPlugin` (`@objectstack/runtime`) takes `{ dev }`; `organizationOwnershipRefusalMessage` and `assertOrganizationOwnershipMigrated` take the same option.
