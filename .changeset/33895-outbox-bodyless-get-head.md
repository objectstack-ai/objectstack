---
'@objectstack/service-messaging': patch
---

fix(service-messaging): a GET or HEAD delivery through the HTTP outbox goes out with no body and is signed over what it sends

Clause-②: no
Metadata-protocol: none

A durable `http` node with `method: 'GET'` (or `'HEAD'`) never delivered through the messaging HTTP outbox. The outbox always sent a body (`'{}'` for a node with none), `fetch` refuses a GET or HEAD that carries any body, and the dispatcher retried that failure until the delivery was dead. The outbox also signed `'{}'`, bytes a receiver never saw.

- A GET or HEAD delivery now goes out with no body and without the default `Content-Type: application/json`. Its `X-Objectstack-Signature` covers the empty string, the published scheme's bytes for a request with no body, the same signature the `http` node's inline call sends. `SqlHttpOutbox` and `MemoryHttpOutbox` sign it that way when they enqueue. Every other method is unchanged.
- The outbox never drops a body to make that work. A GET or HEAD enqueue whose payload is a real body is refused with an error that names the method and the fix: use POST or PUT, or drop the body. Only an absent payload, `null`, or the empty `{}` that a durable `http` node with no `body` enqueues is admitted. A durable `http` node with `method: 'GET'` and an authored `body` now fails at the node (`http (durable) failed to enqueue: …`). A GET or HEAD webhook whose event payload is sent as its body is refused the same way: the auto-enqueuer logs the lost event at `error` once per outage, and the record write that produced the event is not affected. A stored row that still holds a GET or HEAD with a real payload, such as one being redelivered, fails at send with the same message and is not retried. On 18.5.0 all of these went to `dead` after `fetch` refused them.
- `httpDeliveryBody(payload, method?)` (`deliveryBody`) takes the delivery's method and answers `''` for GET and HEAD. A caller that signs a body must pass the method.
- Type change: in the exported `FetchImpl` type, `init.body` is now optional. A custom `fetchImpl` gets no `body` for a GET or HEAD delivery. Nothing changes at runtime for POST and the other methods. An implementation that stored `init.body` as a `string` now needs to accept `undefined` there.
- Rows already in `sys_http_delivery` as GET or HEAD with a signing secret were signed over their payload's bytes when they were enqueued: `'{}'` for a durable `http` node with no `body`. The signature is computed once, at enqueue, and the secret is not kept. Such a row with the empty `{}` payload now goes out with no body and that old signature, so a receiver that verifies the signature refuses it. A row with any other payload fails at send, as above. None of these rows delivered before this fix either. Re-run the flow to enqueue the call again with a correct signature.

With this fix, the 18.5.0 note that names `method: 'GET'` as the way to keep the old verb on a durable `http` node is true whether or not an outbox is wired.
