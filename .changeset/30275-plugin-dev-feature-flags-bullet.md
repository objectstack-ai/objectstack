---
'@objectstack/skills': patch
---

docs(skills): `objectstack-platform`'s plugin-development reference no longer teaches the removed `feature_flags` settings namespace

Clause-②: no
Metadata-protocol: none

The "Feature Flags" section listed a `feature_flags` settings manifest with `ai_enabled` / `beta_*` toggles and `OS_FEATURE_FLAGS_*` env overrides. That namespace was removed from `@objectstack/service-settings` (reading it is refused with `SETTINGS_UNKNOWN_NAMESPACE`, and the env vars do nothing). The bullet now gives the live answer: a plugin that needs an org toggle declares its own `SettingsManifest` and registers it on the `settings` service.
