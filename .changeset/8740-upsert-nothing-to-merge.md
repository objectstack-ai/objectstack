---
'@objectstack/driver-sql': patch
---

fix(driver-sql): an `upsert` with nothing left to merge is a plain INSERT, so a collision surfaces as the driver's unique violation instead of merging every column

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is the statement `SqlDriver.upsert` sends when its merge set is empty. -->

**BREAKING** (a served-set narrowing) for an `upsert` whose payload carries only insert-only columns (`id`, `created_at`, `auto_number` columns) and none of its conflict-target columns, when that row collides with a stored row. Such a call used to merge EVERY payload column into the stored row, insert-only columns included. It now raises the driver's unique-violation error and leaves the stored row as it was.

`SqlDriver.upsert` merges every payload column that is not insert-only, or, when there is none, the conflict-target columns the payload carries (a no-op). When the payload carries neither, the statement used to fall back to knex's bare `merge()`, which compiles to merge-ALL on every dialect (`do update set` / `on duplicate key update` over every inserted column). That fallback is removed: with nothing to merge, the statement is a plain `INSERT` with no conflict clause. It is not `insert ignore` / `do nothing` either, which would hide a collision.

Unchanged: a payload with a column to merge, or one that carries its conflict target, upserts exactly as before, and a payload that collides with nothing is inserted and answered as before.

Also changed, on SQLite and PostgreSQL only: a conflict target that no unique index backs is no longer refused when the payload carries nothing to merge and none of the target's columns. There is no conflict clause left for the database to judge, so the row is inserted. MySQL still refuses it before the statement, and every call with something to merge is still refused on all three dialects.

**What changes for you.** If you upsert a payload made only of insert-only columns under a business conflict key the payload omits, catch the unique-violation error on a collision, or use `update()` to change a stored row.
