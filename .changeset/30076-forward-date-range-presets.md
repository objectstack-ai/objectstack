---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/lint': patch
'@objectstack/verify': patch
'@object-ui/core': minor
'@object-ui/components': minor
'@object-ui/i18n': minor
---

feat(spec): three forward date-range presets: `next_month`, `next_quarter` and `next_30_days`

Clause-②: yes (widening)
Metadata-protocol: added

The relative dates a dashboard date filter and the filter builder offer looked only backward. A forecast asks forward: what closes next month, next quarter, in the next 30 days. Those questions had to use a custom range, whose fixed dates go stale.

`DATE_RANGE_PRESETS` now also declares `next_month` (the whole of next month), `next_quarter` (the whole of next quarter) and `next_30_days` (today and the 30 days after it, the mirror of `last_30_days`). Every place that accepts a preset accepts them: `dashboard.dateRange.defaultRange`, a date global filter's `defaultValue`, the filter builder's `between` row and `AnalyticsQuery.timeDimensions[].dateRange`. They sit beside the family they extend in the filter bar: `next_month` after `last_month`, `next_quarter` after `last_quarter`, `next_30_days` after `last_90_days`. Their `DATE_RANGE_PRESET_MACRO_WINDOWS` rows follow the inclusive last-day convention: `['{next_month_start}', '{next_month_end}']`, `['{next_quarter_start}', '{next_quarter_end}']` and `['{today}', '{30_days_from_now}']`. A preset name written as a bare filter comparand is refused with that window as the prescription, as for the other presets.

`@objectstack/core`'s `resolveAnalyticsDateRangePreset` resolves the three in its half-open form. `next_30_days` stops before `{31_days_from_now}`. `next_month` and `next_quarter` stop before the month and the quarter after next, which no macro token names: the resolver reads `next_month_start` (or `next_quarter_start`) again from the start of the day it named, so the end is still a day the one token resolver computed. No macro token is added.

In the console, the three presets have labels in all ten locale packs, and the client date-macro resolver now answers `{next_month_end}` and `{next_quarter_end}`, two spec tokens it did not resolve before. `@objectstack/verify`'s dashboard-window proof also writes fixture rows on a forward preset's future edges, so it judges the three new windows; the days it writes for the other presets are unchanged. `@objectstack/lint` changes documentation only.
