---
"@objectstack/plugin-email": minor
---

fix(plugin-email): `sys_email` rows stranded at `queued` are swept at boot, and a failed drain says so at `error` (#5161)

`status: 'queued'` had exactly one consumer: the `afterInsert` outbox drain that
fires during the insert itself (plus, since #5160, the `email.send.async` job
`send()` publishes). Nothing ever looked at such a row again. A process that
died between the insert and the delivery — or a drain whose delivery threw —
left the row at `queued` **forever**: a state named after a queue that had no
reader, while the caller had already been told the message was accepted.

**A once-per-boot sweep is now that reader.** At `kernel:ready`, after the
registries are settled and the `email.send.async` subscriber is attached,
`sweepStrandedOutbox` picks up `sys_email` rows still at `queued` and advances
them:

- **durable queue delivery on** → the row is published as an `{ rowId }` job to
  `email.send.async` through the same producer, options and
  `sys_email:<id>` idempotency key `send()` uses, so a row that still has a
  pending job collapses onto it instead of putting a second worker on it;
- **inline delivery** → the row is delivered and finalized in place (`sent` /
  `failed`), which is what the drain hook would have done had the process lived.

Only rows **older than five minutes** are eligible. A row inserted seconds ago
is not stranded, it is someone's in-flight work — this process's `send()`, its
deferred drain hook, or the same on another instance — and sweeping it would
send that message twice. (Age, not "created before this boot": one instance's
boot time says nothing about a sibling's row inserted a second ago.) Rows this
process is delivering right now, and rows that already carry a `message_id`, are
skipped. The batch is bounded at 500 rows per boot, oldest first, and says so
when it truncates. One `info` line reports the counts; boot does **not** wait on
the sweep, and a sweep that cannot run reports at `error` rather than relying on
`kernel:ready` error propagation.

**Drain-hook failures are now `error`, not `warn`.** A drain that throws means
the mail was not sent while the insert reported success and the row still reads
`queued` — the durability class the degradation-log-level rule pins at `error`.
Both lines now name the consequence (this message was NOT sent, the row stays at
`queued`) and the fix (the boot sweep picks it up on the next restart; turn on
durable queue delivery to have failures retried and dead-lettered instead).
`deliverPersistedRow` joins `DURABILITY_CRITICAL_CALLEES`, so a future `catch`
that quietly downgrades it fails `pnpm check:durability-log-level`.

New exports: `sweepStrandedOutbox`, `OUTBOX_OBJECT`, `OUTBOX_SWEEP_MIN_AGE_MS`,
`OUTBOX_SWEEP_LIMIT`, `EmailService.enqueuePersistedRow`, and
`EmailServicePlugin.outboxSweepSettled` (the sweep's promise, for callers that
need determinism). The normal `send()` → deliver path is byte-for-byte
unchanged.
