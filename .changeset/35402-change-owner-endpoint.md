---
'@objectstack/core': patch
'@objectstack/rest': patch
'@objectstack/client': patch
'@objectstack/spec': patch
'@objectstack/service-messaging': patch
---

feat(rest): Change Owner endpoint — hand one record or a list of records to another owner, on objects that offer the action

Clause-②: yes (widening)
Metadata-protocol: none

Two new doors under the data surface, both run as the caller:

- `POST /api/v1/data/:object/:id/change-owner` with `{ ownerId | queue, notify? }` hands one record to a person or moves it to an ownership queue (ADR-0142), and answers the record's new owner.
- `POST /api/v1/data/:object/change-owner` with `{ ids, ownerId | queue, notify? }` does the same for up to 500 records, one update per record, and answers a per-row report that lists every record that did not move with its code and sentence.

An object offers Change Owner when the platform gives it a reassignable owner and its `userActions.transfer` switch is on (on by default, off on a `controlled_by_parent` detail). Any other object is refused as a whole, `403 CHANGE_OWNER_DISABLED`, whoever asks — a holder of `modifyAllRecords` included. The switch gates this action only: a plain `owner_id` update still needs the transfer grant and nothing else, so imports and hooks are unaffected. On an object that offers it, each record moves through the ordinary write path, so the caller needs edit on the record and the transfer grant (`allowTransfer` or `modifyAllRecords`); without the grant the record keeps its owner and the answer is the data door's own `403 PERMISSION_DENIED`. `notify: true` sends the new owner one notification under the `record.owner_changed` topic.

`@objectstack/core` exports `changeRecordOwner`, `changeRecordsOwner`, `changeOwnerOffReason`, `changeOwnerOffRefusal`, `CHANGE_OWNER_DISABLED`, `CHANGE_OWNER_NOTIFICATION_TOPIC` and `assertAssignableUser` (the assigned-work hand-over's target check, now shared). `@objectstack/client` adds `data.changeOwner` and `data.changeOwnerMany`. `@objectstack/spec` registers `CHANGE_OWNER_DISABLED` in the error-code ledger, and the `userActions.transfer` liveness row is now `live`. `@objectstack/service-messaging` lists `record.owner_changed` among the platform's notification topics.
