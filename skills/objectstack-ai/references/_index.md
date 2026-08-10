# objectstack-ai — Schema References

> **Auto-generated** — do not edit. Maintainers regenerate this in the
> framework repo with `pnpm --filter @objectstack/spec run gen:skill-refs`
> (not runnable in an installed app).

Schemas live in the published `@objectstack/spec` package. Read them directly
from `node_modules` — there is no local copy in the skill bundle.

## Core schemas

- `node_modules/@objectstack/spec/src/ai/agent.zod.ts` — AI Model Configuration
- `node_modules/@objectstack/spec/src/ai/conversation.zod.ts` — AI Conversation Memory Protocol
- `node_modules/@objectstack/spec/src/ai/embedding.zod.ts` — Embedding & Vector Store Primitives
- `node_modules/@objectstack/spec/src/ai/knowledge-document.zod.ts` — Knowledge Document / Chunk / Hit — canonical shapes shared by every
- `node_modules/@objectstack/spec/src/ai/knowledge-source.zod.ts` — Knowledge Source — declarative metadata describing what to index and
- `node_modules/@objectstack/spec/src/ai/mcp.zod.ts` — Model Context Protocol (MCP) — Reference & Binding Primitives
- `node_modules/@objectstack/spec/src/ai/model-registry.zod.ts` — AI Model Registry Protocol
- `node_modules/@objectstack/spec/src/ai/skill.zod.ts` — Skill Trigger Condition Schema
- `node_modules/@objectstack/spec/src/ai/tool.zod.ts` — Retired `ToolSchema` keys — the rejection carries the upgrade prescription,
- `node_modules/@objectstack/spec/src/ai/usage.zod.ts` — AI Usage Primitives

## Transitive dependencies

- `node_modules/@objectstack/spec/src/automation/state-machine.zod.ts` — XState-inspired State Machine Protocol — hierarchical states, guarded
- `node_modules/@objectstack/spec/src/data/field-value.zod.ts` — Field runtime VALUE-shape contract (ADR-0104 D1).
- `node_modules/@objectstack/spec/src/data/field.zod.ts` — Field Type Enum
- `node_modules/@objectstack/spec/src/data/filter.zod.ts` — Unified Query DSL Specification
- `node_modules/@objectstack/spec/src/kernel/metadata-protection.zod.ts` — Metadata Protection Model — Phase 1 (ADR-0010)
- `node_modules/@objectstack/spec/src/shared/expression.zod.ts` — Expression Protocol
- `node_modules/@objectstack/spec/src/shared/identifiers.zod.ts` — System Identifier Schema
- `node_modules/@objectstack/spec/src/shared/protection.zod.ts` — Package-level metadata protection (ADR-0010 §3.7 — Phase 4.3)
- `node_modules/@objectstack/spec/src/shared/suggestions.zod.ts` — "Did you mean?" Suggestion Utilities

## How to read these

1. The schemas are runtime Zod definitions. Use `Read` on the absolute
   path under `node_modules/@objectstack/spec/src/` to inspect field shapes,
   `.describe()` text, enums, and refinements.
2. TypeScript types: `import type { … } from '@objectstack/spec'` (or the
   matching subpath export).
3. Runtime values: import from the **matching subpath** shown in the
   schema's directory (`'@objectstack/spec/data'`, `'@objectstack/spec/ai'`, …).
   The root barrel re-exports the common factories, but not every symbol —
   when in doubt, use the subpath.
