---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the per-package layer stamps a row with its own package's envelope, never another package's (#28831)

Clause-②: no — the stamp is on the per-package layer (`getMetaItemsPerPackage`), which no door serves as it is: the package export drops every `_`-prefixed key, and the anonymous form doors' withdrawal judgement matches by view name. No accept set, export or served answer moves.
Metadata-protocol: none

`getMetaItemsPerPackage` seats each stored row under its own package, and the #22024 envelope graft looked up the item's artifact at that package. When the package ships no artifact of the name, the artifact lookup falls back to the first code package that does, so a dependent package's row, or a `.custom` pair's undeclared row, under a base item's name read the base's `_packageId`, `_packageVersion` and `_provenance`.

- **Now.** On the per-package layer an item bound to a package wears its own package's artifact envelope, or none.
- **Kept.** A `.custom` pair's declared override keeps the base's envelope it is served under, judged by `isServedOverrideRowOf` on the row's own `package_id` at the item's bundle member. An item bound to no package keeps the lookup's answer.
- **Unchanged.** The artifact lookup (`registry.getArtifactItem` and its fallback) for every other caller, and every other read: the effective list, the by-name read and the execution list.
