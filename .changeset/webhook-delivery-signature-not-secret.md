---
"@objectstack/service-messaging": patch
"@objectstack/plugin-webhooks": patch
---

fix(service-messaging): stop persisting webhook HMAC signing secrets on every delivery row (#7722)

`sys_http_delivery` carried the caller's `signingSecret` verbatim, once per
delivery attempt, in a plain `signing_secret` column — and that table is
readable over the ordinary data API (`GET /api/v1/data/sys_http_delivery`).
Anyone who could read deliveries recovered the shared key that authenticates
ObjectStack to the receiver, for **every** subscriber at once. The signature is
the receiver's only proof of origin, so the blast radius reaches outside the
deployment: a leaked key mints payloads the receiver accepts as genuine, and
rotating it means re-coordinating with every receiver operator.

**The row now carries the signature, not the key.** A delivery's body is
decided at enqueue and replayed byte-for-byte by every retry and by
`redeliver()` — so the HMAC has exactly one correct value for the row's whole
life. `enqueue()` computes it once from the producer's secret and stores only
the result (`signature`, `sha256=<hex>`); the secret is consumed and dropped.
The stored value is what the receiver is handed on the wire anyway and is
one-way in the key, so reading a delivery row tells you what was sent, not how
to forge something else.

Signing behaviour on the wire is unchanged: `X-Objectstack-Signature` still
carries `sha256=HMAC-SHA256(raw body, secret)` and verifies against the
subscriber's secret exactly as before — now pinned by tests that recompute the
HMAC over the delivered body rather than asserting a header is merely present,
and by an at-rest guard that byte-scans every column of a real delivery table
after a real delivery.

Producers are unaffected: `enqueueHttp({ …, signingSecret })` keeps its shape
for both callers (webhook fan-out and the Flow `http` node), and the fix sits at
the outbox, so both stop writing cleartext.

**Upgrading.** The `signing_secret` column is no longer declared, so an existing
database keeps it as an unmapped column holding the old cleartext until it is
dropped: run `os migrate plan` and apply the reported `drop_column` op (it is
classified destructive, so it is never applied unattended). Until then those
rows also age out on the table's existing 30-day telemetry retention. Rotate any
signing secret that was exposed. Code reading `HttpDelivery.signingSecret` off a
row should read `signature` instead — the secret is not available there by
design.
