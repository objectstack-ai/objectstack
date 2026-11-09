---
'@objectstack/service-settings': patch
'@objectstack/platform-objects': patch
---

fix(service-settings)!: Setup no longer offers a Feature Flags page whose four toggles changed nothing (#30204)

Clause-②: no (narrowing) — removes the four settable keys of the `feature_flags` settings namespace (`ai_enabled`, `kanban_swimlanes`, `realtime_cursors`, `inline_comments`), the namespace itself (left empty by their removal), its Setup entry and the `featureFlagsSettingsManifest` export. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @objectstack/service-settings#featureFlagsSettingsManifest) The one author-reachable removal is a runtime export: the `feature_flags` settings manifest constant leaves `@objectstack/service-settings`'s published entry and `builtinSettingsManifests`. A settings key is a value an administrator saves, not metadata an author writes: no spec key, authorable spelling, object definition or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** for an administrator who saved one of the four Feature Flags toggles, and for a host that imports `featureFlagsSettingsManifest`.

- **Why.** No code read any of the four keys, so turning one on changed nothing (ADR-0049 enforce-or-remove). A flag comes back with the feature that reads it.
- **Removed keys.** `feature_flags.ai_enabled`, `feature_flags.kanban_swimlanes`, `feature_flags.realtime_cursors` and `feature_flags.inline_comments`: removed; each had no effect. The in-app AI panel is decided elsewhere and is unchanged.
- **The namespace.** `feature_flags` is no longer registered, so `GET` and `PUT /api/settings/feature_flags` answer `404 UNKNOWN_NAMESPACE`, and `SettingsService.getManifest('feature_flags')` throws `UnknownNamespaceError` (`SETTINGS_UNKNOWN_NAMESPACE`). Setup's Configuration group no longer lists Feature Flags (`@objectstack/platform-objects`, entry `nav_settings_feature_flags` and its four locale labels).
- **Stored values.** A `sys_setting` row saved under `feature_flags` and an `OS_FEATURE_FLAGS_*` environment variable are left in place and become inert: nothing registers the namespace, so nothing resolves them. They are not cleaned up; delete them at will.

The one-line fix for a host:

- FROM `featureFlagsSettingsManifest` TO nothing: drop it from the host's `SettingsServicePlugin({ manifests })` list; `builtinSettingsManifests` no longer carries it.
