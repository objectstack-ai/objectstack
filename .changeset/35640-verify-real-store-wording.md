---
'@objectstack/verify': patch
---

fix(verify): the skip reason for a managed datasource with no stand-in no longer says verify never writes to it

Clause-②: no
Metadata-protocol: none

For an object on a managed datasource whose engine has no ephemeral stand-in (`mongodb`, or a driver a plugin supplies), the CRUD report said `not exercised — verify has no ephemeral stand-in for this engine and never writes through to the real one`. That was not true: verify withholds only its own derived writes there, while the app's seed and the hooks and flows that verify's writes fire still write to that real database during the run. The reason now reads `… verify has no ephemeral stand-in for this engine, so it withholds its own writes; the app's seed, hooks and flows still write to the real database`, and the README says the same. Nothing else changes: which objects are skipped, and what reaches which store, are as before.
