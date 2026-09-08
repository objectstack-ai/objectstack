---
"@objectstack/spec": minor
"@objectstack/runtime": minor
---

feat(spec)!: `timeDimensions[].dateRange`'s string arm closes to the date-range preset vocabulary; any other string is refused with `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` (#16041)

<!-- adr-0087: registered analytics-time-dimension-date-range-vocabulary-closed -->

**BREAKING** — an accept-set narrowing on a published analytics contract.
`AnalyticsQuerySchema.timeDimensions[].dateRange` (and with it the
`POST /analytics/query` / `/analytics/sql` bodies, `AnalyticsQueryRequestSchema`,
and the `AnalyticsQuery` type every driver and `AnalyticsService.query` caller is
typed against) used to accept ANY string. It now accepts exactly the thirteen
dashboard date-range preset names, derived from `data/date-range-presets.ts`
(`z.enum(DATE_RANGE_PRESETS)` — the vocabulary's single source of truth since
#4614, so the two cannot drift), or the unchanged `[start, end]` array arm.
Shipped as `minor` under the repo's launch-window convention for breaking
changes; the hand-migration prescription is registered under protocol major 18.
Maintainer ruling on #16041 (2026-09-06, decision batch #57, option A —
contract first, 「同意」): 「本项目以协议为基准。所以开发应该对其协议，协议有问题应该立卡修改协议」.

## What was wrong

The arm was a bare `z.string()` whose only documented example — `"Last 7 days"`,
in the schema's own comment — was a value no driver could parse. `driver-memory`
recognised exactly `today` and a case-sensitive `last N <unit>` and fell every
other string through to a `[range, range]` pseudo-window that (measured through
mingo, 2026-09-05) matched **every `Date`-typed row**, 2099 included, because a
`Date` compares above a `String` under BSON cross-type ordering. The SQL
strategies read the same bare string as a single ISO day. A dashboard asking for
one week silently got all of history on one backend and one day on the other,
at HTTP 200 on both.

## What it does now

- The string arm is `AnalyticsDateRangePresetSchema = z.enum(DATE_RANGE_PRESETS)`
  (`today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`,
  `this_quarter`, `last_quarter`, `this_year`, `last_year`, `last_7_days`,
  `last_30_days`, `last_90_days`); the schema example is corrected to
  `'last_7_days'`.
- Any other value raises ONE prescriptive issue at `timeDimensions.N.dateRange`
  (`analyticsDateRangeRefusalMessage`: the value, the vocabulary, the array
  spelling for an explicit window). `@objectstack/spec/data` exports the
  structural predicate `isAnalyticsDateRangeRefusalIssue` for doors.
- `POST /analytics/query` and `/analytics/sql` answer the ADR-0112 envelope
  **`400 ANALYTICS_DATE_RANGE_UNRECOGNIZED`** — a new `ERROR_CODE_LEDGER` member
  registered under `@objectstack/runtime` — and the analytics service is never
  reached. A body wrong in more places than the `dateRange` stays the generic
  `400 VALIDATION_FAILED` + `details.fields[]`.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `dateRange: 'Last 7 days'` / `'last 7 days'` | `dateRange: 'last_7_days'` |
| `dateRange: 'Last 30 days'` / `'last 30 days'` | `dateRange: 'last_30_days'` |
| `dateRange: 'last 3 months'` | `dateRange: 'last_90_days'`, or an explicit `['{90_days_ago}', '{today}']` |
| `dateRange: '2026-01-20'` (the SQL single-day dialect) | `dateRange: ['2026-01-20', '2026-01-20']` |
| `dateRange: 'This week'` | `dateRange: 'this_week'` |
| `dateRange: ['2026-01-01', '2026-01-31']` | unchanged |

Measured in this repository at the ruling: three authored `'Last 7 days'`, all
in `packages/spec` tests (re-spelled here), and no published dashboard authors
the string arm at all — the shipped console lowers presets to the array arm
before querying. The drivers' own refusal of a non-conforming value that reaches
them in-process (past the schema) is the sibling card #16322, blocked by this
one; the fenced `service-analytics` fixture that authors the retired bare-ISO
spelling is that card's to re-triage.
