---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
'@objectstack/plugin-security': patch
---

feat(security): an unmanaged install copies an app's capabilities, renamed with the copy

Clause-②: yes (widening)
Metadata-protocol: added

An app that gates an action on its own capability can now install as an unmanaged copy (`installModes: ['unmanaged']`). Before, `capability` was code-only (`allowRuntimeCreate: false`), so the validator refused the mode for any app that declared one, and the install door had no channel to write the copy's capabilities.

- **`capability` is runtime-creatable.** Its `DEFAULT_METADATA_TYPE_REGISTRY` entry is now `allowRuntimeCreate: true`, and overlays stay closed (`supportsOverlay: false`, `allowEnvironmentOverlay: false`). A body is judged by `CapabilityDeclarationSchema`, as before.
- **The save door refuses two names.**
  - A platform capability's name (`manage_users`, `setup.access`, every name in `PLATFORM_CAPABILITIES`) answers `422 NAMESPACE_CONFLICT`. An environment item under that name would shadow the platform's definition, because the registry answers its bare slot first.
  - A name an installed package's capability holds answers `422 NAMESPACE_CONFLICT`, naming the holder. A capability holds one name per deployment, the same rule permission sets and positions follow.
- **The environment catalog holds capabilities.** `ENVIRONMENT_HELD_SECURITY_CATALOG_TYPES` is `['position', 'permission', 'capability']`. A package that ships a capability name the environment already authored is refused at boot, as a position or permission-set name is.
- **An unmanaged copy renames its capabilities.** When the copy takes a new namespace, a capability whose name starts with the source namespace (`<ns>.` or `<ns>_`) is renamed into the copy's namespace. Every reference is rewritten with it: a permission set's `systemPermissions` (list or per-operation map) and an object's or action's `requiredPermissions`. An unprefixed capability keeps its name. A renamed capability that collides with another package's capability refuses the install, naming both. Install again under another namespace.
- **An environment-saved capability is not excused at the `everyone` anchor.** The check that refuses a high-privilege permission set bound to `everyone` excuses the tokens an app declared itself. It now counts only declarations that carry a package (`_packageId`), as ADR-0090 D5 rules: an app's shipped capabilities and an unmanaged copy's. A capability saved through the metadata door excuses nothing, so a metadata author cannot clear a token for `everyone` by declaring it.
- **The gate is unchanged.** It still matches capability names. The copy's action is gated on the copy's capability: a holder of the copy's permission set passes, and a holder of only the source's set does not.
