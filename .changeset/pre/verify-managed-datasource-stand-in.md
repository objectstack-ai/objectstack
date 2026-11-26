---
'@objectstack/verify': patch
---

Clause-②: no
Metadata-protocol: none

`os verify` no longer writes test rows into a declared managed datasource's real database. A datasource the app declares with `schemaMode: 'managed'` (or none) is now built as a fresh in-memory store of the same kind as verify's own default store, so its objects are still exercised (CRUD, reference shapes, delete behaviours, unique scopes) and nothing reaches the database the datasource names. A managed datasource whose engine has no faithful in-memory stand-in (`mongodb`, or a driver a plugin supplies) keeps its real driver, and verify leaves its objects out, reported as `managed datasource "NAME" (driver "DRIVER"): not exercised`. An object that requires a reference to a withheld object (external, or one of those) is now reported as withheld on purpose with the target's reason, instead of "required relational target X is not synthesizable".
