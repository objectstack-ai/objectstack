---
'@objectstack/spec': patch
'@object-ui/i18n': patch
---

docs(spec,i18n): stop naming the removed feature-flags settings page

Clause-②: no
Metadata-protocol: none

The `feature_flags` settings namespace and its Setup page were removed from `@objectstack/service-settings` and `@objectstack/platform-objects`. Two shipped texts still pointed at it; both now say what is live.

- **Settings hub subtitle (`@object-ui/i18n`).** `console.settingsHub.subtitle` no longer promises feature flags, in all ten language packs. English FROM "Configure your system, integrations, and feature flags." TO "Configure your system and integrations."; each other pack drops its own term the same way. No key is added or removed.
- **Spec doc comments (`@objectstack/spec`).** The kernel barrel and `PUBLIC_AUTH_FEATURES` docblocks no longer send readers to a `feature_flags` settings manifest or to `OS_FEATURE_FLAGS_*`. A setting a plugin reads is declared on that plugin's own settings manifest (ADR-0007, env-overridable as `OS_{NAMESPACE}_{KEY}`); capabilities a deployment advertises to clients are the `PUBLIC_AUTH_FEATURES` registry. The `SettingsManifestSchema` docblock (and its generated reference page) gives `mail`, `branding`, `localization` as example namespaces. No schema, type or export changes.
