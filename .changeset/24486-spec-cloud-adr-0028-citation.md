---
'@objectstack/spec': patch
---

Clause-②: no

docs(spec): the `GET /api/v1/ai/models` response JSDoc cites `cloud ADR-0028`, not a bare `ADR-0028`

- **What changed.** The JSDoc on `AiModelsResponseSchema` and on its `models` field now cites `cloud ADR-0028` (the plan-filtered AI model picker decision) where it cited a bare `ADR-0028`. This repository's own ADR-0028 is about metadata naming and namespace isolation; the AI service that serves this list is a cloud package. The client SDK TSDoc and the docs already cite it this way.
- **Unchanged.** Every schema shape, `.describe()` string, generated JSON Schema and behaviour.
