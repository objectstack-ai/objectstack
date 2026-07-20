// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { ManifestSchema } from './kernel/manifest.zod';
import { validateObjectNamespacePrefix } from './kernel/namespace-prefix';
import { PLATFORM_CAPABILITY_TOKENS } from './kernel/platform-capabilities';
import { ClusterCapabilityConfigSchema } from './kernel/cluster.zod';
import { DatasourceSchema } from './data/datasource.zod';
import { TranslationBundleSchema, TranslationConfigSchema } from './system/translation.zod';
import { objectStackErrorMap, formatZodError } from './shared/error-map.zod';
import { normalizeStackInput, type MetadataCollectionInput, type MapSupportedField } from './shared/metadata-collection.zod';

// Data Protocol
import { ObjectSchema, ObjectExtensionSchema } from './data/object.zod';
import { SeedSchema } from './data/seed.zod';

// UI Protocol
import { AppSchema } from './ui/app.zod';
import { PortalSchema } from './ui/portal.zod';
import { ViewSchema } from './ui/view.zod';
import { PageSchema } from './ui/page.zod';
import { DashboardSchema } from './ui/dashboard.zod';
import { ReportSchema } from './ui/report.zod';
import { DatasetSchema } from './ui/dataset.zod';
import { ActionSchema } from './ui/action.zod';
import { ThemeSchema } from './ui/theme.zod';

// Automation Protocol
import { FlowSchema } from './automation/flow.zod';
import { JobSchema } from './system/job.zod';

// Security Protocol
import { PositionSchema } from './identity/position.zod';
import { PermissionSetSchema } from './security/permission.zod';
import { CapabilityDeclarationSchema } from './security/capabilities';
import { SharingRuleSchema } from './security/sharing.zod';

import { ApiEndpointSchema } from './api/endpoint.zod';
import { FeatureFlagSchema } from './kernel/feature.zod';

// AI Protocol
import { AgentSchema } from './ai/agent.zod';
import { SkillSchema } from './ai/skill.zod';
import { ToolSchema } from './ai/tool.zod';

// Data Protocol (additional)
import { HookSchema } from './data/hook.zod';
import { MappingSchema } from './data/mapping.zod';
import { CubeSchema } from './data/analytics.zod';

// Automation Protocol (additional)
import { WebhookSchema } from './automation/webhook.zod';

// System Protocol (additional)
import { EmailTemplateDefinitionSchema } from './system/email-template.zod';
import { DocSchema } from './system/doc.zod';
import { BookSchema } from './system/book.zod';

// Integration Protocol
import { DeclarativeConnectorEntrySchema } from './integration/connector.zod';

/**
 * Datasource Mapping Rule Schema
 *
 * Defines rules for routing objects to specific datasources based on
 * namespace, package, or object name patterns. This provides centralized
 * control over datasource assignment without modifying individual objects.
 *
 * Inspired by Django's Database Router and Kubernetes StorageClass patterns.
 *
 * @example
 * ```ts
 * datasourceMapping: [
 *   { namespace: 'crm', datasource: 'memory' },
 *   { objectPattern: 'sys_*', datasource: 'turso' },
 *   { package: 'com.example.analytics', datasource: 'bigquery' },
 *   { default: true, datasource: 'default' }
 * ]
 * ```
 */
import { lazySchema } from './shared/lazy-schema';
export const DatasourceMappingRuleSchema = lazySchema(() => z.object({
  /**
   * Match by namespace (e.g., 'crm', 'auth', 'todo')
   * Objects with this namespace will use the specified datasource.
   */
  namespace: z.string().optional().describe('Match objects by namespace'),

  /**
   * Match by package ID (e.g., 'com.example.crm')
   * All objects from this package will use the specified datasource.
   */
  package: z.string().optional().describe('Match objects by package ID'),

  /**
   * Match by object name pattern (supports wildcards: *, ?)
   * Examples: 'sys_*', 'temp_*', 'cache_*'
   */
  objectPattern: z.string().optional().describe('Match objects by name pattern (glob-style)'),

  /**
   * Mark as default fallback rule.
   * This rule applies to all objects that don't match any other rules.
   */
  default: z.boolean().optional().describe('Default fallback rule'),

  /**
   * Target datasource name.
   * Must match a registered driver name (e.g., 'memory', 'turso', 'postgres').
   */
  datasource: z.string().describe('Target datasource name'),

  /**
   * Optional priority for rule ordering (lower = higher priority).
   * If not specified, rules are evaluated in array order.
   */
  priority: z.number().optional().describe('Rule priority (lower = higher priority)'),
}).describe('Datasource routing rule'));

export type DatasourceMappingRule = z.infer<typeof DatasourceMappingRuleSchema>;

/**
 * ObjectStack Ecosystem Definition
 *
 * This schema represents the "Full Stack" definition of a project or environment.
 * It is used for:
 * 1. Project Export/Import (YAML/JSON dumps)
 * 2. IDE Validation (IntelliSense)
 * 3. Runtime Bootstrapping (In-memory loading)
 * 4. Platform Reflection (API & Capabilities Discovery)
 */
/**
 * 1. DEFINITION PROTOCOL (Static)
 * ----------------------------------------------------------------------
 * Describes the "Blueprint" or "Source Code" of an ObjectStack Plugin/Project.
 * This represents the complete declarative state of the application.
 * 
 * Usage:
 * - Developers write this in files locally.
 * - AI Agents generate this to create apps.
 * - CI Tools deploy this to the server.
 */
export const ObjectStackDefinitionSchema = lazySchema(() => z.object({
  /** System Configuration */
  manifest: ManifestSchema.optional().describe('Project Package Configuration'),
  datasources: z.array(DatasourceSchema).optional().describe('External Data Connections'),

  /**
   * Datasource Mapping Configuration
   *
   * Centralized routing rules that map packages, namespaces, or object patterns
   * to specific datasources. This eliminates the need to configure datasource
   * on every individual object.
   *
   * Rules are evaluated in order (or by priority if specified). First match wins.
   * If no match, falls back to object's explicit `datasource` field, then 'default'.
   *
   * @example
   * ```ts
   * datasourceMapping: [
   *   // System objects use Turso (persistent storage)
   *   { objectPattern: 'sys_*', datasource: 'turso' },
   *   { namespace: 'auth', datasource: 'turso' },
   *
   *   // CRM application uses Memory (dev/test)
   *   { namespace: 'crm', datasource: 'memory' },
   *   { package: 'com.example.crm', datasource: 'memory' },
   *
   *   // Temporary objects use Memory
   *   { objectPattern: 'temp_*', datasource: 'memory' },
   *
   *   // Default fallback
   *   { default: true, datasource: 'turso' },
   * ]
   * ```
   */
  datasourceMapping: z.array(DatasourceMappingRuleSchema).optional()
    .describe('Centralized datasource routing rules for packages/namespaces/objects'),

  translations: z.array(TranslationBundleSchema).optional().describe('I18n Translation Bundles'),
  i18n: TranslationConfigSchema.optional().describe('Internationalization configuration'),

  /** 
   * ObjectQL: Data Layer 
   * All business objects and entities.
   */
  objects: z.array(ObjectSchema).optional().describe('Business Objects definition (owned by this package)'),

  /**
   * Object Extensions: fields/config to merge into objects owned by other packages.
   * Use this instead of redefining an object when you want to add fields to
   * an existing object from another package.
   * 
   * @example
   * ```ts
   * objectExtensions: [{
   *   extend: 'contact',
   *   fields: { sales_stage: Field.select([...]) },
   * }]
   * ```
   */
  objectExtensions: z.array(ObjectExtensionSchema).optional().describe('Extensions to objects owned by other packages'),

  /** 
   * ObjectUI: User Interface Layer 
   * Apps, Menus, Pages, and Visualizations.
   */
  apps: z.array(AppSchema).optional().describe('Applications'),
  portals: z.array(PortalSchema).optional().describe('External-user UI portals (projections of apps/views/actions)'),
  views: z.array(ViewSchema).optional().describe('List Views'),
  pages: z.array(PageSchema).optional().describe('Custom Pages'),
  dashboards: z.array(DashboardSchema).optional().describe('Dashboards'),
  reports: z.array(ReportSchema).optional().describe('Analytics Reports'),
  datasets: z.array(DatasetSchema).optional().describe('Analytics semantic-layer datasets (ADR-0021)'),
  actions: z.array(ActionSchema).optional().describe('Global and Object Actions'),
  themes: z.array(ThemeSchema).optional().describe('UI Themes'),

  /**
   * ObjectFlow: Automation Layer
   * Business logic, approvals, and flows.
   *
   * ADR-0019: approvals are no longer a top-level collection — an approval is
   * authored as a flow with one or more Approval nodes, so it lives in `flows`.
   * ADR-0020: there is no top-level `workflows` collection — record state
   * machines are a `state_machine` validation rule on each object.
   */
  flows: z.array(FlowSchema).optional().describe('Screen Flows'),
  jobs: z.array(JobSchema).optional().describe('Background / Scheduled Jobs (run by IJobService on cron/interval/once schedules)'),
  emailTemplates: z.array(EmailTemplateDefinitionSchema).optional().describe('Email Templates resolved by IEmailService.sendTemplate({ template, locale })'),
  docs: z.array(DocSchema).optional().describe('Package documentation — flat Markdown items compiled from src/docs/*.md (ADR-0046)'),
  books: z.array(BookSchema).optional().describe('Documentation navigation spines — ordered groups with derived membership (ADR-0046 §6)'),

  /**
   * ObjectGuard: Security Layer
   */
  positions: z.array(PositionSchema).optional().describe('Positions — flat capability-distribution groups (ADR-0090 D3)'),
  permissions: z.array(PermissionSetSchema).optional().describe('Permission Sets'),
  /**
   * [ADR-0066 D1] Authorization capabilities this package DEFINES.
   *
   * The formal, EXPLICIT declaration entry point (`defineCapability`) — the
   * package-side counterpart of the curated platform capabilities. Each entry
   * is seeded into `sys_capability` at boot with `managed_by:'package'` +
   * `package_id` provenance, instead of being implicitly derived (untitled)
   * from whatever a permission set references in `systemPermissions[]`.
   *
   * NOT to be confused with `requires` (platform SERVICE capabilities like
   * `ai`/`automation`) nor the runtime `ObjectStackCapabilities` descriptor —
   * these are authorization capabilities in the ADR-0066 sense (referenced by
   * `requiredPermissions` / granted by `systemPermissions`).
   */
  capabilities: z.array(CapabilityDeclarationSchema).optional()
    .describe('[ADR-0066 D1] Authorization capabilities this package defines (seeded with package provenance)'),
  sharingRules: z.array(SharingRuleSchema).optional().describe('Record Sharing Rules'),

  /**
   * ObjectAPI: API Layer
   */
  apis: z.array(ApiEndpointSchema).optional().describe('API Endpoints'),
  webhooks: z.array(WebhookSchema).optional().describe('Outbound Webhooks'),

  /**
   * Server-facing API configuration read by `objectstack serve` / `dev` when
   * it mounts the REST + dispatcher plugins. Declared here (rather than only
   * consumed ad-hoc) so it SURVIVES `defineStack` strict parsing — an
   * undeclared key is silently stripped, which previously made these knobs a
   * no-op through the primary authoring path. Forwarded to the REST plugin as
   * `api.api.*`.
   */
  api: z.object({
    /**
     * Reject anonymous requests on `/data/*` with HTTP 401. Secure-by-default
     * (ADR-0056 D2) at the REST layer; set `false` here to intentionally serve
     * data publicly (the REST plugin logs a boot warning).
     */
    requireAuth: z.boolean().optional()
      .describe('[ADR-0056 D2] Reject anonymous /data/* requests (secure-by-default; set false to serve publicly)'),
    /** Enable environment-scoped routing for data/meta/AI APIs. */
    enableProjectScoping: z.boolean().optional(),
    /** Environment id resolution strategy when scoping is on. */
    projectResolution: z.enum(['required', 'optional', 'auto']).optional(),
    /** Per-environment membership 403 gate (dispatcher). Undefined → default. */
    enforceProjectMembership: z.boolean().optional(),
  }).optional().describe('Server-facing API config consumed by objectstack serve/dev'),

  /**
   * ObjectAI: Artificial Intelligence Layer
   *
   * Three-tier composition (Agent → Skill → Tool) aligned with Salesforce
   * Agentforce Topics, Microsoft Copilot Studio Topics, and ServiceNow Now
   * Assist Skills:
   *
   * - **agents**: Persona-bearing copilots (1-3 per app). Each agent declares
   *   its base instructions, model, knowledge, and the set of skills it can
   *   draw on. Users typically don't pick an agent per message — the active
   *   app's `defaultAgent` is selected automatically.
   * - **skills**: Reusable capability bundles ("topics" in Salesforce parlance).
   *   Each skill groups related tools, declares trigger phrases for
   *   intent matching, and trigger conditions for context-aware activation.
   */
  agents: z.array(AgentSchema).optional().describe('AI Agents and Assistants'),
  tools: z.array(ToolSchema).optional().describe('AI Tools (callable functions referenced by Skills/Agents)'),
  skills: z.array(SkillSchema).optional().describe('AI Skills (reusable capability bundles referenced by Agents)'),

  /**
   * ObjectQL: Data Extensions
   * Hooks, mappings, and analytics cubes.
   */
  hooks: z.array(HookSchema).optional().describe('Object Lifecycle Hooks'),
  /**
   * Named handler functions for declarative metadata that references
   * handlers by string name (`Hook.handler: 'my_handler'`,
   * `Action.target: 'my_handler'`). Two accepted shapes:
   *
   *   - Map form (preferred): `{ my_handler: (ctx) => {...} }`
   *   - Array form: `[{ name: 'my_handler', handler: (ctx) => {...} }]`
   *
   * Functions live in code only; they are not serialized into project
   * artifacts. The `AppPlugin` registers them on the engine before
   * binding hooks so `string` handlers resolve at startup.
   */
  functions: z.union([
    z.record(z.string(), z.function()),
    z.array(z.object({
      name: z.string(),
      handler: z.function(),
      packageId: z.string().optional(),
    })),
  ]).optional().describe('Named handler functions referenced by hooks/actions'),
  mappings: z.array(MappingSchema).optional().describe('Data Import/Export Mappings'),
  analyticsCubes: z.array(CubeSchema).optional().describe('Analytics Semantic Layer Cubes'),

  /**
   * Integration Protocol — connectors are of two kinds (ADR-0097):
   *
   * 1. **Provider-bound instance** (has `provider`): a live, dispatchable
   *    connector authored as pure metadata. At boot the automation service looks
   *    up the installed generic executor named by `provider` (`openapi` / `mcp` /
   *    `rest`, contributed by the matching plugin in `plugins:`), resolves
   *    `auth.credentialRef` through the secrets/env layer, and registers the
   *    materialized `{ def, handlers }` on the connector registry — so
   *    `connector_action` dispatches it and `GET /connectors` lists it, exactly
   *    like a hand-written connector. A declared `provider` with no installed
   *    factory is a **hard boot error**.
   *
   * 2. **Catalog descriptor** (no `provider`, the #2612 interim contract): an
   *    inert metadata entry for discovery / documentation / marketplace listing.
   *    It does NOT reach the connector registry; `connector_action` cannot
   *    dispatch it. The automation service audits these at boot — a descriptor
   *    with `actions` and no same-name runtime registration logs a loud warning;
   *    mark a deliberate catalog-only entry with `enabled: false` to silence it.
   *
   * Runtime connectors may also be contributed directly by plugins calling
   * `engine.registerConnector(def, handlers)` (ADR-0018 §Addendum). A
   * provider-bound instance whose `name` collides with such a plugin-registered
   * connector is a hard boot error (no silent precedence, ADR-0097 §4).
   */
  connectors: z.array(DeclarativeConnectorEntrySchema).optional().describe(
    'External System Connectors. A provider-bound entry (has `provider`: openapi/mcp/rest) is materialized into a ' +
    'live, dispatchable connector at boot and referenced by flows via `connector_action`; credentials are `auth.credentialRef` ' +
    'references, never inline secrets. An entry with no `provider` is a catalog descriptor only (NOT dispatchable) — set ' +
    '`enabled: false` on deliberate descriptors. Unknown provider / unresolvable credentialRef / name conflict ⇒ hard boot error (ADR-0097, #2977).',
  ),

  /**
   * Data Seeding Protocol
   * 
   * Declarative seed data for bootstrapping, demos, and testing.
   * Each entry targets a specific object and provides records to load
   * using the specified conflict resolution strategy.
   * 
   * Uses the standard SeedSchema which supports:
   * - `externalId`: Idempotency key for upsert matching (default: 'name')
   * - `mode`: Conflict resolution (upsert, insert, ignore, replace)
   * - `env`: Environment scoping (prod, dev, test)
   * 
   * @example
   * ```ts
   * data: [
   *   {
   *     object: 'account',
   *     mode: 'upsert',
   *     externalId: 'name',
   *     records: [
   *       { name: 'Acme Corp', type: 'customer', industry: 'technology' },
   *     ]
   *   }
   * ]
   * ```
   */
  data: z.array(SeedSchema).optional().describe('Seed Data / Fixtures for bootstrapping'),

  /**
   * Plugins: External Capabilities
   * List of plugins to load. Can be a Manifest object, a package name string, or a Runtime Plugin instance.
   */
  plugins: z.array(z.unknown()).optional().describe('Plugins to load'),

  /**
   * Required Capabilities
   *
   * Declarative dependency on platform-provided capabilities. The
   * runtime resolves each name to a built-in service plugin and
   * loads it automatically — no need to construct the plugin in
   * `plugins[]` or pass `--preset` flags at the CLI level.
   *
   * Built-in capability names (mapped in `@objectstack/cli`):
   *   `ai`         → AIServicePlugin (`@objectstack/service-ai`)
   *   `ai-studio`  → AIStudioPlugin (`@objectstack/service-ai-studio`; implies `ai`)
   *   `automation` → AutomationServicePlugin (+ default node packs)
   *   `analytics`  → AnalyticsServicePlugin
   *   `audit`      → AuditPlugin
   *   `i18n`       → I18nPlugin
   *
   * INTENT, not presence (#1597). Listing a capability here is an explicit
   * declaration that this app REQUIRES it, so the platform resolves it
   * fail-fast at startup: if the provider package is not installed (or its
   * plugin throws while starting), boot ABORTS with a clear error instead of
   * silently degrading. This is the opposite of "load it if the package happens
   * to be installed" — a capability the app merely bundles but does NOT list
   * here is loaded best-effort (absent ⇒ quiet skip), and tier gating remains an
   * orthogonal deny (a capability whose tier is off never loads, whatever the
   * intent). Use this for the AI service too: `requires: ['ai']` makes a missing
   * `@objectstack/service-ai` a hard boot error rather than a broken-but-booted app.
   *
   * Tokens must be members of the platform vocabulary
   * (`PLATFORM_CAPABILITY_TOKENS`, canonical kebab-case). An UNKNOWN token — a
   * typo or stale reference no runtime provides — is a `defineStack` **error**,
   * not a silent no-op (framework#3265). The legacy camelCase spellings
   * `aiStudio`/`aiSeat` were deprecated aliases in the prior release and were
   * removed in framework#3308 — use `ai-studio`/`ai-seat`.
   *
   * If a capability is also provided explicitly via `plugins[]`, the
   * explicit instance wins (and the resolver does not double-register).
   *
   * @example
   * ```ts
   * defineStack({
   *   manifest: { ... },
   *   requires: ['ai', 'automation', 'analytics'],
   *   objects: [...],
   * });
   * ```
   */
  requires: z.array(z.string()).optional().describe('Capability names this stack requires from the platform (canonical kebab-case tokens from PLATFORM_CAPABILITY_TOKENS; an unknown token is a defineStack error, declared-but-missing ⇒ fail-fast at startup)'),

  /**
   * Plugin tier presets to auto-register (e.g. `core`, `ai`, `ui`, `auth`).
   * Overrides the `--preset` flag; omit to use the preset default. Set a list
   * WITHOUT `ai` to run without the AI service (Community-Edition deployments).
   */
  tiers: z.array(z.string()).optional().describe('Plugin tier presets to enable; overrides --preset'),

  /**
   * DevPlugins: Development Capabilities
   * List of plugins to load ONLY in development environment.
   * Equivalent to `devDependencies` in package.json.
   * Useful for loading dev-tools, mock data generators, or referencing local sibling packages for debugging.
   */
  devPlugins: z.array(z.union([ManifestSchema, z.string()])).optional().describe('Plugins to load only in development (CLI dev command)'),

  /**
   * Compiled Runtime Bundle Reference
   *
   * Path (relative to the JSON artifact) to a sibling ESM module emitted
   * by `objectstack build`. The module exports `{ functions: Record<string, Function> }`
   * containing every inline `Hook.handler` (and top-level `functions` map
   * entry) that was lowered to a string ref during compilation.
   *
   * Runtimes (StandaloneStack, multi-tenant artifact-bind path) MUST
   * dynamic-import this file on boot and merge `module.functions` into
   * `bundle.functions` before `bindHooks(...)` runs — otherwise every
   * declarative hook will fail to resolve its handler.
   *
   * The two-product layout (JSON + ESM) is the canonical build artifact
   * shape for the platform. Authoring tools (`defineStack`, Studio
   * inline editor) must NOT set this field directly; it is populated
   * exclusively by the compiler.
   *
   * @example "./objectstack-runtime.7a70cd6576d17ff6.mjs"
   */
  runtimeModule: z.string().optional().describe('Path (relative to the artifact JSON) of the compiled runtime ESM bundle. Set by `objectstack build`; do not author by hand.'),
}));

export type ObjectStackDefinition = z.infer<typeof ObjectStackDefinitionSchema>;

/**
 * Extract the element type from an array type.
 * @internal
 */
type ExtractArrayItem<T> = T extends (infer Item)[] ? Item : never;

/**
 * Input type for `defineStack()` that accepts both array and map format
 * for all named metadata collections.
 * 
 * Map format allows defining metadata using the key as the `name` field:
 * ```ts
 * // Array format (traditional)
 * objects: [{ name: 'task', fields: { ... } }]
 * 
 * // Map format (key becomes name)
 * objects: { task: { fields: { ... } } }
 * ```
 * 
 * The output type is always arrays (`ObjectStackDefinition`).
 */
export type ObjectStackDefinitionInput =
  Omit<z.input<typeof ObjectStackDefinitionSchema>, MapSupportedField> & {
    [K in MapSupportedField]?: MetadataCollectionInput<
      ExtractArrayItem<NonNullable<z.input<typeof ObjectStackDefinitionSchema>[K]>>
    >;
  };

// Alias for backward compatibility
export const ObjectStackSchema = lazySchema(() => ObjectStackDefinitionSchema);
export type ObjectStack = ObjectStackDefinition;

/**
 * Options for `defineStack()`.
 */
export interface DefineStackOptions {
  /**
   * When `true` (default), enables strict validation:
   * - All Zod schemas are validated (field names, types, etc.)
   * - Cross-reference validation runs (views/actions/workflows reference valid objects)
   * - Ensures data integrity and catches errors early
   *
   * When `false`, validation is skipped for maximum flexibility
   * (e.g., when views reference objects provided by other plugins).
   * Use this ONLY when you need to bypass validation for advanced use cases.
   *
   * @default true
   */
  strict?: boolean;
}

/**
 * Validate that every object name is prefixed with the package namespace.
 *
 * Rules:
 * - When `manifest.namespace` is set, every `object.name` MUST start with
 *   `${namespace}_` (single underscore). Returns one error per offender.
 * - Names starting with `sys_` are platform-reserved and always allowed.
 * - Names containing `__` (legacy FQN double-underscore form) are flagged
 *   so authors migrate to the canonical single-prefix form.
 * - When `manifest.namespace` is absent (legacy stacks), the check is
 *   skipped — `defineStack` does not invent a prefix on the author's
 *   behalf because doing so would silently introduce a second writing
 *   style.
 *
 * The rule applies recursively to references on other metadata too
 * (views, dashboards, reports, flows, approvals, hooks, app navigation,
 * sharing rules, permissions) — but those are checked by the existing
 * `validateCrossReferences` against the canonical object set, so mis-
 * prefixed references will surface there once the objects are correct.
 */
function validateNamespacePrefix(config: ObjectStackDefinition): string[] {
  const errors: string[] = [];
  const ns = config.manifest?.namespace;
  if (!ns || !config.objects) return errors;

  // Single source of the per-object prefix rule — shared verbatim with the
  // runtime publish enforcement in MetadataManager.publishPackage.
  for (const obj of config.objects) {
    const err = validateObjectNamespacePrefix(obj.name, ns);
    if (err) errors.push(err);
  }
  return errors;
}

/**
 * Validate the "at most one App per package" rule — ADR-0019 (D1/D3).
 *
 * A consumer package (`manifest.type === 'app'`) must not define **more than
 * one** app — that is the banned "suite contains apps" shape. Fold the apps
 * into a single app with multiple tabs, or split into separate packages. Zero
 * apps is allowed (a package may still be under authoring, or define its app
 * elsewhere); non-`app` package types are internal contributions and are not
 * constrained here.
 *
 * Mirrors {@link validateNamespacePrefix}: returns one error per violation;
 * `defineStack` aggregates and throws.
 */
function validateSingleApp(config: ObjectStackDefinition): string[] {
  if (config.manifest?.type !== 'app') return [];
  const apps = config.apps ?? [];
  if (apps.length <= 1) return [];
  const names = apps.map((a) => a.name).join(', ');
  return [
    `An 'app' package must define at most one app, but found ${apps.length} (${names}). ` +
      `Fold them into one app with multiple tabs, or split into separate packages (ADR-0019 D3).`,
  ];
}

/**
 * Platform-provided object names (`sys_` / `cloud_` / `ai_` prefixes — the
 * same classification the seed loader applies). These objects are contributed
 * by the runtime, never by the stack, so cross-reference checks must not
 * demand they appear in `config.objects`: an app legitimately seeds the
 * ADR-0090 business-unit tree (`sys_business_unit`) or grants a delegated
 * administrator CRUD on the RBAC link tables (`sys_user_position`, ADR-0090
 * D12). The typo net stays intact for the stack's OWN objects.
 */
function isPlatformObjectName(name: string): boolean {
  return /^(sys_|cloud_|ai_)/.test(name);
}

/**
 * Collect all object names defined in a stack definition.
 */
function collectObjectNames(config: ObjectStackDefinition): Set<string> {
  const names = new Set<string>();
  if (config.objects) {
    for (const obj of config.objects) {
      names.add(obj.name);
    }
  }
  return names;
}

/**
 * Perform strict cross-reference validation on a parsed stack definition.
 * Returns an array of error messages (empty if valid).
 */
function validateCrossReferences(config: ObjectStackDefinition): string[] {
  const errors: string[] = [];
  const objectNames = collectObjectNames(config);

  if (objectNames.size === 0) return errors;

  // Validate hook → object references
  if (config.hooks) {
    for (const hook of config.hooks) {
      if (hook.object) {
        const hookObjects = Array.isArray(hook.object) ? hook.object : [hook.object];
        for (const obj of hookObjects) {
          if (!objectNames.has(obj)) {
            errors.push(
              `Hook '${hook.name}' references object '${obj}' which is not defined in objects.`,
            );
          }
        }
      }
    }
  }

  // Validate view data source → object references (nested in data.object)
  if (config.views) {
    for (const [i, view] of config.views.entries()) {
      const checkViewData = (data: unknown, viewLabel: string) => {
        if (data && typeof data === 'object' && 'provider' in data && 'object' in data) {
          const d = data as { provider: string; object: string };
          if (d.provider === 'object' && d.object && !objectNames.has(d.object)) {
            errors.push(
              `${viewLabel} references object '${d.object}' which is not defined in objects.`,
            );
          }
        }
      };

      if (view.list?.data) {
        checkViewData(view.list.data, `View[${i}].list`);
      }
      if (view.form?.data) {
        checkViewData(view.form.data, `View[${i}].form`);
      }
    }
  }

  // Validate seed data → object references (platform objects are runtime-
  // provided seed targets — see isPlatformObjectName).
  if (config.data) {
    for (const dataset of config.data) {
      if (
        dataset.object &&
        !objectNames.has(dataset.object) &&
        !isPlatformObjectName(dataset.object)
      ) {
        errors.push(
          `Seed data references object '${dataset.object}' which is not defined in objects.`,
        );
      }
    }
  }

  // Validate mapping → object references + executable-transform gate (#2611).
  // A mapping whose targetObject doesn't exist can never be applied by the
  // import endpoint (it 400s on target mismatch), and a `javascript`
  // transform has no server-side sandbox — both must fail at build time,
  // not at first use (Prime Directive #12: reject at the producer).
  if (config.mappings) {
    for (const m of config.mappings) {
      if (m.targetObject && !objectNames.has(m.targetObject)) {
        errors.push(
          `Mapping '${m.name}' targets object '${m.targetObject}' which is not defined in objects.`,
        );
      }
      for (const entry of m.fieldMapping ?? []) {
        if (entry.transform === 'javascript') {
          errors.push(
            `Mapping '${m.name}' uses transform 'javascript', which the import path does not execute ` +
              `(no server-side sandbox — see framework#2611). Use none/constant/map/split/join/lookup, ` +
              `or model the logic as a flow.`,
          );
        }
      }
    }
  }

  // Validate permission-set / profile object grants → object references.
  // A grant keyed by an object that isn't declared (e.g. a short `lead` instead
  // of the namespaced `crm_lead`) silently applies to NOTHING: the
  // authenticated path may namespace-resolve it, but the anonymous /
  // explicit-permission-set path does not — so the grant is simply lost (e.g. a
  // public Web-to-Lead INSERT is denied for "roles []"). Fail loudly at build
  // time. (`validateNamespacePrefix`'s doc already assumes this check lives here.)
  // Platform objects are legitimate grant targets (e.g. a delegated-admin set
  // carrying CRUD on the RBAC link tables, ADR-0090 D12) — skip them here.
  if (config.permissions) {
    for (const perm of config.permissions) {
      const grants = (perm as { objects?: Record<string, unknown> }).objects;
      if (grants && typeof grants === 'object') {
        for (const objName of Object.keys(grants)) {
          if (!objectNames.has(objName) && !isPlatformObjectName(objName)) {
            errors.push(
              `Permission '${(perm as { name?: string }).name ?? '(unnamed)'}' grants on object ` +
                `'${objName}' which is not defined in objects.`,
            );
          }
        }
      }
    }
  }

  // Validate app navigation → object/dashboard/page/report references
  if (config.apps) {
    const dashboardNames = new Set<string>();
    if (config.dashboards) {
      for (const d of config.dashboards) {
        dashboardNames.add(d.name);
      }
    }
    const pageNames = new Set<string>();
    if (config.pages) {
      for (const p of config.pages) {
        pageNames.add(p.name);
      }
    }
    const reportNames = new Set<string>();
    if (config.reports) {
      for (const r of config.reports) {
        reportNames.add(r.name);
      }
    }

    for (const app of config.apps) {
      if (!app.navigation) continue;
      const checkNavItems = (items: unknown[], appName: string) => {
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const nav = item as Record<string, unknown>;
          if (nav.type === 'object' && typeof nav.objectName === 'string' && !objectNames.has(nav.objectName)) {
            // `requiresObject` opts the nav item into "may be provided by
            // another stack / platform plugin" semantics — the frontend
            // hides the entry when the object isn't in the SchemaRegistry,
            // and stack-level cross-ref validation must skip it.
            if (!nav.requiresObject) {
              errors.push(
                `App '${appName}' navigation references object '${nav.objectName}' which is not defined in objects.`,
              );
            }
          }
          if (nav.type === 'dashboard' && typeof nav.dashboardName === 'string' && dashboardNames.size > 0 && !dashboardNames.has(nav.dashboardName)) {
            errors.push(
              `App '${appName}' navigation references dashboard '${nav.dashboardName}' which is not defined in dashboards.`,
            );
          }
          if (nav.type === 'page' && typeof nav.pageName === 'string' && pageNames.size > 0 && !pageNames.has(nav.pageName)) {
            errors.push(
              `App '${appName}' navigation references page '${nav.pageName}' which is not defined in pages.`,
            );
          }
          if (nav.type === 'report' && typeof nav.reportName === 'string' && reportNames.size > 0 && !reportNames.has(nav.reportName)) {
            errors.push(
              `App '${appName}' navigation references report '${nav.reportName}' which is not defined in reports.`,
            );
          }
          // Recurse into group children
          if (nav.type === 'group' && Array.isArray(nav.children)) {
            checkNavItems(nav.children, appName);
          }
        }
      };
      checkNavItems(app.navigation, app.name);
    }
  }

  // Validate action → flow/modal cross-references
  // Note: When no flows/pages are defined (size === 0), targets are not validated
  // because the referenced items may be provided by a plugin.
  // This is consistent with dashboard/page/report validation in navigation.
  if (config.actions) {
    const flowNames = new Set<string>();
    if (config.flows) {
      for (const flow of config.flows) {
        flowNames.add(flow.name);
      }
    }

    const pageNames = new Set<string>();
    if (config.pages) {
      for (const page of config.pages) {
        pageNames.add(page.name);
      }
    }

    for (const action of config.actions) {
      // Validate flow-type actions reference a defined flow
      if (action.type === 'flow' && action.target && flowNames.size > 0 && !flowNames.has(action.target)) {
        errors.push(
          `Action '${action.name}' references flow '${action.target}' which is not defined in flows.`,
        );
      }

      // Validate modal-type actions reference a defined page
      if (action.type === 'modal' && action.target && pageNames.size > 0 && !pageNames.has(action.target)) {
        errors.push(
          `Action '${action.name}' references page '${action.target}' (via modal target) which is not defined in pages.`,
        );
      }

      // Validate action → object references (objectName)
      if (action.objectName && !objectNames.has(action.objectName)) {
        errors.push(
          `Action '${action.name}' references object '${action.objectName}' which is not defined in objects.`,
        );
      }
    }
  }

  return errors;
}

/**
 * Stable-sort an actions array by explicit `order` (lower = higher / earlier).
 *
 * - Actions that leave `order` unset are treated as `0`.
 * - The sort is STABLE (`Array.prototype.sort` is stable since ES2019), so
 *   actions that tie on `order` — including the overwhelmingly common case where
 *   NOBODY sets `order` — keep their original registration order. This is what
 *   lets `order` promote a `record_header` action into the primary-button slot
 *   without disturbing everything else.
 * - Returns the SAME array reference untouched when no action opts in, so callers
 *   pay zero allocation on the common path and can cheaply detect "unchanged".
 *
 * @internal
 */
function sortActionsByOrder<T extends { order?: number }>(actions: T[]): T[] {
  if (!actions.some((a) => a.order !== undefined)) return actions;
  // Copy first so the stable sort never mutates the caller's array.
  return actions.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Merge top-level actions into their target objects based on `objectName`, then
 * honour each action's explicit `order`.
 *
 * Actions with `objectName` are appended to the corresponding object's `actions`
 * array. Actions without `objectName` (global actions) are left in place. The
 * top-level `actions` array is preserved for global access (e.g., platform
 * overview, search).
 *
 * After merging, every action group (each object's `actions` and the top-level
 * `actions`) is stable-sorted by `order` via {@link sortActionsByOrder}. Because
 * that sort is a no-op unless an author sets `order`, this is fully backward
 * compatible — arrays with no `order` keep their exact registration order and
 * reference. Renderers that pick a single primary action from `record_header`
 * (objectui) therefore see approve/reject-style actions in their declared
 * priority rather than in fragile cross-file registration order.
 *
 * This aligns with Salesforce/ServiceNow patterns where object metadata includes
 * its actions, so API responses like `/api/v1/meta/objects/:name` include actions
 * (already ordered) without downstream merge.
 *
 * @internal
 */
function mergeActionsIntoObjects(config: ObjectStackDefinition): ObjectStackDefinition {
  // Honour `order` on the preserved top-level actions regardless of objects.
  const sortedTop = config.actions ? sortActionsByOrder(config.actions) : config.actions;
  const topChanged = sortedTop !== config.actions;

  if (!config.objects || config.objects.length === 0) {
    return topChanged ? { ...config, actions: sortedTop } : config;
  }

  // Build map: objectName → actions[] (top-level actions targeting an object)
  const actionsByObject = new Map<string, NonNullable<ObjectStackDefinition['actions']>>();
  for (const action of config.actions ?? []) {
    if (action.objectName) {
      const list = actionsByObject.get(action.objectName) ?? [];
      list.push(action);
      actionsByObject.set(action.objectName, list);
    }
  }

  // Merge into objects and sort each object's final actions by `order` (shallow
  // copy — only the `actions` field is modified; other fields stay shared
  // references, consistent with mergeObjects() and Zod output).
  let objectsChanged = false;
  const newObjects = config.objects.map((obj) => {
    const objActions = actionsByObject.get(obj.name);
    const base = obj.actions ?? [];
    const merged = objActions ? [...base, ...objActions] : base;
    const sorted = sortActionsByOrder(merged);
    // Untouched: no top-level actions merged in AND the sort was a no-op.
    if (!objActions && sorted === base) return obj;
    objectsChanged = true;
    return { ...obj, actions: sorted };
  });

  if (!objectsChanged && !topChanged) return config;
  return {
    ...config,
    ...(objectsChanged ? { objects: newObjects } : {}),
    ...(topChanged ? { actions: sortedTop } : {}),
  };
}

/**
 * Type-safe helper to define a generic stack.
 *
 * In ObjectStack, the concept of "Project" and "Plugin" is fluid:
 * - A **Project** is simply a Stack that is currently being executed (the `cwd`).
 * - A **Plugin** is a Stack that is being loaded by another Stack.
 *
 * This unified definition allows any "Project" (e.g., Todo App) to be imported
 * as a "Plugin" into a larger system (e.g., Company PaaS) without code changes.
 *
 * @param config - The stack definition object
 * @param options - Optional settings. Use `{ strict: true }` to validate cross-references.
 * @returns The validated stack definition
 *
 * @example
 * ```ts
 * // Basic usage (pass-through, backward compatible)
 * const stack = defineStack({ manifest: { ... }, objects: [...] });
 *
 * // Map format — key becomes `name` field
 * const stack = defineStack({
 *   objects: {
 *     task: { fields: { title: { type: 'text' } } },
 *     project: { fields: { name: { type: 'text' } } },
 *   },
 *   apps: {
 *     project_manager: { label: 'Project Manager', objects: ['task', 'project'] },
 *   },
 * });
 *
 * // Strict mode — validates that views/workflows reference defined objects
 * const stack = defineStack({ manifest: { ... }, objects: [...], views: [...] }, { strict: true });
 * ```
 */
/**
 * [ADR-0057] HIERARCHY access scopes (`unit` / `unit_and_below` /
 * `own_and_reports`) are an ENTERPRISE capability — their enforcement ships in
 * `@objectstack/security-enterprise`, not the open edition. A stack that uses
 * one MUST declare `requires: ['hierarchy-security']`; otherwise the open
 * runtime would silently fail closed to owner-only (the metadata would lie,
 * ADR-0049). This makes that an authoring-time error instead.
 */
function validateHierarchyScopeCapability(data: unknown): string[] {
  const errors: string[] = [];
  const d = data as { requires?: unknown; permissions?: unknown };
  const requires = Array.isArray(d?.requires) ? (d.requires as string[]) : [];
  if (requires.includes('hierarchy-security')) return errors;
  const HIER = new Set(['unit', 'unit_and_below', 'own_and_reports']);
  const perms = Array.isArray(d?.permissions) ? (d.permissions as any[]) : [];
  for (const ps of perms) {
    const objs = ps?.objects && typeof ps.objects === 'object' ? ps.objects : {};
    for (const [objName, grant] of Object.entries(objs)) {
      const g = grant as Record<string, unknown>;
      for (const key of ['readScope', 'writeScope']) {
        const v = g?.[key];
        if (typeof v === 'string' && HIER.has(v)) {
          errors.push(
            `permission set '${ps?.name ?? '?'}' grant on '${objName}' uses ${key}='${v}', a HIERARCHY scope. ` +
            `Declare \`requires: ['hierarchy-security']\` (provided by @objectstack/security-enterprise) — ` +
            `the open edition cannot enforce it and would fail closed to owner-only.`,
          );
        }
      }
    }
  }
  return errors;
}

/**
 * Reject `requires` tokens that are not part of the platform capability
 * vocabulary (framework#3265). An unknown token is a genuine typo or a stale
 * reference that NO runtime provides, so every runtime would otherwise SILENTLY
 * ignore it (declared ≠ enforced). Fail at the producer, loudly (Prime
 * Directive #12): the vocabulary is the union of every token the framework CLI
 * and cloud's objectos-runtime resolve, plus the enterprise plugin-provided ones
 * (`hierarchy-security` / `ai-seat` / `governance`). The legacy `aiStudio` /
 * `aiSeat` aliases were removed in #3308, so those now reject too. Returns one
 * error per distinct unknown token.
 */
function validateKnownCapabilities(config: ObjectStackDefinition): string[] {
  const raw = config.requires;
  if (!raw || raw.length === 0) return [];
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const token of raw) {
    if (PLATFORM_CAPABILITY_TOKENS.includes(token) || seen.has(token)) continue;
    seen.add(token);
    errors.push(
      `requires: '${token}' is not a known platform capability — check for a typo ` +
        `(known tokens are kebab-case, e.g. 'ai-studio', 'pinyin-search', 'automation'). ` +
        `No runtime provides it, so it would be silently ignored.`,
    );
  }
  return errors;
}

export function defineStack(
  config: ObjectStackDefinitionInput,
  options?: DefineStackOptions,
): ObjectStackDefinition {
  // Default to strict=true for safety (validate by default)
  const strict = options?.strict !== false;

  // Normalize map-formatted collections to arrays (key → name injection)
  const normalized = normalizeStackInput(config as Record<string, unknown>);

  if (!strict) {
    // Non-strict mode: skip validation (advanced use cases only)
    return mergeActionsIntoObjects(normalized as ObjectStackDefinition);
  }

  // Strict mode (default): parse with custom error map, then cross-reference validate
  const result = ObjectStackDefinitionSchema.safeParse(normalized, {
    error: objectStackErrorMap,
  });

  if (!result.success) {
    throw new Error(formatZodError(result.error, 'defineStack validation failed'));
  }

  // REJECT any unknown capability token (framework#3265/#3308): no runtime
  // provides it, so it would otherwise be silently ignored (declared ≠
  // enforced, Prime Directive #12). No alias canonicalization — the deprecated
  // `aiStudio`/`aiSeat` spellings were removed in #3308.
  const data = result.data;

  const capErrors = validateKnownCapabilities(data);
  if (capErrors.length > 0) {
    const header = `defineStack capability validation failed (${capErrors.length} issue${capErrors.length === 1 ? '' : 's'}):`;
    const lines = capErrors.map((e) => `  ✗ ${e}`);
    throw new Error(`${header}\n\n${lines.join('\n')}`);
  }

  const crossRefErrors = validateCrossReferences(data);
  if (crossRefErrors.length > 0) {
    const header = `defineStack cross-reference validation failed (${crossRefErrors.length} issue${crossRefErrors.length === 1 ? '' : 's'}):`;
    const lines = crossRefErrors.map((e) => `  ✗ ${e}`);
    throw new Error(`${header}\n\n${lines.join('\n')}`);
  }

  const nsErrors = validateNamespacePrefix(data);
  if (nsErrors.length > 0) {
    const header = `defineStack namespace-prefix validation failed (${nsErrors.length} issue${nsErrors.length === 1 ? '' : 's'}):`;
    const lines = nsErrors.map((e) => `  ✗ ${e}`);
    const hint = `\n\nEvery object.name must be \`\${manifest.namespace}_\${shortName}\`. This is the only supported writing style — the platform does not provide ns() helpers or factory wrappers.`;
    throw new Error(`${header}\n\n${lines.join('\n')}${hint}`);
  }

  const appErrors = validateSingleApp(data);
  if (appErrors.length > 0) {
    const header = `defineStack single-app validation failed (${appErrors.length} issue${appErrors.length === 1 ? '' : 's'}):`;
    const lines = appErrors.map((e) => `  ✗ ${e}`);
    throw new Error(`${header}\n\n${lines.join('\n')}`);
  }

  const hierErrors = validateHierarchyScopeCapability(data);
  if (hierErrors.length > 0) {
    const header = `defineStack hierarchy-scope capability validation failed (${hierErrors.length} issue${hierErrors.length === 1 ? '' : 's'}):`;
    const lines = hierErrors.map((e) => `  ✗ ${e}`);
    throw new Error(`${header}\n\n${lines.join('\n')}`);
  }

  return mergeActionsIntoObjects(data);
}


// ─── composeStacks ──────────────────────────────────────────────────

/**
 * Strategy for resolving conflicts when multiple stacks define the same named item.
 *
 * - `'error'`    — Throw an error when a duplicate name is detected (default).
 * - `'override'` — Last stack wins; later definitions replace earlier ones.
 * - `'merge'`    — Shallow-merge items with the same name (later fields win).
 */
export const ConflictStrategySchema = lazySchema(() => z.enum(['error', 'override', 'merge']));
export type ConflictStrategy = z.infer<typeof ConflictStrategySchema>;

/**
 * Options for {@link composeStacks}.
 */
export const ComposeStacksOptionsSchema = lazySchema(() => z.object({
  /**
   * How to handle same-name objects across stacks.
   * @default 'error'
   */
  objectConflict: ConflictStrategySchema.default('error'),

  /**
   * Which manifest to keep when multiple stacks provide one.
   * - `'first'` — Use the first manifest found.
   * - `'last'`  — Use the last manifest found (default).
   * - A number  — Use the manifest from the stack at the given index.
   * @default 'last'
   */
  manifest: z.union([z.enum(['first', 'last']), z.number().int().min(0)]).default('last'),

  /**
   * Optional namespace prefix (reserved for Phase 2 — Marketplace isolation).
   * When set, object names from this composition are prefixed for isolation.
   */
  namespace: z.string().optional(),
}));

export type ComposeStacksOptions = z.input<typeof ComposeStacksOptionsSchema>;

/**
 * All array fields on `ObjectStackDefinition` that are simply concatenated.
 * @internal
 */
const CONCAT_ARRAY_FIELDS = [
  'datasources',
  'translations',
  'objectExtensions',
  'apps',
  'views',
  'pages',
  'dashboards',
  'reports',
  'actions',
  'themes',
  'flows',
  'positions',
  'permissions',
  'capabilities',
  'sharingRules',
  'apis',
  'webhooks',
  'agents',
  'skills',
  'hooks',
  'mappings',
  'analyticsCubes',
  'connectors',
  'data',
  'plugins',
  'devPlugins',
  'requires',
] as const satisfies readonly (keyof ObjectStackDefinition)[];

/**
 * Merge objects from multiple stacks according to the chosen conflict strategy.
 * @internal
 */
function mergeObjects(
  stacks: ObjectStackDefinition[],
  strategy: ConflictStrategy,
): ObjectStackDefinition['objects'] {
  type Obj = NonNullable<ObjectStackDefinition['objects']>[number];
  const map = new Map<string, Obj>();
  const result: Obj[] = [];

  for (const stack of stacks) {
    if (!stack.objects) continue;
    for (const obj of stack.objects) {
      const existing = map.get(obj.name);
      if (!existing) {
        map.set(obj.name, obj);
        result.push(obj);
        continue;
      }

      switch (strategy) {
        case 'error':
          throw new Error(
            `composeStacks conflict: object '${obj.name}' is defined in multiple stacks. ` +
              `Use { objectConflict: 'override' } or { objectConflict: 'merge' } to resolve.`,
          );
        case 'override': {
          // Replace in-place in the result array
          const idx = result.indexOf(existing);
          result[idx] = obj;
          map.set(obj.name, obj);
          break;
        }
        case 'merge': {
          const merged = { ...existing, ...obj, fields: { ...existing.fields, ...obj.fields } } as Obj;
          const idx = result.indexOf(existing);
          result[idx] = merged;
          map.set(obj.name, merged);
          break;
        }
      }
    }
  }

  return result.length > 0 ? result : undefined;
}

/**
 * Select the manifest to use from multiple stacks.
 * @internal
 */
function selectManifest(
  stacks: ObjectStackDefinition[],
  strategy: 'first' | 'last' | number,
): ObjectStackDefinition['manifest'] {
  if (typeof strategy === 'number') {
    return stacks[strategy]?.manifest;
  }
  if (strategy === 'first') {
    for (const s of stacks) {
      if (s.manifest) return s.manifest;
    }
    return undefined;
  }
  // 'last' (default)
  for (let i = stacks.length - 1; i >= 0; i--) {
    if (stacks[i].manifest) return stacks[i].manifest;
  }
  return undefined;
}

/**
 * Declaratively compose multiple stack definitions into a single unified stack.
 *
 * This eliminates the manual `...spread` merging pattern when combining
 * multiple applications (e.g., CRM + Todo + BI) into a single project.
 *
 * **Array fields** (apps, views, dashboards, etc.) are concatenated in order.
 * **Objects** are merged according to the `objectConflict` strategy.
 * **Manifest** is selected based on the `manifest` option.
 *
 * @param stacks  - Stack definitions to compose (order matters for conflict resolution)
 * @param options - Composition options (conflict strategy, manifest selection, etc.)
 * @returns A single merged `ObjectStackDefinition`
 *
 * @example
 * ```ts
 * import { composeStacks, defineStack } from '@objectstack/spec';
 *
 * const crm = defineStack({ ... });
 * const todo = defineStack({ ... });
 *
 * // Simple composition — throws on duplicate objects
 * const combined = composeStacks([crm, todo]);
 *
 * // Override strategy — later stacks win
 * const combined = composeStacks([crm, todo], { objectConflict: 'override' });
 *
 * // Merge strategy — fields from later stacks are shallow-merged
 * const combined = composeStacks([crm, todo], { objectConflict: 'merge' });
 * ```
 */
export function composeStacks(
  stacks: ObjectStackDefinition[],
  options?: ComposeStacksOptions,
): ObjectStackDefinition {
  if (stacks.length === 0) return {} as ObjectStackDefinition;
  if (stacks.length === 1) return stacks[0];

  const opts = ComposeStacksOptionsSchema.parse(options ?? {});

  const composed: Record<string, unknown> = {};

  // 1. Manifest — pick based on strategy
  composed.manifest = selectManifest(stacks, opts.manifest);

  // 2. i18n — last-wins (single object, not array)
  for (let i = stacks.length - 1; i >= 0; i--) {
    if (stacks[i].i18n) {
      composed.i18n = stacks[i].i18n;
      break;
    }
  }

  // 3. Objects — use conflict strategy
  const objects = mergeObjects(stacks, opts.objectConflict);
  if (objects) {
    composed.objects = objects;
  }

  // 4. All other array fields — simple concatenation
  for (const field of CONCAT_ARRAY_FIELDS) {
    const arrays = stacks
      .map((s) => (s as Record<string, unknown>)[field])
      .filter((v): v is unknown[] => Array.isArray(v));
    if (arrays.length > 0) {
      composed[field] = arrays.flat();
    }
  }

  return mergeActionsIntoObjects(composed as ObjectStackDefinition);
}


/**
 * 2. RUNTIME CAPABILITIES PROTOCOL (Dynamic)
 * ----------------------------------------------------------------------
 * Describes what the ObjectStack platform *is* and *can do*.
 * AI Agents read this to understand:
 * - What APIs are available?
 * - What features are enabled?
 * - What limits exist?
 *
 * The capabilities are organized by subsystem for clarity:
 * - ObjectQL: Data Layer capabilities
 * - ObjectUI: User Interface Layer capabilities
 * - Kernel: System Layer capabilities
 */

/**
 * ObjectQL Capabilities Schema
 * 
 * Defines capabilities related to the Data Layer:
 * - Query operations and advanced SQL features
 * - Data validation and business logic
 * - Database driver support
 * - AI/ML data features
 */
export const ObjectQLCapabilitiesSchema = lazySchema(() => z.object({
  /** Query Capabilities */
  queryFilters: z.boolean().default(true).describe('Supports WHERE clause filtering'),
  queryAggregations: z.boolean().default(true).describe('Supports GROUP BY and aggregation functions'),
  querySorting: z.boolean().default(true).describe('Supports ORDER BY sorting'),
  queryPagination: z.boolean().default(true).describe('Supports LIMIT/OFFSET pagination'),
  queryWindowFunctions: z.boolean().default(false).describe('Supports window functions with OVER clause'),
  querySubqueries: z.boolean().default(false).describe('Supports subqueries'),
  queryDistinct: z.boolean().default(true).describe('Supports SELECT DISTINCT'),
  queryHaving: z.boolean().default(false).describe('Supports HAVING clause for aggregations'),
  queryJoins: z.boolean().default(false).describe('Supports SQL-style joins'),
  
  /** Advanced Data Features */
  fullTextSearch: z.boolean().default(false).describe('Supports full-text search'),
  vectorSearch: z.boolean().default(false).describe('Supports vector embeddings and similarity search for AI/RAG'),
  geoSpatial: z.boolean().default(false).describe('Supports geospatial queries and location fields'),
  
  /** Field Type Support */
  jsonFields: z.boolean().default(true).describe('Supports JSON field types'),
  arrayFields: z.boolean().default(false).describe('Supports array field types'),
  
  /** Data Validation & Logic */
  validationRules: z.boolean().default(true).describe('Supports validation rules'),
  workflows: z.boolean().default(true).describe('Supports workflow automation'),
  triggers: z.boolean().default(true).describe('Supports database triggers'),
  formulas: z.boolean().default(true).describe('Supports formula fields'),
  
  /** Transaction & Performance */
  transactions: z.boolean().default(true).describe('Supports database transactions'),
  bulkOperations: z.boolean().default(true).describe('Supports bulk create/update/delete'),
  
  /** Driver Support */
  supportedDrivers: z.array(z.string()).optional().describe('Available database drivers (e.g., postgresql, mongodb, excel)'),
}));

/**
 * ObjectUI Capabilities Schema
 * 
 * Defines capabilities related to the UI Layer:
 * - View rendering (List, Form, Calendar, etc.)
 * - Dashboard and reporting
 * - Theming and customization
 * - UI actions and interactions
 */
export const ObjectUICapabilitiesSchema = lazySchema(() => z.object({
  /** View Types */
  listView: z.boolean().default(true).describe('Supports list/grid views'),
  formView: z.boolean().default(true).describe('Supports form views'),
  kanbanView: z.boolean().default(false).describe('Supports kanban board views'),
  calendarView: z.boolean().default(false).describe('Supports calendar views'),
  ganttView: z.boolean().default(false).describe('Supports Gantt chart views'),
  
  /** Analytics & Reporting */
  dashboards: z.boolean().default(true).describe('Supports dashboard creation'),
  reports: z.boolean().default(true).describe('Supports report generation'),
  charts: z.boolean().default(true).describe('Supports chart widgets'),
  
  /** Customization */
  customPages: z.boolean().default(true).describe('Supports custom page creation'),
  customThemes: z.boolean().default(false).describe('Supports custom theme creation'),
  customComponents: z.boolean().default(false).describe('Supports custom UI components/widgets'),
  
  /** Actions & Interactions */
  customActions: z.boolean().default(true).describe('Supports custom button actions'),
  screenFlows: z.boolean().default(false).describe('Supports interactive screen flows'),
  
  /** Responsive & Accessibility */
  mobileOptimized: z.boolean().default(false).describe('UI optimized for mobile devices'),
  accessibility: z.boolean().default(false).describe('WCAG accessibility support'),
}));

/**
 * Kernel Capabilities Schema
 *
 * Defines capabilities related to the System Layer:
 * - Runtime environment and platform features
 * - API and integration capabilities
 * - Security and multi-tenancy
 * - System services (events, jobs, audit)
 */
export const KernelCapabilitiesSchema = lazySchema(() => z.object({
  /** System Identity */
  version: z.string().describe('Kernel version'),
  environment: z.enum(['development', 'test', 'staging', 'production']),
  
  /** API Surface */
  restApi: z.boolean().default(true).describe('REST API available'),
  graphqlApi: z.boolean().default(false).describe('GraphQL API available'),
  odataApi: z.boolean().default(false).describe('OData API available'),
  
  /** Real-time & Events */
  websockets: z.boolean().default(false).describe('WebSocket support for real-time updates'),
  serverSentEvents: z.boolean().default(false).describe('Server-Sent Events support'),
  eventBus: z.boolean().default(false).describe('Internal event bus for pub/sub'),
  
  /** Integration */
  webhooks: z.boolean().default(true).describe('Outbound webhook support'),
  apiContracts: z.boolean().default(false).describe('API contract definitions'),
  
  /** Security & Access Control */
  authentication: z.boolean().default(true).describe('Authentication system'),
  rbac: z.boolean().default(true).describe('Role-Based Access Control'),
  fieldLevelSecurity: z.boolean().default(false).describe('Field-level permissions'),
  rowLevelSecurity: z.boolean().default(false).describe('Row-level security/sharing rules'),
  
  /** Multi-tenancy */
  multiTenant: z.boolean().default(false).describe('Multi-tenant architecture support'),
  
  /** Platform Services */
  backgroundJobs: z.boolean().default(false).describe('Background job scheduling'),
  auditLogging: z.boolean().default(false).describe('Audit trail logging'),
  fileStorage: z.boolean().default(true).describe('File upload and storage'),
  
  /** Internationalization */
  i18n: z.boolean().default(true).describe('Internationalization support'),
  
  /** Plugin System */
  pluginSystem: z.boolean().default(false).describe('Plugin/extension system'),

  /**
   * Cluster Capability Configuration.
   *
   * Governs cross-process behaviour: PubSub, Lock, KV, Counter primitives;
   * event scope & delivery semantics; service leader election. Optional;
   * when absent the kernel uses the in-memory driver (single-process).
   *
   * @see content/docs/kernel/cluster.mdx
   */
  cluster: ClusterCapabilityConfigSchema.optional()
    .describe('Cluster transport & semantics configuration.'),
  
  /** Active Features & Flags */
  features: z.array(FeatureFlagSchema).optional().describe('Active Feature Flags'),
  
  /** Available APIs */
  apis: z.array(ApiEndpointSchema).optional().describe('Available System & Business APIs'),
  network: z.object({
    graphql: z.boolean().default(false),
    search: z.boolean().default(false),
    websockets: z.boolean().default(false),
    files: z.boolean().default(true),
    analytics: z.boolean().default(false).describe('Is the Analytics/BI engine enabled?'),
    ai: z.boolean().default(false).describe('Is the AI engine enabled?'),
    workflow: z.boolean().default(false).describe('Is the Workflow engine enabled?'),
    notifications: z.boolean().default(false).describe('Is the Notification service enabled?'),
    i18n: z.boolean().default(false).describe('Is the i18n service enabled?'),
  }).optional().describe('Network Capabilities (GraphQL, WS, etc.)'),

  /** Introspection */
  systemObjects: z.array(z.string()).optional().describe('List of globally available System Objects'),
  
  /** Constraints (for AI Generation) */
  limits: z.object({
    maxObjects: z.number().optional(),
    maxFieldsPerObject: z.number().optional(),
    maxRecordsPerQuery: z.number().optional(),
    apiRateLimit: z.number().optional(),
    fileUploadSizeLimit: z.number().optional().describe('Max file size in bytes'),
  }).optional()
}));

/**
 * Unified ObjectStack Capabilities Schema
 * 
 * Complete capability descriptor for an ObjectStack instance.
 * Organized by architectural layer for clarity and maintainability.
 */
export const ObjectStackCapabilitiesSchema = lazySchema(() => z.object({
  /** Data Layer Capabilities (ObjectQL) */
  data: ObjectQLCapabilitiesSchema.describe('Data Layer capabilities'),
  
  /** User Interface Layer Capabilities (ObjectUI) */
  ui: ObjectUICapabilitiesSchema.describe('UI Layer capabilities'),
  
  /** System/Runtime Layer Capabilities (Kernel) */
  system: KernelCapabilitiesSchema.describe('System/Runtime Layer capabilities'),
}));

export type ObjectQLCapabilities = z.infer<typeof ObjectQLCapabilitiesSchema>;
export type ObjectUICapabilities = z.infer<typeof ObjectUICapabilitiesSchema>;
export type KernelCapabilities = z.infer<typeof KernelCapabilitiesSchema>;
export type ObjectStackCapabilities = z.infer<typeof ObjectStackCapabilitiesSchema>;

/** @deprecated Renamed — use {@link KernelCapabilitiesSchema}. The "ObjectOS" layer name is retired; ObjectOS now names the commercial runtime environment. */
export const ObjectOSCapabilitiesSchema = KernelCapabilitiesSchema;
/** @deprecated Renamed — use {@link KernelCapabilities}. */
export type ObjectOSCapabilities = KernelCapabilities;



