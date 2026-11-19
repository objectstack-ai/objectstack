---
'@objectstack/verify': patch
---

fix(verify): `os verify` writes nothing to an object on an external datasource, even one whose write gate is open

Clause-②: no
Metadata-protocol: none

The harness connects every datasource an app declares, the way `os dev` does. An object on an external datasource whose write gate was open (`external.allowWrites` on the datasource and `external.writable` on the object) was let into the CRUD round trip and every write family built on it, so a verify run could insert, update and delete test rows in the real database behind that datasource.

Now `deriveCrudCases` blocks every object on an external datasource, whatever its write gate says, and the reason names the gate's state: `external datasource "NAME" (writes allowed): not exercised — verify writes only to its ephemeral store`, or `(read-only)` for a closed gate. The CRUD stage reports the object `skipped` with that reason, which does not fail the run; the RLS, reference-shape, delete-behaviour, unique-scope, parent-write-reach and dashboard-window families, which build their records from the same case, leave it out with the same reason. An object that requires a reference to it is skipped too. An object counts as on an external datasource when it carries an `external` block (verify's existing trigger) or when its datasource declares a `schemaMode` other than `managed` (the engine's write gate's own test). An object bound to a declared managed datasource, or one that declares no `schemaMode`, is still written through that datasource, as under `os dev`.

A write the app itself makes to an external object (its seed, or a hook or flow that one of verify's writes fires) still goes where the app sends it, as under `os dev`; the `--flow` run already refuses every write routed away from the in-memory database. The package README and the harness header now say exactly this instead of "never touches a real database".
