---
'@objectstack/driver-memory': patch
---

`MemoryAnalyticsService` lowers the `FilterArray` spelling of `where` instead of dropping it

Clause-②: no

An array `where` such as `[['stage', '=', 'won']]` used to skip every filter step of the
analytics (cube) face: `query()` aggregated every row and `generateSql()` echoed no `WHERE`,
while the object spelling `{ stage: 'won' }` answered its rows. The array is now lowered by
`@objectstack/spec`'s `isFilterAST` / `parseFilterAST` — the lowering the analytics `where` door
and the engine already apply — so both spellings answer the same rows and echo the same `WHERE`
on both exits. `[]` still means no filter. An array that is not a filter (an infix join such as
`[condA, 'or', condB]`, an unknown operator, a list of scalars) is refused with
`INVALID_FILTER` / 400 instead of answering every row; write the prefix form
`['or', condA, condB]`, or the `FilterCondition` object.
