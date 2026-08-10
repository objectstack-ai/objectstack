# objectstack-automation — Schema References

> **Auto-generated** — do not edit. Maintainers regenerate this in the
> framework repo with `pnpm --filter @objectstack/spec run gen:skill-refs`
> (not runnable in an installed app).

Schemas live in the published `@objectstack/spec` package. Read them directly
from `node_modules` — there is no local copy in the skill bundle.

## Core schemas

- `node_modules/@objectstack/spec/src/automation/approval.zod.ts` — Approval Step Approver Type
- `node_modules/@objectstack/spec/src/automation/execution.zod.ts` — Automation Execution Protocol
- `node_modules/@objectstack/spec/src/automation/flow.zod.ts` — Flow Node Types — **built-in seed set** (ADR-0018).
- `node_modules/@objectstack/spec/src/automation/node-executor.zod.ts` — Node Executor Plugin Protocol — Wait Node Pause/Resume
- `node_modules/@objectstack/spec/src/automation/state-machine.zod.ts` — XState-inspired State Machine Protocol — hierarchical states, guarded
- `node_modules/@objectstack/spec/src/automation/time-relative-trigger.zod.ts` — Time-Relative Trigger Protocol
- `node_modules/@objectstack/spec/src/automation/webhook.zod.ts` — Webhook Trigger Event
- `node_modules/@objectstack/spec/src/data/validation.zod.ts` — ObjectStack Validation Protocol

## Transitive dependencies

- `node_modules/@objectstack/spec/src/automation/control-flow.zod.ts` — Structured control-flow constructs (ADR-0031) — the **native + AI-authored**
- `node_modules/@objectstack/spec/src/data/field-value.zod.ts` — Field runtime VALUE-shape contract (ADR-0104 D1).
- `node_modules/@objectstack/spec/src/data/field.zod.ts` — Field Type Enum
- `node_modules/@objectstack/spec/src/data/filter.zod.ts` — Unified Query DSL Specification
- `node_modules/@objectstack/spec/src/kernel/metadata-protection.zod.ts` — Metadata Protection Model — Phase 1 (ADR-0010)
- `node_modules/@objectstack/spec/src/shared/expression.zod.ts` — Expression Protocol
- `node_modules/@objectstack/spec/src/shared/identifiers.zod.ts` — System Identifier Schema
- `node_modules/@objectstack/spec/src/shared/protection.zod.ts` — Package-level metadata protection (ADR-0010 §3.7 — Phase 4.3)
- `node_modules/@objectstack/spec/src/shared/retry-policy.zod.ts` — The **single declaration** of the exponential-backoff retry policy (#4661,
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
