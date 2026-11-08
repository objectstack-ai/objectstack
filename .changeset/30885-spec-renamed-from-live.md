---
'@objectstack/spec': minor
---

docs(spec): `renamedFrom` is live — a declared rename carries the old column's values on upgrade

Clause-②: no
Metadata-protocol: semantic

The field's `renamedFrom` description no longer says the carry is pending: the schema sync renames the old column to the declaring field, or refuses by name before any change. Keep an entry while any installed version may still carry the old key. `liveness/field.json` grades the key `live`, citing the driver's carry and the install door.
