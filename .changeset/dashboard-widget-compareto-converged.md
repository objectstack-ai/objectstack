---
"@objectstack/spec": major
"@objectstack/service-analytics": major
---

**BREAKING — `dashboard.widgets[].compareTo` converges on the analytics executor's contract (#5011).**

The widget declared three period-over-period arms with confident TSDoc. The analytics
executor implements one shape, and it was never the same one — so on the ADR-0021 dataset
path (the spec's own "single author-facing analytics shape") **all three arms were
broken**, in two different ways:

- `compareTo: 'previousPeriod'` / `'previousYear'` were **silently DROPPED** by the dataset
  renderer. The widget rendered its base numbers and the comparison the author asked for
  simply was not there.
- `compareTo: { offset: '7d' }` was forwarded into `DatasetSelection.compareTo`, whose
  contract is `{ kind, dimension }` and has no `offset` in it — so the executor threw
  `compareTo requires a timeDimension "undefined"` and the whole widget errored out.

All three worked on the legacy inline chart path. Same key, two fates, and the failing one
was the path the spec calls canonical.

`compareTo` is now a thin projection of the contract that is actually implemented:

```ts
compareTo?: { kind: 'previousPeriod' | 'previousYear'; dimension?: string }
```

There is no widget-side vocabulary left to drift from the executor's, so `declared =
enforced` holds by construction rather than by review.

## FROM → TO

| v16 | v17 | Fix |
|:--|:--|:--|
| `compareTo: 'previousPeriod'` | `compareTo: { kind: 'previousPeriod' }` | `os migrate meta --from 16` rewrites it |
| `compareTo: 'previousYear'` | `compareTo: { kind: 'previousYear' }` | `os migrate meta --from 16` rewrites it |
| `compareTo: { offset: '1y' }` | `compareTo: { kind: 'previousYear' }` | `os migrate meta --from 16` rewrites it — `1y` **is** `previousYear` |
| `compareTo: { offset: '7d' \| '1M' \| … }` | **no faithful target** | State the window on the widget's own `filter` and compare with `{ kind: 'previousPeriod' }`, which shifts by that window's own length |

The last row is deliberately *not* rewritten. `previousPeriod` shifts by the length of
whatever window the filter resolves to, which equals `7d` only when that window happens to
be seven days — a mechanical rewrite would silently change which rows the comparison
column counts, turning a loud failure into a wrong number. It is registered as the
`dashboard-widget-compareto-offset` semantic migration; the schema rejects the key with the
prescription in hand.

Retired at the schema, so every old spelling is a parse error carrying its own upgrade —
including the bare strings, which are dispatched by value so a *typo* is still told it is a
typo rather than told it "was removed".

## `dimension` is optional — resolved by the executor, not by a renderer

Omit it and `dataset-executor.ts` resolves it, by its own long-standing criterion (a
`timeDimensions` entry carrying a `dateRange`):

- exactly one candidate → that one is shifted;
- **zero** → a loud error: a comparison is only defined against a bounded window;
- **two or more** → a loud error **listing the candidates by name**, never a silent
  first-wins. Picking `created_at` when the author meant `close_date` produces a comparison
  that is *wrong* rather than *missing*, which is the failure nobody audits.

This is a producer-side resolution rule, not consumer-side tolerance (Prime Directive
#12): every caller — dashboard widget, report, raw `queryDataset` — gets the same dimension
or the same error, and no renderer is ever in a position to guess one.

## Notes

- `DatasetCompareTo.dimension` is now optional. Callers that always passed it are
  unaffected; callers that relied on the old "must be present" typing get a wider type.
- The converged slot is **union-free**. That is not cosmetic: zod collapses a failed union
  into one bare `Invalid input`, so curated guidance written inside a union arm never
  reaches the author (#5014). This slot's prescriptions are top-level and do.
- objectui's legacy inline chart path adapts separately (objectui#3337), which also deletes
  the `DatasetWidget` string-drop workaround this change makes unnecessary.
