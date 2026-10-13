---
'@objectstack/platform-objects': minor
'@objectstack/service-automation': minor
'@objectstack/service-realtime': minor
'@objectstack/spec': minor
---

feat(platform-objects,service-automation,service-realtime)!: seven deployment-level platform tables lose their injected organization column, and reading them needs `manage_platform_settings` (ADR-0131 D7)

Clause-②: no (narrowing)

<!-- adr-0087: registered sys-flow-dispatch-organization-column-retired, sys-job-organization-column-retired, sys-job-queue-organization-column-retired, sys-job-run-organization-column-retired, sys-migration-journal-organization-column-retired, sys-migration-organization-column-retired, sys-presence-organization-column-retired -->

**BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes (Changesets pre mode is not on yet).

`sys_job`, `sys_job_run`, `sys_job_queue`, `sys_flow_dispatch`, `sys_migration`, `sys_migration_journal` and `sys_presence` hold deployment-level state. No writer attributes a row of any of them to an organization: every write is a system-context write whose row names none, and nothing writes `sys_presence` through ObjectQL at all. So the injected `organization_id` column only ever held NULL. ADR-0131 D7 takes it off: each object now declares `systemFields: { tenant: false }`.

With no column there is no tenant wall, so these tables are governed by object permission. Each also declares `requiredPermissions: ['manage_platform_settings']`. Without that gate, a walled deployment's `organization_admin`, whose grant carries the superuser bits on every object, would read every other organization's job errors, queued payloads, dispatch keys and migration traces.

**What moves for consumers.**

- **The column.** `organization_id` is no longer a field of these seven objects. A filter, list-view column, report grouping, formula or seed key naming it on one of them is now an unknown field. Delete the reference: no organization owns a row of these tables.
- **Who reads, on a walled posture** (`group` or `isolated`). Before: the wall compared the NULL column to the caller's organization, so every reader got zero rows, platform administrators included (unless the deployment declared the table platform-global, which stood the wall down). Now: a principal holding `manage_platform_settings` (platform administrators hold it) lists every row; anyone else is refused `403 PERMISSION_DENIED`.
- **Who reads, on the `single` posture.** Before: any principal with a read grant on the object read every row, an organization administrator included. Now: only a principal holding `manage_platform_settings` reads; an organization administrator who is not a platform administrator is refused `403 PERMISSION_DENIED`. Grant the capability to an operator who needs these tables.

**Unchanged.** Every platform writer and reader of these tables uses a system context, which no capability gate applies to, so job scheduling, the queue, flow dispatch, migration flags and the migration journal behave as before. The physical unique indexes are unchanged: none of these objects declares an organization-scoped one.

**Existing databases.** Schema sync only adds, so the physical `organization_id` column stays on each existing table (with its index, where the deployment indexed it), and the boot drift report names it orphaned. By the writer census it holds only NULL, so dropping it loses nothing: `os migrate apply --allow-destructive` drops it, the remedy the drift report names.
