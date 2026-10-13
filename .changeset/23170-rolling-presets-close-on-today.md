---
'@objectstack/spec': patch
'@objectstack/core': patch
---

fix(spec,core): the rolling `last_7_days`, `last_30_days` and `last_90_days` presets close on today, at the spec's prescription table, the save door's refusal and the analytics preset arm

Clause-②: no (no accept set widens: the three rolling windows gain the inclusive `{today}` end every calendar preset already has)

The three rolling windows were the open arm of `DATE_RANGE_PRESET_MACRO_WINDOWS`: `['{30_days_ago}', null]`, prescribed as `{ $gte: '{30_days_ago}' }`. A `$gte`-only window has no upper bound, so on a column that carries future dates (a close date, a due date) "last 30 days" also counted every later day. Measured on a `date` field with one row dated today−5 and one dated today+5: that window counted 2, while the console's preset lowering and the analytics preset arm counted 1.

- `DATE_RANGE_PRESET_MACRO_WINDOWS` now closes every rolling window on `{today}`: `last_7_days` is `['{7_days_ago}', '{today}']`, and `last_30_days` and `last_90_days` follow the same shape. That is the inclusive last-day end every calendar preset already uses, and the extent the console's lowering already selects. The table's declared type narrows to match, `readonly [start: string, end: string]` (it was `end: string | null`). A reader that compared `end` with `null` still compiles; that branch can no longer be taken.
- The save door's refusal of a bare preset comparand (`bareDateRangePresetComparandMessage`, and the `filter-preset-comparand` lint verdict that quotes it) now prescribes the closed window. For `last_30_days` it says: write `{ $between: ['{30_days_ago}', '{today}'] }`, where it used to say `{ $gte: '{30_days_ago}' }`.
- `@objectstack/core`'s `resolveAnalyticsDateRangePreset`, the preset arm behind `timeDimensions[].dateRange`, selects the same extent. A rolling window now stops before tomorrow begins in the reference timezone, exactly as `today` does, with `endExclusive: true`. It used to end at the reference instant, so it dropped rows stamped later today. Its ends keep this module's own "the day the window stops before" spelling (`tomorrow`). Every preset this resolver returns is now `endExclusive: true`, and a caller's explicit `[a, b]` window keeps its inclusive reading, as before.

If you followed the old refusal and authored `{ $gte: '{N_days_ago}' }` for a rolling preset, add `$lte: '{today}'`, or write the `$between` pair above, to stop counting future-dated rows.
