---
"@objectstack/runtime": patch
---

fix(runtime): a flat-manifest bundle no longer collects every seed dataset twice

`AppPlugin.start()` collects seed data from two locations — the top-level
`data` field, then the legacy `manifest.data` for backward compatibility. The
legacy read resolves its base as `this.bundle.manifest || this.bundle`, so on a
FLAT bundle — manifest fields written directly on the bundle rather than nested
under `manifest:`, a shape `AppPlugin` supports by design and this repo's own
tests construct — it re-read the very array the top-level read had just
contributed. Every dataset landed in the collection twice.

`mergeSeedDatasets` is a plain `push` with no de-duplication, so both copies
reached the shared `seed-datasets` registry, the inline boot seed, and every
later per-org replay. For an `upsert` dataset with an `externalId` the second
pass is idempotent and the cost is doubled work; for a `mode: 'insert'` dataset
it is the dataset APPLIED TWICE per boot — measured here as two `insert` calls
for one record.

The legacy read now carries the same reference guard its sibling collector has
always carried: `loadTranslations()` performs the identical two-location read
and skips the legacy half when `manifest.translations` IS the array the top
level already contributed. That asymmetry between the two collectors was the
whole defect, so the repair is the sibling's guard rather than a third spelling
of the same idea.

⛔ Not a removal of the legacy read: a bundle whose `manifest.data` is a
genuinely different array from its top-level `data` still contributes both, and
a bundle that nests its manifest is unaffected either way. Nothing is added to
or removed from any published surface.
