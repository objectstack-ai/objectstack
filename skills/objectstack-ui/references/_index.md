# objectstack-ui — Schema References

> **Auto-generated** — do not edit. Maintainers regenerate this in the
> framework repo with `pnpm --filter @objectstack/spec run gen:skill-refs`
> (not runnable in an installed app).

Schemas live in the published `@objectstack/spec` package. Read them directly
from `node_modules` — there is no local copy in the skill bundle.

## Core schemas

- `node_modules/@objectstack/spec/src/ui/action.zod.ts` — Action Parameter Schema
- `node_modules/@objectstack/spec/src/ui/app.zod.ts` — Base Navigation Item Schema
- `node_modules/@objectstack/spec/src/ui/chart.zod.ts` — Unified Chart Type Taxonomy
- `node_modules/@objectstack/spec/src/ui/component.zod.ts` — Empty Properties Schema
- `node_modules/@objectstack/spec/src/ui/dashboard.zod.ts` — Color variant for dashboard widgets (e.g., KPI cards).
- `node_modules/@objectstack/spec/src/ui/dataset.zod.ts` — Analytics Dataset — the one semantic layer (ADR-0021).
- `node_modules/@objectstack/spec/src/ui/page.zod.ts` — Page Region Schema
- `node_modules/@objectstack/spec/src/ui/report.zod.ts` — Report Type Enum
- `node_modules/@objectstack/spec/src/ui/theme.zod.ts` — Color Palette Schema
- `node_modules/@objectstack/spec/src/ui/view.zod.ts` — HTTP Method Enum & HTTP Request Schema
- `node_modules/@objectstack/spec/src/ui/widget.zod.ts` — Field Widget Props Schema

## Transitive dependencies

- `node_modules/@objectstack/spec/src/api/errors.zod.ts` — Standardized Error Codes Protocol
- `node_modules/@objectstack/spec/src/data/date-macros.zod.ts` — Date Macro Tokens — the declarative placeholders the UI substitutes
- `node_modules/@objectstack/spec/src/data/feed.zod.ts` — Activity-timeline UI config enums.
- `node_modules/@objectstack/spec/src/data/field-value.zod.ts` — Field runtime VALUE-shape contract (ADR-0104 D1).
- `node_modules/@objectstack/spec/src/data/field.zod.ts` — Field Type Enum
- `node_modules/@objectstack/spec/src/data/filter.zod.ts` — Unified Query DSL Specification
- `node_modules/@objectstack/spec/src/data/hook-body.zod.ts` — Capability tokens a script body may request.
- `node_modules/@objectstack/spec/src/data/query.zod.ts` — Sort Node
- `node_modules/@objectstack/spec/src/kernel/metadata-protection.zod.ts` — Metadata Protection Model — Phase 1 (ADR-0010)
- `node_modules/@objectstack/spec/src/shared/enums.zod.ts` — Exports: SortDirectionEnum, SortItemSchema, MutationEventEnum, IsolationLevelEnum
- `node_modules/@objectstack/spec/src/shared/expression.zod.ts` — Expression Protocol
- `node_modules/@objectstack/spec/src/shared/http.zod.ts` — Shared HTTP Schemas
- `node_modules/@objectstack/spec/src/shared/identifiers.zod.ts` — System Identifier Schema
- `node_modules/@objectstack/spec/src/shared/protection.zod.ts` — Package-level metadata protection (ADR-0010 §3.7 — Phase 4.3)
- `node_modules/@objectstack/spec/src/shared/suggestions.zod.ts` — "Did you mean?" Suggestion Utilities
- `node_modules/@objectstack/spec/src/ui/action-params.zod.ts` — The action DISPATCH contract: what the platform validates on the way in, and
- `node_modules/@objectstack/spec/src/ui/bulk-action.zod.ts` — Bulk Action Schemas
- `node_modules/@objectstack/spec/src/ui/i18n.zod.ts` — Display-label and ARIA-label primitives shared by every `ui/` shape.
- `node_modules/@objectstack/spec/src/ui/responsive.zod.ts` — Breakpoint Name Enum
- `node_modules/@objectstack/spec/src/ui/sharing.zod.ts` — Sharing & Embedding Protocol

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
