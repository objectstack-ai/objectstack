---
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
'@objectstack/cloud-connection': minor
---

fix(objectql, metadata-protocol, cloud-connection)!: a declared `.custom` action override is keyed and judged the same way at every door, and only its declared base's handler slots beneath it

Clause-②: yes (narrowing) — the protocol door (save and publish) now refuses a declared action override whose `objectName` is not the base action's, with `403 NOT_OVERRIDABLE` and rule `declared_package_ships_no_such_item`, the refusal `os validate` and the managed install already gave it; the save door used to admit it. The managed install now admits a re-install of the pair whose override relaxes an earlier tightening back to the base's own gates, which it used to refuse with `declared_action_widens_access` while the save door admitted it. Every other input answers as before.
Metadata-protocol: narrowed
Skills-docs: follow-up #30505 — the declared action override's docs card; it owes one sentence that an override keeps the base action's `objectName`.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: the action schema and the `overrides` declaration keep their shapes. What moves is which door admits one declared override shape, so all three doors give one answer, and the refusal carries its own remedy; nothing at rest is rewritten. -->

**BREAKING** accept-set narrowing at the protocol door (`@objectstack/metadata-protocol`, ADR-0146 D2/D9): a declared action override names its base's action by `<objectName>:<name>`, the identity `os validate` and the managed install key it on.

- **Before.** The save and publish doors matched a declared action override's base by name alone, so an override in the base's `.custom` pair could move the base's action to another object. Its handler was not rebound there, and `os validate` and the install door refused the same body.
- **Now.** The save door refuses it as the other two doors do: the base ships no action of that name on that object. Keep the base action's `objectName` in the override, or remove `overrides` and add the action under the pair's own name.

`@objectstack/cloud-connection`: the managed install judges a declared action override against the installed base's code artifact (`SchemaRegistry#getArtifactItem`), as the save door does. The protocol's per-package listing it read before serves an armed override under the base's envelope, so a re-install of the pair was judged against its own previous version.

`@objectstack/objectql`: `ObjectQL#registerActionOverride` takes the package the override declares (`overrides.package`) as an optional fifth argument, and the authored-action resync passes it. `registerAction` under a key such an override holds slots the handler beneath it only when the registry's code artifact of the action belongs to that package, on that object; any other registration, one with no package included, replaces the override and is warned like every other handler collision. Before, any other package's registration slotted beneath it, so a row of another base's pair bound before the real base registered kept running after the real base's handler arrived, while every read served the real base's action; and a registration with no package slotted beneath it at `debug`, where the method's docblock promises a warning.
