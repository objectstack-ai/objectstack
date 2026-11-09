---
'@object-ui/core': patch
'@object-ui/i18n': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-charts': patch
---

fix(core): a compareTo widget on a forward date range (next month, next quarter, next 30 days) compares with the period just before it, not with itself

Clause-②: no
Metadata-protocol: none

- **`@object-ui/core`: `shiftFilterByCompareTo`** with `kind: 'previousPeriod'` moved only `current_*` / `today` tokens, so a dashboard filtered to `next_month` or `next_quarter` compared the window with itself and the delta always read 0, and `next_30_days` (`{today}` … `{30_days_from_now}`) moved only its start and compared with a window that overlapped it on all but one day. A forward window now steps back one period: `{next_month_*}` becomes this month, `{next_quarter_*}` this quarter, and a `{today}` … `{N_days_from_now}` pair on one field becomes the N + 1 days that end yesterday (`{(N+1)_days_ago}` … `{yesterday}`), the same window the dataset executor computes for that range. Every other token, and the 13 backward presets, compare as before.
- **`@object-ui/core`: `compareToTrendLabelKey`** names that window: `vsThisMonth` for a forward month, `vsThisQuarter` for a forward quarter, and `vsPreviousPeriod` for a forward rolling window (it read `vsLastMonth`, `vsLastQuarter` and `vsYesterday`).
- **`@object-ui/i18n`:** `dashboard.trend.vsThisMonth` and `dashboard.trend.vsThisQuarter` in all ten locale packs (zh: 较本月, 较本季度).
- **`@object-ui/plugin-dashboard`, `@object-ui/plugin-charts`:** English fallbacks for the two keys in the metric tile and in the chart's comparison series label.
