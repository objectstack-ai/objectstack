---
'@objectstack/metadata': patch
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata, metadata-protocol, objectql): a passing boot logs no `DATABASE_ERROR` on the WASM SQLite driver and no metadata-loader INFO line at `warn`, and an expected refusal logs one `warn` line with no stack

Clause-②: no
Metadata-protocol: none

- `resolveDriverClientName` now also reads the dialect the knex client declares (`knex.client.dialect`) when the driver was given no client NAME. `@objectstack/driver-sqlite-wasm` hands knex a Client class rather than a name, so the resolver used to answer `undefined`, the table-presence probe fell back to a statement that raises, and every boot of a project that had never numbered a record logged `[sql-driver] DATABASE_ERROR … no such table: _objectstack_sequences`. The probe now asks the catalog, as it does on every other SQL driver. A driver configured by name answers exactly as before, and the driver's own fault log is unchanged.
- ObjectQL's insert and update doors still log a caller-input refusal (the engine's own `ValidationError`: a required field left out, a value out of range, a validation rule) at `warn`, but as one line with no stack: `Insert operation failed` / `Update operation failed` with `{ object, operation, fields: [{ field, code }], reason }`. Before, every refused form submission, and every test asserting one, printed a WARN with a stack trace. Every other write failure keeps its level and its full stack: driver and database faults, duplicates, and the database's NOT NULL refusal, which reaches the caller as a `ValidationError` but carries the driver's error.
- `MetadataManager`'s lines follow the host's logger level. The manager used to log through its own logger fixed at `info`, built before any host could hand it a level, so `INFO Registered metadata loader: filesystem (file:)` printed into every boot at `warn`. A host that sets the new `awaitHostLogger` option has the manager's `debug` / `info` lines held and replayed through the logger it hands over with the new `useHostLogger(logger)`; `warn` and above print at once, as before. `MetadataPlugin` does both, with the kernel's logger, so a boot at `warn` prints none of those lines and `OS_LOG_LEVEL=info` prints them. A `MetadataManager` built without the option logs exactly as before.
