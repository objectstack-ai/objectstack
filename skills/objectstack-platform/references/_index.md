# objectstack-platform — Schema References

> **Auto-generated** — do not edit. Maintainers regenerate this in the
> framework repo with `pnpm --filter @objectstack/spec run gen:skill-refs`
> (not runnable in an installed app).

Schemas live in the published `@objectstack/spec` package. Read them directly
from `node_modules` — there is no local copy in the skill bundle.

## Core schemas

- `node_modules/@objectstack/spec/src/data/datasource.zod.ts` — Exports: DriverType, DriverDefinitionSchema, SchemaModeSchema, ExternalDatasourceSettingsSchema, DatasourceSchema
- `node_modules/@objectstack/spec/src/data/seed.zod.ts` — Exports: SeedMode, SeedSchema, leadSeed
- `node_modules/@objectstack/spec/src/kernel/context.zod.ts` — Exports: RuntimeMode, KernelContextSchema, TenantRuntimeContextSchema
- `node_modules/@objectstack/spec/src/kernel/manifest.zod.ts` — Exports: PluginPermissionsSchema, ManifestPermissionsSchema, PluginEnginesSchema, PluginRuntimeSchema, PluginPackagingSchema
- `node_modules/@objectstack/spec/src/kernel/metadata-plugin.zod.ts` — Metadata Plugin Protocol
- `node_modules/@objectstack/spec/src/kernel/plugin-capability.zod.ts` — Plugin Capability Protocol
- `node_modules/@objectstack/spec/src/kernel/plugin-loading.zod.ts` — Plugin Loading Protocol
- `node_modules/@objectstack/spec/src/kernel/plugin.zod.ts` — Exports: PluginContextSchema, PluginSchema
- `node_modules/@objectstack/spec/src/kernel/service-registry.zod.ts` — Service Registry Protocol
- `node_modules/@objectstack/spec/src/stack.zod.ts` — Exports: DatasourceMappingRuleSchema, ArtifactPackageEntrySchema, AssembledPackageBodySchema, ArtifactPackageSchema, ObjectStackDefinitionSchema

## Transitive dependencies

- `node_modules/@objectstack/spec/src/data/field.zod.ts` — Exports: FieldType, SelectOptionSchema, LocationCoordinatesSchema, CurrencyConfigSchema, CurrencyValueSchema
- `node_modules/@objectstack/spec/src/data/hook.zod.ts` — Exports: HookEvent, HookSchema, HookContextSchema
- `node_modules/@objectstack/spec/src/data/object.zod.ts` — Exports: ApiMethod, ApiOperationSchema, ObjectCapabilities, IndexSchema, TenancyConfigSchema
- `node_modules/@objectstack/spec/src/security/rls.zod.ts` — Row-Level Security (RLS) Protocol
- `node_modules/@objectstack/spec/src/ui/app.zod.ts` — Exports: ObjectNavItemSchema, DashboardNavItemSchema, PageNavItemSchema, UrlNavItemSchema, ReportNavItemSchema

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
