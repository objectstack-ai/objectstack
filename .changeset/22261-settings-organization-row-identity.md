---
'@objectstack/service-settings': minor
---

fix(service-settings)!: tenant- and user-scope settings rows carry the caller's organization, and the data API read of the settings stores applies each namespace's readPermission

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime narrowing inside SettingsService and its plugin, not a metadata change: no spec key, export, option, response field or stored shape is removed, renamed or re-shaped (`organization_id` is the column `sys_setting` already declares in its row identity), so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is the service's accept set (a tenant-scope write naming no organization under a walled posture is refused) and the generic read door's row set (a namespace's rows are withheld from a principal lacking its readPermission). The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this service and this diff adds none (not registered / already-registered); and no published interface or type is removed or narrowed (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`sys_setting` declares its row identity as `(organization_id, namespace, key, scope, user_id)`. `SettingsService` now carries the organization in that identity itself, on every read and write of a `tenant` or `user` row, because it reads and writes the store under its own system context, which no driver tenant scope or organization wall reaches.

- **Writes.** A `tenant` or `user` row is written with the caller's organization (`SettingsContext.tenantId`) in its key and in its stored `organization_id`. A write by one organization updates only that organization's row.
- **Reads.** The tenant and user rungs draw on the caller organization's rows and on rows stored with no organization, and take the caller organization's own row when it has one. A row stored with no organization stays the fallback for every organization until that organization writes its own. A caller that names no organization reads only the rows stored with no organization under a walled posture (`group`, `isolated`), and every row under `single`. The global rung (`sys_platform_setting`) is unchanged and read by every organization.
- **Locks.** The lock check on a write reads the same upper rows the caller's cascade reads, so a lock on one organization's tenant row locks nothing for another organization.
- **Refused now.** Under a walled posture, `set` and `setMany` refuse a key declared `scope: 'tenant'` when the context names no organization, a `null` reset of one included. The refusal is a `SettingsValidationError` (`code: 'SETTINGS_VALIDATION'`, HTTP 400 at the settings routes) with one `fields` entry per such key (`code: 'invalid_value'`, `constraint: { scope: 'tenant' }`). It refuses the whole batch, before anything is written. The posture is the one the `tenancy` service reports; `SettingsServicePlugin` supplies it through `bindEngine`.
- **Generic read door.** `SettingsServicePlugin` registers an engine middleware on `sys_setting`, `sys_setting_audit` and `sys_platform_setting`: every non-system read (`find`, `findOne`, `count`, `aggregate`) is narrowed to the namespaces whose `readPermission` the principal holds, by the same rule `GET /api/settings/:namespace` applies. A namespace with no registered manifest reads at the default capability, `setup.access`.
- **Unchanged.** Under `single`, a caller in the default organization reads every value it read before, and a process-wide reader that names no organization reads the organization's current value. Keys declared at `scope: 'global'` resolve and write the same for every caller.

What changes for you: write a tenant-scope setting from inside the organization it belongs to (an active organization on the session, or `SettingsContext.tenantId` in process). Rows already stored with no organization are not rewritten.
