---
'@objectstack/plugin-approvals': patch
---

fix(approvals): the record-lock refusal names the record, not its primary key (#18153)

Clause-②: no

A record held by a live approval refused the write with
`record '<id>' of '<apiName>' is locked while an approval is in progress`. The
console copies that sentence into a toast verbatim, so an end user read an
opaque primary key and a machine identifier — neither of which tells them an
approval has the record — and a deny-path toast is exactly the string that ends
up in screenshots, screen recordings and support tickets.

It now reads `Opportunity 'Acme renewal' is locked while an approval is in
progress, and cannot be edited until that approval is complete`, degrading to
`This Opportunity is locked …` when the object declares no resolvable title and
to `This record is locked …` when the registry is unreachable — ⛔ never back to
the id. The record id and the object's API name are not deleted: they move to
the CONSOLE (`logger.info`, alongside the pending request's id), which is where
a support path reads them and where a screen recording does not.

**No read was added.** Both halves were already in hand at the refusal: the
object's `label` and its ADR-0079 title pointer come from the engine's in-memory
registry (`getSchema`), and the record itself is `ctx.previous`, the pre-image
the engine has already read — measured on all four update shapes (by-id,
`updateManyData`, predicate `multi`, unscoped `multi`), every one of which
dispatches the hook per row with `previous` bound. Deliberately NOT used: a
system-context read of the record on the deny path (it would title a row the
caller may not be allowed to READ — the very state this lock exists to gate) and
the `payload_json` snapshot (served redacted per reader).

**Nothing else moved.** `RECORD_LOCKED` and its `409` are unchanged and pinned
in both directions, the `CODE: message` envelope is unchanged, and the three
OPERATOR-facing refusals in the same file — the two `PENDING_LOCK_LIMIT` cap
messages and the unanswerable-intersection message — still name the object's API
name, which is the useful thing to say to whoever has to rescope that write.
They are pinned byte for byte so a later "harmonise the lock's messages" sweep
cannot fold them into the end-user shape.

A client asserting on the old sentence's text will need updating; a client
branching on `error.code` or the 409 needs no change.
