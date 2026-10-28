---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a `compareTo` dataset answer also returns the time buckets that are empty in both windows (#27111)

Clause-②: no — no input is refused or newly accepted and no export or type changes; a `compareTo` dataset answer gains the rows for the time buckets no record fell in, in either window, which it used to leave out
Metadata-protocol: none

The empty time-bucket fill for a date-dimension series did not run when the selection carried a `compareTo`, so a period-over-period trend still dropped a month that held no record in either window, and a chart drew the months on either side of it as neighbours. `queryDataset` (and `POST /api/v1/analytics/dataset/query`) now fills a `compareTo` answer by the same rule as a plain series:

- **Which buckets.** The primary window decides: every bucket of the time axis's own `dateRange`, never the shifted one. A bucket that holds records in either window already comes back, with the same values as before; only a bucket empty in both windows is added. An axis with no `dateRange` of its own (the comparison anchored on another, window-only date) gets only the gaps between its first and last bucket filled.
- **Their values.** The same values an empty group reads, for the measure and for its `<measure>__compare` column alike: `0` for `count` and `sum`; `avg`, `min` and `max` stay unset (the column is absent from the row). A derived measure is computed over them as over any row.
- **Not filled.** As for a plain series: a selection with a `limit` or `offset`, an `order` on a measure or on a `__compare` column, a grid with two bucketed time dimensions, and a fill that would leave more than 2,000 rows answer exactly as before.

This supersedes the "or a `compareTo`" in the **Not filled** line of the #26893 note in the same release: a `compareTo` answer is filled too, as above.
