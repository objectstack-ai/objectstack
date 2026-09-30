---
"@objectstack/core": minor
"@objectstack/service-analytics": patch
"@objectstack/trigger-schedule": patch
---

fix(core): a date or time in the years 0001..0099 is read as written, not as 1900..1999, wherever a UTC instant is built from year / month / day / time parts

`Date.UTC(year, …)` and `new Date(year, …)` read a year from 0 to 99 as 1900 + year. Core built its instants from parts that way, so every day of the years 0001..0099 (inside the supported range 0001..9999) landed in the 1900s at the sites below, with no error.

- `@objectstack/core`: **new export** `wallClockToUtcMs(parts)`, the epoch milliseconds of a `WallClockParts` read as UTC. It is `Date.UTC` without the two-digit-year remap: `month` is 1-12, omitted time components are 0, and every component rolls over past its end as `Date.UTC` rolls it (`month: 13` is next January, `day: 0` the previous month's last day, `hour: 24` the next midnight). A `NaN` component gives `NaN`. Every site below now builds through it:
  - `zonedWallClockToUtcMs` and `zonedDateStartToUtcMs`, the wall clock and the zone-offset read. The offset read also takes the zone's era, so a wall clock early on 0001-01-01 in a zone west of UTC, whose offset probe lands in year 0, reads right.
  - `bucketKeyToCalendarRange` (`0050` spans 0050-01-01..0051-01-01, not 1950..1951; `0050-01-01` as a `day` key is no longer `null`) and `bucketDateKey`'s ISO week (0050-01-01 is in week 52 of 0049, not of 1949).
  - The date macros: `{1976_years_ago}` resolves to `0050-09-30`, not `1950-09-30`. A macro that lands in 0001..0999 is now spelled with a four-digit year, as the `date` storage form spells it (`0055-06-15`, not `55-06-15`, which names no day).
- `@objectstack/service-analytics`: the preview evaluator's `week` key and the `compareTo` bucket alignment build their days through `wallClockToUtcMs`.
- `@objectstack/trigger-schedule`: a time-relative window's day bounds build through `wallClockToUtcMs`.

What an author sees: `POST /api/v1/data/:object/import` stores the `datetime` cell `0050-01-01 10:00` as `0050-01-01T10:00:00.000Z`, and in `Asia/Shanghai` as `0050-01-01T01:54:17.000Z` (the zone's local mean time for that year). Before, it stored `1950-01-01T10:00:00.000Z` and `1950-01-01T02:00:00.000Z` and reported the row `ok`. Measured through the import route and read back through `POST /api/v1/data/:object/query` on SQLite and PostgreSQL 16; the `2026-07-15 10:00` control is stored the same before and after. Every year from 0100 on builds exactly as before.
