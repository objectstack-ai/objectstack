---
'@objectstack/spec': patch
---

docs(spec): the `ValidationRule` `condition` example guards its nullable `amount` comparison with `record.amount != null`

Clause-②: no
Metadata-protocol: none

The publish-time null-guard rule refuses an ordering or arithmetic operator on a declared-nullable field in a validation `condition` unless an explicit `!= null` test guards it. The `condition` `.describe()` text compared `record.amount` without one; it now reads `record.amount != null && record.amount < 0`, and the generated `content/docs/references/data/validation.mdx` rows follow. The two doc-comment examples in the same file (the `cross_field` discount limit and the `conditional` enterprise rule) get the same guard.

The spec change is description and doc-comment text only: no schema shape changes, and no accept set moves.
