---
"@objectstack/spec": minor
---

feat(spec): `icontains` joins the view and infix filter vocabularies, closing the dialect gap on the capability every driver executes (#8934)

`$icontains` has been executable on every driver and evaluation face since
#5702/#6520, yet it was authorable from exactly one of the three filter
dialects — the MongoDB-style `FieldOperatorsSchema`. Maintainer ruling
(Option A on #8934): the two remaining vocabularies gain the canonical
spelling.

- `VIEW_FILTER_OPERATORS` (`ui/view.zod.ts`) gains `icontains`, so a
  `ViewFilterRule` can declare a case-insensitive contains. No alias rows:
  the alias table bridges spellings already living in stored metadata, and a
  new canonical operator has none.
- `AST_OPERATOR_MAP` (`data/filter.zod.ts`) gains `icontains` → `$icontains`,
  so `isFilterAST` accepts the infix spelling and `parseFilterAST` lowers it
  to the operator the drivers already run. `canonicalAstOperator` round-trips
  it through the generic path (`CANONICAL_INFIX` row added).
- Boundary preserved, per the ruling: `icontains`/`$icontains` (LIKE-escaped
  substring — a comparand `%` is a LITERAL) and `ilike`/`$ilike` (raw LIKE
  pattern) are NOT aliases of each other in either vocabulary, and there is no
  `not_icontains` — the `$` dialect has no `$notIcontains`, and the authoring
  vocabularies mirror the executed set rather than widening it.
- The parity suite (`filter-view-operator-parity.test.ts`) and
  `FILTER_TEXT_CASES` extend accordingly, including a conformance case that
  lowers the infix spelling and pins `%`-literalness on every backend that
  runs the table. The comparand-type door already judged `$icontains`
  (a `FieldOperatorsSchema` key since #5701) — no change needed there.
