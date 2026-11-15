---
'@objectstack/service-automation': patch
---

fix(service-automation): a durable `http` node with no `method` sends POST on the no-outbox fallback too, as it does through the outbox

Clause-②: no — no accepted input, export or served shape is added; the no-outbox fallback now sends the verb the node's descriptor and the outbox already send.
Metadata-protocol: none

A flow `http` node with `durable: true` and no `method` was enqueued as a POST when the messaging HTTP outbox was wired, but sent as a GET when it was not (the awaited fallback, and the one background send on a record save's path). The GET carried no body and was counted as a read, so the run reported it changed nothing. The verb is now resolved once — the authored `method`, else POST for a durable node and GET for a request/response one — and both paths send it, with the same body and signature the outbox would deliver. To keep the old behaviour, author `method: 'GET'` on the node.
