---
'@objectstack/service-messaging': patch
---

fix(service-messaging): a GET or HEAD delivery through the HTTP outbox goes out with no body and is signed over what it sends

Clause-②: no
Metadata-protocol: none

A durable `http` node with `method: 'GET'` (or `'HEAD'`) never delivered through the messaging HTTP outbox. The outbox always sent a body (`'{}'` for a node with none), `fetch` refuses a GET or HEAD that carries any body, and the dispatcher retried that failure until the delivery was dead. The outbox also signed `'{}'`, bytes a receiver never saw.

- A GET or HEAD delivery now goes out with no body and without the default `Content-Type: application/json`. Its `X-Objectstack-Signature` covers the empty string, the published scheme's bytes for a request with no body, the same signature the `http` node's inline call sends. `SqlHttpOutbox` and `MemoryHttpOutbox` sign it that way when they enqueue. Every other method is unchanged.
- `httpDeliveryBody(payload, method?)` (`deliveryBody`) takes the delivery's method and answers `''` for GET and HEAD. A caller that signs a body must pass the method.
- Type change: in the exported `FetchImpl` type, `init.body` is now optional. A custom `fetchImpl` gets no `body` for a GET or HEAD delivery. Nothing changes at runtime for POST and the other methods. An implementation that stored `init.body` as a `string` now needs to accept `undefined` there.
- Rows already in `sys_http_delivery` as GET or HEAD with a signing secret were signed over `'{}'` when they were enqueued. The signature is computed once, at enqueue, and the secret is not kept. These rows now go out with no body and that old signature, so a receiver that verifies the signature refuses them. They never delivered before this fix either. Re-run the flow to enqueue the call again with a correct signature.

With this fix, the 18.5.0 note that names `method: 'GET'` as the way to keep the old verb on a durable `http` node is true whether or not an outbox is wired.
