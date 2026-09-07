---
"@objectstack/service-analytics": minor
"@objectstack/spec": patch
---

A dataset measure's `fields[].type` stops contradicting the value beside it: a `min`/`max` over a temporal field is described as `time`, not `number` (#15768)

`POST /api/v1/analytics/dataset/query` described **every** measure column as `type: "number"`, including a `min`/`max` over a `date` / `datetime` / `time` field whose value in the same response is an ISO instant. Measured on a real boot (`@objectstack/cli` 17.3.0, SQLite dev datasource):

```json
{"rows":[{"oldest_last_update_at":"2026-07-04T07:00:00.000Z"}],
 "fields":[{"name":"oldest_last_update_at","type":"number","label":"Oldest touch","format":"relative"}]}
```

`min` and `max` return a value **of the aggregated field's own type**, so that column carries an instant and the metadata denied it — which is enough on its own to keep a formatter that branches on the declared type from ever reaching a temporal branch.

What changed:

- **The measure column's type is resolved from the authored measure plus the source field's declared type**, in `AnalyticsService.queryDataset`'s ADR-0021 result-column enrichment — the same block that already resolves `label` / `format` / `currency` / `percentScale`, and the one seam every producer of the shape passes through on the way to the route, which relays that method's return verbatim. The rule itself is `measureResultType` in the new `measure-result-type.ts`, so the per-aggregate verdict has one home instead of four copies.
- **The corrected spelling is `time`**, the `DimensionType` word a temporal DIMENSION column in the same response has always carried. A second temporal word in one wire position would have left every existing consumer branch unreached.
- **Only `min` and `max` move.** `count` and `count_distinct` are numeric however temporal the column they read is; `sum` / `avg` over a temporal column are refused by no layer and answered by the backend (an epoch mean on SQLite, an error on Postgres), so there is no single value for a type to describe and none is invented; a derived measure is numeric by construction, because `computeDerived` coerces its operands with `Number()`. Row values are untouched on every path.
- **Tiered "cannot answer, do not block".** A host with no source-field metadata wired, and a measure over a relationship PATH (which the source-field lookup resolves against the base object and therefore cannot answer), both leave the column exactly as the query layer produced it.

`AnalyticsResult.fields[].type` and the `AnalyticsResultResponse` schema now state the vocabulary this position speaks and what each aggregate answers; neither declaration widens — the wire type was, and remains, a string.
