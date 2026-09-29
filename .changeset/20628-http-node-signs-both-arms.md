---
"@objectstack/core": minor
"@objectstack/service-automation": patch
"@objectstack/service-messaging": patch
---

**A flow `http` node's `signingSecret` now signs the request on every arm, with one scheme, and a secret that does not resolve refuses the node instead of letting the request leave unsigned.**

`signingSecret` is declared as "HMAC-SHA256 secret → X-Objectstack-Signature", with no arm named. Only the durable arm honoured it, because only the messaging outbox signed. The default inline request, and a `durable: true` node on a host with no messaging HTTP outbox (which degrades to that inline request), were sent without the header while the run reported success.

- `@objectstack/core`: **new exports** `signHttpBody(body, secret)` and `HTTP_SIGNATURE_HEADER`, the outbound HTTP signature scheme: `X-Objectstack-Signature: sha256=<lowercase hex HMAC-SHA256 of the exact body bytes>`, where a request with no body is signed over the empty string. They were `@objectstack/service-messaging`'s own, and they moved here so a sender with no outbox can sign with the same code.
- `@objectstack/service-messaging`: `signHttpBody` and `HTTP_SIGNATURE_HEADER` are still exported under the same names. They are now re-exports of the `@objectstack/core` bindings, not a second implementation. Delivery rows and the headers the outbox sends are unchanged.
- `@objectstack/service-automation`: the `http` node's inline request carries `X-Objectstack-Signature` whenever `signingSecret` is set. It is computed over the exact body the node sends (its JSON serialization of `config.body`, or the empty string when there is none), so a receiver that verifies with `signHttpBody` over the bytes it received accepts it on every arm.
  - A non-empty `signingSecret` that renders to nothing at run time now fails the node with a guard refusal naming `config.signingSecret`, and nothing is sent. This covers a `{token}` with no value in the run, or one that renders the empty string. The refusal is on every arm, including the outbox arm, which used to enqueue such a delivery unsigned. A fault edge does not route it. The fix is to give the run the value the template reads.
  - An authored `signingSecret: ''` still sends unsigned on purpose, on every arm.

Clause-②: yes (widening) — two new exports on `@objectstack/core`'s root. Nothing is removed or renamed on any package. The one newly refused case is a node whose authored secret did not resolve, which the published contract already said signs.
