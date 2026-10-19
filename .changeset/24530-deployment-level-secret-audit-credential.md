---
'@objectstack/platform-objects': minor
'@objectstack/service-settings': minor
'@objectstack/service-automation': minor
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(services)!: `sys_secret` and `sys_flow_credential` are deployment-level, and the settings audit trail's global rung moves to the new `sys_platform_setting_audit`

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone: sys_setting_audit.scope keeps its global option because 18.0 rows hold it, and the two objects keep their organization column declared. What narrows is where a NEW global-rung audit row is stored and who may read it; the remedy is a run-time one, stated below. -->

**BREAKING** for a reader of the settings audit trail, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D7; ruling records 6257510973, Q4 A, and 6259141885, Q1 A). This is the expand half of the change: it adds the new write shape and reads both shapes. It moves, deletes and re-stamps no row an 18.0 install wrote, and it drops no column.

- **`sys_secret` is deployment-level.**
  - **Before.** Under `single`, every `sys_secret` row was stamped with the Default Organization, and an encrypted tenant or user setting wrote its organization on the secret.
  - **Now.** The object declares `tenancy: { enabled: false }`: nothing stamps, walls or scopes it by organization. A secret is owned by the row that holds its handle, and every read stays by id under privilege. The settings service no longer passes `organization_id` to its secret store, and `SettingsSecretStore.insert` no longer declares the property.
  - **The 18.0 column stays.** `organization_id` is still declared, nullable, read-only and unread, with the shape 18.0 gave it (a 255-wide string, no longer a lookup), so an 18.0 database boots and its schema sync proposes no change. A row an 18.0 install stamped keeps its organization and opens by id as before. The upgrade ceremony drops the column.
- **`sys_flow_credential` is deployment-level**, in the same shape: `tenancy: { enabled: false }`, the 18.0 column kept declared and unread. A credential's ownership follows its flow, which is environment metadata. New credential rows, and the `sys_secret` rows their values mint, carry no organization. 18.0 rows keep theirs and resolve as before.
- **The settings audit trail's global rung moves to `sys_platform_setting_audit`.**
  - **Before.** A write of a global-scope settings key appended its history row to `sys_setting_audit`, stamped with the Default Organization under `single`. Any principal the settings read door let read the namespace could list it there.
  - **Now.** That row goes to the new `sys_platform_setting_audit`: the same row shape, `scope` always `global`, no organization column (`systemFields: { tenant: false }`). Reading it through the generic data API requires the `manage_platform_settings` capability, as `sys_platform_setting` does, and each namespace's `readPermission` applies there too. Tenant and user rows stay in `sys_setting_audit`, stamped as before.
  - **18.0 rows.** Global-rung rows an 18.0 install wrote stay in `sys_setting_audit` until the upgrade ceremony moves them. The global rung's history is both tables.

**The remedy.** If you list or filter the global rung's settings history (`sys_setting_audit` with `scope = global`), read `sys_platform_setting_audit` as well, with a principal that holds `manage_platform_settings`. Nothing to change for a reader of tenant or user rows, or for a reader of a secret or a flow credential by id.
