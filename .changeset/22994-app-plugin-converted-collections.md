---
'@objectstack/runtime': patch
---

`GET /api/v1/meta/<type>` now lists an artifact's items in their converted shape, the shape `GET /api/v1/meta/<type>/<name>` serves

Clause-②: no

A compiled artifact built before a spec retirement still carries the retired key, and the ADR-0087 forward conversion rewrites it when the artifact boots. The artifact door converted it, so the item read served the converted copy. `AppPlugin` handed the RAW bundle to the engine registry, which is what the list read, `getMetaItemsForExecution` and the email template loader read. So the list served the retired key with `_diagnostics.valid: false`, and a reader of the list (the email loader is one) was handed an item the current schema refuses. Measured with `os dev -a dist/objectstack.json --fresh` on an artifact that declares no `engines.protocol` and carries a dashboard with `refreshInterval: 300`: the item read served `refreshIntervalSeconds: 300`, valid, and the list served `refreshInterval: 300`, invalid.

`AppPlugin` now runs one forward conversion per boot, after the protocol handshake, over the same definition its security registrar already converted. The registry and that registrar both register from its result. An artifact authored in the current spellings registers exactly what it did before, because a conversion that changes nothing returns its input.

The security seeders read the same registry copy first, so a boot with an engine now seeds what the conversion produced. Measured on `createStandaloneStack` with a `>=17.1.0` artifact: a sharing rule declared with the legacy recipient type `role` is now seeded as `position`, where it used to be skipped as an unmappable recipient. A seeded permission set no longer stores the retired `allowRestore` / `allowPurge` or the row-level-security `priority`.

One case is unchanged: a bundle that carries `packages[]` still hands its package bodies over as authored. No conversion reaches those bodies, at the artifact door either.
