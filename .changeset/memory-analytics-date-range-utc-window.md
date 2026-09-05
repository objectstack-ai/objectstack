---
"@objectstack/driver-memory": minor
---

`driver-memory` analytics resolves `dateRange` on the UTC calendar, so `'today'` and `last N ...` stop being offset by the process timezone (#15825)

`MemoryAnalyticsService.query()` lowers a string `dateRange` through
`parseDateRangeString()`, and that function built its window on the **local**
calendar and rendered it as **UTC**. Two independent defects lived in it.

**1. The window boundary was local midnight.** `new Date(y, m, d)` constructs
local midnight; `toISOString()` renders that instant in UTC. So in any process
not sitting at UTC, the `'today'` bucket was the **local** day expressed as a
UTC range. Measured 2026-09-05, with the clock at `2026-09-05T20:51Z`:

| `TZ` | `'today'` window produced | the UTC day it should be |
|:---|:---|:---|
| `UTC` | `2026-09-05T00:00Z` → `2026-09-06T00:00Z` | (agrees) |
| `Asia/Shanghai` | `2026-09-05T16:00Z` → `2026-09-06T16:00Z` | `2026-09-05T00:00Z` → `2026-09-06T00:00Z` |
| `America/Los_Angeles` | `2026-09-05T07:00Z` → `2026-09-06T07:00Z` | `2026-09-05T00:00Z` → `2026-09-06T00:00Z` |
| `Europe/Berlin` | `2026-09-04T22:00Z` → `2026-09-05T22:00Z` | `2026-09-05T00:00Z` → `2026-09-06T00:00Z` |
| `Asia/Kolkata` | `2026-09-05T18:30Z` → `2026-09-06T18:30Z` | `2026-09-05T00:00Z` → `2026-09-06T00:00Z` |

That is wrong on **every day of the year**, with no DST transition needed.

**2. The `last N ...` legs mixed two calendars.** `setDate(getDate() - n)` is
local arithmetic and `toISOString()` is a UTC rendering. `setDate` preserves
wall-clock time, so the instant moves `n × 24h` only while every local day in
the window is 24 hours long; across a DST transition it moves 23h or 25h and
the window start slips an hour. `setMonth` / `setFullYear` are the same class,
and can move it by a whole day: at `America/New_York` with the clock at
`2026-01-01T12:00Z`, `last 1 month` started at `2025-12-02T00:00Z` instead of
`2025-12-01T00:00Z`.

**⛔ The two do not fix each other**, which is the easiest thing to get wrong
here: `setUTCDate` alone leaves the local-midnight boundary in place, and
`Date.UTC` alone leaves the arithmetic mixed. Both are repaired, each is pinned
by its own file, and each was ablated on its own to prove the separation.

**Why UTC and not "any consistent calendar".** The rest of the platform
resolves a bare date to the UTC day — `@objectstack/core`'s `{today}`
filter-token macro builds its reference day as
`new Date(Date.UTC(year, month - 1, day))` and falls back to UTC parts when the
context carries no timezone, and `{TODAY()}` in flow templates resolves to the
UTC day (#14852 repaired the identical two-calendar shape there). Before this
change the same analytics question asked through the driver's `dateRange` and
through a flow token could select **different rows in one deployment**. UTC is
also the terminal fallback of the engine's own resolution chain
(`selection.timezone ?? context.timezone ?? 'UTC'`, ADR-0053 Phase 2).

**What did not change.** The parser's vocabulary, its `[range, range]`
fallback, and the shape of the emitted `$match` are untouched — this is a
calendar repair, not a rewrite. `AnalyticsQuery.timezone` is still not consulted
by this path; making the range tokens timezone-**aware** is a separate and
larger question, which #14852 also declined.

**Who sees a difference.** Any deployment whose process is not at UTC: `'today'`
and `last N ...` now select the UTC day they always claimed to, so charts built
on a string `dateRange` shift by the process offset — toward agreement with
`{today}` / `{TODAY()}` and with the same query run at `TZ=UTC`. Deployments
already running at UTC are unaffected; the two spellings are indistinguishable
there, which is exactly why CI never reddened on this.
