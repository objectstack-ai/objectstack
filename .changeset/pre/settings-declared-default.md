---
'@objectstack/service-settings': patch
---

feat(service-settings): a deployment's declared default answers the bottom rung of the settings cascade

Clause-②: yes (widening) — widened: `SettingsService.registerDeclaredDefault(namespace, key, provider)` and the exported type `SettingsDeclaredDefault`. A key with a registered provider resolves, while nothing is stored and no `OS_*` override is in force, to what the provider answers instead of the manifest `default`, still `source: 'default'`; a key or namespace with no provider resolves exactly as before.
Metadata-protocol: none

A manifest `default` is the console's default. Where a package's runtime takes a key from its own configuration while nothing is stored (plugin options, a host declaration), the settings page read the manifest default while something else ran, and a save of that default was "no change" to the key's write predicates.

A package now states that value: `settings.registerDeclaredDefault('auth', 'email_password_enabled', () => declared)`. It is asked on each use and never recorded, and it answers every place the cascade read the manifest default: `get`, `getMany`, `getNamespace` (and `GET /api/settings/:namespace`), the change test that decides whether a write predicate is asked, the value a cleared key falls back to, and the type an `OS_*` value is coerced to. `undefined` or `null` means "nothing declared" (the manifest default stands); a provider that throws is reported once at `warn` and the manifest default answers. A stored row and an `OS_*` override still win. ADR-0007's rung 4 is amended to match.

What to do: nothing for existing namespaces.
