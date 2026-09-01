---
"@objectstack/service-queue": patch
---

fix(service-queue): compare the publish idempotency window as instants, not strings (#13993)

`DbQueueAdapter#publish` deduped terminal rows with
`String(row.created_at) >= windowStart` — a lexicographic compare of the raw
driver value against canonical ISO text. On Postgres/MySQL the builtin audit
column `created_at` comes out of the record read door as a JS `Date`, whose
`String()` begins with a weekday letter, unconditionally above the ISO
window-start's leading digit — so the predicate was always true: any terminal
(`completed`/`dlq`) row with that idempotency key blocked re-publish forever,
and `publish()` returned the old id having enqueued nothing. Silent message
loss on the production default drivers; SQLite (ISO text on both sides) was
always correct, which is why every existing test stayed green.

The check now normalises `created_at` to an instant (the #13382
`canonicalVersionInstant` shape: `Date`, epoch-ms number, or absolute ISO
text) and compares epoch milliseconds, so every dialect gets the declared
window semantics. The `pending`/`running` arm — which blocks regardless of
age — is untouched, and SQLite verdicts are unchanged. A `created_at` that
denotes no instant cannot be inside a window measured on the `created_at`
axis and no longer blocks.
