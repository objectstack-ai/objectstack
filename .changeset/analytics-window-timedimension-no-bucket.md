---
"@objectstack/service-analytics": patch
---

fix(service-analytics): a `timeDimensions` entry used only as a date WINDOW no longer buckets the grid (#5688)

**Observable behaviour change — read this if you render, page, or assert on
dataset responses.** A selection that used a date dimension only as a window —
`timeDimensions: [{ dimension, dateRange }]` with no `granularity`, and the
dimension NOT listed in `selection.dimensions` — used to have the dataset
dimension's declared `dateGranularity` filled in anyway. That made the entry a
`GROUP BY` item, so the response grew a time column nobody selected and every
row split per bucket. "Count by Owner" plus a dashboard date-range filter came
back as "by Owner × month":

```
before  fields  [owner, close_date, opp_count]
        rows    [{owner:'u1', close_date:'2026-01', opp_count:1},
                 {owner:'u1', close_date:'2026-02', opp_count:1},
                 {owner:'u2', close_date:'2026-01', opp_count:1}]

after   fields  [owner, opp_count]
        rows    [{owner:'u1', opp_count:2},
                 {owner:'u2', opp_count:1}]
```

Both the **row count and the column set** change for such a selection: the extra
month column disappears and rows that were split per bucket collapse back into
one row per selected dimension tuple. A KPI single-value card that was reading
the first of several month rows now reads the only row. Consumers that pinned
the previous shape (a snapshot of `fields`, a row count, a hard-coded column
index) need updating; consumers that render the response's own `fields` do not.

Three conditions had to hold together to be affected, so a selection outside
them is byte-identical: the dataset dimension declares an explicit
`dateGranularity`, the `timeDimensions` entry states no `granularity`, and
`selection.dateGranularity` is unset.

**What still buckets, unchanged.** An entry is bucketed when the request says
that date is being bucketed: the dimension is one of the selection's own
`dimensions`, the entry carries its own `granularity` (#4033 — still projected
as a column even when not selected), or `selection.dateGranularity` is set. The
granularity *precedence* chain is untouched. A dataset dimension's
`dateGranularity` says how that date renders **when** grouped — it is no longer
read as a request to group by it.

**`compareTo` alignment (#3588/#4870) holds by construction.** The comparison
pass re-enters the same query builder with the same grid dimensions, differing
only in the shifted `dateRange`, so both passes bucket an entry alike or not at
all — never one of each, which was the state that left every `__compare` column
empty. For a window-only anchor this **repairs** the comparison rather than
preserving it: the merge has always keyed on `selection.dimensions` alone, so
the backfilled bucket column sat outside the merge key, and with several
month-split rows per group the comparison value landed on whichever row the
index held last while the others read a confident `0`.

Also fixed, same root cause: a time column that IS projected via
`timeDimensions` (an entry carrying its own `granularity`, never listed under
`dimensions`) now carries its dataset `label` in `fields` instead of a bare
`type` — the label enrichment walked `selection.dimensions` only.
