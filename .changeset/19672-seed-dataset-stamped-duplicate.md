---
"@objectstack/runtime": patch
---

A seed dataset declared **once** on an **additive** multi-package artifact (one that carries its collections both flattened at the top level and under `packages[]`) is now registered once per boot. Before this, it reached the shared `seed-datasets` registry twice, so a `mode: 'insert'` dataset wrote its rows twice on every boot and again on every per-organization replay.

The cause was the identity check that stops the two halves of an additive artifact from being read twice. A dataset has no `name`, so it is matched on its whole value. Boot registration stamps the ADR-0010 envelope (`_packageId`, `_provenance`) onto the package body's copy in place, and `AppPlugin` reads its collections after that. In a compiled `objectstack.json` the two halves are separate objects, so the stamped copy and the unstamped top-level copy no longer compared equal. The value comparison now leaves out the registration envelope. The key set comes from `MetadataProtectionFields` and is not listed by hand, so every nameless collection item is matched on what its author wrote.

Artifacts in this shape are still produced and loaded:

- Every multi-package artifact built before the emitter stopped writing the flattened copy has this shape. `os dev` without `--compile`, `os start` and `--artifact` / `OS_ARTIFACT_PATH` boot it as is after an upgrade.
- The current `composeStacks(…, { manifest: 'preserve' })` still emits this shape when the package bodies do not reproduce the flattened copy. Two examples are a standalone action bound to a sibling package's object, and an input with no `manifest`.

Nothing an author writes changes. An artifact whose datasets are all `upsert` ends up with the same rows as before; each dataset is simply no longer applied twice.
