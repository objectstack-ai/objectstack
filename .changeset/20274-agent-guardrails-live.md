---
"@objectstack/spec": patch
---

Liveness ledger: `agent.guardrails` (`maxTokensPerInvocation`, `maxExecutionTimeSec`, `blockedTopics`) is now `live`, not `experimental`. The cloud AI runtime enforces it on every user turn. The token and time limits are checked before each model round, with each limit refusal audited, and a blocked tool name or category is removed from the offer and refused at call time.

Clause-②: no

- The `guardrails` describe drops its `[EXPERIMENTAL — not enforced]` marker. It now says the cloud AI runtime enforces the block and the open framework edition does not run agents. The generated agent reference page follows.
- Author-facing effect: `os lint` / `os validate` no longer warn `liveness-experimental-property` on an agent that sets `guardrails`. A warning is not a refusal, so the accept set is unchanged.
- The ledger row cites the cloud readers and producer, dated to the reading they come from.
- The liveness README no longer says its gate refuses `live` on evidence attributed only to the closed cloud runtime. The gate never did.
- `tool.outputSchema` stays `experimental`, because nothing reads it on a tool record. Its describe and the tools guide now say where output validation actually lives: `ai.outputSchema` on the action, against which the cloud AI runtime checks the action's result. The old claim that the keys are folded into the tool description is gone.
- ⛔ No schema, parse, export or accept-set change. `agent.memory`, `agent.structuredOutput` and `agent.lifecycle` stay `experimental`.
