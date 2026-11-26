---
'@objectstack/spec': minor
'@objectstack/metadata': minor
'@object-ui/data-objectstack': minor
'@objectstack/metadata-protocol': minor
---

fix(metadata): a skill the platform registers keeps its own slot beside an app's skill of the same name

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — no skills/ page names `_provenance` or its values, and the new value is one no author writes: the artifact door refuses it

`MetadataProvenanceSchema` (`@objectstack/spec/kernel`) gains `'platform'`: the `_provenance` of a record the platform's own code registers at boot. It is a store-slot marker only, read at the item's own top-level `_provenance` key and nowhere else, and only the metadata service sets it.

For every type stored per `(package, name)` (`skill`, `agent`, `tool` and the rest of `PACKAGE_SLOTTED_STORE_TYPES`), the platform's built-in record and a package's item of the same name no longer overwrite each other, in memory, in `sys_metadata`, and on a process or cluster peer that reads them back from the rows.

- `MetadataManager.register(type, name, data, { origin: 'platform' })` marks a record the platform's own code registers: the body is stamped `_provenance: 'platform'` and the record fills the name's bare slot, in memory and in `sys_metadata`. Before, a package-less write under a name one package held was folded into that package's slot as its customization, so the platform's boot registration rewrote the app's skill.
- A package's first item of a name no longer takes over the bare slot when the platform's record is in it; the two stay side by side. For a bundled type (`email_template`) the row judged is the written member's. The environment's own item in the bare slot is still taken over, as before.
- A package-less environment write under a platform name keeps today's rule: it takes the bare slot without the stamp, and the platform's next registration restores its record.
- The readers that rebuild the store from loaders and rows keep both records: the plural read (`loadMany`, `loadManyKeyed`) gives the platform's entry a key of its own, `list` keeps a loader's platform row beside a package's slot and a loader's package item beside a platform slot, and a read naming a package is never answered from the platform's record.
- `MetadataManager.unregister(type, name, { origin: 'platform' })` withdraws the platform's record only, from the registry, every loader (`MetadataLoaderDeleteOptions.platformOnly`) and every cluster peer. A package's item of the name and the environment's own item are never taken, for any type, and nothing is refused however many packages hold the name. Before, a removal naming no package took every slot of a name one package held. On a host that declares a package id, the boot pass leaves the platform's stored record without the host's package, for every type, so the withdrawal takes the registry's copy too.
- `MetadataManager.getPlatformItem(type, name)` reads the platform's record only, never a package's item and never the environment's own.
- No other write carries the platform stamp. `register` without `origin: 'platform'`, `registerInMemory`, `save` and `rollback` store the body without it, and so do the metadata protocol's save door and its restore doors (`rollbackMetaItem` and the restore limb of `revertCommit`) on every restore whose row is not the platform's own record; a stored row the boot pass re-registers keeps it only when the row held it as read. A restore whose row is the platform's own record is refused (`409 RESOURCE_CONFLICT`, naming the fix), with nothing written, at all three restore doors: `rollback`, and the metadata protocol's `rollbackMetaItem` and the restore limb of `revertCommit`. The metadata protocol's two undo writes, of a refused batch publish's landed promotions and of a batch row the registry refused, put a row back as the same operation found it, byte for byte, so the mark comes back only where the row held it. A body served from a loader other than a `datasource:` one is served without it; `getPublished` serves it on the answer's top level only when the stored item carries it there (the platform's own record's publish snapshot, served as the answer, keeps the mark it carries at its top), and never on a snapshot nested inside the answer; and the artifact door refuses an item that carries it, with or without a manifest id (`VALIDATION_ERROR` at `_provenance`, naming the fix). A `_provenance` key nested in the body (an authored `metadata` record, for one) is the author's data: it is kept as written and never read as the mark. A body that names a package is that package's item, whatever `_provenance` it carries.
- `@objectstack/metadata` exports the mark's one definition (`PLATFORM_PROVENANCE`, `carriesPlatformStamp`, `isPlatformOrigin`, `withoutPlatformOrigin`); the artifact door and the metadata protocol's doors read it.
- `@objectstack/metadata-protocol`: the boot census `metadata_sealed_overlay_unserved` no longer names the platform's own row beside a package that ships the name, nor prescribes deleting it.
- Reads naming no package, and every removal and write without the option, keep their rules.
- Public API added on `MetadataManager`: the `origin` option of `MetadataRegisterOptions` and `MetadataUnregisterOptions`, and `getPlatformItem`. The spec's `MetadataWriteOptions` is not widened.
- `@object-ui/data-objectstack`: the layered read's `provenance` is typed from the spec's `MetadataProvenance`, so it accepts `'platform'`.

Callers that register built-ins at boot pass `{ origin: 'platform' }` to `register` and `unregister` to get this behaviour; without it, a write is treated as before.
