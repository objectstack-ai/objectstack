---
'@objectstack/objectql': patch
---

docs(objectql): `search-companion.ts` — the ADR-0061 `$search` expansion over source columns is `$icontains`, and the companion column's reader is `expandSearchToFilter` (#13984)

Comment-only, zero behaviour. Two independent corrections in one file, listed
separately because they are distinct claims:

1. The module docblock opened with "`$search` (ADR-0061 Tier 1) is a `$contains`
   over source columns". The source-column clauses compile to `$icontains`:
   `fieldClausesForTerm` returns `{ [field]: { $icontains: term } }`
   (`search-filter.ts:109` / `:111`), and the adjudication is recorded in that
   file's own header at `:23` — "[#7641] The case-insensitive operator is
   `$icontains`, NOT `$contains`." Only the operator spelling changed. The
   argument the sentence carries is untouched and still holds: typing `zhangwei`
   cannot hit a stored `张伟` under EITHER operator, because case folding does not
   transliterate. That is why a false spelling survived inside a correct
   argument.
2. `provisionSearchCompanion`'s docblock named the companion column's only
   reader `buildSearchFilter`. That is not an export of `search-filter.ts` — or
   of anything else in the repo. The reader is `expandSearchToFilter`, the name
   the same file already uses 50 lines above.

The two remaining `$contains` mentions in this file (`:237` and `:286`) describe
the hidden `__search` companion clause, where the case-SENSITIVE operator is
correct and deliberate: the column is a normalized blob already lowercase on
both sides, so `$contains` over two folded values is exact. `search-filter.ts`
says so in the imperative at `:137-143` — "Do not 'align' the two." A whole-file
find-and-replace here would turn two correct sentences false. They stay.

Published rather than skipped because correction 2 reaches the shipped
declarations: it sits inside the JSDoc of the exported `provisionSearchCompanion`,
and the build emits it into `dist/util-*.d.ts` and `dist/util-*.d.mts` (measured,
with a positive control on an exported symbol's own doc line). Correction 1 does
not reach any declaration file — a floating module-level block followed by an
`import` is dropped by the declaration emitter — so on its own it would have been
a `skip-changeset` diff.
