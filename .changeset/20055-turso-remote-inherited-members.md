---
"@objectstack/driver-turso": minor
---

fix(driver-turso)!: a REMOTE `TursoDriver` answers or refuses every public `SqlDriver` method it inherited, instead of failing on a Knex connection it does not have (#20055)

Clause-②: yes (narrowing)

`TursoDriver` extends `SqlDriver`. Before this change, 23 public `SqlDriver` members had no remote-mode arm, so a remote driver ran their Knex implementations. Remote mode builds Knex with no connection, so those calls failed with knex's `Unable to acquire a connection`, which reads as a network fault, or they answered from state no remote schema sync fills. Each one is now answered on the remote database or refused with `NOT_IMPLEMENTED` / 501, and the driver's source lists every public `SqlDriver` member with its remote answer. A method added to `SqlDriver` later fails this package's type check until its remote answer is decided.

**BREAKING.** On a remote driver, six members that used to answer now refuse or answer differently. This narrows what a published driver accepts. It ships as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`).

- `explain()` and `analyzeQuery()` used to resolve with the SQL the local compiler would build, plus an `error` field in place of a plan. They now reject with `NOT_IMPLEMENTED` / 501.
- `applyMigrationEntries()` used to resolve. Every entry came back `skipped`, including a destructive entry that `allowDestructive` permitted. It now rejects with `NOT_IMPLEMENTED` / 501, with or without entries.
- `getKnex()` used to return a Knex instance on which every statement failed. It now throws `NOT_IMPLEMENTED` / 501.
- `supportsRotation` used to read `true`. It now reads `false`. The lifecycle service reads it, and for an object that declares a rotation storage policy it now takes its age-based reap instead of calling `rotateShards()`, which failed.
- `setFileColumnsMovedResolver()` used to return `true` ("taken"), and then never asked the resolver. It now returns `false`. Remote mode keeps writing media columns in the JSON encoding, as before.

**Refused with a clearer error.** These calls already failed. They now reject with `NOT_IMPLEMENTED` / 501, and the message names the local or embedded-replica transport, or `execute()`, as the alternative:

- `introspectSchema()`. The datasource connection test still answers `ok: false`, and its error now says introspection is not supported in remote mode;
- `findWithWindowFunctions()`;
- `rotateShards()`;
- `distinct()` called with `options.tenantId` on an object that has a tenant column. No remote read applies the tenant scope, so an answer would list every organization's values.

**Now answered on the remote database.** These used to fail:

- `distinct()` without a tenant scope runs a `SELECT DISTINCT` and answers what local mode answers for the same rows. The filter and the value presentation match, and an unknown column is refused with `INVALID_FIELD` / 400.
- `reclaimSpace()` sends the statement local mode issues, `PRAGMA incremental_vacuum`, to the remote database. The lifecycle service's sweep now counts the datasource as reclaimed instead of logging a warning. The statement returns pages only on a database whose `auto_vacuum` mode is `INCREMENTAL`.

`RemoteTransport` gains one public method, `compileDistinct()`. It builds the statement behind a remote `distinct()`.

**Unchanged.** Local and embedded-replica modes run the inherited Knex members as before. On a remote driver, `commitTransaction()` and `rollbackTransaction()` still reject through the `commit()` / `rollback()` refusal. The deferred-DDL readers still report nothing deferred, and `getSchemaSyncStats()` still answers `{ created: 0, existing: 0 }`, which the `IDataDriver` contract reads as "cannot say". The bookkeeping and dialect members also answer as before.

<!-- adr-0087: not-required (no-migration-prescription) A narrowing of which calls a remote `TursoDriver` answers: no key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed. `TursoDriverConfig` and both `TursoConfigSchema` copies are untouched, and every `SqlDriver` member keeps its name and signature. What moves is only whether a remote driver answers a call or refuses it with NOT_IMPLEMENTED/501, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. -->
