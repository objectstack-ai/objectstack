---
"@objectstack/spec": patch
---

docs(spec): record the ruled EXCLUDE direction for negative operators over no-value rows (#5299)

`FILTER_LOGIC_CASES` is a published contract — its header tells third-party
driver authors it is "the single source of truth every filter backend is checked
against". Since 2026-08-10 that header has been telling them something the
maintainer has superseded, so this change makes the published document say what
is ruled as well as what is enforced.

**The ruling (#5299, 2026-08-10).** SQL's native three-valued logic is the common
denominator, and both JS evaluators align to it:

> **Negative operators never match no-value rows; the only ways to select "no
> value" are `$exists: false` / `$null: true`.**

Concretely: `$notContains` on a value-less field does not match, `$exists` means
"has a value" (`!= null`) and never key-presence, and `$nin` on a no-value field
does not match.

**No behaviour moves in this change, and the header now says why.** The ruled
direction reverses the one #5298 shipped and #5146 ruled before it — the same
direction the four enrolled `d`-column cases currently enforce, and the direction
every SQL compiler in the repo was deliberately bent to in #5298 (`nullSafeNegative`,
plus four independent copies of `nullValueSatisfiesOperator` answering `$nin` →
true and `$notContains` → true). A new "family 4" note in the header carries the
eleven-surface measurement of that gap, taken by adding the candidate rows to the
table and running every suite that drives it.

It also records the two things that block enrolment, both measured rather than
argued:

- the DEBT ledger in `scripts/check-driver-conformance.mjs` is per
  (driver × case-set), not per case — there is no way to spell "this driver fails
  one row", so a row added ahead of a backend is just a red gate;
- two of the five scored drivers (`driver-memory`, `driver-mongodb`) are inside
  the #5499 investment freeze, and both answer the include direction on their live
  query paths.

The pin tests in `@objectstack/formula` and `@objectstack/driver-memory` are
re-annotated to match, and the formula-side pins now assert the non-negated
`$notContains` / `$nin` row sets explicitly, so the cross-backend PR that lands
the ruled semantics has to move them deliberately. One stale claim is corrected
while doing it: `driver-memory`'s pin said `formula` reads `$exists` as
key-presence, which stopped being true in PR #5962.
