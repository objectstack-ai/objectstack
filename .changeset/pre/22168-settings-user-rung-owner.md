---
'@objectstack/service-settings': minor
---

fix(service-settings)!: the user rung answers only its owner, and a write of a user-scoped key must name its user

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime narrowing inside SettingsService, not a metadata change: no spec key, export, option, response field or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is the service's accept set: `set` and `setMany` now refuse a key declared `scope: 'user'` when the caller's context names no user. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this service and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A settings key declared `scope: 'user'` belongs to one user. `SettingsService` now holds that on both its read and its write side.

- **Reads.** The user rung answers only a caller whose `SettingsContext.userId` is present and equals the row's owner. A resolve whose context names no user (no `userId`, or an empty one) has no user rung: it answers from the tenant rung, then global, then the manifest default. This holds on every read path that reaches the cascade: `get`, `getMany`, `getNamespace`, `createClient`, `runAction` and `resetNamespace`.
- **Refused now.** `set` and `setMany` refuse a user-scoped key when the context names no user, a `null` reset of one included. The refusal is a `SettingsValidationError` (`code: 'SETTINGS_VALIDATION'`) with one `fields` entry per such key (`code: 'invalid_value'`, `constraint: { scope: 'user' }`). It refuses the whole batch, before anything is written.
- **Unchanged.** A caller with a user id reads and writes only their own rows, as before. Keys declared at `scope: 'tenant'` or `'global'` resolve and write the same with or without a user id. The settings HTTP routes resolve a signed-in user before they read or write any row, so they behave as before.

What changes for you: when your code calls the settings service for a user-scoped key, pass the user id of the person the value belongs to. A value meant for everyone belongs on a key declared at `scope: 'tenant'` or `'global'`. None of the settings namespaces this repository ships declares a user-scoped key.
