---
"@objectstack/spec": patch
---

Liveness ledger: `agent.guardrails` (`maxTokensPerInvocation`, `maxExecutionTimeSec`, `blockedTopics`) is now `live`, not `experimental`. The cloud AI runtime enforces it on every user turn. The token and time limits are checked before each model round, a call to a blocked tool name or category is refused, and each refusal is audited.

Clause-②: no

- The `guardrails` describe drops its `[EXPERIMENTAL — not enforced]` marker. It now says the cloud AI runtime enforces the block and the open framework edition does not run agents. The generated agent reference page follows.
- Author-facing effect: `os lint` / `os validate` no longer warn `liveness-experimental-property` on an agent that sets `guardrails`. A warning is not a refusal, so the accept set is unchanged.
- The ledger row cites the cloud readers and producer, dated to the reading they come from.
- The liveness README no longer says its gate refuses `live` on evidence attributed only to the closed cloud runtime. The gate never did.
- ⛔ No schema, parse, export or accept-set change. `agent.memory`, `agent.structuredOutput`, `agent.lifecycle` and `tool.outputSchema` stay `experimental`.
