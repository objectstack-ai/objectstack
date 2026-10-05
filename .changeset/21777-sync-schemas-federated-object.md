---
"@objectstack/objectql": patch
---

A runtime schema sync (`ObjectQL.syncSchemas()`) no longer sends DDL to an object with `external` set. That sync runs on an install-local install, a rehydrate and template seeding. It also no longer logs the durability ERROR "Schema sync FAILED … not durable" for such an object. The ERROR still fires for any other object whose sync fails.

Clause-②: no

- **What was wrong.** A federated object (ADR-0015) lives on a datasource whose schema the remote database owns. The boot sync never sends it DDL. It binds the object to its remote table with the driver's DDL-free `registerExternalObject`. The runtime sync had no such branch, so it called `syncSchema` on every federated object in the registry. On an external-schema datasource the driver refuses that DDL, as designed. The refusal was then logged as a durability failure, although nothing durable was lost. A showcase-based host printed two false ERROR lines on every install-local install, one each for `showcase_ext_customer` and `showcase_ext_order`. A false alarm on every run teaches operators to skip the one line that, for any other object, means its data is not on disk.
- **What it does now.** `syncSchemas()` treats a federated object exactly as the boot sync does. It binds the object without DDL and logs a `debug` line. If the driver has no `registerExternalObject`, it skips the object at `debug`. A binding that throws is logged at `warn`. It never calls `syncSchema` for the object. The binding matters for an object registered at runtime: without it, every read resolves to a table named after the object instead of the remote table, and fails with "no such table".
- **One predicate.** The boot sync, `syncSchemas()` and `syncObjectSchema()` now ask one shared predicate, `external != null`, so the runtime and boot syncs cannot drift apart again. The predicate reads the object's own `external` block, not its datasource's `schemaMode`. An object without `external` that lands on an external-schema datasource still gets the ERROR when its DDL is refused, because it expected a table it did not get.
- No accepted input, key, export, status or error code changes.
