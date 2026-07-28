---
"@objectstack/objectql": minor
"@objectstack/verify": minor
"@objectstack/core": patch
"@objectstack/service-analytics": patch
"@objectstack/spec": patch
---

fix(objectql)!: one key for the empty group bucket — real `null`, on both aggregation paths (#3839)

A grouped row whose dimension value is empty now carries `null` for that
dimension no matter which way the aggregate ran. Downstream code can test the
empty bucket with a plain `value == null` again: charts render their own empty
label, drill-through on that bucket builds `field = null` and returns the rows
it should, and a dashboard no longer changes shape when the driver, the
granularity or the reference timezone changes.

### What was wrong

`engine.aggregate` has two implementations of one feature. It pushes the
aggregate down as SQL when the driver advertises every requested granularity and
the reference timezone is UTC; otherwise it fetches rows and buckets them in JS.
The two disagreed about how to spell "empty":

```
--- same dataset, same query, one row with a NULL value ---
  pushed-down SQL : [{ "key": null,     "type": "null",   "total": 2 }, …]
  in-memory       : [{ "key": "(null)", "type": "string", "total": 2 }, …]
```

The measures were always right — only the key's type and literal differed —
which is why this went unnoticed for so long: every total reconciled. But the
engine picks a path per query, so the same data produced a different bucket key
on SQLite-plus-UTC-plus-`month` than on `week` (which SQLite does not advertise),
a non-UTC timezone, or `driver-rest` / `driver-memory` / a remote Turso, all of
which bucket in memory unconditionally.

It was never date-specific either. A plain `groupBy: ['stage']` over a NULL
column diverged the same way.

Consumers are written against `null` — they check `== null` and supply their own
empty label ('—', '(empty)', a localized "Uncategorized"). The sentinel defeated
every one of them: it rendered a raw English debug string in the UI, and a drill
on the empty bucket compiled to `field = '(null)'` and matched nothing.

The in-memory path's comment justified the string as staying "consistent with
the client `useReportData` hook". That hook was removed with ADR-0021, and the
literal never appeared in it.

### What changed

- `applyInMemoryAggregation` and `bucketDateValue` (`@objectstack/objectql`) key
  the empty bucket as `null`. `bucketDateValue` now returns `string | null`. A
  null instant and an unparseable one still share one bucket, because SQL cannot
  tell them apart either (`strftime('%Y-%m', 'not-a-date')` is NULL).
- The internal composite bucket id is JSON-encoded, so the empty bucket stays
  distinct from a row whose value is the literal string `"null"`.
- `bucketKeyToCalendarRange` (`@objectstack/core`) accepts `string | null`. The
  empty bucket has no calendar span, so a drill on it opens the unscoped
  superset instead of an invented bound — unchanged behavior, honest signature.
- The driver output contract in `@objectstack/spec` now states the rule: a row
  with no value keys as `null`, never a sentinel. Propagating NULL through the
  bucket expression is the whole of it; a driver only breaks it by adding a
  `COALESCE`.

### Gates

`checkDateBucketParity` (`@objectstack/verify`) deliberately carried no null
instant, because the divergence would have failed it for a reason it was not
about. Its fixture now has one, so the convergence is held in place — including
for out-of-tree drivers that run the check against themselves.

Two fixes were needed to make that fixture meaningful:

- The check folded bucket labels through `String(value)`, which turns SQL NULL
  into `'null'` — a label a TEXT column can genuinely hold. A driver spelling
  "empty" as a string could compare equal to one returning real NULL. The empty
  bucket is now keyed out of band.
- Label sets were compared with `JSON.stringify`, which is sensitive to key
  insertion order. Row order is not part of this contract and the two paths
  naturally differ (SQL sorts its groups; the in-memory path emits first-seen
  order), so a driver with entirely correct buckets could be reported as
  disagreeing — with an empty diff message, since nothing actually differed.
  The comparison is now order-insensitive.

A new dogfood check covers the non-date half against real drivers: same dataset,
plain and date-bucketed `groupBy`, both paths, one key.
