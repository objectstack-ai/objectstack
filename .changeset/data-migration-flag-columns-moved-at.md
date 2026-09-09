---
"@objectstack/spec": minor
"@objectstack/platform-objects": minor
---

`DataMigrationFlagSchema` gains `columns_moved_at`, and the `sys_migration` platform object gains the matching column: the deployment-level attestation that a migration's COLUMN MOVE ran here — the step that retypes the migrated columns and rewrites the values they hold into the new encoding.

**What it attests** is a fact the ledger could not previously express. `applied_at` says the backfill ran in apply mode; `verified_at` says the self-check passed. Neither says anything about the physical columns, because the backfill and the column move are separate acts and only the first of them had somewhere to be recorded. A deployment can therefore have applied AND verified a migration and still store the legacy encoding. `columns_moved_at` is that second fact, carried as its own member rather than as a widening of either existing one: folding it into `verified_at` would change what an already-verified row authorises on every deployment that has never heard of a column move.

**Absence is the contract, not a default.** The member is optional and nullable, and nothing in this change writes it. Null or absent means the columns still hold the legacy encoding — a real, expected steady state on any deployment that has run the backfill but not the move, and never an error state — so every row that exists in the world today, and any consumer that cannot read the member at all, lands on the legacy encoding with no extra logic. A required member, or a default value, would destroy the exact property the mechanism was chosen for.

**Nothing reads it yet, and the arbiter is untouched.** `isDataMigrationFlagVerified` — documented as the ONE arbiter for the existing consumers (reap gating, the strict value-shape flip) — is unchanged in this diff, and is now pinned to return the same verdict for a row that omits the new member as it returned before the member existed; `authorisesIrreversibleAction`, which composes it, is pinned the same way. The predicate that will require `columns_moved_at` non-null belongs to the driver work this change unblocks, and reads it in addition to the arbiter, never inside it.

This is an additive widening: `DataMigrationFlag` (`z.input` of the schema) gains one optional member, no existing member changes or moves, and no export is added or removed.
