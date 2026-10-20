---
'@objectstack/runtime': patch
---

fix(runtime): the organization-ownership boot refusals say what 18.0 supports for a v17 database and name no step of `os migrate organization-ownership`, which 18.0 refuses on every database

Clause-②: no (refusal text only: the refusal code `ORGANIZATION_OWNERSHIP_MIGRATION_REQUIRED`, the refused tables and the boot outcome do not move)

In 18.0, `os migrate organization-ownership` refuses plan and apply on every database (`NOT_IMPLEMENTED`): 18.0 supports fresh installs only. Three branches of the v18 boot refusal still told the operator to run that command's plan and its `--apply --plan-file PLAN --backup-taken`, so following them led to a second refusal.

Each branch now closes on the sentence `os migrate apply`'s drop gate and `os dev` already use: "18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17.x release until the 18.x release that carries the upgrade path, and upgrade it there."

- **A table still in the v17 shape** (an object that declares no organization column, over a table that still carries `organization_id`). This branch already said that 18.0 does not upgrade a v17 database. It no longer follows that with the command's plan and apply steps.
- **No table left in the v17 shape, and the ceremony's marker is not verified.** The refusal no longer prescribes a re-plan and a re-apply, which 18.0 cannot run.
- **No table left in the v17 shape, and the marker could not be read.** The refusal now says to fix the read and start again: a database no ceremony ran on boots once the read answers. It no longer prescribes a re-plan and a re-apply.
- **The column read itself failed.** The refusal still says to fix the read. It no longer offers the command as the alternative.

A development boot (`OrganizationOwnershipBootGuardPlugin({ dev: true })`, as `os serve --dev` composes it) says "a v17 development database" in place of "a v17 database". Before, it named the command with `--dev`.
