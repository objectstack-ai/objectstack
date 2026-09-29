---
'@objectstack/spec': patch
---

refactor(spec): protocol 18's migration step keeps its `rationale` as key-sorted fragments and derives its `conversionIds` — no value changes (#20535)

Nothing a consumer reads changes. `MIGRATIONS_BY_MAJOR[18].rationale` (48,953
characters), `MIGRATIONS_BY_MAJOR[18].conversionIds` (45 ids, same order) and the
whole `MIGRATIONS_BY_MAJOR` value are byte-identical to the previous release, and so
is the rationale `migrate meta` prints for the 17 → 18 hop.

What changed is how the step is written, so two major-18 retirements can be in
flight at once without conflicting in `packages/spec/src/migrations/registry.ts`:

- The rationale is `STEP18_RATIONALE`, one `{ id, order, text }` fragment per
  retirement, kept sorted by `id` and rendered by `order`, joined with one space.
  A retirement adds ONE fragment where its `id` (its D3 semantic entry id) sorts —
  never at the end — with `order` one more than the highest present.
- `conversionIds` is read off `CONVERSIONS_BY_MAJOR[18]`, which it copied value
  for value. A retirement adds its conversion there only.
