---
"@objectstack/service-analytics": patch
"@objectstack/rest": patch
---

fix(service-analytics,rest): an analytics dimension over a missing field answers 400 INVALID_FIELD, not a driver 500 (#5520)

#4437 gave a **measure** over a non-existent field a `400 INVALID_FIELD` naming
the field, because a driver error class must never be the caller's `error.code`
for a caller-shaped mistake (ADR-0112). It covered the measure half only, so the
identical typo one request key over still reached the driver as a `GROUP BY`
column:

```
POST /analytics/query {"cube":"account_metrics","measures":["account_count"],"dimensions":["bogus_dim"]}
→ 500 {"code":"SQLITE_ERROR","message":"Internal server error"}

# the control group on the same route, already fixed by #4437
POST /analytics/query {"cube":"account_metrics","measures":["bogus_measure"]}
→ 400 {"code":"INVALID_FIELD","message":"Measure 'bogus_measure' … Valid measures: …"}
```

**The gate.** `ensureCube` now runs `assertDimensionFields` alongside
`assertMeasureFields` on every path, so a dimension whose source column the
backing object does not have is refused **before** any SQL is built, with the
same envelope the measure gate uses: `INVALID_FIELD` / 400 plus
`field` / `object` / `param`, a message naming the field, the valid dimensions,
and the object's known field list. `query`, `generateSql` and `queryDataset` are
all covered, and a rejected query leaves nothing behind in the cube registry.
`timeDimensions` are covered too — they resolve through the same
`cube.dimensions` bag and produced the same 500 — with `param` reporting which
request key carried the bad name.

**What deliberately did not change:** grouping by a REAL field the cube never
declared as a dimension (`dimensions: ["phone"]`) still works. The gate asks
"does the *object* have this field", never "did the cube declare this
dimension". A cube whose `sql` is an expression, a dotted relation dimension,
and a host that wires no field-name probe are all stood down on, exactly as the
measure gate stands down.

**The SQL echo, same request.** `POST /analytics/dataset/query` composed its own
5xx body and echoed the error message verbatim. Knex prefixes the offending
statement to its message, so the caller received the generated SQL — physical
table and column names included:

```
500 {"code":"ANALYTICS_QUERY_FAILED",
     "error":"SELECT bogus_dim AS \"bogus_dim\", COUNT(*) AS \"account_count\"
               FROM \"crm_account\" GROUP BY bogus_dim - no such column: bogus_dim"}
```

The sibling face never leaked it: `/analytics/query` exits through the
dispatcher, which has applied the shared `looksLikeInternalErrorLeak` predicate
to every >= 500 message since #3867. That same predicate now guards this route's
500 body. Classification is untouched — the status stays 500, the code stays
`ANALYTICS_QUERY_FAILED`, the ADR-0112 envelope branch and the transitional
message list are unchanged — and the full text still reaches server logs. A 500
whose message does not look like driver output keeps its prose.
