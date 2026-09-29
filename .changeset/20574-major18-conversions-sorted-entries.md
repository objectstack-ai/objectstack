---
'@objectstack/spec': patch
---

refactor(spec): protocol 18's conversions are authored as identifier-sorted entries with an explicit application order — no value changes (#20574)

Nothing a consumer reads changes. `CONVERSIONS_BY_MAJOR[18]` (46 conversions, same
order), `ALL_CONVERSIONS` (113, same order) and `MIGRATIONS_BY_MAJOR[18].conversionIds`
are value-identical to the previous release, so the loader and the migration chain
apply the same conversions in the same sequence.

What changed is how the list is written, so two major-18 retirements can be in flight
at once without conflicting in `packages/spec/src/conversions/registry.ts`:

- `CONVERSIONS_BY_MAJOR[18]` is read off `MAJOR_18_CONVERSIONS`: one
  `{ conversion, order }` entry per conversion, kept sorted by the conversion's
  identifier and applied by ascending `order` (ties by the conversion's `id`). A
  retirement adds ONE entry where its identifier sorts — never at the end — with
  `order` one more than the highest present.
- A new conversion is defined directly above the definition of the entry that follows
  it in that list, not at the end of the definitions.
