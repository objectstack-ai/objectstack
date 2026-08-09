# objectstack-data — Schema References

> **Auto-generated** — do not edit. Maintainers regenerate this in the
> framework repo with `pnpm --filter @objectstack/spec run gen:skill-refs`
> (not runnable in an installed app).

Schemas live in the published `@objectstack/spec` package. Read them directly
from `node_modules` — there is no local copy in the skill bundle.

## Core schemas

- `node_modules/@objectstack/spec/src/data/datasource.zod.ts` — Driver Identifier
- `node_modules/@objectstack/spec/src/data/field.zod.ts` — Field Type Enum
- `node_modules/@objectstack/spec/src/data/hook.zod.ts` — Hook Lifecycle Events
- `node_modules/@objectstack/spec/src/data/object.zod.ts` — API Operations Enum
- `node_modules/@objectstack/spec/src/data/seed.zod.ts` — Seed Import Strategy
- `node_modules/@objectstack/spec/src/data/validation.zod.ts` — ObjectStack Validation Protocol
- `node_modules/@objectstack/spec/src/security/permission.zod.ts` — Entity (Object) Level Permissions

## Transitive dependencies

- `node_modules/@objectstack/spec/src/automation/flow-function.zod.ts` — The contract for a **named handler function a `script` node invokes** —
- `node_modules/@objectstack/spec/src/data/driver.zod.ts` — Common Driver Options
- `node_modules/@objectstack/spec/src/data/driver/common.zod.ts` — Shared building blocks for the per-driver `datasource.config` shapes (#4410).
- `node_modules/@objectstack/spec/src/data/driver/config-registry.zod.ts` — The driver-id → `datasource.config` shape registry (#4410).
- `node_modules/@objectstack/spec/src/data/driver/memory.zod.ts` — Memory Driver Configuration Schema
- `node_modules/@objectstack/spec/src/data/driver/mongo.zod.ts` — MongoDB Standard Driver Protocol
- `node_modules/@objectstack/spec/src/data/driver/mysql.zod.ts` — MySQL / MariaDB driver configuration — the `config` slot of a `datasource`
- `node_modules/@objectstack/spec/src/data/driver/postgres.zod.ts` — PostgreSQL driver configuration — the `config` slot of a `datasource` whose
- `node_modules/@objectstack/spec/src/data/driver/sqlite.zod.ts` — SQLite driver configuration — the `config` slot of a `datasource` whose
- `node_modules/@objectstack/spec/src/data/driver/turso.zod.ts` — Turso / libSQL Driver Protocol (#6345).
- `node_modules/@objectstack/spec/src/data/filter.zod.ts` — Unified Query DSL Specification
- `node_modules/@objectstack/spec/src/data/hook-body.zod.ts` — Capability tokens a script body may request.
- `node_modules/@objectstack/spec/src/data/query.zod.ts` — Sort Node
- `node_modules/@objectstack/spec/src/kernel/metadata-protection.zod.ts` — Metadata Protection Model — Phase 1 (ADR-0010)
- `node_modules/@objectstack/spec/src/security/rls.zod.ts` — Row-Level Security (RLS) Protocol
- `node_modules/@objectstack/spec/src/shared/enums.zod.ts` — Exports: SortDirectionEnum, SortItemSchema, MutationEventEnum, IsolationLevelEnum
- `node_modules/@objectstack/spec/src/shared/expression.zod.ts` — Expression Protocol
- `node_modules/@objectstack/spec/src/shared/http.zod.ts` — Shared HTTP Schemas
- `node_modules/@objectstack/spec/src/shared/identifiers.zod.ts` — System Identifier Schema
- `node_modules/@objectstack/spec/src/shared/protection.zod.ts` — Package-level metadata protection (ADR-0010 §3.7 — Phase 4.3)
- `node_modules/@objectstack/spec/src/shared/suggestions.zod.ts` — "Did you mean?" Suggestion Utilities
- `node_modules/@objectstack/spec/src/ui/action.zod.ts` — Action Parameter Schema
- `node_modules/@objectstack/spec/src/ui/bulk-action.zod.ts` — Bulk Action Schemas
- `node_modules/@objectstack/spec/src/ui/chart.zod.ts` — Unified Chart Type Taxonomy
- `node_modules/@objectstack/spec/src/ui/i18n.zod.ts` — Display-label and ARIA-label primitives shared by every `ui/` shape.
- `node_modules/@objectstack/spec/src/ui/sharing.zod.ts` — Sharing & Embedding Protocol
- `node_modules/@objectstack/spec/src/ui/view.zod.ts` — HTTP Method Enum & HTTP Request Schema

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
