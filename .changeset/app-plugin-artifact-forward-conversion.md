---
'@objectstack/runtime': patch
---

AppPlugin's bundle path runs the same ADR-0087 forward conversion as the artifact door

On an artifact boot the stack-declared security metadata (`positions`,
`permissions`, `capabilities`, `sharingRules`) reached the metadata registry
through two independent readers: the artifact door
(`MetadataPlugin._parseAndRegisterArtifact`), which replays the versioned
ADR-0087 forward conversion before its strict parse, and `AppPlugin`'s ADR-0057
block, which registered the bundle from `loadArtifactBundle` raw. The two copies
of the same item therefore differed, and which one a consumer saw depended on
registration order. `AppPlugin` now consumes the door's own
`applyArtifactForwardConversions` policy, so both copies carry the canonical
shape for every key the conversion layer governs.
