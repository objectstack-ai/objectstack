---
"@objectstack/spec": patch
---

docs(spec): describe the RLS `using` grammar by what pushes down, not by a count (#6919)

The TSDoc block above `RowLevelSecurityPolicySchema`'s `using` property still
opened with "The reference RLS compiler implements a deliberately **small,
fixed grammar** … **Exactly four forms compile**", then enumerated four SQL
spellings and declared "there is intentionally **no** support for `AND`/`OR`/
`NOT`, comparison operators other than `=`". That contradicted the
`.describe()` on the *same property* — corrected in #6762 / PR #6918 — and it
contradicted the compiler. Measured against `isSupportedRlsExpression`
(`@objectstack/formula`, `src/rls-predicate.ts`): `!=` and the full ordering
comparisons, `in` over a `current_user.*` array **and** over an inline CEL list,
string `startsWith`/`endsWith`/`contains`, `&&`, `||`, parenthesised grouping
and a bare `true` all lower to a filter and genuinely enforce.

PR #6918 could only park a `⚠️ STALE` marker on the block, because rewriting
~60 lines of grammar prose deserved its own review. This is that rewrite; the
marker is gone with it.

The block is now written as the one question the compiler actually asks —
*does this predicate lower to an ObjectQL filter?* — with the forms that lower
listed as open categories rather than a numbered set, and the forms that fail
closed listed beside them. Replacing "four" with the current number would have
been the same defect, so no count appears. Canonical CEL leads; the SQL
spelling is presented as what it is, a deprecated transitional bridge
(`sqlPredicateToCel`, ADR-0058 D1) covering only `=` → `==` and `IN` → `in`.
The property's five `@example` strings, all SQL dialect, are now CEL.

Two boundaries the old text got wrong in the *permissive* direction are stated
explicitly, because both are silent-fail-closed traps: SQL's parenthesised
value list does not survive the bridge (`status IN ('draft', 'pending')` fails
closed where `status in ['draft', 'pending']` lowers), and `!` negates a
parenthesised comparison but cannot negate a bare field.

Also adds `rls-predicate-grammar-docs.pin.test.ts`, which holds the file's
three grammar faces — the published module docblock line, the property TSDoc,
and the property's `.describe()` — to one story: none may re-assert a
fixed-count or closed-set grammar, all must keep stating the fail-closed
contract, and the two operator-listing faces must name the same operators.
This grammar has now drifted twice in the same direction, and nothing compared
the faces to each other.

No generated output changes: `gen:docs` never renders property-level TSDoc, so
`check:docs` reports all 231 files still in sync.
