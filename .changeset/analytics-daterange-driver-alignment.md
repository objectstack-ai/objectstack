---
"@objectstack/core": minor
"@objectstack/driver-memory": minor
"@objectstack/service-analytics": minor
"@objectstack/spec": patch
---

fix(analytics)!: every analytics face lowers the closed `dateRange` preset vocabulary to one window and refuses the rest with `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` (#16322)

<!-- adr-0087: not-required (already-registered analytics-time-dimension-date-range-vocabulary-closed) the driver half of #16041 implements the migration that card registered; the accept set narrowed at the contract there, and the prescription an author needs is that entry's, unchanged -->

**BREAKING** for an in-process caller that reaches an analytics face PAST the
schema door with a string the closed vocabulary does not contain: it used to be
answered, and is now refused. Shipped as `minor` under the repo's launch-window
convention. The driver half of #16041, whose spec change closed
`AnalyticsQuery.timeDimensions[].dateRange`'s string arm to the thirteen
dashboard preset names; every value affected here was already refused at
`POST /analytics/query` and `/analytics/sql` when that landed.

## What was wrong

#16041 closed the contract; the faces behind it never aligned, so the defect it
abolished simply moved onto the newly-blessed vocabulary. Measured on the built
`driver-memory` dist over five probe rows (2020, 2026-08-31, 2026-09-05, now,
2099):

| input | before | after |
|:--|--:|--:|
| `today` | 1/5 | 1/5 |
| the other twelve declared presets | **5/5 — 2020 and 2099 included** | a real window each |
| `'not a range at all'`, `'Last 7 Days'` | 5/5 | `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` |

`driver-memory` recognised exactly `today`: every snake_case preset missed its
`startsWith('last ')` branch and fell to a `[range, range]` pseudo-window whose
two bounds were the preset's own NAME, which matched every `Date`-typed row
under BSON cross-type ordering. Both `service-analytics` SQL strategies lowered
the same names — and unrecognised strings, and `today` — to the point window
`created_at >= 'last_30_days' AND created_at <= 'last_30_days'`, whose answer is
whatever the dialect decides a vocabulary word compares as. So a dashboard
asking for one month got all of history on one backend and a nonsense
comparison on the other, at HTTP 200 on both.

## What it does now

- **One lowering, in `@objectstack/core`.** `resolveAnalyticsDateRangePreset` /
  `resolveAnalyticsDateRangeString` resolve every declared preset to
  `{ start, end, endExclusive }`. The window is a pair of `{date-macro}` tokens
  handed to the existing macro resolver, so `dateRange: 'this_month'` and a
  `{month_start}` filter token cannot answer differently, and the anchoring on
  `AnalyticsQuery.timezone` (#16042) plus the one-calendar arithmetic (#15825)
  come from that resolver rather than from each face.
- **One refusal.** `analyticsDateRangeUnrecognizedError` stamps the ADR-0112
  envelope `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` with the spec's own
  `analyticsDateRangeRefusalMessage` wording — the same sentence the schema door
  answers with. `driver-memory`, both SQL strategies and the draft-preview evaluator call
  it, so "memory and SQL refuse identically" is one function rather than an
  agreement.
- **The upper bound keeps #16179's separation.** A window a face RESOLVED is
  compared exclusively (`$lt` / `<`) for the ten calendar presets and
  inclusively for the three rolling `last_N_days`, whose bound is NOW; an
  explicit `[a, b]` a CALLER wrote is untouched and keeps `$lte`.
- The fifteen `driver-memory` date-range pins #16041 retired are reinstated in
  preset form (DST cells re-measured under calendar semantics, not re-spelled),
  and one cross-face conformance fixture holds all FOUR faces to the same
  windows and the same refusal.
- **The draft-preview evaluator is the fourth face**, and it is in that fixture
  for the same reason the other three are. `preview-evaluator.ts` (ADR-0037 P3 —
  the Live Canvas preview over a pending seed draft) carried the identical
  `[range, range]` fallback, so a valid `last_30_days` selected NOTHING there,
  silently, while the published chart beside it answered a real window — across
  a publish boundary the preview exists to make continuous, since publish
  materialises the same seed.

## FROM → TO

Unchanged from #16041's — the spelling that is refused here is the spelling that
was already refused at the door.

| you wrote | write instead |
|:--|:--|
| `dateRange: 'Last 7 days'` / `'last 7 days'` | `dateRange: 'last_7_days'` |
| `dateRange: 'last 3 months'` | `dateRange: 'last_90_days'`, or an explicit `['{90_days_ago}', '{today}']` |
| `dateRange: '2026-01-20'` (the SQL single-day dialect) | `dateRange: ['2026-01-20', '2026-01-20']` |
| `dateRange: ['2026-01-01', '2026-01-31']` | unchanged |

The `@objectstack/spec` entry is a `PROVENANCE_WAIVERS` row only: the refusal's
code stays registered under `@objectstack/runtime` (the door that names the wire
vocabulary), and the waiver records that the shared constructor spelling it
lives one package over.
