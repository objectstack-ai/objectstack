---
'@objectstack/service-analytics': patch
---

Draft-preview analytics: `count` over a declared field counts its non-null values, matching every live face

A dataset measure `{ aggregate: 'count', field: 'payer' }` compiles to the cube
metric `{ type: 'count', sql: 'payer' }`, and the draft-preview evaluator carried
that field in and never read it — it answered the ROW count, nulls included,
while every SQL face lowers the same measure to `COUNT("payer")`, defined over
non-null values. A drafted chart therefore showed a different number than the
published one, silently, and the number it showed was the one `count(*)` gives:
the author's choice to count a specific column had no effect on the preview path.

Measured on one dataset, one row set, two `AnalyticsService` instances differing
only in `draftRowsResolver` (the live half being `NativeSQLStrategy`'s generated
SQL on a real SQLite): rows `{meals, 'bob'}` and `{meals, null}` answered
`payer_count` 1 live and 2 on preview. Both now answer 1.

Unchanged, and pinned by the same differential: `count` with no field and `count`
with `field: '*'` still answer the row count (the compiler writes
`sql: m.field ?? '*'`, so the star is the "no field declared" spelling), and
`count_distinct` still answers a cardinality. A group in which no row carries a
value counts `0`, never null — `emptyGroupValueFor` rules counting nothing the
identity `0`.

The live path is unchanged.

Bumped `patch` rather than `minor`: the package's published surface is
byte-unchanged — `src/index.ts` is not in this diff, `aggregate()` is
module-private and `evaluateAnalyticsQueryOverRows` is not on the barrel — and
the only user-visible effect is a drafted chart's number moving to the number
the published chart already showed, which is a correction toward the live
standard rather than the backwards-compatible feature addition `minor` denotes.
