---
"@objectstack/service-analytics": patch
---

fix(analytics): a new spec aggregate can no longer silently return a row count

Track C item 4 of objectstack-ai/objectui#2945 — *"`AggregationFunction`: three
places in lockstep"*. They agreed only by coincidence, and the failure mode when
they stopped agreeing was silent wrong numbers.

The three:

1. `AggregationFunction` (`@objectstack/spec/data`) — eight members, what an
   author may declare as a dataset measure's `aggregate`.
2. `UNSUPPORTED_AGGREGATES` (`dataset-compiler.ts`) — `array_agg`/`string_agg`,
   rejected at compile time with a clear error.
3. The aggregate `switch` in `native-sql-strategy.ts` — six cases, then
   `default: return 'COUNT(*)'`.

8 − 2 = 6 = the six cases, today. Add a ninth member to the spec — `median`,
`percentile`, anything — and it would:

- pass the compiler's gate, since it is not in `UNSUPPORTED_AGGREGATES`;
- be **advertised as supported** by that gate's error message, which listed
  `count, sum, avg, min, max, count_distinct` as hand-written prose — a third
  copy of the vocabulary;
- reach the strategy's `switch`, match no case, and fall to
  `default: COUNT(*)`.

The author asks for a median and gets a row count. No error, no log, wrong
figures on a dashboard — the same silent-wrong-answer shape as the filter
operators in #3948, in the analytics SQL builder.

**The fix is derivation plus a guard, with no behaviour change.** The `switch`
becomes `AGGREGATE_SQL`, a table whose coverage is assertable; the error
message's prose list becomes `SUPPORTED_AGGREGATES`, derived as
`AggregationFunction.options` minus `UNSUPPORTED_AGGREGATES`; and
`aggregation-lockstep.test.ts` asserts the arithmetic — the lowered set equals
the admitted set, every spec member is either lowered or explicitly rejected,
nothing is both, and the rejection list names only aggregates the spec has.

Verified by adding a hypothetical `median` to the spec, which now fails three
assertions naming it, including *"these would fall through to the COUNT(*)
fallback and return a row count"*. Before this change the same edit was green.

Nothing is narrowed and no SQL changes: the same six aggregates lower to the
same six expressions, and the `COUNT(*)` fallback still catches everything else.

**Reported, not fixed:** that fallback is also reached by a measure whose `type`
is `number`/`string`/`boolean` — a custom SQL *expression*, per
`AggregationMetricType` — whose expression is then replaced by a row count.
Datasets cannot produce one (`aggregateToMetricType` only ever returns an
`AggregationFunction` member), so it is reachable only from a hand-authored
Cube. Emitting `col` instead is a behavioural change in an analytics SQL path
and deserves its own change with its own tests; the strategy's doc comment now
records it.
