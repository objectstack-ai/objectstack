---
"@objectstack/driver-mongodb": minor
"@objectstack/driver-turso": minor
---

fix(drivers): `update()` on a missing id answers `null` on MongoDB and on Turso's remote face

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing alongside a
runtime behaviour change, shipped as `minor` under the launch-window convention. Two
published declared returns move: `MongoDBDriver.update()` and `RemoteTransport.update()`
(both exported from their package index) now declare
`Promise<Record<string, unknown> | null>` where they declared
`Promise<Record<string, unknown>>`. A caller that reads fields off either result —
`result.id`, `result.title` — no longer compiles until it narrows the `null` arm first.
The narrowing is delivered by the compiler at every call site, and it is the honest
declaration: the value that arm carries has always been reachable, it was simply being
answered with a fabricated record instead.

`IDataDriver.update()` declares `Promise<Record<string, unknown> | null>` — the
not-found arm landed with the ruling on the contract (`packages/spec` is untouched here),
and it is the answer `InMemoryDriver`, `SqlDriver`, `SqliteWasmDriver` and `TursoDriver`'s
local face have always given. Two implementations did not honour it. They **invented a
record** instead:

- `MongoDBDriver.update()` ran `updateOne({ id })`, then `findOne({ id })`, and
  when nothing came back returned
  `withoutUndefinedOwnKeys({ id: String(id), ...updateData })` — a row assembled
  from the caller's own payload plus the `updated_at` it had just stamped, under
  an id that names no document.
- `RemoteTransport.update()` ran `UPDATE … WHERE "id" = ?`, then
  `SELECT * … WHERE "id" = ?`, and when no row came back returned
  `{ id, ...data }` — the caller's payload with the id stapled on.

Both now return `null`. That is the runtime half of this change, and it is why this
release is not a pure type-surface move: the value a caller receives for a missing id is
different at run time, not only in the `.d.ts`.

This is the expensive direction of wrong, not merely the wrong answer: the
fabricated row said **succeeded** where the truth was **not found**, and said it
in a shape carrying the caller's own fields back, so nothing about it looked
wrong. Through the engine's by-id door a REST / SDK / MCP `update` against a
deleted or mistyped id answered **200 with a record that does not exist** — on
these two implementations only. A caller, human or agent, read that as a landed
write and did not retry, alert or roll back.

Two things downstream become correct rather than merely different:

- **One `TursoDriver`, one answer.** Its remote branch passes the transport
  result through `formatRemoteRow`, which already guards
  `row && typeof row === 'object'`, so `null` reaches the engine untouched and
  the two faces converge with no edit at that seam. Previously the same driver
  answered the same missing id two ways, chosen by `isRemote`.
- **`RemoteTransport.bulkUpdate()`'s skip stops being dead code.**
  `if (updated) results.push(updated)` is the cross-driver convention
  `SqlDriver.bulkUpdate` follows; on this transport `updated` could never be
  falsy, so a batch over N missing ids answered N invented rows. It now answers
  the rows that exist.

`upsert()` is untouched on both drivers: an upsert never answers "not found".

No landed test pinned the fabricating posture on either driver, so the
regression pins added here are net-new coverage rather than a changed baseline.

<!-- adr-0087: not-required (no-migration-prescription) No metadata key is removed, renamed or re-shaped: the moving surfaces are two driver methods' declared return types and the value they answer for an id that names no row, so there is nothing for `objectstack migrate meta`, `spec-changes.json` or the upgrade guide to project, and this changeset prescribes no rewrite. The consumer obligation is a TypeScript narrowing at the call site, delivered by the compiler. `type-surface-only` is NOT claimable here: its predicate 4 (narrowed-from-erased) is false — neither declared return was `any` at the merge base, they were the non-null `Promise<Record<string, unknown>>` — and, independently, runtime behaviour moves in the same diff, which is more than a type surface. Same disposition and reasoning as `.changeset/driver-memory-update-upsert-honest-types.md` (PR #14434), one day earlier in this same series. -->
