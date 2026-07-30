---
"@objectstack/spec": minor
---

feat(spec): temporal conformance matrix — the runtime regression backstop for date/datetime filter semantics (ADR-0053 D-A3, #4081)

The temporal seam broke four times (#3650, #3773, #3777, #4047), and each break
was found by a user hitting it, not by a test: every fix left behind a suite
proving its own issue against its own fixture, so nothing held the six
evaluation surfaces to one standard and the fifth divergence would again be
invisible.

`@objectstack/spec/data` now exports that standard — the temporal twin of
`FILTER_LOGIC_CASES` (#3774):

- **`TEMPORAL_CONFORMANCE_ROWS`** — one fixture spanning the boundaries the
  incidents turned on: an exact-midnight instant, intra-day times, the next
  day's midnight, a month's last millisecond abutting the next month's first
  instant, a leap day, a pre-epoch instant, and a `writerForm` tag (`wire` ISO
  string vs `native` `Date`) so drivers seed genuinely mixed writer
  populations (D-E4).
- **`TEMPORAL_CONFORMANCE_CASES`** — `{ name, fieldType, operator, filter,
  tokenFilter?, dateRange?, expected, note }`: field-type × operator ×
  bound-semantics (point vs whole-day, D-D2) × relative-token cells, asserting
  **row-id sets**, never emitted SQL. Each `note` names the incident the case
  guards.
- **`TEMPORAL_CONFORMANCE_NOW`** — the pinned instant consumers hand to
  `resolveFilterTokens`, so `{today}`/`{90_days_ago}`/period-token spellings
  must produce the same rows as their literal twins.

Six backends consume it through thin per-package tests: `driver-sql` (canonical
+ un-backfilled legacy storage; live PG/MySQL via CI's temporal job),
`driver-sqlite-wasm`, `driver-memory`, `driver-mongodb`, `formula`'s
`matchesFilterCondition`, and the analytics preview evaluator. A red cell now
names the backend that left the consensus and the issue it is about to
re-introduce — the signal all four incidents lacked.
