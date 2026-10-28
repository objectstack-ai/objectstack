---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a date-dimension series answers every bucket of its window, the empty ones included (#26893)

Clause-②: no — no input is refused or newly accepted and no export or type changes; a dataset answer gains the rows for the time buckets no record fell in, which it used to leave out
Metadata-protocol: none

A grouped query answers one row per bucket that holds records, so a month with no closed-won deal was not a zero in a 12-month revenue trend: it was missing, and a chart's category axis drew the months on either side of it as neighbours. `queryDataset` (and `POST /api/v1/analytics/dataset/query`, which the dashboard's dataset widget calls) now adds those buckets in the dataset executor:

- **Which buckets.** When the grid's time dimension carries a `timeDimensions[].dateRange` (a preset or an explicit pair), every bucket of that window, in order. With no `dateRange`, only the gaps between the first and last bucket that came back are filled: a window stated only in `runtimeFilter`, or a one-bound filter such as `{ close_date: { $gte: '{12_months_ago}' } }`, does not bound the edges. No window and no rows still answer no rows.
- **Their values.** The same values an empty group already reads: `0` for `count` and `sum`; `avg`, `min` and `max` stay unset (the column is absent from the row, which a chart reads as no value), never `0`. A derived measure is computed over them as over any row.
- **Other dimensions.** With a second grid dimension (month × owner), each combination that already holds a row gets every bucket; a combination no row holds is not added.
- **Keys.** The added keys are spelled by the same bucket labeller the grouping uses, in the selection's timezone, so they sort and merge with the real ones (`2026-05`, `2026-W01`, `2026-10-04`).
- **Not filled.** A selection with a `limit` or `offset` or an `order` on a measure, and a grid with two bucketed time dimensions, answer exactly as before. A fill that would leave more than 2,000 rows in the grid (a `day` series over ten years) does not run at all, so the answer is never filled part-way.
