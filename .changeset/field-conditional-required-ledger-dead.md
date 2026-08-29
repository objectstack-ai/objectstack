---
'@objectstack/spec': patch
---

liveness ledger: re-classify `field.conditionalRequired` `live` → `dead` (#13043)

Both halves of the entry's evidence were falsified, not just its citation. It
claimed a `FieldSchema .transform` lowering `conditionalRequired` → `requiredWhen`
that drops the alias: `packages/spec/src/data/field.zod.ts` has **zero**
`.transform` calls — its only two occurrences of that token are comments recording
that `.overwrite()` was chosen instead (#6926). And its note leaned on
`packages/objectql/src/validation/rule-validator.ts` keeping a
`requiredWhen ?? conditionalRequired` fallback "on purpose"; #3903 retired that
fallback, because every path that hands the validator a stored field definition now
replays the ADR-0087 conversion chain at rehydration, so a pre-17 row arrives with
the alias already lowered. The absence is pinned by that module's own test ("does
NOT read the retired conditionalRequired alias — PD #12, no dialect fallback").

The alias and its lowering were removed together in protocol 17 (#3855, PR #3883,
landed 2026-07-28); the key has been a `retiredKey` tombstone ever since.

Data-only: no schema, no runtime, no authoring-surface change — authoring
`conditionalRequired` already failed `tsc` and the parse before this, and still
does. The row STAYS: per the `rls.priority` precedent a `retiredKey()` tombstone
keeps the key in the walked shape, so deleting the row would report UNCLASSIFIED.
`liveness/` is in this package's `files` array, so these ledgers ship in the npm
tarball and this is published data.

This was the last `path:NNN` citation in any ledger. Retiring it takes the gate's
line-citation counter to zero and closes #13003's symbol-anchor adoption worklist,
which is why the same change deletes the two non-vacuity floors that guarded that
population (and their guard comments) exactly as those comments instructed.
