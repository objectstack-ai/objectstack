---
'@objectstack/objectql': patch
---

fix(objectql)!: a by-id delete whose driver removes nothing after the row was read answers RECORD_NOT_FOUND and runs no after-delete work

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer an engine caller gets from a by-id delete that loses a race for its row: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller of the engine's by-id delete (`engine.delete(object, { where: { id } })`, a hook's `ctx.api`, an action handler, a flow `delete_record` step) whose row is removed by another writer after this delete read it and before its own driver call. This happens when two deletes of one row run at once on a store whose writers do not queue behind each other: for example PostgreSQL for any object, and SQLite for an object with no metadata `beforeDelete` hook and no blocking metadata `afterDelete` hook. On SQLite such a hook makes the second delete wait for the first, and the second then finds no row when it reads it.

- FROM: the loser's driver answered `false` (it removed nothing), and the engine still ran every after-delete step for it: the `afterDelete` hooks, the parent roll-up summary recompute and the `data.record.deleted` realtime event. The loser's answer was `false`. On SQLite, with such a metadata hook the loser waited for the winner and answered `RECORD_NOT_FOUND`, so the answer depended on the hook binding.
- TO: the loser answers `RECORD_NOT_FOUND` (404), the error a by-id delete already gives for an id that names no row, and none of those steps runs for it. The winner's delete is unchanged and runs each step once. A recycle-bin entry the loser wrote is still withdrawn, as before. When the loser's delete runs in a transaction (its object is referenced by a cascading relation), the cascade it walked rolls back with it.
- The same answer applies when the row is removed by the delete's own `beforeDelete` hook (a hook that deletes the row it is asked about through `ctx.api`): that delete answered `false` and now answers `RECORD_NOT_FOUND`.
- A child delete that a parent's cascade issued is the exception: when its driver answers `false`, the dependent the cascade was sent to remove is already gone, so that child delete still answers `false`, runs none of the after-delete steps, and the cascade goes on; the parent's delete completes, as it did before. A child that was already gone when its own delete read it still stops the cascade with `RECORD_NOT_FOUND`, unchanged.

The REST and batch delete routes, and the own-row delete route, already answered 404 for this case; their code and status do not change. On the own-row delete route the loser's `RECORD_NOT_FOUND` is now raised by the engine, so its `userMessage` is built from the route's system context, which carries no locale, where the route used to build it from the caller's.

The fix for a caller: treat `RECORD_NOT_FOUND` from a by-id delete as "the row is already gone", as for any id that names no row. The error this change adds always names the row the caller addressed, since a cascade's child delete no longer raises it; a dependent that the child delete's own read does not return (gone, or not readable by the caller) still stops the cascade with a `RECORD_NOT_FOUND` naming that dependent, as before. A caller that tested the answer for `false` reads the error's `code` instead.
