---
'@objectstack/formula': minor
---

feat(formula)!: `validateExpression` judges relationship traversal in the `value` role when the caller opts in, with formula wording

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape or authorable spelling is added, removed or renamed. `validateExpression('value', …)` with `traversalHydration: true` now reports the two traversal conflicts it already reported for `predicate`; a caller that does not pass the flag sees no change. Nothing stored changes, so there is nothing for `objectstack migrate meta` to rewrite. -->

- `validateExpression('value', source, { fieldTypes, traversalHydration: true, … })` now refuses a second hop through a reference (`traversal-multi-hop`) and a reference read both through and as a plain value (`traversal-bare-and-traversed`). The messages say the formula reads null, and the repair for an empty reference is the optional read `record.LOOKUP.?FIELD.orValue('…')`. Before, the `value` role ignored the flag.
- `findTraversalConflicts` takes an optional fourth argument, `subject` (`'predicate'`, the default, or `'formula'`), which selects that wording. The `TraversalSubject` type is exported.

Without the flag, every role behaves as before.
