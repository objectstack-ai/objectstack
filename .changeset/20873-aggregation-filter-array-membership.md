---
'@objectstack/objectql': patch
---

fix(objectql): a per-aggregation `filter` with `$contains` / `$notContains` on a multi-valued field counts the rows the same `where` finds (#20873)

Clause-②: no

`engine.aggregate({ aggregations: [{ …, filter }] })` — and so `POST /api/v1/data/:object/query`
with a per-aggregation `filter` — evaluates that filter in the engine, not in the driver. Its
`$contains` arm failed every value that was not a string, so on a `multiple: true` lookup,
`multiselect`, `checkboxes` or `tags` field a stored array never matched:
`{ owners: { $contains: 'u1' } }` counted 0 on every driver where the same condition as a `where`
found 2 rows, and `$notContains` counted every row, the rows holding the member included.

On a declared JSON-stored field (a multi-valued field, or a structured-JSON type) both operators
now ask MEMBERSHIP, the reading `FILTER_OPERATORS`' `$contains` docblock declares and `where` gives
on every SQL dialect: `'u1'` is a member of `['u1', 'u2']` and not of `['u10']`, and a member stored
as a number or boolean is named by its text (`'1'` finds `[1, 2]`). `$notContains` is the exact
complement, and a row with no value still satisfies it. A scalar text field keeps the substring
test, unchanged, and so does `having`.

No query that was refused now answers, and none that answered is refused: only the count of a
per-aggregation `filter` on a multi-valued field moves, to the `where` count.
