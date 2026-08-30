---
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
---

A definition-level input-schema refusal is now non-retryable and classified as a
never-dispatched exit (#10025, maintainer ruling 2026-08-20). When a node's
static `config` violates the `inputSchema` its own flow definition declares,
`execute()` refuses once with the ADR-0112 code `FLOW_INPUT_SCHEMA_INVALID`
(registered by #11504) and **no** `status`, and never hands the throw to the
retry loop — the guard's verdict is a pure function of the flow definition, so
re-running it cannot change the answer. All flow-dispatch doors (trigger,
`/actions`, declared endpoints) answer it `422` through the shared
`classifyFlowRefusal` table.

Retry accounting and run-log volume change for affected flows, deliberately: a
`strategy: 'retry'` flow with a mis-declared `inputSchema` now writes exactly
**one** failed run-log row instead of `1 + maxRetries` identical ones, consumes
no retry budget and no backoff delay, and its result carries the code instead of
`status: 'failed'` (previously answered `400 FLOW_FAILED`; now
`422 FLOW_INPUT_SCHEMA_INVALID`). The #9889 parity floor is unchanged
underneath: the guard still runs on every attempt path.
