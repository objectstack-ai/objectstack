---
'@objectstack/rest': patch
---

Restore the `field` key and the curated conflict sentence on the 409 body for an insert refused by a unique constraint

Since the ObjectQL engine began answering a driver's unique violation with its own `DUPLICATE_RECORD` envelope (`status: 409`, `object`, `field`, the driver error on `cause`), `POST /api/v1/data/:object` let that envelope leave `classifyDataError` through the generic declared-status passthrough: still 409, but with `code: 'DUPLICATE_RECORD'`, no `field`, and the engine's own sentence in `error`. The `isUniqueViolationError` arm that names the conflicting column (`field: 'email'`, "A record with this email already exists") was no longer reached for an insert conflict. Measured with the real engine and real drivers: on `driver-sqlite-wasm` the `field` key disappeared from every conflict on a single-column index; on `driver-memory` the sentence changed.

A dedicated arm for the engine's envelope now sits with the other structured 409s (`DELETE_RESTRICTED`, `CONCURRENT_UPDATE`), ahead of the passthrough:

- `code` stays `UNIQUE_VIOLATION` — the code every client branching on this conflict already reads.
- `field` is restored whenever the dialect determinably named the column (SQLite, Postgres); composite keys and index-naming dialects (MySQL) carry no `field` key, exactly as before.
- `error` is the curated end-user sentence again; the engine's own sentence rides on `developerMessage`, the same split the `DELETE_RESTRICTED` body uses.
- The body still quotes nothing the driver said — no offending value, no statement, no index name — including on `driver-memory`, whose raw refusal used to echo the offending values as JSON through the passthrough.

`patch`: a restoration of the shipped body's keys and wording; the wire `code` and the status are unchanged. The arm fires for the engine's envelope only; a plugin or sandbox body that throws the registered `DUPLICATE_RECORD` itself keeps the answer it gets today.
