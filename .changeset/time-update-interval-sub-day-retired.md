---
"@objectstack/spec": minor
"@objectstack/driver-memory": minor
---

fix(spec)!: `TimeUpdateInterval` retires its three sub-day intervals and derives its members from `DateGranularity` (#17296)

<!-- adr-0087: registered time-update-interval-sub-day-retired, cube-sub-day-granularities-removed -->

## ADR-0087 disposition

`second`, `minute` and `hour` leave a published closed enum that reaches TWO authored sites: an analytics request body's `timeDimensions[].granularity`, and an analytics cube dimension's `granularities[]`, which is stored metadata (`defineCube()` / `defineStack({ analyticsCubes })`). The stored half is rewritten by the D2 conversion `cube-sub-day-granularities-removed`, which strips the retired members from `analyticsCubes[].dimensions.<dim>.granularities` and drops the key entirely when nothing coarser remains (an empty list would read as "offers none", the absent key as "offers all"). The semantic entry `time-update-interval-sub-day-retired` carries the half no transform can decide: a dimension that offered ONLY sub-day intervals needs an author to say what it actually serves. `day`, `week`, `month`, `quarter` and `year` are untouched and parse byte-identically.

**BREAKING** for anyone authoring or sending `granularity: 'second'`,
`'minute'` or `'hour'`, and for anyone importing the `TimeUpdateInterval`
TYPE. Landing in the
launch window as `minor` under the lockstep convention this cluster's siblings
already use.

## What was wrong

`TimeUpdateInterval` declared **eight** intervals. The rest of the contract
never carried three of them, and this is the measurement rather than the
argument:

| layer | declares |
|:---|:---|
| `TimeUpdateInterval` (`data/analytics.zod.ts`) | **8** — the five below plus `second`, `minute`, `hour` |
| `DateGranularity` (`data/query.zod.ts`) — what a `groupBy` entry and every driver bucket expression are typed by | 5 |
| `@objectstack/core`'s `BUCKET_GRANULARITIES` — the canonical bucket-KEY output contract a drill-down crosses | 5 |
| `driver-mongodb`'s `MONGODB_DATE_GRANULARITIES` | 5 |

`DriverCapabilitiesSchema.supports.queryDateGranularity` — the one mechanism a
backend has for saying which granularities it buckets natively — is a
`z.record(DateGranularity, boolean)`. Measured: `{ day, week, month, quarter,
year }` parses; the same record plus `hour` raises `unrecognized_keys: ["hour"]`.
**No driver could advertise sub-day bucketing even if it had one.** That is what
makes this a retirement rather than a capability gap: a declared value one
backend cannot serve is a gap and the contract has a place to say so, but a
declared value *no* backend can even claim has no counterpart anywhere in the
contract that carries it.

Driven against the built packages, two rows fourteen hours apart on one UTC
calendar day, before this change:

| face | `granularity: 'hour'` | `granularity: 'day'` (control) |
|:---|:---|:---|
| `driver-memory` analytics | `NOT_IMPLEMENTED` / 501 | 1 group, `2026-09-06` |
| `driver-mongodb` bucket builder | `NOT_IMPLEMENTED` / 501 | `$dateToString` `%Y-%m-%d` |
| engine in-memory aggregation — the fallback every SQL/ObjectQL analytics query carrying a granularity lands on, since `NativeSQLStrategy` declines on a granularity | **200, 2 groups keyed on the RAW instant** | 1 group, `2026-09-06` |

Two honest refusals and one silently wrong answer. No third behaviour, and no
backend that bucketed it.

## What changed

- `TimeUpdateInterval` is now `z.enum(DateGranularity.options, …)` — the members
  come from the single source instead of a second literal list that disagreed
  with it by three members for as long as both existed.
- A refusal message splits two populations that are not the same mistake: a
  **retired** sub-day name gets the retirement and the `os migrate meta --from
  17` line; anything else gets the vocabulary. `driver-memory`'s own analytics
  door carries the same split.
- `driver-memory`'s `NOT_IMPLEMENTED` / 501 answer for these three is **not
  silenced** — the declaration it announced is gone, so the class moves to the
  400 the retirement makes correct. The 501 arm stays, and a pin measures that
  its population is now empty (`TimeUpdateInterval.options` equals
  `BUCKET_GRANULARITIES`), so the day one of the two is widened alone it lights
  up again instead of a freshly declared value being called undeclared.

## What this does NOT decide

Sub-day analytics bucketing as a **capability**. Offering it means widening
`DateGranularity`, the `queryDateGranularity` record, the canonical bucket-key
vocabulary and every driver's bucket expression together — new capability,
decided as such, rather than a name that parses in one enum and resolves
nowhere.
