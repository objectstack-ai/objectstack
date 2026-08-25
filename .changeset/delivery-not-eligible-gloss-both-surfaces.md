---
'@objectstack/spec': patch
---

`DELIVERY_NOT_ELIGIBLE`'s ledger gloss now describes every surface that raises it, not just `redeliver`

The `ERROR_CODE_LEDGER` entry for `DELIVERY_NOT_ELIGIBLE` glossed the code as
*"delivery row is in a non-terminal state"*. That named one refusal on one
surface, and the code has since been reused on a second: `INotificationOutbox.ack`
refuses any row that is not `in_flight`, which covers an unclaimed `pending` row
**and** an already-terminal one. So the old wording was not merely incomplete —
it was backwards for half the code's uses, describing terminal rows as the
acceptable ones when `ack` refuses exactly those.

The reuse itself is the ruled shape, not a defect: one concept — *this delivery
row's state does not permit the requested operation* — on two delivery surfaces,
with a second near-synonym code rejected for the vocabulary sprawl ADR-0112
exists to prevent. Only the comment lagged.

The gloss is now stated per surface, because the two refuse opposite halves of
the state space and no single status predicate covers both:

- **`IHttpOutbox.redeliver`** (`HttpRedeliverError`) refuses a row that is NOT
  terminal — `redeliver` means send this again, so it wants
  `success`/`failed`/`dead`. It also raises the same code when the producer's
  `RedeliverGuard` refuses or itself throws (fail-closed: "we could not check"
  must never read as "allowed"), and when the terminal re-check at the write
  misses because a dispatcher tick re-claimed the row mid-call.
- **`INotificationOutbox.ack`** (`NotificationAckError`) refuses a row that is
  not `in_flight` — both the unclaimed `pending` row (the ack-as-cancel trap)
  and the already-terminal one — plus the `SqlNotificationOutbox` compare-and-set
  read-back that shows the claim was lost mid-ack.

Comment only. No code is registered or removed, no wire value changes, and no
acceptance or refusal behaviour moves — `packages/spec` publishes
`src/**/*.zod.ts`, so the corrected gloss ships to consumers reading the ledger.
