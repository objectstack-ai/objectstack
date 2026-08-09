---
"@objectstack/objectql": patch
---

fix(objectql): resync the engine's fallback autonumber counter instead of seeding it once (#6806)

On the engine's **fallback** autonumber path — the one serving drivers that do
NOT declare `supports.autonumber` (driver-memory, driver-mongodb); SQL drivers
own a persistent sequence and are untouched — `applyAutonumbers` seeded
`object.field.<scope>` from the store **once** and then incremented purely in
memory. That is only the truth while the engine is the sole writer of the field,
and it never is. Two holes, closed from the two ends that can see them.

**1. An exempt writer's record number now lifts the counter (free).** `isSystem`
seed replay, a `preserveAudit` historical import and a `beforeInsert` hook stamp
all reach the "respect an explicit value" branch — #5503's strip exempts exactly
those three — so each persisted a number the counter never saw. The counter kept
issuing from the one-time seed, *below* the store's real max, and every number
up to that max was a duplicate business identifier. The supplied value is now
parsed with the same #6468 anchoring rules the seeding scan uses (extracted as
one shared reader, so the two readings cannot drift) and the counter is lifted to
it. Cost: one string parse, **no extra query** — a warm counter now converges on
what a cold re-seed of the same store would answer.

Adoption deliberately never throws (an exempt write was accepted before and
still is), never lowers a counter, never seeds an *unseeded* counter (that would
skip the seeding scan and answer from one row), and ignores a value outside the
record's own counter scope (a historical import into a past date scope cannot
burn today's band).

**2. A collision now re-seeds and re-issues instead of burning numbers.** A
counter sitting below the real max — because a writer *outside* this process
took numbers the engine could not observe — collided on every insert until it
walked past that max one number at a time; each failed create surfaced the
driver's raw error *and* advanced the counter, so it never converged on its own.
A unique-constraint failure attributable to an autonumber the engine issued now
drops the counter, re-seeds from the store and re-issues, bounded to 3 attempts;
past that the write fails with `code: 'ERR_AUTONUMBER_COLLISION'` carrying the
driver's error as `cause`, rather than the raw driver error. A conflict on a
different column, and any non-unique failure, are rethrown untouched.

**This half is storage-dependent, and the docs name the drivers.** It is
triggered by the store rejecting the duplicate, so it reaches only drivers that
take this fallback path *and* enforce uniqueness. Measured across all five
in-repo drivers: only **driver-memory** (`supports = {}`) and **driver-mongodb**
(bit absent) take the path at all — driver-sql declares `autonumber: true`, and
driver-sqlite-wasm and driver-turso inherit it via `extends SqlDriver`. Of those
two, only driver-mongodb can raise a violation (a single-field unique index, when
the field declares `unique`); **driver-memory never does** — its `create` is a
`table.push()` storing no constraints at all — so there a duplicate still lands
silently and this branch is unreachable.

So the collision retry protects essentially one backend, and that is now stated
in those terms rather than as "the storage layer". It is not a new claim: it is
the reading already ruled and gated in `scripts/driver-memory-census.ledger.json`
for `autonumber-seed-cross-side-parity.integration.test.ts` — "InMemoryDriver
declares `supports = {}`, so the ENGINE's autonumber seeding owns the counter. No
SQL backend can stand in". The silent-duplicate outcome is pinned rather than
left implied, and driver-memory is covered by the adoption half above, which
waits for no rejection. Enforcing uniqueness in the driver is the remedy for the
remaining case and is not attempted here.

A **batch** insert drops the stale counter but is never re-issued (`bulkCreate`
may be partially applied, so re-writing it could duplicate the rows that did
land). `insert(object, rows[])` and `insertMany` therefore reject with the
**driver's own** duplicate-key error — never `ERR_AUTONUMBER_COLLISION`, which is
the single-row identity for "re-issued and still refused" — and the guarantee a
batch does get is that the next write re-seeds, so a caller's retry converges.

The unique-violation questions are asked of `@objectstack/types`'
`isUniqueViolationError` / `uniqueViolationColumn` (#6250 / #6544), never a
dialect word-list of the engine's own. #6114's read-failure discrimination is
unchanged and now also covers the re-seed: a missing table still seeds from 0,
every other read failure still propagates and writes nothing.

The counter stays **global** (not tenant-partitioned) — that remains parked per
#5495's disposition.
