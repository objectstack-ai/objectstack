---
"@objectstack/service-analytics": patch
"@objectstack/rest": patch
"@objectstack/spec": patch
---

fix(analytics,rest): five dataset refusals declare `DATASET_INVALID` / 400 themselves, and the route's message-sniffing list shrinks to one entry (#5367)

`POST /analytics/dataset/query` answered `400 DATASET_INVALID` for six error
families because the route recognised their **prose**, not because the errors
said anything about themselves. #5352 gave the catch an ADR-0112 envelope branch
(`error.code` + a 4xx `error.status`, read first) and had to leave a hardcoded
list of message substrings behind it, since all six producers were still bare
`throw new Error(…)`:

```
/not declared in the dataset|not backed by a declared relationship|
 not supported by the v1 dataset runtime|read-scope-sql|
 not a selected dimension or measure|is not a subset of the selected dimensions/
```

That made the HTTP status of six families a property of their wording.
Rephrasing `dataset-compiler`'s "is not declared in the dataset's `include`" —
no logic change — moved that refusal from 400 to 500, i.e. re-opened #5352 for a
different family, and no test and no gate would have gone red. Prime Directive
#12 permits an accommodation like that only while it is declared, loud, tested
**and removable on a schedule**; #5366 delivered the first three and nothing
carried the fourth.

**Five producers now declare their own verdict.** A new
`dataset-refusal.ts` in `@objectstack/service-analytics` exports
`datasetInvalidError` — the same shape as that package's existing
`invalidFilterError` (`INVALID_FILTER` / 400) and `assertDimensionFields`
(`INVALID_FIELD` / 400) — and five sites throw through it:

- `dataset-compiler.ts` — a measure whose aggregate the v1 runtime cannot lower;
  a dimension/measure traversing a relationship path the dataset never declared
  in `include`;
- `dataset-executor.ts` — an `order` key that is not a selected dimension or
  measure; a `totals` grouping that is not a subset of the selected dimensions;
- `native-sql-strategy.ts` — a join outside the dataset's declared allowlist.

Their five entries are gone from the route's list, which is now a single
`read-scope-sql` test.

**`read-scope-sql` deliberately stays.** Its ten fail-closed refusals are RLS
read-scope lowering failures whose inputs are an admin-authored policy and a
compiler-generated join alias — not caller input — so `DATASET_INVALID` ("your
request is invalid") may well be the wrong verdict and choosing the right one is
a separate judgement, still tracked by #5367. Deleting the entry before that
judgement lands would regress those ten from `400 DATASET_INVALID` to 500.

**No outward behaviour change for the five.** They answered
`400 DATASET_INVALID` before and answer `400 DATASET_INVALID` now, with the same
message; what changed is the mechanism, from message-matching to the producer's
own declaration. The one visible difference is for a bare `Error` that merely
*resembles* one of those messages: it is no longer promoted to a 400. That is the
point — a phrase is no longer a classification.

`DATASET_INVALID` is registered in `ERROR_CODE_LEDGER` under
`@objectstack/service-analytics` as well as `@objectstack/rest` (provenance, per
ADR-0112 D3; the code itself is unchanged and the union does not grow), and the
constructor types it as `RegisteredErrorCode` so an unregistered code is a
compile error rather than a body some route rejects at runtime.

Coverage: `dataset-refusal-envelope.test.ts` (service-analytics) pins each of the
five refusals against its real producer — the refusal SET first, green before and
after, then the envelope; `analytics-dataset-refusal-envelope.test.ts` (rest)
drives all five end-to-end through a real `AnalyticsService` with positive
controls on both the aggregate and raw-SQL paths; and
`analytics-filter-refusal-envelope.test.ts` pins the deletion in both directions
— the five messages answer 400 when enveloped and 500 when bare, so re-adding a
regex entry turns it red.
