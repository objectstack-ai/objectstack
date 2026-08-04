---
"@objectstack/plugin-email": minor
"@objectstack/service-settings": minor
"@objectstack/cli": minor
---

feat(plugin-email): durable email delivery through `sys_job_queue`, opt-in (#5160)

`IEmailService.send()` has always delivered **inline**: the SMTP session ran
inside the caller's `await`, and `EmailService`'s retry loop lived in the same
process — so a crash between the attempt and the retry dropped the message with
no trace beyond a `sys_email` row stuck at `queued`. The pieces for a durable
path all existed (`sys_job_queue`, the `DbQueueAdapter`, an `email.send.async`
subscriber) but nothing in the repo ever published to that topic.

**New: `queueDelivery`.** With it on, `send()` persists the `sys_email` row,
publishes an `email.send.async` job **referencing that row**, and returns
`{ status: 'queued' }` immediately. A worker delivers the row and finalizes it
in place (`sent` + `message_id`, or `failed` + `error`); the queue retries with
exponential backoff (1s → 5min cap) and dead-letters the job when the attempts
run out, so a restart resumes delivery instead of losing it. The `'queued'`
status was already in `EmailDeliveryStatus` — no spec change.

Three ways to turn it on, all default-off:

- `new EmailServicePlugin({ queueDelivery: true })`
- `OS_EMAIL_QUEUE_ENABLED=true` (or `config.email.queueDelivery`) on `os serve`
- Settings → Mail → **Durable queue delivery**, hot-applied without a restart

**One retry budget, not two.** `retries` keeps its meaning — total attempts are
`retries + 1` in both modes. Inline it drives the in-process loop; queued it
becomes the queue's `maxAttempts` and the per-row loop is pinned to one attempt
per delivery. Turning the toggle on changes *where* a retry happens (durable,
backed off) and never *how many* happen, so the two layers cannot multiply.

**Fixed in the same change: the `email.send.async` subscriber inserted a new
`sys_email` row per delivery.** It called `send()` with the message, so a job
the queue retried five times left five rows — four permanently `failed`, none
carrying the real attempt count. It now delivers the referenced row via
`deliverPersistedRow`, so one message is one row and `attempt_count`
accumulates on it. Messages published in the old shape (a bare `SendEmailInput`)
are still accepted and delivered inline for a migration window.

Boundaries worth knowing before you switch it on:

- **"Send test email" always sends inline**, in every mode — the button has to
  report the provider's own answer (`535 …`), and "queued" is exactly the
  non-answer #5087 removed from it.
- **Messages with attachments or custom headers are delivered inline**, because
  `sys_email` has no columns for them and a queued copy would arrive stripped.
  Queueing them is tracked separately; this ships the loss-free behaviour.
- **A declaration that cannot be honoured fails the boot.** `queueDelivery: true`
  from the constructor or `OS_EMAIL_QUEUE_ENABLED` with no durable queue
  registered (or with `persist: false`) throws on `kernel:ready`, naming the
  fix — the #5132 judgement, applied to durability. The **settings toggle** is
  the opposite trade: it logs at `error` and keeps sending inline, because one
  save must not stop the mail.
- The kernel's built-in in-memory `queue` fallback does **not** count as a
  durable queue: it delivers synchronously with no retry or DLQ, so publishing
  to it would report `queued` for a message nothing could ever recover. Mount
  `@objectstack/service-queue` over an ObjectQL engine (the `queue` capability
  does this on `os serve`) to get the `sys_job_queue`-backed adapter.

Leaving `queueDelivery` unset keeps today's behaviour byte for byte.
