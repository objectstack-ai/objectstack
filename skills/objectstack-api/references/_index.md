# objectstack-api — Schema References

> **Auto-generated** — do not edit. Maintainers regenerate this in the
> framework repo with `pnpm --filter @objectstack/spec run gen:skill-refs`
> (not runnable in an installed app).

Schemas live in the published `@objectstack/spec` package. Read them directly
from `node_modules` — there is no local copy in the skill bundle.

## Core schemas

- `node_modules/@objectstack/spec/src/api/auth.zod.ts` — Authentication Service Protocol
- `node_modules/@objectstack/spec/src/api/batch.zod.ts` — Batch Operations API
- `node_modules/@objectstack/spec/src/api/endpoint.zod.ts` — API Mapping Schema
- `node_modules/@objectstack/spec/src/api/errors.zod.ts` — Standardized Error Codes Protocol
- `node_modules/@objectstack/spec/src/api/realtime.zod.ts` — Transport Protocol Enum
- `node_modules/@objectstack/spec/src/api/rest-server.zod.ts` — REST API Server Protocol
- `node_modules/@objectstack/spec/src/api/versioning.zod.ts` — API Versioning Protocol
- `node_modules/@objectstack/spec/src/api/websocket.zod.ts` — WebSocket Event Protocol

## Transitive dependencies

- `node_modules/@objectstack/spec/src/api/contract.zod.ts` — Machine-readable semantic code (ADR-0112): a `StandardErrorCode` member or
- `node_modules/@objectstack/spec/src/api/error-code-ledger.zod.ts` — Error-Code Ledger (ADR-0112 D3).
- `node_modules/@objectstack/spec/src/api/realtime-shared.zod.ts` — Realtime Shared Protocol
- `node_modules/@objectstack/spec/src/data/data-engine.zod.ts` — Data Engine Protocol
- `node_modules/@objectstack/spec/src/data/field-value.zod.ts` — Field runtime VALUE-shape contract (ADR-0104 D1).
- `node_modules/@objectstack/spec/src/data/field.zod.ts` — Field Type Enum
- `node_modules/@objectstack/spec/src/data/filter.zod.ts` — Unified Query DSL Specification
- `node_modules/@objectstack/spec/src/data/query.zod.ts` — Sort Node
- `node_modules/@objectstack/spec/src/kernel/execution-context.zod.ts` — Execution Context Schema
- `node_modules/@objectstack/spec/src/kernel/metadata-protection.zod.ts` — Metadata Protection Model — Phase 1 (ADR-0010)
- `node_modules/@objectstack/spec/src/security/explain.zod.ts` — [ADR-0090 D6] Access-explanation contract — `explain(principal, object,
- `node_modules/@objectstack/spec/src/shared/expression.zod.ts` — Expression Protocol
- `node_modules/@objectstack/spec/src/shared/http.zod.ts` — Shared HTTP Schemas
- `node_modules/@objectstack/spec/src/shared/identifiers.zod.ts` — System Identifier Schema
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
