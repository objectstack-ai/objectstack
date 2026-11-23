---
'@objectstack/core': patch
---

fix(core)!: Change Owner answers what was saved, and says a person was notified only when the notice went out

Clause-②: no (narrowing: the single Change Owner door answers `403 FIELD_NOT_ACCESSIBLE` where it answered `200`, and the bulk door lists under `failures` a record it reported moved, when a `readonlyWhen` lock holds the owner or the queue; the exported `ChangeOwnerMessaging.emit` must now resolve `{ delivered, enqueued }`)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is what the Change Owner doors report for a record whose owner or queue a readonlyWhen lock holds, and how notified is read. A caller that needs the record moved changes the record so the lock no longer holds. -->

**BREAKING** for a caller of Change Owner on an object that locks its owner under a condition (`owner_id` or `queue` with a `readonlyWhen` that holds for the record, for example "read-only once the case is closed"), and for code that implements `ChangeOwnerMessaging` from `@objectstack/core`'s security entry. The data engine leaves a locked owner as it was; Change Owner used to report the record as moved anyway, and to tell the named person a record was now theirs.

- FROM: `POST /api/v1/data/:object/:id/change-owner` answered `200` for a record whose owner or queue was locked, and `POST /api/v1/data/:object/change-owner` counted it under `updated`, while the stored owner did not change; `notified` was `true` whenever the messaging service's `emit` returned, whatever it sent, and `ChangeOwnerMessaging.emit` could resolve any value.
- TO: each owner write passes `strictReadonlyWrites`, so the locked record is refused before anything is written. The single door answers `403 FIELD_NOT_ACCESSIBLE`, naming the locked column; the bulk door lists the record under `failures` with `FIELD_NOT_ACCESSIBLE` and moves the others as before; no notification names a record that did not move. A queue target writes the owner and the queue together, so a lock on either leaves both unchanged. `notified` is `true` only when the emit reports a delivered or an enqueued notice, and `false` when the service sent it nowhere (a muted topic, an unavailable channel). `ChangeOwnerMessaging.emit` must resolve `{ delivered, enqueued }`, the counts the messaging service's `EmitResult` already carries.

The fix for a caller: change the record so the lock's condition no longer holds (or remove the condition from the field), then change the owner; or change the owner where the condition does not hold. A host that passes its own messaging service to `changeRecordOwner` / `changeRecordsOwner` returns the delivered and enqueued counts from `emit`. An object with no conditional lock on its owner sees no change.
