---
"@objectstack/service-analytics": patch
---

fix(service-analytics): every authorable filter operator now reaches the query (#4128)

Closes the cause behind the `$between` defect rather than just that instance.
`normalizeAnalyticsFilters` skipped any operator missing from its map, and a
skipped predicate does not narrow a query — it **widens** it: the compiled SQL
stays valid and returns rows the author excluded. Four operators from the
spec's authorable vocabulary sat in that state, plus one that was mapped
incorrectly.

- **`$startsWith` / `$endsWith`** were dropped entirely. Both strategies now
  compile them — anchored `LIKE 'x%'` / `LIKE '%x'` on the raw-SQL path, and
  the canonical `$startsWith` / `$endsWith` operators (which every driver
  implements directly) on the ObjectQL path, so an anchored match does not
  depend on regex dialect.
- **`$null`** was dropped. It is the shape the console emits for an "is empty"
  / "is not empty" filter, so such a widget was showing every row. Now compiles
  to `IS NULL` / `IS NOT NULL` per its boolean.
- **`$exists`** was mapped value-*independently* to `set`, so `{$exists: false}`
  compiled to `IS NOT NULL` — the exact inverse of what it asks for. It and
  `$null` are now resolved explicitly, because a key→name map cannot express an
  operator whose meaning flips with its value.
- **`$notContains`** reached the ObjectQL strategy, which had no arm for it and
  fell through to a `default` returning a bare value — compiling "does not
  contain x" as "**equals** x".
- **Unknown operators now throw** on both surfaces instead of being silently
  dropped (normalizer) or reinterpreted as an equality (ObjectQL strategy). An
  operator outside the vocabulary is a caller error, and a loud one beats a
  silently widened read — the call driver-memory made for the same shape in
  #3948.

Still declared as a gap, but no longer a silent one: `$or` / `$not` are skipped,
since expressing them needs a recursive WHERE builder rather than the flat
array the strategies consume.

Cover is `filter-operator-coverage.test.ts`, which runs the whole vocabulary
against a real SQLite engine and asserts **row ids** — six of its cases fail
without this change. A dropped predicate is invisible to the SQL-string
assertions the strategies' other suites use, which is how these survived.
