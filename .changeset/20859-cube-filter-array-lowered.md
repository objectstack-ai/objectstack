---
'@objectstack/driver-memory': minor
---

`MemoryAnalyticsService` lowers the `FilterArray` spelling of `where` instead of dropping it

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling or type: no spec key, export name or stored row moves. What changes is which `where` values one runtime face of this package answers: a `where` array that `isFilterAST` rejects, which `AnalyticsQuerySchema.where` (a `FilterConditionSchema`) never admitted, is now refused as the analytics `where` door and the query engine already refuse it, where it used to answer every row. Which filter the caller meant by such an array is not something a ledger entry can decide. The package publishes (not `unpublished`); no ADR-0087 id covers a runtime filter-shape refusal (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

An array `where` such as `[['stage', '=', 'won']]` used to skip every filter step of the
analytics (cube) face: `query()` aggregated every row and `generateSql()` echoed no `WHERE`,
while the object spelling `{ stage: 'won' }` answered its rows. The array is now lowered by
`@objectstack/spec`'s `isFilterAST` / `parseFilterAST` — the lowering the analytics `where` door
and the engine already apply — so both spellings answer the same rows and echo the same `WHERE`
on both exits. `[]` still means no filter.

**BREAKING**: `query()` and `generateSql()` now refuse, with `INVALID_FILTER` / 400, a `where`
array that is not a filter — one `isFilterAST` rejects. Each such array used to answer EVERY row
and echo no `WHERE`; the analytics `where` door and the query engine refuse the same shapes.
Measured on a fixture where `d` is `'v1'`, `'v2'`, `null` and absent, each of these answered all
four rows:

- an infix join, `[['d', '=', 'v1'], 'or', ['d', '=', 'v2']]`;
- an operator outside the filter-array vocabulary, `[['d', 'sounds_like', 'v1']]`;
- a list of scalars, `[1, 2, 3]`;
- a cube-style entry list, `[{ member: 'd', operator: 'equals', values: ['v1'] }]`.

An array that does lower but carries a comparand or operator the face refuses in its object
spelling (`[['d', 'in', 'v1']]`, `[['d', 'starts_with', 'v']]`) is now refused as that object
spelling is; it too used to answer every row.

The fix is to write the filter you mean: the prefix form `['or', condA, condB]` for an infix
join, an operator from the filter-array vocabulary, or the `FilterCondition` object.
