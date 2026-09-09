---
"@objectstack/core": minor
"@objectstack/objectql": minor
"@objectstack/driver-memory": minor
---

fix(driver-memory)!: an analytics time dimension buckets by its declared `granularity`, and refuses a sub-day one instead of ignoring it (#16178)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed. `packages/spec` is untouched: `TimeUpdateInterval` still declares all eight intervals, `AnalyticsQuery.timeDimensions[].granularity` keeps its name, its type and its optionality, and every analytics request body parses byte-identically to before — so `objectstack migrate meta` has nothing to rewrite and this changeset carries no rewrite instructions. What narrows is one BACKEND's accept set at request time: `driver-memory`'s analytics face refuses the three sub-day granularities it cannot label, where it previously accepted them and produced an ungrouped answer. The remedy is a coarser granularity in the request itself, which is data a caller holds rather than an authored artifact with a stored representation; the spec-side narrowing of `TimeUpdateInterval` is filed separately as a `domain:spec` card under ADR-0049 and is deliberately not performed here. The other two packages add exports and relocate an implementation, both additive. -->

**BREAKING** in two senses, both on `driver-memory`'s analytics face, landing in
the launch window as `minor` under the lockstep convention this cluster's
siblings already use:

- an accepted request now answers **differently**: a time dimension carrying a
  `granularity` folds its rows into calendar buckets instead of returning one
  group per distinct timestamp. Every affected answer was wrong before;
- an accepted request is now **refused**: `granularity: 'second' | 'minute' |
  'hour'` answers `NOT_IMPLEMENTED` / 501 instead of being silently dropped.

## What was wrong

`AnalyticsQuery.timeDimensions[].granularity` is declared by the spec and a cube
dimension enumerates the granularities it offers (`granularities: ['day']`).
`memory-analytics.ts` read neither. The `$group` stage keyed on the raw field
path, so a time dimension bucketed **one group per distinct timestamp** — one bar
per row in a "new accounts by month" chart, which is the symptom #3588
catalogued and repaired for `service-analytics`.

Measured through the public entry against the built package, two rows on one UTC
calendar day (`2026-09-06T01:00:00Z` and `2026-09-06T23:00:00Z`) under
`granularity: 'day'`:

| | before | after |
|:--|--:|--:|
| `granularity: 'day'` | **2 groups**, keyed on the raw instants | 1 group, `2026-09-06` |
| no granularity (control) | 2 groups | 2 groups, unchanged |
| `granularity: 'hour'` | **2 groups**, silently | `NOT_IMPLEMENTED` / 501 |

The emitted pipeline was byte-identical across all three, which is the whole
finding: the request was accepted, no warning was emitted, and the key was inert.

## What it does now

- **One forward labeller, in `@objectstack/core`.** `bucketDateKey(value,
  granularity, timezone)` sits beside the inverse `bucketKeyToCalendarRange` and
  the `calendarPartsInTzOrUtc` primitive it builds on, and it is now the only
  statement of the rule. `BUCKET_GRANULARITIES` and `isBucketGranularity` name
  the five granularities that HAVE a canonical key, so a face that must refuse
  the other three quotes the accepted set instead of hand-listing it.
- **`@objectstack/objectql`'s `bucketDateValue` is a delegate**, export name and
  signature unchanged, answers unchanged — pinned across granularity, timezone
  and input form rather than asserted. A driver that pushes the bucket down into
  SQL and this in-memory path must label one instant identically or a drill-down
  breaks at the seam, and that is now one function rather than an agreement
  between two.
- **`driver-memory` folds by granularity before its `$group`.** The pipeline is
  cut at that stage: the `$match` half still runs in the driver, the bucket keys
  are written onto the selected rows, and the grouping half runs over those. The
  key travels under a synthetic field rather than overwriting the row's own, so a
  member that is both a group key and a measure's aggregand still ranks instants
  in `max()` while grouping on the label.
- **The output vocabulary is the published one** — `2026`, `2026-Q3`, `2026-09`,
  `2026-09-06`, `2026-W36`. The week label is `YYYY-Www`, never the Monday's
  `YYYY-MM-DD`: `DriverCapabilitiesSchema.queryDateGranularity` calls this an
  output contract, and a second spelling is what breaks a drill-down across a
  backend seam.
- **Bucketing honours `AnalyticsQuery.timezone`** — the same reference zone
  #16042 threaded through the `dateRange` window resolver, so the window that
  selects the rows and the bucket that folds them agree on where a calendar day
  starts. The same two rows answer one group in UTC, two in `America/New_York`
  and two in `Asia/Tokyo`. An absent zone buckets in UTC, the resolver's default.
- **`second` / `minute` / `hour` are refused at compile**, in the ADR-0112
  envelope this driver's other capability gaps speak (`NOT_IMPLEMENTED` / 501,
  the class `refusePerAggregationFilter` uses for the same reason: the query is
  spelled correctly, the spec declares the value, and it is this backend that
  compiles nothing for it). The canonical key vocabulary defines no label for a
  sub-day bucket, so there is no string another backend's pushed-down SQL would
  agree with. Passing it through unbucketed is this card's own defect wearing a
  new name.

## If a caller is refused

A stored widget or a request asking for a sub-day granularity was never bucketed
by this backend — it received one group per distinct timestamp under an ordinary
200. Nothing that worked stops working. Ask for `day` or coarser and the answer
is a real bucket; keep the raw timestamps deliberately by dropping the key, which
is the behaviour that key used to produce by accident.
