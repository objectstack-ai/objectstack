---
"@objectstack/verify": patch
---

fix(verify): skip read-only federated (external) objects in CRUD verification.

`objectstack verify` probe-inserts a record into every object. A federated object
on an external datasource is read-only unless BOTH the datasource and the object
opt into writes (ADR-0015 write gate), so that insert is correctly rejected —
which `verify` was reporting as a `create-failed` runtime failure. `deriveCrudCases`
now marks such objects `blocked` (skipped), matching the write gate's double
opt-in rule, so the dogfood gate stays honest while supporting external datasource
example apps.
