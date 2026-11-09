---
'@objectstack/cli': patch
---

fix(cli): `os migrate apply` takes a database lock, so concurrent migrators against one database run one at a time

Clause-②: no
Metadata-protocol: none

Two `os migrate apply` runs against the same Postgres or MySQL database (for example one per replica, from an init container on each pod) both read the same pending schema work and both performed it. Each applying run now takes a session-level advisory lock on the primary database (Postgres `pg_advisory_lock`, MySQL `GET_LOCK`, named `objectstack:schema-migrate`) after its DDL-free boot and before it reads what is pending, and releases it when the command ends. A second migrator waits for the first, then finds the schema in sync and changes nothing.

On a single node nothing changes: the lock is uncontended and prints nothing, and SQLite (with Turso and WASM SQLite) takes no lock at all. A migrator that has to wait prints one line saying so. If the other migration still holds the lock after 10 minutes, the waiting run refuses, changes nothing and exits non-zero; run it again once the other migration has finished.
