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

- `node_modules/@objectstack/spec/src/ai/agent.zod.ts` — Exports: AIModelConfigSchema, StructuredOutputFormatSchema, TransformPipelineStepSchema, StructuredOutputConfigSchema, AgentSchema
- `node_modules/@objectstack/spec/src/ai/skill.zod.ts` — Skill Trigger Condition Schema
- `node_modules/@objectstack/spec/src/ai/tool.zod.ts` — Exports: ToolSchema
- `node_modules/@objectstack/spec/src/api/endpoint.zod.ts` — Exports: ApiMappingSchema, ApiEndpointSchema, ApiEndpoint
- `node_modules/@objectstack/spec/src/api/errors.zod.ts` — Standardized Error Codes Protocol
- `node_modules/@objectstack/spec/src/automation/control-flow.zod.ts` — Structured control-flow constructs (ADR-0031) — the **native + AI-authored**
- `node_modules/@objectstack/spec/src/automation/flow-function.zod.ts` — The contract for a **named handler function a `script` node invokes** —
- `node_modules/@objectstack/spec/src/automation/flow.zod.ts` — Exports: FlowNodeAction, FlowVariableSchema, FlowNodeSchema, FlowEdgeSchema, FlowSchema
- `node_modules/@objectstack/spec/src/automation/state-machine.zod.ts` — XState-inspired State Machine Protocol — hierarchical states, guarded
- `node_modules/@objectstack/spec/src/automation/webhook.zod.ts` — Exports: WebhookTriggerType, WebhookSchema
- `node_modules/@objectstack/spec/src/data/analytics.zod.ts` — Analytics/Semantic Layer Protocol
- `node_modules/@objectstack/spec/src/data/date-macros.zod.ts` — Date Macro Tokens — the declarative placeholders the UI substitutes
- `node_modules/@objectstack/spec/src/data/driver-sql.zod.ts` — Exports: SQLDialectSchema, DataTypeMappingSchema, SSLConfigSchema, SQLDriverConfigSchema, SQLiteDataTypeMappingDefaults
- `node_modules/@objectstack/spec/src/data/driver.zod.ts` — Exports: DriverOptionsSchema, DriverCapabilitiesSchema, DriverInterfaceSchema, PoolConfigSchema, DriverConfigSchema
- `node_modules/@objectstack/spec/src/data/driver/common.zod.ts` — Shared building blocks for the per-driver `datasource.config` shapes.
- `node_modules/@objectstack/spec/src/data/driver/config-registry.zod.ts` — The driver-id → `datasource.config` shape registry.
- `node_modules/@objectstack/spec/src/data/driver/memory.zod.ts` — Memory Driver Configuration Schema
- `node_modules/@objectstack/spec/src/data/driver/mongo.zod.ts` — MongoDB Standard Driver Protocol
- `node_modules/@objectstack/spec/src/data/driver/mysql.zod.ts` — MySQL / MariaDB driver configuration — the `config` slot of a `datasource`
- `node_modules/@objectstack/spec/src/data/driver/postgres.zod.ts` — PostgreSQL driver configuration — the `config` slot of a `datasource` whose
- `node_modules/@objectstack/spec/src/data/driver/sqlite.zod.ts` — SQLite driver configuration — the `config` slot of a `datasource` whose
- `node_modules/@objectstack/spec/src/data/driver/turso.zod.ts` — Turso / libSQL Driver Protocol.
- `node_modules/@objectstack/spec/src/data/field-value.zod.ts` — Field runtime VALUE-shape contract (ADR-0104 D1).
- `node_modules/@objectstack/spec/src/data/field.zod.ts` — Exports: FieldType, SelectOptionSchema, LocationCoordinatesSchema, CurrencyConfigSchema, CurrencyValueSchema
- `node_modules/@objectstack/spec/src/data/filter.zod.ts` — Unified Query DSL Specification
- `node_modules/@objectstack/spec/src/data/hook-body.zod.ts` — Exports: HookBodyCapability, ExpressionBodySchema, ScriptBodySchema, HookBodySchema
- `node_modules/@objectstack/spec/src/data/hook.zod.ts` — Exports: HookEvent, HookSchema, HookContextSchema
- `node_modules/@objectstack/spec/src/data/mapping.zod.ts` — Exports: TransformType, ImportFieldMappingSchema, MappingSchema
- `node_modules/@objectstack/spec/src/data/object.zod.ts` — Exports: ApiMethod, ApiOperationSchema, ObjectCapabilities, IndexSchema, TenancyConfigSchema
- `node_modules/@objectstack/spec/src/data/query.zod.ts` — QueryAST — Abstract Syntax Tree for data queries.
- `node_modules/@objectstack/spec/src/data/validation.zod.ts` — ObjectStack Validation Protocol
- `node_modules/@objectstack/spec/src/identity/position.zod.ts` — Exports: PositionSchema
- `node_modules/@objectstack/spec/src/integration/connector.zod.ts` — Connector Protocol - LEVEL 3: Enterprise Connector
- `node_modules/@objectstack/spec/src/kernel/cluster.zod.ts` — Cluster Protocol
- `node_modules/@objectstack/spec/src/kernel/metadata-loader.zod.ts` — Metadata Manager Configuration
- `node_modules/@objectstack/spec/src/kernel/metadata-protection.zod.ts` — Metadata Protection Model — Phase 1 (ADR-0010)
- `node_modules/@objectstack/spec/src/security/permission.zod.ts` — Exports: ObjectAccessScopeSchema, ObjectPermissionSchema, EffectiveObjectPermissionSchema, AdminScopeSchema, FieldPermissionSchema
- `node_modules/@objectstack/spec/src/security/rls.zod.ts` — Row-Level Security (RLS) Protocol
- `node_modules/@objectstack/spec/src/security/sharing.zod.ts` — Exports: OWDModel, SharingRuleType, SharingLevel, ShareRecipientType, CriteriaSharingRuleSchema
- `node_modules/@objectstack/spec/src/shared/connector-auth.zod.ts` — SHARED CONNECTOR AUTHENTICATION SCHEMAS
- `node_modules/@objectstack/spec/src/shared/enums.zod.ts` — Exports: SortDirectionEnum, SortItemSchema, MutationEventEnum, IsolationLevelEnum
- `node_modules/@objectstack/spec/src/shared/error-map.zod.ts` — Exports: objectStackErrorMap
- `node_modules/@objectstack/spec/src/shared/expression.zod.ts` — Expression Protocol
- `node_modules/@objectstack/spec/src/shared/http.zod.ts` — Shared HTTP Schemas
- `node_modules/@objectstack/spec/src/shared/identifiers.zod.ts` — Exports: SystemIdentifierSchema, SnakeCaseIdentifierSchema, MetadataItemNameSchema
- `node_modules/@objectstack/spec/src/shared/mapping.zod.ts` — Base Field Mapping Protocol
- `node_modules/@objectstack/spec/src/shared/metadata-collection.zod.ts` — Metadata Collection Utilities
- `node_modules/@objectstack/spec/src/shared/metadata-types.zod.ts` — Exports: MetadataFormatSchema, BaseMetadataRecordSchema
- `node_modules/@objectstack/spec/src/shared/protection.zod.ts` — Package-level metadata protection (ADR-0010 §3.7 — Phase 4.3)
- `node_modules/@objectstack/spec/src/shared/retry-policy.zod.ts` — The **single declaration** of the exponential-backoff retry policy.
- `node_modules/@objectstack/spec/src/shared/suggestions.zod.ts` — "Did you mean?" Suggestion Utilities
- `node_modules/@objectstack/spec/src/shared/value-domain.zod.ts` — Standard value domains: one closed vocabulary and one membership predicate for settings and fields.
- `node_modules/@objectstack/spec/src/system/book.zod.ts` — Package Documentation Navigation — the `book` element (ADR-0046 §6).
- `node_modules/@objectstack/spec/src/system/deploy-bundle.zod.ts` — Deploy Bundle Protocol
- `node_modules/@objectstack/spec/src/system/doc.zod.ts` — Package Documentation Metadata Protocol (ADR-0046)
- `node_modules/@objectstack/spec/src/system/email-template.zod.ts` — Email Template Metadata Protocol
- `node_modules/@objectstack/spec/src/system/job.zod.ts` — Exports: CronScheduleSchema, IntervalScheduleSchema, OnceScheduleSchema, ScheduleSchema, JobSchema
- `node_modules/@objectstack/spec/src/system/stack-server.zod.ts` — `defineStack({ server })` — the authorable server-facing configuration.
- `node_modules/@objectstack/spec/src/system/tenant.zod.ts` — Tenant Schema (Multi-Tenant Architecture)
- `node_modules/@objectstack/spec/src/system/translation.zod.ts` — Exports: LocaleSchema, FieldTranslationSchema, ActionResultDialogTranslationSchema, ObjectTranslationDataSchema, TranslationDataSchema
- `node_modules/@objectstack/spec/src/ui/action-params.zod.ts` — The action DISPATCH contract: what the platform validates on the way in, and
- `node_modules/@objectstack/spec/src/ui/action.zod.ts` — Exports: ActionParamSchema, ActionType, ActionLocationSchema, ActionAiSchema, ActionSchema
- `node_modules/@objectstack/spec/src/ui/app.zod.ts` — Exports: ObjectNavItemSchema, DashboardNavItemSchema, PageNavItemSchema, UrlNavItemSchema, ReportNavItemSchema
- `node_modules/@objectstack/spec/src/ui/bulk-action.zod.ts` — Bulk Action Schemas
- `node_modules/@objectstack/spec/src/ui/chart.zod.ts` — Unified Chart Type Taxonomy
- `node_modules/@objectstack/spec/src/ui/dashboard.zod.ts` — Exports: WidgetColorVariantSchema, WidgetActionTypeSchema, DashboardHeaderActionSchema, DashboardHeaderSchema, DashboardWidgetOptionsSchema
- `node_modules/@objectstack/spec/src/ui/dataset.zod.ts` — Analytics Dataset — the one semantic layer (ADR-0021).
- `node_modules/@objectstack/spec/src/ui/i18n.zod.ts` — Display-label and ARIA-label primitives shared by every `ui/` shape.
- `node_modules/@objectstack/spec/src/ui/page.zod.ts` — Exports: PageRegionSchema, PageComponentType, ElementDataSourceSchema, PageComponentSchema, PageVariableSchema
- `node_modules/@objectstack/spec/src/ui/report.zod.ts` — Exports: ReportType, ReportChartSchema, ReportSortSchema, JoinedReportBlockSchema, ReportSchema
- `node_modules/@objectstack/spec/src/ui/responsive.zod.ts` — Exports: StyleMapSchema, ResponsiveStylesSchema
- `node_modules/@objectstack/spec/src/ui/sharing.zod.ts` — Sharing & Embedding Protocol
- `node_modules/@objectstack/spec/src/ui/view.zod.ts` — View protocol schemas — the `view` metadata type and its three persisted body spellings.

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
