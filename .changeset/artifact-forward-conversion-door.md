---
'@objectstack/metadata-core': patch
'@objectstack/metadata': patch
---

Artifacts built by released 17.x tooling boot again on ≥17.2 runtimes: the artifact-ingestion door now runs a versioned ADR-0087 forward conversion before the strict parse (#12772).

A compiled artifact whose declared `engines.protocol` floor predates the running `@objectstack/spec` version replays the full conversion chain — retired entries included — before validation, exactly the policy the stored-row read path already applies to `sys_metadata` rows. Measured incident: `dist/objectstack.json` built by `@objectstack/cli` 17.1.0 carries the then-legal `allowRestore`/`allowPurge` permission bits (75 of each, injected by the released builder), and spec 17.2.0's `retiredKey` tombstone refused the boot with no operator remedy (`os migrate meta` targets sources, not built artifacts).

The conversion is versioned, not a blanket amnesty: an artifact authored at the current (or a newer) spec version converts nothing and still refuses at the tombstone — the retired keys return with the M2 lifecycle initiative (#1883), and artifacts authored against that surface are never stripped by history. Conversion notices surface operator-visibly and deduped, one summary line per conversion per artifact. New exports from `@objectstack/metadata-core`: `applyArtifactForwardConversions`, `resolveInstalledSpecVersion`, `parseRangeFloor`, `resolveDeclaredRange`.
