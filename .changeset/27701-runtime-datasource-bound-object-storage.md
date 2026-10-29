---
'@objectstack/service-datasource': patch
---

fix(service-datasource): a code object bound to a Setup-created managed datasource gets its table when the datasource's pool opens, on create and after a restart (#27701)

Clause-②: no
Metadata-protocol: none

An author declares an object with `datasource: 'warehouse'`, and an admin creates `warehouse` in Setup → Datasources. Boot's schema sync skipped the object, because no `warehouse` driver existed yet, and the pool the admin door opened synced nothing either. The datasource answered `ok`, the table was never created, and every read of the object was a 500 (Postgres `42P01`), the same after every restart.

- **Now.** Opening a runtime datasource's pool (the admin create, the boot rehydration, and a peer replica's convergence on a new datasource) syncs the schema of the objects already bound to it, as boot does for a declared datasource. A table that is missing is created; a table that exists is left as the sync leaves it. One object's refused sync is logged at `error` and does not fail the connect, as on the declared path.
- ⛔ **Only a managed datasource.** A datasource whose `schemaMode` is `external` or `validate-only` syncs nothing for its objects, so it never gets DDL. Its mode is read as the driver factory reads it.
- **Not changed.** An edit that rebuilds the pool (a changed `config`, credential, `schemaMode` or `active`) still syncs nothing.
