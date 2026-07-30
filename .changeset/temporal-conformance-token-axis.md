---
"@objectstack/spec": minor
---

feat(spec): the temporal conformance matrix gains its relative-token axis (ADR-0053 D-A3, #4081)

The matrix (#4098) landed with the token axis documented as still open — the
cases took resolved comparands, while authors actually write `{today}` /
`{90_days_ago}` / `{current_month_end}`, and nothing proved the resolved
token reaches the same rows on every backend. Closed here:

- `TemporalCase` gains `tokenFilter?` (the same filter spelled in tokens) and
  `dateRange?` (the analytics `timeDimensions.dateRange` spelling of the same
  window — the surface #3650 broke), plus the pinned instant `TEMPORAL_NOW`
  consumers hand to `resolveFilterTokens`. A resolver drift and an evaluator
  drift are now distinguishable at a glance: the literal spelling fails for
  one, the token spelling for the other.
- `TemporalRow` gains `writerForm` (`wire` ISO string vs `native` `Date`), so
  driver consumers seed genuinely mixed writer populations through their own
  `create()` — the exact column shape that produced #4047 (D-E4).
- New rows/cells: a pre-epoch row (negative epoch ms, the #3773 family), and
  the `date` equality/`$in` cases — #1874's original `date == today` shape.
- Two more sweeps consume the table: a `driver-sqlite-wasm` conformance test
  pinning the inherited SqlDriver seam, and a legacy-storage sweep in
  `driver-sql` running every case over an un-backfilled mixed epoch/naive
  column through the read-repair path.
