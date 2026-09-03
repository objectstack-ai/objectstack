---
"@objectstack/driver-mongodb": patch
"@objectstack/driver-turso": patch
---

fix(drivers): `update()` on a missing id answers `null` on MongoDB and on Turso's remote face

`IDataDriver.update()` declares `Promise<Record<string, unknown> | null>` — the
not-found arm landed with the ruling on the contract, and it is the answer
`InMemoryDriver`, `SqlDriver`, `SqliteWasmDriver` and `TursoDriver`'s local face
have always given. Two implementations did not honour it. They **invented a
record** instead:

- `MongoDBDriver.update()` ran `updateOne({ id })`, then `findOne({ id })`, and
  when nothing came back returned
  `withoutUndefinedOwnKeys({ id: String(id), ...updateData })` — a row assembled
  from the caller's own payload plus the `updated_at` it had just stamped, under
  an id that names no document.
- `RemoteTransport.update()` ran `UPDATE … WHERE "id" = ?`, then
  `SELECT * … WHERE "id" = ?`, and when no row came back returned
  `{ id, ...data }` — the caller's payload with the id stapled on.

Both now return `null`.

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
