---
"@objectstack/platform-objects": minor
"@objectstack/service-settings": patch
"@objectstack/verify": patch
---

feat(platform-objects,service-settings,verify): `sys_secret` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the settings service (#4270)

The environment's encrypted-secret store (`sys_secret`, ADR-0066 D2/④) was
registered by `@objectstack/service-settings`, but it has three producer
classes and only one of them is settings: the settings service's encrypted
specifiers, the ObjectQL engine's own `secret`-field encryption
(`encryptSecretFields`/`resolveSecret` — the generic write path of ANY
business object carrying a `Field.secret()`), and the datasource credential
binder. Unlike the `sys_migration` precedent (#4243), the failure posture is
fail-CLOSED: on a kernel composed without settings, every insert/update of an
object with a secret field threw — with an error message that told the
operator to "Ensure the platform-objects (sys_secret) are registered", naming
a package that did not register it.

The registration now lives in `PlatformObjectsPlugin`
(`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
auto-injects into every served kernel — so the store exists with the
platform, independent of which optional services are composed, and the
engine's fail-closed error message is true. Definition ownership is unchanged
(`sys_secret` stays in `@objectstack/platform-objects` and in
`PLATFORM_OBJECTS_BY_PACKAGE`); the settings service remains a producer and
consumer through its `sys_secret`-backed secret store.

Consequences:

- `@objectstack/service-settings` no longer contributes `sys_secret` to the
  manifest (`settingsObjects` is now `[SysSetting, SysSettingAudit]`). An
  embedder composing `SettingsServicePlugin` on a hand-built kernel that
  relied on it for the `sys_secret` table must compose
  `PlatformObjectsPlugin` (the plugin every supported assembly path already
  includes). The move REPLACES the registration — nothing registers the
  object twice.
- `@objectstack/verify`'s boot harness now composes `PlatformObjectsPlugin`,
  mirroring `os serve`'s auto-inject — which also means harness kernels now
  carry the `sys_migration` ledger + fresh-datastore attestation (#4243) the
  served assembly always had.
