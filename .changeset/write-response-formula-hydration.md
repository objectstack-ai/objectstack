---
"@objectstack/objectql": patch
---

fix(objectql): a write response is a record, so it carries the record's `formula` fields (#5504)

`POST /data/:object` and `PATCH /data/:object/:id` answered with the stored
document, in which a `formula` field is not `null` but **absent** — formulas are
virtual, so no driver ever returns a column for one. The very next `GET` of the
same row carried every one of them. Read-your-write was broken in the direction
that is hardest to notice: the response calls itself `record`, so consumers
render it directly, and every object whose `nameField` points at a formula
rendered blank until a second round-trip.

Cause: `applyFormulaPlan` had exactly two call sites — the `find` result and the
`findOne` result. The write paths returned the driver's row untouched, and the
REST layer passed it straight through.

**What changed.** `engine.insert` and `engine.update` now hydrate formula
virtuals onto what they hand back, using the *same* plan builder and the *same*
evaluation the read path uses — one formula semantic, not a write-path dialect.
Evaluation runs against the row the driver already returned (`create` uses
`RETURNING *`, `update` re-reads), so there is no extra round-trip and no
formula sees a partial record. Execution context is threaded exactly as `find`
threads it today.

Covered by construction, not per call site: single insert, batch insert,
`insertMany` / `createManyData` / `insertManyData`, and single-id update all
flow through the one hydration point on each verb. A **predicate** (`multi`)
update is unchanged — `driver.updateMany` resolves to an affected-row COUNT and
names no row, so it has no record to materialize.

Ordering, both halves pinned by tests:

- **after** the write-path strips and refusals — a formula reading a stripped
  `autonumber` (#5503) or `readonly` (#2948) field reports what was STORED, and
  a write refused under `strictReadonlyWrites` (#5126) produces no response to
  hydrate at all;
- **before** the `afterInsert` / `afterUpdate` dispatch, mirroring the read
  path's `applyFormulaPlan` → `afterFind` order, so an after-hook observes the
  same complete record on a write that it observes on a read.

Cost is gated exactly as on the read path: an object that declares no formula
builds an empty plan and evaluates nothing.

No API or schema change — a response that was missing keys now has them.
Consumers that worked around this with an extra `GET` after every write can drop
it; consumers that treated the absent key as "field not configured" should note
that an unevaluable formula is reported as `null`, as it always has been on read.
