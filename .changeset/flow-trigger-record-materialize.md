---
"@objectstack/trigger-record-change": patch
---

fix(trigger-record-change): the seeded flow record is total over the object's declared fields — no more fault on an untouched field (#4953)

A record-change flow's `record` / `previous` CEL roots used to be **sparse**:
`record` was seeded as `{ ...(inputData ?? {}), ...after }` with no fallback to
the prior row, so a declared field this write's payload didn't mention — and the
driver's after-row didn't echo back either — was simply an ABSENT key. CEL is
strict about that: `record.x != null` on a record missing the key `x` doesn't
evaluate to `false`, it **faults** (`No such key: x`), while `has(record.x)`
silently answers `false` for the same reason — reading as "the field genuinely
has no value" when the truth is "this evaluation point never got told". A
`record-before-*` trigger's `record` was hit hardest: with no `after` row at all
(the write hasn't landed yet), it was literally just the incoming patch.

This is the services-lane half of the maintainer's 2026-08-06 ruling on #4953
item 1 ("server-side unified, cross-process deferred"). The engine-core half
(field `readonlyWhen`, PR #6454) already materializes; this closes the other
named server seam so both are now total, matching the sibling seams
(`rule-validator.ts`'s object validation / `requiredWhen`, `hook-wrappers.ts`'s
declarative hook `condition`s).

`record-change-trigger.ts`'s `buildContext` now:

- layers the prior row (`ctx.previous`, fetched unconditionally ahead of
  dispatch for by-id writes since #7867) as the BASE of `record`, so a field
  this write didn't touch keeps its real persisted value instead of vanishing —
  this runs for every dispatch, before- and after-hooks alike, not just the
  after-row merge #1872 already covered;
- then makes both `record` and `previous` total over the object's DECLARED
  fields (a structural mirror of `@objectstack/objectql`'s
  `materializeDeclaredFields`, keeping this package's zero build-time
  dependency on objectql), filling whatever is STILL missing with an explicit
  `null` — but only once the record's persisted state is actually in hand
  (insert: always; update/delete: only when the prior row was fetched), so a
  write whose prior row genuinely could not be read is left sparse rather than
  fabricating a value that might contradict the stored row.

`has()` semantics are unchanged: once a declared field is present (materialized
or not), `has()` still answers whether the KEY is declared/present, not whether
the value is empty — `!= null` is still the way to test emptiness, same contract
`declared-fields.ts` has documented since #4649.
