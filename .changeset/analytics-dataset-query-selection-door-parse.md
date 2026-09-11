---
'@objectstack/rest': minor
---

`POST /analytics/dataset/query` parses its `selection` at the door, the way its two siblings already do

The route checked one thing about the body it forwards — that
`selection.measures` was a non-empty array — and forwarded everything else
unexamined. `/analytics/query` and `/analytics/sql` Zod-parse their body at
the entry and lift a malformed member to a 400 before the service is reached,
so a client met two postures on one family depending on which door it knocked
on, and a malformed member of `selection` travelled into `dataset-executor` to
be answered by whatever the face behind it happened to do with it.

⚠️ **A 400 is newly reachable.** Requests that previously slipped through are
now refused. Two shapes:

- A `timeDimensions[].dateRange` outside the closed preset vocabulary answers
  `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` — the same code, status and wording
  the sibling door has answered for the identical condition since the
  vocabulary closed. Measured on the tree before this change, the literal
  string `not a range at all` reached the executor under an ordinary `200`.
- Anything else malformed answers `400 VALIDATION_FAILED` with
  `details.fields[]`, each entry naming the member as `selection.<path>`.

**What is NOT newly refused, deliberately.** `selection` is a
`DatasetSelection`, which is *not* the `AnalyticsQuery` the siblings parse: it
carries no `cube`, and `runtimeFilter`, `dateGranularity`, `compareTo` and
`totals` are members of its own. Reusing the sibling schema would have refused
every real dashboard widget. What the door parses is the projection of the
seven members whose declaration on `DatasetSelection` *is* the `AnalyticsQuery`
member of the same name — `dimensions`, `measures`, `timeDimensions` (declared
there by reference), `order`, `limit`, `offset`, `timezone` — so the refusal
set is exactly what the published interface already declared. The four
dataset-only members are projected away before the parse and keep reaching the
executor untouched.

Validation-only: the caller's `selection` object is what `queryDataset`
receives, by identity, never a parse output.
