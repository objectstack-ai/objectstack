---
'@objectstack/driver-turso': minor
---

feat(driver-turso): the REMOTE face refuses a pending declared rename by name instead of adding an empty column

Clause-②: no
Metadata-protocol: semantic

The Turso remote transport renames no column. Its schema doors (`syncSchema`, `initObjects`, `syncSchemasBatch`) now read the remote catalog first and throw `DeclaredRenameRefusal` (reason `transport`) when a field's `renamedFrom` names an old column the table still holds, rather than adding the new key as an empty column beside it. `declaredRenameLimit`, `planDeclaredRenames` and `carryDeclaredRenames` answer on this face; `reverseDeclaredRenames` and `retireIndexesNamedForOldKeys` refuse `NOT_IMPLEMENTED`. The local and embedded-replica faces inherit the SQL driver's carry.
