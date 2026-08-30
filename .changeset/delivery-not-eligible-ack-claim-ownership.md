---
'@objectstack/spec': patch
---

`DELIVERY_NOT_ELIGIBLE`'s `INotificationOutbox.ack` gloss now describes the post-#11859 refusal set

The `ERROR_CODE_LEDGER` entry for `DELIVERY_NOT_ELIGIBLE` enumerates `ack`'s
refusal cases per surface. #11859 widened that set on the notification surface —
the claim credential now rides the record `claim()` returns and `ack()` takes it
back — and two statements in the bullet stopped being the whole truth:

- **The refusal set is wider than "not `in_flight`".** `ack` now also refuses a
  row that **is** `in_flight` but is no longer held by the claim being
  completed: ownership joined the predicate, and the credential is the
  (`claimed_by`, `claimed_at`) **pair**, so a claim lost to the `claimTtlMs`
  reap plus a re-claim by any node — including the caller's own later claim —
  matches nothing and nothing is written. It additionally refuses a record
  handed back carrying no claim credential at all.
- **"Also raised by `SqlNotificationOutbox`" was too narrow.**
  `MemoryNotificationOutbox` raises the lost-claim refusal too; both backends
  are pinned on one table in `outbox-ack-claim-ownership.integration.test.ts`,
  and both route through the shared refusal messages in `outbox.ts` so the two
  cannot drift into different wordings for one contract violation.

Comment only. No code is registered or removed, no wire value changes, and no
acceptance or refusal behaviour moves — `packages/spec` publishes
`src/**/*.zod.ts`, so the corrected gloss ships to consumers reading the ledger.
