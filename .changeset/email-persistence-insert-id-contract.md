---
"@objectstack/plugin-email": patch
---

fix(plugin-email)!: `EmailPersistence.insert` must return the row's own id — a substituted id is rejected instead of double-sending (#5523)

**FROM** — `insert` could answer with an id of its own (a database-assigned
primary key, an external delivery system's receipt id) and `EmailService.send()`
adopted it: the substituted id was added to the service-managed set, used as the
queued job's `rowId`, and returned to the caller.

**TO** — `insert` must confirm the id it was handed. Returning a different id
throws, naming the contract and the value returned, **before the message is
delivered**.

**Fix, one line:** return `{ id: row.id }` (or `row.id`) from `insert`. If your
store assigns its own primary key, keep the service-minted id in the row's `id`
column and record the store's key in a column of its own.

Why the contract tightened rather than the service accommodating both: the id is
minted by the service *before* the insert and is already load-bearing by the time
`insert` is called — out-of-row attachment content has been uploaded under
`sys_email/attachments/<row.id>/…`, so the row id is the only key that finds
those bytes again. Re-keying the row also broke delivery exactly-once: the
`sys_email` `afterInsert` outbox drain hook decides whether a freshly-inserted
row is the service's to deliver by asking `isServiceManaged()` about **the
inserted row's own id**, and that hook runs *inside* the insert — before `send()`
had seen, let alone reserved, the substituted id. So the hook read the row as an
application-inserted outbox entry and delivered it, while `send()` delivered it
again down its own path: one message sent twice, two terminal updates racing on
one row. The only thing that ever prevented it was the hook's `setTimeout(…, 0)`
losing a race to `send()`'s inline delivery — and `transport.send` is real
network I/O, so that race is normally lost.

Scope of the check: it judges the confirmation's **value**, not its presence. An
implementation that returns no id at all leaves nothing to disagree with (the
drain hook reads the id off the inserted row, which is the minted one either
way), so the mail still goes. An insert that *throws* is unchanged — that stays
an operational condition the service rides out with a warning and inline
delivery; only a *successful* insert that renames the row is fatal.

Breaking for external `EmailPersistence` implementations that re-key the row —
of which there are currently none: the in-repo implementation forwards the
engine's own answer and ObjectQL honours the id it is handed. Filed at `patch`
because the surface has no known external consumer and the declared TypeScript
signature is unchanged; a maintainer who counts a narrowed public-interface
contract as `minor`/`major` should relabel it.
