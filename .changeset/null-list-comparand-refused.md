---
"@objectstack/spec": minor
---

feat(spec): refuse `null` in list-comparand positions — `$in` / `$nin` members and `$between` bounds (#13357, #13495)

**BREAKING** accept-set narrowing on the filter contract, shipped as `minor`
under the repo's launch-window convention for breaking changes. Maintainer
ruling 2026-08-31 (option C): the contract refuses the shape loudly at the
validation entrance, and the cross-backend divergence it used to reach becomes
constructively unreachable — ⛔ no cross-backend alignment (#5299 stays
declined), and the reference matcher's own answers for these shapes are sealed
behind the refusal, not repaired.

What is refused, and where:

- **Runtime door** (`assertListComparandShapes`, run inside `parseFilterAST`
  and at the engine seam on every verb): a `null` member of `$in` / `$nin`,
  and a `null` `$between` bound, are refused with the platform envelope
  (`INVALID_FILTER` / 400). Previously the shape reached the backends, where
  the SQL family, the mingo path and the reference matcher answered it three
  ways — the matcher even disagreed with itself across the two readings of
  "no value" (#13357's table).
- **Schema door** (`SetOperatorSchema` / `FieldOperatorsSchema`): a `null`
  member is refused at parse time with a pointed message, the same
  check-not-type-change mechanism as the #7596 `{ $field }` member refusal.
  A `null` `$between` endpoint never parsed (the endpoint union is
  `number | Date | string`); it now gets the pointed message instead of zod's
  generic union text.

The refusal text prescribes the ruling's explicit spelling: "one of […] OR has
no value" is `{"$or": [{"$in": […]}, {"$null": true}]}`, and `{"$null": false}`
is the has-a-value half. The carve-out is null-shaped and nothing wider:
`$in: []` / `$nin: []` stay the declared predicates they are, every non-null
member type keeps parsing (#5041's and #5234's member questions stand
untouched), and `$eq: null` is a separate surface (#13494, ruled separable).

**Migration.** A filter refused by the new checks was already answered
inconsistently across backends, so it had no portable meaning to preserve.
Spell the intent explicitly: `$or: [{$in: […]}, {$null: true}]` for
"one of […] or empty", `{$null: false}` (or `$and` with it) for the
has-a-value direction, and `$gte` / `$lte` for a half-open range.

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over existing keys: no key is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. The refusal reaches an affected author at the parse/query site carrying the remedy; which explicit spelling matches the author's intent ($or with $null:true, $null:false, or a half-open range) is an authoring decision no migration entry can perform — and the ruling's evidence base measured zero authored occurrences of the refused shape. -->
