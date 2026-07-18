# objectstack-platform — Schema References

> **Auto-generated** by `packages/spec/scripts/build-skill-references.ts`.
> Do not edit — re-run `pnpm --filter @objectstack/spec run gen:skill-refs` to update.

Schemas live in the published `@objectstack/spec` package. Read them directly
from `node_modules` — there is no local copy in the skill bundle.

## Core schemas

- `node_modules/@objectstack/spec/src/data/datasource.zod.ts` — Driver Identifier
- `node_modules/@objectstack/spec/src/data/seed.zod.ts` — Seed Import Strategy
- `node_modules/@objectstack/spec/src/kernel/context.zod.ts` — Runtime Mode Enum
- `node_modules/@objectstack/spec/src/kernel/feature.zod.ts` — Feature Rollout Strategy
- `node_modules/@objectstack/spec/src/kernel/manifest.zod.ts` — Structured permission grants requested by a plugin (ADR-0025 §3.2).
- `node_modules/@objectstack/spec/src/kernel/metadata-plugin.zod.ts` — Metadata Plugin Protocol
- `node_modules/@objectstack/spec/src/kernel/plugin-capability.zod.ts` — Plugin Capability Protocol
- `node_modules/@objectstack/spec/src/kernel/plugin-lifecycle-events.zod.ts` — Plugin Lifecycle Events Protocol
- `node_modules/@objectstack/spec/src/kernel/plugin-loading.zod.ts` — Plugin Loading Protocol
- `node_modules/@objectstack/spec/src/kernel/plugin.zod.ts` — Upgrade Context Schema
- `node_modules/@objectstack/spec/src/kernel/service-registry.zod.ts` — Service Registry Protocol

## Transitive dependencies

- `node_modules/@objectstack/spec/src/data/field.zod.ts` — Field Type Enum
- `node_modules/@objectstack/spec/src/data/hook-body.zod.ts` — Capability tokens a script body may request.
- `node_modules/@objectstack/spec/src/kernel/cluster.zod.ts` — Cluster Protocol
- `node_modules/@objectstack/spec/src/kernel/metadata-customization.zod.ts` — Metadata Customization Layer Protocol
- `node_modules/@objectstack/spec/src/kernel/metadata-loader.zod.ts` — Metadata Loader Protocol
- `node_modules/@objectstack/spec/src/kernel/metadata-protection.zod.ts` — Metadata Protection Model — Phase 1 (ADR-0010)
- `node_modules/@objectstack/spec/src/kernel/public-auth-features.ts` — Public auth feature-flag registry (#2874)
- `node_modules/@objectstack/spec/src/shared/expression.zod.ts` — Expression Protocol
- `node_modules/@objectstack/spec/src/shared/identifiers.zod.ts` — System Identifier Schema
- `node_modules/@objectstack/spec/src/shared/lazy-schema.ts` — Wrap a Zod schema constructor so its body is only evaluated on first use.
- `node_modules/@objectstack/spec/src/shared/protection.zod.ts` — Package-level metadata protection (ADR-0010 §3.7 — Phase 4.3)
- `node_modules/@objectstack/spec/src/system/tenant.zod.ts` — Tenant Schema (Multi-Tenant Architecture)
- `node_modules/@objectstack/spec/src/ui/action.zod.ts` — Action Parameter Schema
- `node_modules/@objectstack/spec/src/ui/app.zod.ts` — Base Navigation Item Schema
- `node_modules/@objectstack/spec/src/ui/i18n.zod.ts` — I18n Object Schema
- `node_modules/@objectstack/spec/src/ui/sharing.zod.ts` — Sharing & Embedding Protocol

## How to read these

1. The schemas are runtime Zod definitions. Use `Read` on the absolute
   path under `node_modules/@objectstack/spec/src/` to inspect field shapes,
   `.describe()` text, enums, and refinements.
2. TypeScript types: `import type { … } from '@objectstack/spec'` (or the
   matching subpath export).
3. Runtime values: `import { … } from '@objectstack/spec'` — the package
   re-exports every schema and helper.
