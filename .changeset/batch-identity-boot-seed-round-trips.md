---
"@objectstack/plugin-security": minor
---

Batch the identity boot seeds' existence read and stop re-writing rows that
already match the declaration (#10946).

Every permission set and every position an environment declared cost **exactly
4 sequential database round trips on every kernel boot** — measured on a real
per-environment kernel build with every `@libsql/client` call counted: slope
4.0000, R² = 1.000000 on both axes, with a per-statement histogram naming the
four legs (2 × existence `SELECT`, 1 × `UPDATE`, 1 × `SELECT`). Two of the four
were an `UPDATE` that fired even when nothing had changed. On a local file
database the loop is invisible; on a remote libsql/Turso database — every hosted
environment — each leg is its own sequential HTTP request. Schema sync had
already been batched (`TursoDriver.supports.batchSchemaSync`), which is why
objects, views and artifact seeds add 0.00 round trips each on the same rig;
identity content was the one content axis still paying per item.

Both loops now hoist **one** `{ name: { $in: [...] } }` existence read out of the
loop — the declaration is known in full before the loop starts — and write only
when the stored row actually differs from what would be written. A steady-state
rebuild of both loops is now O(1) round trips: measured in-repo against a
call-counting ObjectQL double, a rebuild of 1, 5, 20 and 40 declared items costs
1 round trip in every case, for permission sets and positions alike.

Three things the change is careful **not** to become:

- **Drift still reconciles.** The skip is on equality, never on "we have seen
  this name": a row whose stored value differs — a package version bump, a
  hand-edit, a partially applied write — still gets its `UPDATE`. An
  implementation that skipped all writes would show the same round-trip curve
  and silently stop reconciling, so the round-trip pins are paired one-for-one
  with drift pins over the same fixtures.
- **A read that could not answer is not the answer "none exist."** A batched
  read fails for the whole set at once, so swallowing its failure into `[]`
  would make every boot conclude nothing is seeded and re-create everything. The
  seam is judged on whether the driver returned a result set, never on whether
  the array came back empty; a failed batched read degrades to the per-item read
  (loudly warned), and a name whose record cannot be read at all is declined
  rather than inserted. That last step is deliberately stricter than the code it
  replaces, which turned a failed read into an insert attempt and leaned on the
  `name` unique index to refuse it.
- **A converged publish is still a successful publish.** `PermissionSeedOutcome`
  gains `unchanged` (rows that already matched) and `unreadable` (names declined
  because their record could not be read). The ADR-0086 P2 publish materializer
  asks "did the record end up matching the published body", which was
  accidentally identical to "was a write issued" only because the seeder always
  wrote; it now reads `seeded + updated + unchanged`, so every case that reported
  a materialization before still reports one. A re-publish of a byte-identical
  body reports `inserted: 0, updated: 0` instead of `updated: 1` — the one
  reporting difference, and the truthful reading.

`bootstrapDeclaredPositions` likewise returns `unchanged` and `unreadable`
alongside `seeded`/`updated`.
