---
"@objectstack/spec": minor
"@objectstack/service-datasource": patch
"@objectstack/runtime": patch
---

**Federation:** `SchemaDiffEntry` gains a distinct `unreachable` kind — "the remote could not be read" is no longer reported as `missing_table`, and a transient outage no longer aborts boot under the default `onMismatch: 'fail'` (#11166, maintainer ruling 2026-08-23).

`ExternalDatasourceService.validateEach` used to convert **any** per-object validation throw — including `connect ECONNREFUSED` from remote introspection — into a `{ kind: 'missing_table', severity: 'error' }` row, indistinguishable from a genuinely dropped table. Downstream, that shape meant: the boot gate (`ExternalValidationPlugin.runValidation`) aborted startup for a 30-second network blip, and the background drift checker raised `external.schema.drift` events claiming the schema changed on every tick the remote stayed down.

Now:

- **`@objectstack/spec`** (minor): `SchemaDiffEntryKind` adds `'unreachable'` — the one kind that asserts *nothing about the remote schema*; it states that validation was indeterminate because the remote (or the object definition) could not be read. The throwing error's text is carried in `actual`. Every other kind remains a measured fact about a schema that was successfully read. Additive: existing entries and their meanings are unchanged. Consumers that exhaustively switch on the kind union (e.g. a `Record<SchemaDiffEntryKind, …>`) will get a compile-time prompt to label the new member; non-exhaustive consumers see a new string value at runtime and should render it as-is.
- **`@objectstack/service-datasource`** (patch): the per-object catch in `validateEach` classifies every throw as `unreachable` (rows stay `ok: false`, `severity: 'error'`). `missing_table` is still reported — but only from its measured branch: a table absent from an introspection that returned.
- **`@objectstack/runtime`** (patch): the boot gate no longer feeds `unreachable` rows to the `onMismatch` policy — no abort under `fail`; instead it logs a loud `warn` naming the datasource, the object, the underlying error, and that the object's schema is unverified for this boot, under every `onMismatch` value. Measured mismatches keep the existing policy behavior, including sitting beside an unreachable row in the same report. The drift checker still emits `external.schema.drift` for unreachable rows (consumers discriminate on `kind`), but its operator-facing summary now says "could not read the remote", never "drift detected", for them.
