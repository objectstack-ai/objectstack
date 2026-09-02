---
"@objectstack/objectql": minor
---

fix(objectql): `insert` answers a driver unique violation with the `DUPLICATE_RECORD` envelope, on every driver (#14095)

The platform recommends "declare a unique index, attempt the insert, swallow the
violation" — it is what lets an idempotent writer be an ordinary job instead of
needing a distributed lock, and `packages/objectql`'s own autonumber-resync doc
argues at length against the read-then-write alternative ("a probe costs a query
on every insert … and is still racy"). **An application could not complete that
pattern**, because the insert door rethrew the DRIVER's error verbatim and left
three bad options: branch on `SQLITE_CONSTRAINT_UNIQUE` (and silently stop being
idempotent the day the deployment moves to Postgres' `23505`, MySQL's
`ER_DUP_ENTRY` or Mongo's `E11000`); pattern-match a message that on the measured
SQLite path is the whole compiled INSERT statement; or use the platform's own
`isUniqueViolationError`, which is correct, dialect-independent — and lives in
`@objectstack/types`, a package an application cannot resolve.

Triage ruling 2026-09-01, verbatim: 「抛一个带既有词表码(`DUPLICATE_RECORD` 已在
ADR-0112 台账里)的平台错误,原驱动错误作 `cause` ⇒ `insert` 在每个驱动上有同一份
契约」.

**What `engine.insert` now raises** for a recognised unique violation, identically
on every driver and on every path a driver create failure leaves the door by
(single row, `bulkCreate` batch, the per-row fallback loop, `insertMany`'s partial
mode, the scoped-repository facade, and the resync's last-chance create):
`DuplicateRecordError` — `code: 'DUPLICATE_RECORD'` (already a member of
`StandardErrorCode`; no `packages/spec` change was needed), `status: 409` (the
conflict status its sibling refusals `DELETE_RESTRICTED` / `CONCURRENT_UPDATE`
declare), the driver's own error WHOLE on `cause`, `object`, a `developerMessage`
carrying the remedy, and `field` when — and only when — `uniqueViolationColumn`
determinably named the conflicting COLUMN (an index name is never reported as a
column; #6544's contract is not widened here).

**Nothing else moves.** A NOT NULL violation, a deadlock, a missing table and an
unreachable store all leave the door as the very object the driver threw — pinned
on identity, in both the single-row and batch paths. The verdict is the shared
`isUniqueViolationError` predicate; this door adds no dialect knowledge of its own.
`ERR_AUTONUMBER_COLLISION` keeps its narrower identity, because "re-seeded,
re-issued, still refused" says something `DUPLICATE_RECORD` cannot.

Shipped as `minor` rather than a patch because callers observe a different error
object on a public data-API door. Measured consequences, end to end on real
drivers:

- **HTTP status is unchanged at 409** on `driver-sqlite-wasm` and `driver-memory`,
  single-column and composite declared indexes alike: REST's declared-status
  passthrough honours the envelope's `status`.
- **The wire `code` changes from `UNIQUE_VIOLATION` to `DUPLICATE_RECORD`** (both
  registered), and the flat body no longer carries the `field` key on the dialects
  that name a column, because the passthrough arm ships neither. Restoring it is a
  dedicated `mapDataError` arm in `@objectstack/rest` — another lane, filed
  separately, not a rider here.
- **Import row reports improve**: the row `code` was previously whatever dialect
  token the driver used (`SQLITE_CONSTRAINT_UNIQUE`, `11000`) and is now
  `DUPLICATE_RECORD`.
- **The operator log is unchanged**: the engine logs the driver's own error (the
  envelope's `cause`), because the platform logger serializes only `message` and
  `stack` — so #8682's "what the database said, including the failing column, is
  kept" still holds.
