---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `bulkCreate` and `upsert` re-seed a stale autonumber counter instead of burning the whole batch (#6943)

#5495 taught `create()` to re-seed a stale autonumber counter and retry instead
of burning one number per failed insert. `bulkCreate()` and `upsert()` call the
same `fillAutoNumberFields` and did not get that fix. They are not, however, the
same defect as each other — measured on `main` @ `c8ff269`, on a fresh database
with seeded rows above the counter (the one-time-storm repro constraint #5495
established):

**`upsert` is `create()`'s old shape exactly.** Single row, so a stale counter
costs it one burned number per call: `last_value` walked 1 → 2 → 3 across two
refused upserts. Its `ON CONFLICT (mergeKeys) DO UPDATE` absorbs a conflict on
the merge key only; the tenanted autonumber lives under a *different* unique
index, so that violation is still raised and still reaches the caller.

**`bulkCreate` is worse.** Each row reserves its number in its own committed
transaction and the batch then goes in as ONE insert, so a single colliding row
burns *every* number the batch reserved and fails the whole request:

| 3-row `bulkCreate`, counter at 10, rows 11–39 already present | before | after |
|:---|:---|:---|
| caller-visible failures | both calls threw | **0** |
| rows written | **0** | 3 |
| `last_value` | 10 → 13, then 13 → 16 | 10 → 42, by one re-seed |

And it is the worst path to leave without recovery: framework#2678 made
`bulkCreate` the common case for seed/import, and seed/import is exactly what
*creates* the staleness — an `isSystem` replay or a `preserveAudit` import keeps
its explicit numbers and never enters `fillAutoNumberFields` (#5495/#5503).

Both paths now reuse #5495's machinery unchanged — `collidingAutoNumberReservations`
for the three-state routing, `autoNumberValueExists` for the data-based
discriminator (the conflicting column is never determinable for a tenanted
autonumber), and the forward-only `resyncSequenceToDataMax`. A collision that is
not provably this counter's is still rethrown untouched, so a duplicate on a
value the caller supplied still reaches them as its own error.

**Batch semantics are unchanged, and that is a measurement rather than a
choice.** `insert(rows[])` is a single statement, so the batch was already
all-or-nothing — the failed batch above left the table exactly as it found it.
Re-issuing and retrying the whole batch therefore preserves the existing
contract: no partial success is introduced, no transaction is opened, and no
"does a failed row roll back its siblings" question arises, because siblings
already fail together. Per-row retry inside the batch was rejected for the
opposite reason — it would have had to split the one statement into N and invent
partial success where none existed.

One thing the batch may not borrow from `create()`: `create()` keeps a
reservation that did not collide, to avoid burning a second number. A batch
cannot. One that straddles the seeded range has its low rows collide and its
high rows not, and re-issuing only the collided ones would hand them numbers
*above* the kept ones — an intra-batch duplicate the driver would have
manufactured itself. Re-issue is therefore per counter: every row drawn from a
counter that went stale is re-issued, and counters that did not go stale keep
their values, so a co-tenant's rows in the same batch are undisturbed.

As with #5495, retrying is confined to the no-caller-transaction case. Inside a
caller's transaction the sequence `UPDATE` rolls back with the refused `INSERT`,
so nothing is burned and there is nothing to repair (measured on both paths), and
on Postgres a constraint failure aborts the transaction outright. The caller owns
that retry.

`TursoDriver` (local/replica) and `SqliteWasmDriver` inherit both fixes, each
pinned by its own test rather than assumed from the base class — Turso
*overrides* `bulkCreate`/`upsert` to route remote traffic away, so inheritance
there is a routing fact, not a class fact. Turso's remote transport builds its
own INSERT and generates no autonumber at all, so it neither has this defect nor
receives this fix (that gap is #6944).
