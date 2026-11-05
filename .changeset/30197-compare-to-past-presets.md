---
'@object-ui/core': patch
---

fix(core): a compareTo widget on an already-past date range (yesterday, last week / month / quarter / year, last N days) compares with the period before it, and previousYear from 29 February stays in February

Clause-②: no
Metadata-protocol: none

- **`shiftFilterByCompareTo`, `kind: 'previousPeriod'`.** `{yesterday}` and the `last_*` tokens were never moved, so a dashboard filtered to `yesterday`, `last_week`, `last_month`, `last_quarter` or `last_year` compared the window with itself and the delta always read 0. They now compare with the period before them: `{yesterday}` with `{2_days_ago}`, and `last_week_*` … `last_year_*` with the week, month, quarter or year before last. The macro vocabulary has no token for "two periods back", so those windows are computed: the `last_*` start is resolved in the display zone, moved back one period, and the end is the day before it.
- **Rolling windows.** `{N_days_ago}` … `{today}` (`last_7_days`, `last_30_days`, `last_90_days`; N + 1 days) moved only its end and compared with the N days ending yesterday, which overlap it. It now compares with the N + 1 days before it, `{(2N+1)_days_ago}` … `{(N+1)_days_ago}`, the same window the dataset executor computes.
- **`kind: 'previousYear'` from 29 February** re-resolved the filter at 1 March of the year before (`new Date(2027, 1, 29)`), so `this_month` compared with March. The day is now clamped to the month's last day, 28 February.
- **`compareToTrendLabelKey`** reads all of these as `vsPreviousPeriod` (they read `vsLastWeek`, `vsLastMonth`, `vsLastQuarter`, `vsLastYear` and `vsYesterday`); no `dashboard.trend.*` key names "the month before last". `today`, the `this_*` and the forward presets compare and label as before.
