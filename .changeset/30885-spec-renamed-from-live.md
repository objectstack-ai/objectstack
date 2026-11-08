---
'@objectstack/spec': minor
---

docs(spec): the liveness ledger grades `renamedFrom` live — a declared rename carries the old column's values on upgrade

Clause-②: no
Metadata-protocol: semantic

`liveness/field.json` (shipped in the package) flips the field's `renamedFrom` row from `planned` to `live`, citing its executor: the SQL driver's schema sync carries the old column to the declaring field, or refuses by name before any change, and the install-local door carries it before the new version registers. The field's `renamedFrom` description and docblock now say so, in place of "until that step ships, no upgrade carries a column" (the generated `references/data/field`, `data/object` and `system/migration` pages follow). No schema shape changes.
