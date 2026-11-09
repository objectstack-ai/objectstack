---
'@objectstack/cli': patch
---

feat(cli)!: `os serve` refuses a database local to each replica when several replicas are declared over the redis cluster driver

Clause-②: no (narrowing) — a boot that declares several replicas (`OS_CLUSTER_REPLICAS` greater than 1, or `OS_EXPECT_MULTI_NODE=true`) over the redis cluster driver (`OS_CLUSTER_DRIVER=redis`) while its primary database is SQLite (a `file:` URL, a path, or the default file when `OS_DATABASE_URL` is unset), sqlite-wasm, or libSQL over a `file:` URL now exits 1 before anything is connected, where it used to start every replica on its own copy; nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row changes: what moves is whether a multi-replica deployment boots on a database local to each replica, and moving its data to a shared database is the operator's choice of database, not a mechanical conversion -->

**BREAKING** for a deployment that declares several replicas over the redis cluster driver and keeps its data in SQLite, sqlite-wasm or a libSQL `file:` database. Each of those replicas read and wrote its own copy of the database, so a record written through one replica was missing from the others. Such a boot now prints `[database] Refusing to start: several replicas are declared …` and exits 1. Fix: point every replica at one shared Postgres database, `OS_DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE`. A libSQL server URL (`libsql://…`, a Turso `https://` host), MySQL and MongoDB are shared databases and are not refused. A single-node boot, and a boot on any other cluster driver, starts as before.
