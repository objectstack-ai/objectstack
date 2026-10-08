---
'@objectstack/platform-objects': minor
'@objectstack/service-settings': minor
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(service-settings,platform-objects)!: the settings cascade's global rung moves to the tenant-less `sys_platform_setting`, and `sys_setting.scope` no longer declares `global` (ADR-0131 D7)

Clause-②: yes (narrowing)

<!-- adr-0087: registered sys-setting-global-rung-moved -->

**BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes (Changesets pre mode is not on yet).

A settings value for a key declared at `global` scope is a deployment-wide value: the mail transport, the SMS, storage, AI and knowledge providers, auth policy, the lifecycle retention defaults. It used to be a `scope: 'global'` row of `sys_setting`, a tenant-scoped table, where the injected `organization_id` column only ever held NULL and a walled posture hid the row from every reader. ADR-0131 D7 moves the rung out: it is now stored in a new platform object, `sys_platform_setting`.

- **`sys_platform_setting`** (registered by the settings service, beside `sys_setting`): one row per `(namespace, key)` for the deployment, with the `value`, `value_enc`, `encrypted`, `locked`, `locked_reason` and `updated_by` columns of a settings row, and no `scope`, `user_id` or `organization_id` (`systemFields: { tenant: false }`). It is governed by object permission: a generic data read needs `manage_platform_settings` (`requiredPermissions`), which platform administrators hold. Writes go only through the settings door.
- **`SettingsService`** writes a global-scope key to `sys_platform_setting` and reads the cascade's global rung from there alone. Its `sys_setting` reads exclude `scope = 'global'`, so there is one source per rung. The cascade order, the lock semantics, `SpecifierScope` and the `source: 'global'` resolution value are unchanged. A global-scope change's `config_change` audit row names `sys_platform_setting` (`CONFIG_CHANGE_GLOBAL_OBJECT_NAME`); tenant- and user-scope changes still name `sys_setting`.
- **`sys_setting.scope`** no longer declares the `global` option: no write produces such a row. `sys_setting_audit.scope` keeps it, because a global-scope change is still audited there.
- **`os secret orphans` / `os secret rewrap`**: the settings family of the `sys_secret` reference union now reads both `sys_setting.value_enc` and `sys_platform_setting.value_enc`. Without that, every credential held at the global rung would read as unreferenced and be swept. An unreadable `sys_platform_setting` gaps the family, which refuses deletion.

**What moves for consumers.**

- **Existing databases — nothing moves automatically** (ADR-0131 D14). A `sys_setting` row at `scope = 'global'` is no longer read; until the v18 upgrade ceremony moves it, that key answers from its next rung or the manifest default. The ceremony moves each such row to `sys_platform_setting` by namespace and key, its `value_enc` handle included. An encrypted value needs no re-encryption: the ciphertext's associated data binds the settings scope, namespace and key, never the holding object or an organization.
- **Authored references.** A filter, list-view column or seed that names `scope = 'global'` on `sys_setting` matches nothing: point it at `sys_platform_setting`, which has no `scope` column.
- **Generic data reads of the global values.** Read `sys_platform_setting`; it needs `manage_platform_settings`. The settings door (`/api/settings/:namespace`) is unchanged and keeps applying each manifest's own read and write capability.
- **Kernels that register the settings objects by hand.** Register `SysPlatformSetting` (`@objectstack/platform-objects/system`) beside `SysSetting`; `SettingsServicePlugin` already does. The service reads both on every resolution, so a kernel missing one fails the read loudly rather than answering a cascade with a rung missing.
