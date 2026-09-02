---
"@objectstack/objectql": minor
---

fix(objectql): `update` answers a driver unique violation with the `DUPLICATE_RECORD` envelope, on every driver (#14390)

The insert door got this contract in #14095; the update door — one verb over —
did not, and the platform was left with ONE contract for the condition on
`insert` and none on `update`. Measured on a real `ObjectQL` engine over a real
`driver-sqlite-wasm` store with a declared unique index on `email`: driving a
second row onto the first's value through `engine.update` threw a bare `Error`
with no `code`, no `status`, no `cause`, and the whole compiled UPDATE
statement — bound values included — as its message. The REST boundary sanitises
an error with neither `code` nor `status` into `500 INTERNAL_ERROR`, so **the
same user action now answers `409 DUPLICATE_RECORD` on create and
`500 INTERNAL_ERROR` on edit.** A 500 tells a client the server fell over, tells
a form to show a generic failure, and pages whoever watches 5xx rates — for a
conflict the user can fix by typing a different value. "Renaming a record onto
a name someone else already took" is the ordinary form-submission case, and it
was the one left dialect-coupled.

**What `engine.update` now raises** for a recognised unique violation,
identically on every driver and on BOTH driver exits of the door — the by-id
`driver.update` call and the predicate (`multi: true`) `driver.updateMany`
call — and therefore through the scoped-repository facade a hook reaches as
`ctx.api.object(name).update(...)` / `.updateById(...)`: `DuplicateRecordError`
— `code: 'DUPLICATE_RECORD'`, `status: 409`, the driver's own error WHOLE on
`cause`, `object`, a `developerMessage` carrying the remedy, and `field` when —
and only when — `uniqueViolationColumn` determinably named the conflicting
COLUMN (an index name is never reported as a column).

**A multi-row update names no row.** The driver's error does not say which of
the N matched rows conflicted, and the envelope does not invent an answer: it
carries exactly the keys the by-id envelope carries — no count, no row index —
and `field` only when the dialect named a column, exactly as the composite-index
case already behaves on insert.

**Nothing else moves.** A NOT NULL violation, a deadlock, a missing table and an
unreachable store all leave the door as the very object the driver threw —
pinned on identity, on both the by-id and the predicate exits. The verdict is
the shared `isUniqueViolationError` predicate; this door adds no dialect
knowledge of its own. The envelope sits on the two driver exits rather than on
the door's outer `catch`, because that `catch` also sees the `afterUpdate`
dispatch and the roll-up recompute — a unique violation raised by a nested
driver call inside a hook is not this object's to envelope, and is passed
through untouched.

**The operator log is unchanged**: `Update operation failed` still carries the
driver's own diagnosis (the failing column, the redacted statement marker),
because the engine logs the envelope's `cause`, exactly as the insert door does.

Shipped as `minor` rather than a patch, for the reason #14095 was: callers
observe a different error object on a public data-API door. Measured
consequences on real drivers:

- `driver-sqlite-wasm`: the by-id and the predicate refusal both become the
  envelope with `field: 'email'` and the raw `SQLITE_CONSTRAINT_UNIQUE` error on
  `cause`; the REST status resolution moves from 500 to 409.
- `driver-memory`: its own `UNIQUE_VIOLATION` / 409 refusal is normalised to the
  same `DUPLICATE_RECORD` envelope (one code for an application to branch on,
  not two), with the driver's error on `cause`; its declared-index sentence
  names no single column, so `field` is absent there.

**Deliberately not in this change**: `upsert` — the engine has no such verb
today (`update.options.upsert` is a retired-key tombstone), and a dialect that
converts a conflict into a merge would need its own measurement first; and the
wire `code` the REST layer speaks for this condition, which is a separate lane.
