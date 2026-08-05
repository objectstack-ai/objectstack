---
"@objectstack/service-analytics": patch
---

fix(service-analytics): the three SQL compilers compare LIKE values literally (#5567)

`$contains` / `$notContains` / `$startsWith` / `$endsWith` build a `LIKE` pattern
around the comparand the author wrote. All three of this package's SQL compilers
concatenated that comparand straight into a wildcard position — no escaping, no
`ESCAPE` clause — so `_` (LIKE's single-character wildcard) and `%` (its
multi-character one) stopped being literals. Measured on real SQLite, over the
rows `x_admin` / `xyadmin` / `off 50% now` / `off 5012 now`:

| `where`                          | returned      | correct |
|----------------------------------|---------------|---------|
| `{name: {$contains: '_admin'}}`  | `['1','2']`   | `['1']` |
| `{name: {$contains: '50%'}}`     | `['3','4']`   | `['3']` |
| `{name: {$startsWith: 'x_'}}`    | `['1','2']`   | `['1']` |
| `{name: {$endsWith: '0% now'}}`  | `['3','4']`   | `['3']` |

Every row is a **widening** — rows the author excluded came back — and
`$notContains` is the mirror image, excluding rows the author kept. One of the
three call sites is the ADR-0021 D-C read-scope (tenant + RLS) lowering, where a
wider predicate is over-reach rather than a loose filter (the #5347 / #5324
ruling on that same file). Prime Directive #3 forces machine names to
`snake_case`, so essentially every machine-name comparand carries a `_` and hit
this silently.

All three compilers now escape the comparand and bind an explicit
`ESCAPE` argument, matching what `driver-sql`'s `applyLike` has always done — so
the same filter selects the same rows whichever strategy answers, and the
`/analytics/sql` echo describes the statement that ran instead of a wider one.

**No authoring change.** A comparand with no `_`, `%` or `\` binds exactly the
pattern it bound before; only its meaning when it *does* carry one changes, from
wildcard to literal. If you were relying on a comparand acting as a wildcard,
that was never a declared capability of these operators — the spec describes them
as substring / prefix / suffix matches — and `driver-sql` already read it
literally, so the reading you got depended on which strategy served the query.
