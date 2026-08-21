---
"@objectstack/spec": patch
"@objectstack/client": patch
---

Stop documenting bare `POST /api/v1/ai/chat` as agent-resolved (#10510). Two
shipped docblocks described a resolution step the route does not perform:
`client.ai.agents` claimed `/ai/chat` "talks to the environment's default
agent", and `App.defaultAgent` claimed that endpoint auto-resolves the app's
agent from `context.appName`. The bare route loads no agent and never reads
`context.appName`; the default-agent chain (explicit > `defaultAgent` of the
named app > first active) is driven by the assistant chat endpoint,
`POST /api/v1/ai/assistant/chat`, and `client.ai.agents.chat()` is the only SDK
method that reaches an agent at all.

Both sites read as a security-relevant scoping guarantee — an agent-resolved
endpoint would have its tool offer scoped by that agent's skills (ADR-0063
§1/§5) — so a reader auditing "which endpoints are surface-scoped?" from these
declarations got the wrong answer at both. Documentation text only: no schema
key, no parse behaviour and no runtime path changes.
