---
'@objectstack/metadata': patch
---

fix(metadata): a skill the platform registers keeps its own slot beside an app's skill of the same name

Clause-②: yes (widening)
Metadata-protocol: none

For every type stored per `(package, name)` (`skill`, `agent`, `tool` and the rest of `PACKAGE_SLOTTED_STORE_TYPES`), the platform's built-in record and a package's item of the same name no longer overwrite each other.

- `MetadataManager.register(type, name, data, { origin: 'platform' })` marks a record the platform's own code registers: the body is stamped `_provenance: 'platform'` and the record fills the name's bare slot, in memory and in `sys_metadata`. Before, a package-less write under a name one package held was folded into that package's slot as its customization, so the platform's boot registration rewrote the app's skill.
- A package's first item of a name no longer takes over the bare slot when the platform's record is in it; the two stay side by side. The environment's own item in the bare slot is still taken over, as before.
- `MetadataManager.unregister(type, name, { origin: 'platform' })` withdraws the platform's record only: the name's package-less slot, from the registry, every loader and every cluster peer. A package's item of the name is never taken, and nothing is refused however many packages hold it. Before, a removal naming no package took every slot of a name one package held.
- `MetadataManager.getPlatformItem(type, name)` reads the platform's record only, never a package's item and never the environment's own.
- No other write carries the platform stamp: `register` without `origin: 'platform'` stores the body without `_provenance: 'platform'`, except a stored row the boot pass re-registers as it read it. A body that names a package is that package's item, whatever `_provenance` it carries.
- Reads naming no package, and every removal and write without the option, keep their rules.
- Public API added on `MetadataManager`: the `origin` option of `MetadataRegisterOptions` and `MetadataUnregisterOptions`, and `getPlatformItem`. The spec's `MetadataWriteOptions` is not widened.

Callers that register built-ins at boot pass `{ origin: 'platform' }` to `register` and `unregister` to get this behaviour; without it, a write is treated as before.
