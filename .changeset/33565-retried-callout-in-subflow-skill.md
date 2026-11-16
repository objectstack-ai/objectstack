---
'@objectstack/skills': patch
---

docs(skills): `objectstack-automation` teaches the silent half of the after-save retried-callout rule

Clause-②: no
Metadata-protocol: none

The `try_catch` row of the `objectstack-automation` skill already said that, in a `record-after-*` flow, a retry may not reach an inline `http` / `connector_action` node (refused when the flow is saved). It now also names the half that is not refused: when the retried inline call sits inside a `subflow` / `map` child, retried by either flow, the caller saves but is never armed, and `GET /api/v1/automation/_status` reports it `bound: false` with `unboundCause: retried_callout_in_subflow` until the child's `http` node is `durable: true` or nothing retries the call. One eval case covers it.

The fault-edge note no longer spells the flow-level retry as `errorHandling.retry`, a key the schema does not have; it reads `errorHandling.strategy: 'retry'`.

Paid in place, the token ceiling does not move. Five restatements were cut, each keeping another home: the trigger table's `Fires` column (the token and the hook column say it), "not a name-keyed map" (the array example beside it), "Not author-facing" (the same row's "author the container"), the hook `runAs` note's closing "declare `runAs: 'system'`" (the note's own first sentence), and "an inbound vendor callback is an `api` flow" (the Flow Types `api` row and integration recipe 4).
