---
"@objectstack/service-analytics": patch
---

fix(analytics): ObjectQLStrategy applies `timeDimensions[].dateRange` — the predicate every date-bucketed chart was missing (#3650)

`ObjectQLStrategy.execute()` built its engine filter purely from
`normalizeAnalyticsFilters(query)`, which reads only `query.where`. But
`dateRange` is a **sibling** of `where`, never folded into it — so the window
was dropped on the floor. No error, no warning: the chart rendered, and the
numbers were for all of history.

This was not a "some drivers only" corner. `NativeSQLStrategy.canHandle`
declines any query carrying a `granularity`, so a **date-bucketed trend lands on
the ObjectQL path on every driver**, Postgres and SQLite included — and a
bucketed trend is precisely the shape that also carries a range ("last 12
months", "this quarter"). The other two paths always applied it
(`NativeSQLStrategy` as `BETWEEN`, `preview-evaluator` row-wise); only this one
did not.

**Two visible symptoms:**

- A trend chart with a time filter plotted **every row ever recorded** instead
  of the selected window.
- `compareTo` (period-over-period) was **structurally dead**. `runCompare`
  builds the comparison pass by shifting `dateRange` and changing nothing else,
  so with the window ignored both passes issued a byte-identical aggregate:
  every `<measure>__compare` column equalled its primary and the delta was a
  flat 0%. And since `compareTo` requires a time dimension, it always took this
  path.

The window now lowers to an inclusive `{$gte, $lte}` on the resolved field — the
same shape `NativeSQLStrategy` binds as `BETWEEN` and the memory driver builds
as a `$match` — so one dashboard reads the same on every driver. No storage
coercion is applied here on purpose: unlike the raw-SQL path (which had to learn
about SQLite's INTEGER epoch in #2034), this path goes through
`engine.aggregate()`, where the driver's own CRUD filter coercion already
handles a `where` bound on that same column.

**Same-field composition was fixed alongside it**, because the window makes it
routine. Operands merged into one field entry by spreading, which silently kept
whichever came last: a `where` bound and a window bound on `close_date` would
have had one erase the other, and a `where` that names one field twice through
`$and` (`{$and: [{stage: 'won'}, {stage: {$ne: 'lost'}}]}`) already lost its
first operand today. Operands that name **different** operators still share one
entry; colliding ones become their own `$and` conjunct, so the engine
intersects them instead of the strategy picking a winner.

`generateSql()` renders the window as a parameterised `BETWEEN` to match — its
comment previously explained why a `BETWEEN` was deliberately absent, which was
correct only while `execute()` dropped the window. Bounds bind as `$n`
placeholders, never inlined: the echoed statement travels to the browser.

A window on a **cross-object** time dimension is still rejected, and is now
reported as the bucketing error it is rather than as the "cross-object filter"
its lowered predicate would otherwise resemble. `execute()` and
`/analytics/sql` continue to accept and reject the same set.

Relative-phrase ranges ("Last 7 days") are still not resolved on this path, and
a bare-string `dateRange` degenerates to a single point — both matching
`NativeSQLStrategy` exactly, rather than inventing a second interpretation for
the driver-independent path.
