---
'@objectstack/spec': minor
'@objectstack/objectql': minor
---

feat(objectql): roll-up `summary` fields can filter which child rows they aggregate (#1868)

`summaryOperations` gains an optional `filter` — a query `where` FilterCondition
evaluated against each child row, so a summary aggregates only the matching
children instead of the whole collection. This is what lets a single child object
feed several distinct parent totals, which the cross-object rollup templates need:

```typescript
// One `engagement` child → distinct filtered totals.
total_signups: {
  type: 'summary',
  summaryOperations: { object: 'engagement', field: 'id', function: 'count', filter: { type: 'signup' } },
}
// Sum only received receipt lines (3-way match).
received_amount: {
  type: 'summary',
  summaryOperations: { object: 'procurement_receipt', field: 'amount', function: 'sum', filter: { status: 'received' } },
}
```

The engine ANDs the predicate with the parent-FK match when it recomputes, and
because the whole filtered aggregate is re-run on every child write, a child that
moves in or out of the predicate (e.g. a status change) keeps the parent current
with no extra wiring. Operator and compound forms work too
(`filter: { type: { $in: ['signup', 'trial'] }, amount: { $gte: 100 } }`).

Purely additive: omitting `filter` aggregates every child exactly as before.
