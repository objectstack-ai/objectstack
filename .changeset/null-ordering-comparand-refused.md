---
"@objectstack/spec": minor
---

feat(spec): refuse a `null` comparand in the ordering positions — `$gt` / `$gte` / `$lt` / `$lte` (#14080)

**BREAKING** accept-set narrowing on the filter contract, shipped as `minor`
under the repo's launch-window convention for breaking changes — the same
convention, the same door and the same envelope as the 2026-08-31 refusal of
`null` in the list-comparand positions (`$in` / `$nin` members, `$between`
bounds). Maintainer ruling 2026-09-01 (option A): the four ordering positions
were the last null-comparand positions the contract neither ruled on
(`$eq: null` / `$ne: null` ARE the null predicate) nor refused, and
`driver-memory`'s two faces answered them differently — the live path reads
two absences as equal, so `$gte: null` admits the no-value row; the reference
matcher compares through JS coercion, so `5 > null` is `5 > 0`. The contract
now refuses the shape loudly at the validation entrance, so that divergence is
constructively unreachable — ⛔ no ordering-vs-null semantics is defined
anywhere, ⛔ the matcher is not repaired, ⛔ no cross-backend alignment.

What is refused, and where:

- **Runtime door** (`assertListComparandShapes`, run inside `parseFilterAST`
  and at the engine seam on every verb): `{ f: { $gt: null } }` and its three
  siblings, in the object form and in every array/authoring spelling that
  lowers to them (`>`, `gt`, `greater_than`, `after`, `before`, …), are refused
  with the platform envelope (`INVALID_FILTER` / 400). Previously the shape
  reached the backends unexamined.
- **Schema door** (`ComparisonOperatorSchema` / `FieldOperatorsSchema`): `null`
  never parsed (the slot is `number | Date | string | { $field }`); it now gets
  the pointed message instead of zod's generic union text, and the two copies
  are built from one shared slot factory so they cannot drift.

The refusal text prescribes the ruled spellings: `{"$eq": null}` is "has no
value", `{"$ne": null}` is "has a value". The carve-out is null-shaped and
nothing wider: every number, `Date`, string (`''` included) and `{ $field }`
comparand keeps parsing, `$eq: null` / `$ne: null` are untouched, and
`undefined` keeps the comparand-TYPE door's own message.

**Migration.** A filter refused by the new check had no portable meaning to
preserve — the two in-memory faces already disagreed on it. Spell the intent
explicitly: `{ f: { $eq: null } }` for "has no value", `{ f: { $ne: null } }`
for "has a value", and `$or: [{ f: { $gte: X } }, { f: { $eq: null } }]` for
"at or above X OR has no value".

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over existing keys: no key is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. The refusal reaches an affected author at the parse/query site carrying the remedy; which explicit spelling matches the author's intent ($eq: null, $ne: null, or $or with one of them) is an authoring decision no migration entry can perform — and the ruling's precondition census measured zero authored occurrences of the refused shape. -->
