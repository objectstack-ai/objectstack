---
---

test(spec,client,runtime): relocate `AiAgentsResponseSchema` onto the `data` payload it now describes, and pin `GET /ai/agents` against its declaration (#4053). Both producers of the route — the framework's degraded fallback (#4124) and cloud's `service-ai` (cloud#929) — converted onto the declared envelope; this closes out the declaration half and corrects four comments that still described the migration as in flight. Comments, a doc-block and one new test file; releases nothing.
