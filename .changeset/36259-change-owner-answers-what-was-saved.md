---
'@objectstack/core': patch
---

fix(core): Change Owner answers what was saved, and says a person was notified only when the notice went out

Clause-②: no
Metadata-protocol: none

When an object locks its owner under a condition (`owner_id` with a `readonlyWhen` that holds for the record, for example "read-only once the case is closed"), the data engine leaves the locked owner as it was. Change Owner used to report the record as moved anyway, and to tell the named person a record was now theirs. Each owner write now passes `strictReadonlyWrites`, so a locked owner or queue refuses that record before anything is written:

- `POST /api/v1/data/:object/:id/change-owner` answers `403 FIELD_NOT_ACCESSIBLE`, naming the locked column, instead of `200`.
- `POST /api/v1/data/:object/change-owner` lists the record under `failures` with `FIELD_NOT_ACCESSIBLE`; the other records move as before.
- No notification names a record that did not move. A queue target writes the owner and the queue together, so a lock on either leaves both unchanged.

`notified` is now read off the messaging service's answer: it is `true` only when the notice was delivered or taken by the outbox, and `false` when the service sent it nowhere (a muted topic, an unavailable channel).
