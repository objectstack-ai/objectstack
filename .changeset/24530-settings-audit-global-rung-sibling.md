---
'@objectstack/platform-objects': minor
'@objectstack/service-settings': minor
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(service-settings)!: the settings audit trail's global rung moves to the new deployment-level `sys_platform_setting_audit`

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone: sys_setting_audit.scope keeps its global option because 18.0 rows hold it. What narrows is where a NEW global-rung audit row is stored and who may read it; the remedy is a run-time one, stated below. -->

**BREAKING** for a reader of the settings audit trail, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D7; ruling record 6257510973, Q4 A). This is the expand half of the change: it adds the new write shape, and the 18.0 rows stay where they are and readable. No row an 18.0 install wrote is moved, deleted or re-stamped.

- **Before.** A write of a global-scope settings key appended its history row to `sys_setting_audit`, stamped with the Default Organization under `single`. Any principal the settings read door let read the namespace could list it there.
- **Now.** That row goes to the new `sys_platform_setting_audit`. It has the same row shape, `scope` is always `global`, and there is no organization column (`systemFields: { tenant: false }`). Reading it through the generic data API requires the `manage_platform_settings` capability, as `sys_platform_setting` does, and each namespace's `readPermission` applies there too. Tenant and user rows stay in `sys_setting_audit`, stamped as before.
- **18.0 rows.** Global-rung rows an 18.0 install wrote stay in `sys_setting_audit`, stamped, until the upgrade ceremony moves them. The global rung's history is both tables: the sibling, plus `sys_setting_audit` rows at `scope = global`.

**The remedy.** If you list or filter the global rung's settings history (`sys_setting_audit` with `scope = global`), read `sys_platform_setting_audit` as well, with a principal that holds `manage_platform_settings`. Select the 18.0 rows by `scope`, never by a missing organization: they carry the Default Organization. Nothing changes for a reader of tenant or user rows.
