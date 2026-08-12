---
"@objectstack/runtime": patch
---

fix(runtime): `GET /automation/:name/runs?limit=` now enforces its own declared 1..100 range (#8054)

`ListRunsRequestSchema.limit` has always declared `.min(1).max(100)`, but the
boundary that reads it (`parseIntegerParam`) only checked that the value was a
whole number, never that it fell inside the declared range. Two measured
symptoms, both a `200` with the wrong answer:

- `?limit=0` (and any negative value) reached the engine as-is, and
  `store.listHistory(flowName, 0).slice(0, 0)` is `[]` — a confidently wrong
  "this flow has never run", the same shape #7300 fixed for `?limit=abc`, but
  produced by a value that *was* a valid integer.
- `?limit=101` reached the engine uncapped, so the declared upper bound was
  decorative.

`parseIntegerParam` gains an optional third `bounds` argument
(`{ min?, max? }`); every existing caller that omits it is byte-for-byte
unaffected — range enforcement is opt-in, per call site. The one call site with
a declared range (`GET /automation/:name/runs`) now threads
`ListRunsRequestSchema.shape.limit`'s own `.min()`/`.max()` through, rather than
re-listing `(1, 100)` as literals — the #7359 discipline
(`ExecutionStatus.options`) applied to a bounded number instead of a closed set,
so the wire's declared range and the boundary's enforced range cannot drift
apart the next time the schema's bounds change.

A value outside the range is refused in the same house shape as everything else
in this module: `400` `VALIDATION_FAILED` (ADR-0112) with a `details.fields[]`
entry carrying the ADR-0114 field code the property names already mirror —
`min_value` below 1, `max_value` above 100. Both declared boundary values
(`?limit=1`, `?limit=100`) and every ordinary in-range value stay exactly as
they were.
