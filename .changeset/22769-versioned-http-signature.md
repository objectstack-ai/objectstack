---
'@objectstack/core': minor
'@objectstack/trigger-api': minor
---

feat(core,trigger-api): a timestamped `X-Objectstack-Signature` form with a five-minute tolerance window, accepted by the inbound flow hook beside the body-only form

Clause-②: yes

- **The new form.** `x-objectstack-signature: t=<unix seconds>,v1=<hex>`, where the hex is the lowercase HMAC-SHA256 of `<t>.<raw body>` under the flow's secret. The timestamp is inside the signed material, so it cannot be changed without the secret. The inbound hook (`POST /api/v1/automation/hooks/:flowName/:hookId`) refuses the value once `t` is more than 300 seconds from the server's clock, in either direction, so a captured post stops verifying five minutes after it was signed.
- **Refusals.** A value that starts with `t=` is judged by the timestamped form alone. If it is malformed, carries the wrong HMAC, carries the body-only HMAC, or has a `t` outside the window, the answer is the same `401 INVALID_SIGNATURE` a bad signature gets, and nothing is enqueued.
- **Body-only signatures keep working.** `sha256=<hex HMAC-SHA256 of the raw body>` is still accepted, so no existing sender breaks. It signs no time, so a captured post can be replayed, and it is now deprecated: the trigger logs one `warn` line per armed hook that names the flow and the hook, the first time that hook accepts a body-only post.
- **`@objectstack/core` exports.** `signHttpBodyAt(body, secret, timestampSeconds)` signs the new form. `verifyHttpSignature(body, secret, header)` verifies both forms and returns an `HttpSignatureVerdict` (`{ valid: true, scheme: 'v1' | 'body-only' }`, or `{ valid: false, reason }`). `HTTP_SIGNATURE_TOLERANCE_SECONDS` is `300`. They sit beside `signHttpBody` and `HTTP_SIGNATURE_HEADER` in the one definition of the scheme. `@objectstack/trigger-api`'s `verifySignature` keeps its signature and now verifies through it, so it accepts both forms.
- **Unchanged.** ObjectStack's own senders, the messaging HTTP outbox (webhooks) and the flow `http` node, still send the body-only form. Receivers outside ObjectStack verify exactly that today.

**To adopt it as a sender.** Sign at send time, not at enqueue: `t = Math.floor(Date.now() / 1000)`, then send `t=<t>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` in `x-objectstack-signature`. From TypeScript, call `signHttpBodyAt(rawBody, secret, t)`.
