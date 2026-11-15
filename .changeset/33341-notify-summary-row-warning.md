---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

fix(service-automation): a run summary's node row carries the warnings its steps raised, so a notify whose channel was refused no longer reads as a clean success in the trigger response

Clause-②: yes (widening)
Metadata-protocol: added

A `notify` step whose only channel was refused (for example `push` on a deployment with no push channel registered) already put a warning naming the channel on its step in the run history. Its row in the run summary's `nodes[]` did not: the trigger response (`POST /api/v1/automation/:name/trigger`), the `summary` a flow door's `400 FLOW_FAILED` details carry, and the persisted run row all said `status: 'success'`, `acted: 0` and nothing else, so a caller reading only the summary could not tell that nobody was notified.

`FlowRunNodeSummarySchema` (`@objectstack/spec/automation`) gains an optional `warnings: string[]`, the same element shape as `ExecutionStepLog.warnings`, and `summarizeRun` fills it on every node row from that node's step warnings: distinct texts in first-seen order, absent when no execution raised one. Every node type's step warnings ride along, not only `notify`'s, so a `create_record` / `update_record` whose requested fields the data engine stripped says so on its row too. The list is bounded per node (five distinct texts); past that a final entry says how many distinct warnings were left out, and the run's step log keeps each execution's own. Node `status`, the counters and flow control are unchanged: a refused channel is still a successful step.

Nothing to migrate: the member is optional and additive. A client that validates the summary with `FlowRunSummarySchema` from an older `@objectstack/spec` strips the new member and reads the row as before.
