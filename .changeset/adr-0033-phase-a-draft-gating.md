---
"@objectstack/service-ai": minor
---

feat(service-ai): ADR-0033 Phase A — draft-gate AI metadata authoring

AI metadata mutations no longer publish straight to the live schema. Every write now routes through the ADR-0027 draft workspace via `protocol.saveMetaItem({ mode:'draft' })` — nothing an agent authors goes live until a human reviews the diff and publishes. The draft is the approval gate (the never-enforced `requiresConfirmation` flag is retired).

Adds a type-agnostic apply surface — `create_metadata` / `update_metadata` / `describe_metadata` / `list_metadata` — that works for any metadata type (view, dashboard, flow, …), validated against each type's Zod schema with errors fed back to the agent for self-correction. The existing object/field tools become thin draft-writing wrappers. Tool results return `{ status:'drafted', type, name, summary, changedKeys }`.
