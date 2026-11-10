---
'@objectstack/rest': patch
---

fix(rest)!: a per-object bulk door whose rows failed answers 207 Multi-Status, not 200 (#32280)

Clause-②: yes (narrowing): a batch / updateMany / deleteMany with failed rows answered 200 and now answers 207
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. What moves is the HTTP status of a per-row report that holds a failed row; the body is byte-for-byte the same, and nothing at rest records the status, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** status narrowing at the per-object bulk doors (`@objectstack/rest`): `POST /data/:object/batch`, `POST /data/:object/updateMany` and `POST /data/:object/deleteMany`.

- **Before.** A call whose rows failed answered `200` with `{ success: false, total, succeeded, failed, results }`, even when every row failed or an atomic batch rolled back. A client that reads only the status counted it as written.
- **Now.** The door answers `207 Multi-Status` when the report's `failed` count is above zero, and `200` when no row failed. The body is the same report either way, `results` included. An atomic batch that rolled back reports every row failed, so it answers `207`.
- **Unchanged.** A call where every row succeeded answers `200`. A request the door refuses before any row runs (a malformed body, a batch over `batch.maxBatchSize`, an object that does not expose the write) keeps its own `4xx`. `createMany` has no per-row report: it answers `201`, and a row it refuses fails the whole call with that row's error status. The cross-object `POST /batch` is always atomic and answers a refusal the same way. Neither answers `207`.
- **Who moves.** `207` is a 2xx, so the `@objectstack/client` SDK's `data.batch`, `data.updateMany` and `data.deleteMany` still resolve with the report (its shared `fetch` throws only on a non-2xx), and the console's bulk edit and bulk delete keep reading `results`. A client that tests for exactly `200` before it reads `results` now sees `207` for a call with failed rows.

**The remedy.** Treat any 2xx from these doors as a report, and read `failed` or each `results[i].success` for the outcome.
