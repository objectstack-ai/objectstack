---
'@objectstack/spec': patch
'@objectstack/service-ai': patch
---

feat(ai): actions opt in to being AI tools via an `ai:` block (ADR-0011)

Realigns ADR-0011 with its original opt-in design. An Action becomes an
AI-callable tool only when its metadata sets `ai.exposed: true`, which requires
an explicit, LLM-facing `ai.description` (≥40 chars, distinct from the UI
`label`). There is no heuristic auto-exposure and no description derived from
the label — a clean break from the first implementation's opt-out `aiExposed`
flag, which is removed (no compatibility shim; the platform has not shipped).

The `ai:` block also carries `category`, `paramHints` (per-parameter JSON-Schema
refinement), `outputSchema` (summarised into the tool description for chaining),
and `requiresConfirmation` (overrides the destructive-action HITL default).
`AIToolDefinition` is extended to carry `category` / `outputSchema` / `objectName`
/ `requiresConfirmation`. The `@objectstack/service-ai` bridge
(`action-tools.ts`) now gates on opt-in, merges `paramHints`, and emits a lint
warning when an exposed destructive-looking action asserts itself safe via
`ai.requiresConfirmation: false`.
