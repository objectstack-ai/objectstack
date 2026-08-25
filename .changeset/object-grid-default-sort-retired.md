---
"@objectstack/spec": minor
---

feat(spec): retire `object-grid`'s legacy `defaultSort` fallback (#11805, ADR-0049)

<!-- adr-0087: registered object-grid-default-sort-removed -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`, per the maintainer's #11805
ruling — 「不需要major」; the migration prescription is registered under
protocol major 18, where `os migrate meta` users will look).

`ObjectGridPropsSchema.defaultSort` was the legacy second spelling of `sort`:
a single `{ field, order }` pair the renderer read only when `sort` was absent
— measured at the `.objectui-sha` pin (`190fbd01d`),
`plugin-grid/src/ObjectGrid.tsx:1244-1246` (the `$orderby` fetch fallback) and
`:2847`, where the header-arrow path wraps it `[schema.defaultSort]`, the
exact array shape `sort` carries. One intent, two spellings; objectui's mirror
schema is parity-test-only and parses nothing at runtime, so only this
strictObject can refuse the legacy spelling (objectui#5861 retires the
renderer's reads as the consumer half, on its own schedule).

FROM → TO:

- `defaultSort: { field, order }` (no `sort` beside it) →
  `sort: [{ field, order }]` — the same pair, wrapped in the array shape every
  read path honours.
- `defaultSort` beside an authored `sort` → *(removed)*. The renderer's own
  precedence made the fallback unread there, so the deletion is lossless.

One-line fix: rename the key to `sort` and wrap the value in an array;
`os migrate meta --from 17` lists the mechanical edits for existing sources.

The retirement kit:

- `retiredKey()` tombstone in `ObjectGridPropsSchema` — authoring the key is a
  tsc error (`never`) and a parse error carrying the wrap-and-rename
  prescription (the surface baseline line carries `[RETIRED]`)
- ADR-0087 registration: `ui/ObjectGridProps:defaultSort` in
  `RETIRED_KEYS_BY_MAJOR[18]`, and the D2 conversion
  `object-grid-default-sort-removed` (protocol 18) wired into the step-18
  chain — wrap-and-rename when `sort` is absent, a pure strip when `sort` is
  present
- pin tests (`component.test.ts`): a refusal pin asserting the prescription, a
  no-materialize pin, and a surviving-surface pin on `sort`
- zero authored occurrences in either repo's corpora (the card's measurement,
  re-run at dispatch), so no in-repo source changes ride along
