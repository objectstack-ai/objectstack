---
"@objectstack/driver-memory": minor
---

`driver-memory` analytics honours `AnalyticsQuery.timezone` when it resolves a string `dateRange`, instead of accepting the field and answering on UTC (#16042)

`AnalyticsQuerySchema` declares `timezone` optional with no default precisely because an absent value is a meaningful state the engine resolves (`selection.timezone ?? context.timezone ?? 'UTC'`, ADR-0053 Phase 2), and `service-analytics` resolves that whole chain and writes the answer into `query.timezone` before a driver ever sees it. `parseDateRangeString()` never read it: a caller asking `dateRange: 'today'` with `timezone: 'Asia/Shanghai'` was accepted, warned about nothing, and answered on the UTC day.

⚠️ **This changes which rows a query answers for a caller already passing `timezone`.** Measured at `2026-09-06T20:00:00Z` with `timezone: 'Asia/Shanghai'`, `'today'`:

| | window | rows selected, from the same 8 probes |
|:--|:--|:--|
| before | `[2026-09-06T00:00:00.000Z, 2026-09-07T00:00:00.000Z)` — the UTC day | `06T00:00:00.000Z`, `06T15:59:59.999Z`, `06T16:00:00.000Z`, `06T23:59:59.999Z` |
| after | `[2026-09-06T16:00:00.000Z, 2026-09-07T16:00:00.000Z)` — Shanghai's day | `06T16:00:00.000Z`, `06T23:59:59.999Z`, `07T04:00:00.000Z`, `07T15:59:59.999Z` |

Four rows either way, and **two of the four are different rows**: `2026-09-06T00:00:00.000Z` and `2026-09-06T15:59:59.999Z` leave the answer (they are yesterday in Shanghai), `2026-09-07T04:00:00.000Z` and `2026-09-07T15:59:59.999Z` join it (they are today in Shanghai). Both row sets are asserted against the real `MemoryAnalyticsService.query()` entry, in the same test, so the before is measured rather than recalled.

A query carrying **no** timezone is byte-identical to before: `zonedDateStartToUtcMs` returns plain UTC midnight for an unset, `'UTC'`, or unknown zone, so #15825's repair — the common case — is untouched, and both of its pins stay green.

Two halves, each of which fails silently on its own and each of which is pinned: the reference timezone decides **which** calendar day `'today'` is (`calendarPartsInTzOrUtc`, the `proxyDay()` pattern), and **where that day begins as an instant** (`zonedDateStartToUtcMs` — that zone's local midnight, which is what ADR-0053 already specifies for a `datetime` bound in `service-analytics`' drill ranges). Resolving only the first would anchor to the zone's calendar day and then cut it at UTC midnight — a window that is neither the UTC day nor the zone's. The end bound is a calendar step, never `+ 86_400_000`: on `America/New_York`, 2026-03-08 is 23 hours long.
