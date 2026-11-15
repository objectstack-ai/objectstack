---
'@objectstack/driver-turso': patch
---

fix(driver-turso): a remote (hosted) connection now reports its database work in Server-Timing `db`

Clause-②: no
Metadata-protocol: none

In remote mode, `TursoDriver` sends its statements through `@libsql/client` directly, so the knex query events that feed Server-Timing `db` never fired: every hosted environment answered `db;dur=0;desc="0 queries"`, and the admin-only `X-OS-Debug-Timing-Detail` header was missing for lack of samples. Each `execute` and each `batch` round trip of the remote transport is now counted into the ambient request collector under the same `db` mark the local face produces (a batch counts once, as one round trip). With detail capture on, each sample records the statement's parametrized SQL, and a batch is labelled `batch(N): <first statement>`; bindings are never recorded. Outside a request scope the statement runs as before, with one lookup added. Local and embedded-replica connections keep their knex-based counting unchanged, and the disclosure gate (admin-only per request, global mode via `OS_SERVER_TIMING`) is unchanged.
