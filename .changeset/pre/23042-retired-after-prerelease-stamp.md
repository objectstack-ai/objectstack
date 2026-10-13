---
'@objectstack/spec': patch
---

The TSDoc on `MetadataConversion.retiredAfter` now says what a retirement stamps under a prerelease package label. Under a stable label `x.y.z` it is the label itself, as before. Under a prerelease label `x.y.z-PRERELEASE` (Changesets pre mode, such as `18.0.0-next.N`) it is the newest published stable release, which sits below `x.y.z`: never the prerelease label, which is not a stable `x.y.z`, and never `x.y.z`, the first stable release that carries the entry retired. The old wording, "the package's version label at the moment the retirement lands", had no value that type-checks under a prerelease label. A stable release published later that does not carry the retirement (a `17.x` maintenance release during the 18 prerelease) still accepted the old shape, so it becomes the value. Text only: `retiredAfter` keeps its `${number}.${number}.${number}` type, and the accepted set does not change.
