// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { ManifestSchema } from './kernel/manifest.zod';
import { validateObjectNamespacePrefix } from './kernel/namespace-prefix';
import { PLATFORM_CAPABILITY_TOKENS } from './kernel/platform-capabilities';
import { DatasourceSchema } from './data/datasource.zod';
import { TranslationBundleSchema, TranslationConfigSchema } from './system/translation.zod';
import { StackServerConfigSchema } from './system/stack-server.zod';
import { hasPlatformObjectPrefix } from './system/constants/platform-object-names';
import { objectStackErrorMap, formatZodError } from './shared/error-map.zod';
import { deepEqualAuthored } from './shared/deep-equal';
import { normalizeStackInput, type MetadataCollectionInput, type MapSupportedField } from './shared/metadata-collection.zod';
import type { ConversionNotice } from './conversions/types.js';
import { formatUnknownAuthoringKey } from './data/authoring-key-lint';
import { lintUnknownAuthoringKeys, lintUnknownStackKeys } from './kernel/metadata-authoring-lint';

// Data Protocol
import { ObjectSchema, ObjectExtensionSchema } from './data/object.zod';
import { SeedSchema } from './data/seed.zod';

// UI Protocol
import { AppSchema } from './ui/app.zod';
import { ViewSchema } from './ui/view.zod';
import { PageSchema } from './ui/page.zod';
import { DashboardSchema } from './ui/dashboard.zod';
import { ReportSchema } from './ui/report.zod';
import { DatasetSchema } from './ui/dataset.zod';
import { ActionSchema } from './ui/action.zod';
import { ThemeSchema } from './ui/theme.zod';

// Automation Protocol
import { FlowSchema } from './automation/flow.zod';
import { FlowFunctionEntrySchema, FlowFunctionEffectSchema } from './automation/flow-function.zod';
import { JobSchema } from './system/job.zod';

// Security Protocol
import { PositionSchema } from './identity/position.zod';
import { PermissionSetSchema } from './security/permission.zod';
import { CapabilityDeclarationSchema } from './security/capabilities';
import { SharingRuleSchema } from './security/sharing.zod';

import { ApiEndpointSchema, type ApiEndpoint } from './api/endpoint.zod';
import { validateApiEndpointDeclarations } from './api/endpoint-publish-gate';
import { retiredKey } from './shared/retired-key';

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

export type DatasourceMappingRule = z.input<typeof DatasourceMappingRuleSchema>;

/**
 * Raise every `apis:` publish-gate failure as a Zod issue (#5040 E7).
 *
 * The #4936 blanket refusal that used to live here — a `.max(0)` on `apis`
 * whose error message told the author to delete their endpoints — is GONE, and
 * this is what replaced it. Its premise was that nothing executed a declared
 * endpoint; the #5040 E-series built the executor (mount seam, matcher, policy
 * keys, execution targets, mapping keys), so the refusal would now be the lie
 * in the other direction. What survives is the part that was always right:
 * a declaration this runtime cannot serve is REFUSED, loudly and with a
 * prescription, never parsed into silence.
 *
 * It hangs off the whole stack object rather than the `apis` field because two
 * of the gates are cross-field: the namespace carve-out is derived from
 * `manifest.namespace` (ADR-0121 D2), and uniqueness is a property of the set.
 * Placing it on the SCHEMA — not inside `defineStack` — is what keeps it
 * unavoidable: `defineStack`, `os validate`, the lint scorer, the metadata
 * plugin's artifact ingestion and `EnvironmentArtifactSchema.metadata` all run
 * through this one parse, so no publish path can forget to check.
 */
function applyApiEndpointGates(
  config: { manifest?: { namespace?: string | undefined } | undefined; apis?: ApiEndpoint[] | undefined },
  ctx: z.RefinementCtx,
): void {
  for (const issue of validateApiEndpointDeclarations(config.apis, {
    namespace: config.manifest?.namespace,
  })) {
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
}

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
  // #3464: the top-level `portals` collection was removed — PortalSchema was a
  // never-enforced, no-op projection (no dispatcher route family, auth scope,
  // LayoutDispatcher, NavigationBuilder or ThemeProvider ever consumed it).
  // Author external-user UI with apps/views + positions & permission sets.
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
   * ObjectAPI: API Layer — the platform's OUTWARD integration face.
   *
   * ⚠️ **Declared endpoints are LIVE from protocol 17** (#5040). Between #4936
   * and the executor landing, a non-empty `apis:` was refused wholesale because
   * nothing executed it; that refusal is now narrowed to a per-endpoint gate,
   * and an endpoint that passes it **serves requests as soon as it is
   * published**. Read `authRequired: false` on any entry as what it is: an
   * anonymous, internet-reachable execution entry point (ADR-0121 D6 makes an
   * armed `rateLimit` its paired obligation).
   *
   * Each entry must satisfy every gate below or publish/validate fails naming
   * that endpoint and that key — the runtime executes exactly the set that
   * passes, so `declared = enforced` holds in both directions:
   *
   *  1. **Namespace** (ADR-0121 D1/D2) — `path` must be
   *     `/api/v1/apps/<manifest.namespace>/<subpath>`. No built-in domain lives
   *     under `apps/`, and two packages cannot collide because their namespaces
   *     differ, so route ownership is structural rather than a maintained list.
   *  2. **Supported subset** — only `object_operation` (with both
   *     `objectParams.object` and `.operation`) and `flow` (with a `target`)
   *     execute in 17.x; `script` and `proxy` are refused pending their own
   *     rulings, and mapping `transform` is refused because no transformation
   *     registry exists.
   *  3. **Policy** — `authRequired: false` requires `rateLimit.enabled: true`;
   *     an armed budget must be usable; `cacheTtl` must be non-negative and
   *     GET-only.
   *  4. **Uniqueness** — one claim per METHOD + path inside a stack.
   *
   * Which channel: a caller INSIDE the platform (a session, the UI, AI/MCP, the
   * SDK) invokes an `action`; a caller OUTSIDE it (a partner system, an
   * inbound webhook) reaches an `apis:` endpoint (ADR-0121 D3).
   */
  apis: z.array(ApiEndpointSchema)
    .optional()
    .describe('API Endpoints — declared endpoints are live from protocol 17; each is gated at publish (ADR-0121, #5040)'),
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
     * [REMOVED in #3963] See `RestApiConfigSchema.requireAuth` — tombstoned for
     * the same reason: this block is not `.strict()`, so deleting the key would
     * silently strip it and the author's intent would vanish without a word.
     */
    requireAuth: retiredKey(
      '`api.requireAuth` was removed in @objectstack/spec 17 (#3963). Anonymous access to object data '
      + 'is now always denied. Delete the key; publish public surfaces by declaration instead — a public '
      + "form view, a share link, or `book.audience: 'public'`. A stack that mounts no auth at all now "
      + 'fails at boot rather than silently serving object data to anonymous callers. '
      + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
    ),
    /** Enable environment-scoped routing for data/meta/AI APIs. */
    enableProjectScoping: z.boolean().optional(),
    /** Environment id resolution strategy when scoping is on. */
    projectResolution: z.enum(['required', 'optional', 'auto']).optional(),
    /** Per-environment membership 403 gate (dispatcher). Undefined → default. */
    enforceProjectMembership: z.boolean().optional(),
  }).optional().describe('Server-facing API config consumed by objectstack serve/dev'),

  /**
   * Server-level runtime configuration read by `objectstack serve` / `dev`.
   *
   * DELIBERATELY NARROW (#4910): it carries only keys an executor consumes —
   * today `security.rateLimit` (the inbound token bucket that answers 429) and
   * `trustProxy` (how that limiter identifies a caller). It is NOT the former
   * nine-key `HttpServerConfigSchema`: seven of those keys had no reader and no
   * authoring surface, and mounting them here would have made dead keys
   * writable — so they were retired with their container instead (#4938,
   * ADR-0049). Port/host stay a deployment concern owned by
   * `objectstack serve -p`; see the schema file for the precedence rule, the
   * per-key prescriptions and the rest of the rationale.
   */
  server: StackServerConfigSchema.optional()
    .describe('Server-level runtime config consumed by objectstack serve/dev (inbound rate limit, proxy trust)'),

  /**
   * ObjectAI: Artificial Intelligence Layer
   *
   * Three-tier composition (Agent → Skill → Tool) aligned with Salesforce
   * Agentforce Topics, Microsoft Copilot Studio Topics, and ServiceNow Now
   * Assist Skills. Per ADR-0063, **skills (+ tools / MCP) are the only
   * third-party extension primitive**:
   *
   * - **agents**: PLATFORM-INTERNAL (ADR-0063 §2). The kernel ships exactly
   *   two agents — `ask` (data product) and `build` (authoring product) —
   *   bound by surface, never picked from a roster. Tenant/app-package custom
   *   agents were withdrawn (ADR-0040 §3 reversed): an agent declared here
   *   parses, but the runtime catalog filters non-platform agent records, so
   *   it is not a supported extension surface. Author skills instead.
   * - **skills**: Reusable capability bundles ("topics" in Salesforce
   *   parlance) — THE extension primitive. Each skill groups related tools,
   *   declares its agent surface affinity (`'ask' | 'build' | 'both'`,
   *   ADR-0063 §3 — checked by lint, enforced at load) and `triggerConditions`
   *   (an AND of context field/operator/value) for context-aware activation.
   *   Activation is that intersected with the agent's own skill allowlist —
   *   there is no phrase list: `triggerPhrases` was retired in #3896 because
   *   phrases were never matched against the user's message, and the key is now
   *   a `retiredKey()` tombstone that rejects on parse. Natural-language intent
   *   belongs in `description` / `instructions`, where the LLM reads it.
   * - **tools**: OPTIONAL refinement layer, never required (ADR-0109). The
   *   default third-party path declares no tool records: a skill's `tools[]`
   *   names a platform-registered tool (`PLATFORM_PROVIDED_TOOL_NAMES`) or a
   *   tool the runtime materialises from the app's own declarative actions
   *   (`action_<name>`) — the executable, its authz and its audit stay on the
   *   action/flow the app already ships. A `stack.tools` record exists only
   *   for AI-presentation refinement (Phase 2: LLM description, parameter
   *   narrowing, flow exposure) and has no runtime reader until that lands.
   */
  agents: z.array(AgentSchema).optional().describe('AI Agents — platform-internal (ADR-0063 §2): the kernel ships exactly two (ask/build); third parties extend via skills, not agents'),
  tools: z.array(ToolSchema).optional().describe('AI Tool metadata records — optional refinement layer, never required: the default path is skills referencing platform tools or materialised action_<name> tools (ADR-0109)'),
  skills: z.array(SkillSchema).optional().describe('AI Skills (reusable capability bundles — the third-party AI extension primitive, ADR-0063)'),

  /**
   * ObjectQL: Data Extensions
   * Hooks, mappings, and analytics cubes.
   */
  hooks: z.array(HookSchema).optional().describe('Object Lifecycle Hooks'),
  /**
   * Named handler functions for declarative metadata that references
   * handlers by string name (`Hook.handler: 'my_handler'`,
   * `Action.target: 'my_handler'`, a `script` node's `config.function`).
   * Two accepted shapes:
   *
   *   - Map form (preferred): `{ my_handler: (ctx) => {...} }`
   *   - Array form: `[{ name: 'my_handler', handler: (ctx) => {...} }]`
   *
   * Either shape may state what the function DOES instead of just naming it
   * (#4396) — `{ my_handler: { handler, effect: 'writes' } }`, or `effect` on
   * an array entry. A `script` node's function is contractually pure (it
   * returns a value; the flow graph persists it), and the run summary counts on
   * that: an undeclared function is counted as having written nothing. A
   * function that legitimately writes declares `effect: 'writes'` and its step
   * is reported as an effect the platform cannot count, rather than as none.
   * See `FlowFunctionEffectSchema` in `@objectstack/spec/automation`.
   *
   * The CALLABLE lives in code only — `objectstack build` lowers it to a
   * handler ref and carries the function itself in the sibling runtime module
   * (what it declared rides along in the artifact and is re-attached on load).
   * The `AppPlugin` registers them on the engine before binding hooks so
   * `string` handlers resolve at startup.
   *
   * BOTH shapes therefore reach this schema twice: once as authored, once
   * lowered. All four combinations (map/array × bare/declared) are accepted —
   * the map's two lowered forms since #4343 and #4976, the array's since #6238.
   * `packages/cli`'s `lower-callables.test.ts` pins every cell against what the
   * lowering actually emits, rather than against a belief about it.
   */
  functions: z.union([
    z.record(z.string(), FlowFunctionEntrySchema),
    // The array member is NOT `FlowFunctionEntrySchema` in a list: an array
    // entry carries its own `name` (and an optional `packageId`) because it has
    // no map key to be named by, so the two shapes are genuinely different
    // records rather than one reused schema.
    //
    // `handler` accepts the lowered string ref for the same reason the map form
    // does (#4343, #4976), and this member was the last place it did not:
    // `lowerCallables` lowers the array branch too (`next.handler = ref`,
    // `next.name = ref`), so `objectstack build` emitted
    // `[{ name: 'syncBilling', handler: 'syncBilling', effect: 'writes' }]` into
    // a schema that still demanded a callable — `invalid_union: Invalid input`,
    // path stopping at `functions`, naming neither the entry nor the key. One
    // widening covers BOTH array spellings at once, unlike the map form's two
    // separate members: `effect` is already optional here, so the bare and the
    // declared entry differ only in whether that key is present.
    z.array(z.object({
      name: z.string(),
      handler: z.union([
        z.function(),
        z.string().min(1).describe('The lowered handler ref (built artifacts) — the callable rides in the sibling ESM module'),
      ]).describe('The function invoked by name — the authored callable, or the ref `objectstack build` lowered it to'),
      packageId: z.string().optional(),
      effect: FlowFunctionEffectSchema.optional(),
    })),
  ]).optional().describe('Named handler functions referenced by hooks/actions/script nodes (optionally declaring their effect)'),
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
}).superRefine(applyApiEndpointGates));

export type ObjectStackDefinition = z.input<typeof ObjectStackDefinitionSchema>;
/** Post-parse shape of {@link ObjectStackDefinition} — defaults applied, transforms run (ADR-0122). */
export type ObjectStackDefinitionParsed = z.infer<typeof ObjectStackDefinitionSchema>;

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
 *
 * Kept as a PREFIX test at this layer on purpose: these are hard `defineStack`
 * throws, and a third-party package may legitimately contribute a prefixed
 * object this repo's registry cannot know about — failing the build on that
 * would be worse than the typo it catches. The narrower "prefixed but no known
 * package registers it" signal (`sys_approval_process`, issue #3583) is an
 * ADVISORY finding, so it lives in `@objectstack/lint`'s reference rules where
 * it can warn instead of throw — see `isPlatformProvidedObjectName`.
 */
function isPlatformObjectName(name: string): boolean {
  return hasPlatformObjectPrefix(name);
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
    // Every action name the stack defines, global + object-embedded — the same
    // "defined ANYWHERE in the stack" scope `validate-action-name-refs` (lint)
    // resolves name-bound action references against.
    const actionNames = new Set<string>();
    if (config.actions) {
      for (const a of config.actions) {
        actionNames.add(a.name);
      }
    }
    if (config.objects) {
      for (const obj of config.objects) {
        for (const a of obj.actions ?? []) {
          actionNames.add(a.name);
        }
      }
    }

    for (const app of config.apps) {
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
          // Deep-link auto-run (#4848): a `runAction` that resolves to no
          // defined action is exactly the dead affordance the declared slot
          // exists to reject — the entry navigates and the auto-run silently
          // never fires. Size-gated like the dashboard/page/report checks
          // above: a stack declaring NO actions may be referencing one
          // provided by another package (lint's `validate-action-name-refs`
          // still reports it there).
          if (nav.type === 'object' && typeof nav.runAction === 'string' && actionNames.size > 0 && !actionNames.has(nav.runAction)) {
            errors.push(
              `App '${appName}' navigation deep-link references action '${nav.runAction}' (via runAction) which is not defined in actions (neither stack.actions nor any object's actions).`,
            );
          }
          // Recurse into children. NOT gated on `type === 'group'`: an `object`
          // nav item carries `children` too (NavigationItemSchema extends it
          // with a child array for per-view entries), and a targeted child
          // nested under one was previously skipped.
          if (Array.isArray(nav.children)) {
            checkNavItems(nav.children, appName);
          }
        }
      };
      // Both nav containers. `areas[]` was previously skipped entirely by an
      // `if (!app.navigation) continue`, so an areas-based app got NO nav
      // cross-reference checking at all (issue #3583).
      if (Array.isArray(app.navigation)) checkNavItems(app.navigation, app.name);
      if (Array.isArray(app.areas)) {
        for (const area of app.areas) {
          const nav = (area as { navigation?: unknown })?.navigation;
          if (Array.isArray(nav)) checkNavItems(nav, app.name);
        }
      }
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

/** Conversion notices already reported this process — same warn-once reason. */
const warnedConversionNotices = new Set<string>();

/**
 * Surface the ADR-0087 D2 conversion notices raised while normalizing.
 *
 * A conversion is deliberately silent about *fixing* the shape — zero consumer
 * action is the point — but it is not supposed to be silent about having HAD to.
 * The notice is the one signal that says "this spelling retires in protocol N,
 * and your metadata stops loading then", and `defineStack` is where the author
 * who wrote the old shape actually is. Until now it passed no sink, so that
 * author heard nothing unless they happened to run `os validate` — the same gap
 * this change closes in `os build`.
 *
 * Advisory and warn-once: the conversion already produced a correct stack.
 */
function warnConversionNotice(notice: ConversionNotice): void {
  const key = `${notice.conversionId} ${notice.path} ${notice.from} ${notice.to}`;
  if (warnedConversionNotices.has(key)) return;
  warnedConversionNotices.add(key);
  console.warn(
    `defineStack: ${notice.path}: '${notice.from}' → '${notice.to}' (converted at load; ` +
    `conversion '${notice.conversionId}', retires in protocol ${notice.retiresIn}). ` +
    `Update the source to the canonical shape — the conversion stops running then.`,
  );
}

const warnedUnknownAuthoringKeys = new Set<string>();

/**
 * Surface every authored key `ObjectSchema` / `FieldSchema` is about to discard
 * (#3786).
 *
 * Same seam and same posture as {@link warnConversionNotice}: it runs pre-parse,
 * because the parse is what eats the key, and it only WARNS — these two schemas
 * are the most-authored surfaces in the protocol, so rejecting is a scheduled
 * migration (#4001's strict tiers), not something to slip in behind a lint.
 *
 * Runs in both strict and non-strict mode: the key is dropped either way, so the
 * author deserves to hear about it either way.
 */
function warnUnknownAuthoringKeys(raw: unknown): void {
  const findings = [
    // Top level first: an undeclared envelope key is the one that reads as
    // configuration that took effect (#4167).
    ...lintUnknownStackKeys(raw, ObjectStackDefinitionSchema),
    ...lintUnknownAuthoringKeys(raw),
  ];
  for (const finding of findings) {
    if (warnedUnknownAuthoringKeys.has(finding.path)) continue;
    warnedUnknownAuthoringKeys.add(finding.path);
    console.warn(`defineStack: ${formatUnknownAuthoringKey(finding)}`);
  }
}

export function defineStack(
  config: ObjectStackDefinitionInput,
  options?: DefineStackOptions,
): ObjectStackDefinition {
  // Default to strict=true for safety (validate by default)
  const strict = options?.strict !== false;

  // Normalize map-formatted collections to arrays (key → name injection), and
  // surface every ADR-0087 D2 conversion the pass had to apply. Unlike the alias
  // warning below this runs in BOTH modes: a conversion happens whether or not
  // we go on to parse, so `strict: false` does not make the old shape any less
  // retiring.
  const normalized = normalizeStackInput(config as Record<string, unknown>, {
    onConversionNotice: warnConversionNotice,
  });

  // Pre-parse: the parse below is what strips an undeclared key, so this is the
  // last point at which the author's own spelling still exists to report (#3786).
  warnUnknownAuthoringKeys(normalized);

  if (!strict) {
    // Non-strict mode: skip validation (advanced use cases only).
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
export type ConflictStrategy = z.input<typeof ConflictStrategySchema>;

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
/** Post-parse shape of {@link ComposeStacksOptions} — defaults applied, transforms run (ADR-0122). */
export type ComposeStacksOptionsParsed = z.infer<typeof ComposeStacksOptionsSchema>;

/**
 * How {@link composeStacks} treats one top-level key (#5005).
 *
 * - `'concat'`    — array collection; concatenated in stack order.
 * - `'single'`    — one scalar/object value; identical declarations pass
 *                   through, differing ones are a composition ERROR.
 * - `'manifest'`  — chosen by the `manifest` option.
 * - `'objects'`   — merged by the `objectConflict` strategy.
 * - `'functions'` — named-handler collection; merged by name.
 * @internal
 */
type ComposeDisposition = 'concat' | 'single' | 'manifest' | 'objects' | 'functions';

/**
 * The composition rule for EVERY top-level key of `ObjectStackDefinition`
 * (#5005).
 *
 * ## Why a total table and not a list
 *
 * `composeStacks` used to build its result from an empty object by filling in
 * `manifest`, `i18n`, `objects` and a hand-maintained array whitelist. Anything
 * absent from that whitelist was not "left alone" — it was **deleted**, with no
 * error, no warning, and no way for a consumer to tell "the composer dropped it"
 * apart from "the author never wrote it". Composition is the platform's
 * app-packaging / install story, so that silence reached real security config:
 * `api.enforceProjectMembership` (the per-environment 403 gate) and, as of
 * #4910, `server.security.rateLimit` both vanished the moment a stack was
 * composed with any other one. Seven declared array collections
 * (`datasourceMapping`, `datasets`, `jobs`, `emailTemplates`, `docs`, `books`,
 * `tiers`) and the whole `functions` handler map went the same way; `tools`
 * escaped the same fate only because ADR-0109 noticed and patched the list.
 *
 * A whitelist makes forgetting the default. This table makes it a **type
 * error**: it is `Record< keyof ObjectStackDefinition, … >`, so a new top-level
 * key does not compile until someone states what composing it means. That is
 * the structural half of the fix; {@link composeStacks} carries the runtime
 * half (an undeclared key warns rather than disappearing), so a key that
 * reaches composition without a rule — via `strict: false`, or a raw object —
 * still reports itself.
 *
 * ## Note on `i18n` (#5051)
 *
 * `i18n` carried a last-wins of its own through #5005 — the one key here that
 * already had a deliberate, working strategy, and #5005's subject was keys that
 * got *dropped*. That left it as the only top-level key still resolving a
 * disagreement by silent override: the very shape the maintainer rejected for
 * `api`/`server` — an earlier stack's declaration overwritten without a word by
 * whoever composes after it. #5051 closed the inconsistency — `i18n` is
 * `'single'` like every other non-array configuration key. Which locales an
 * application supports is not a detail a composer may pick for the author: the
 * `translations` bundles each stack ships are written against its own
 * `supportedLocales`, so overriding one stack's declaration leaves the other
 * stack's bundles addressing locales the composed app no longer admits.
 *
 * @internal
 */
const COMPOSE_KEY_DISPOSITIONS: Record<keyof ObjectStackDefinition, ComposeDisposition> = {
  // ── Bespoke strategies (unchanged by #5005) ──
  manifest: 'manifest',
  objects: 'objects',
  functions: 'functions',

  // ── Array collections — concatenated in stack order ──
  datasources: 'concat',
  datasourceMapping: 'concat',
  translations: 'concat',
  objectExtensions: 'concat',
  apps: 'concat',
  views: 'concat',
  pages: 'concat',
  dashboards: 'concat',
  reports: 'concat',
  datasets: 'concat',
  actions: 'concat',
  themes: 'concat',
  flows: 'concat',
  jobs: 'concat',
  emailTemplates: 'concat',
  docs: 'concat',
  books: 'concat',
  positions: 'concat',
  permissions: 'concat',
  capabilities: 'concat',
  sharingRules: 'concat',
  apis: 'concat',
  webhooks: 'concat',
  agents: 'concat',
  tools: 'concat',
  skills: 'concat',
  hooks: 'concat',
  mappings: 'concat',
  analyticsCubes: 'concat',
  connectors: 'concat',
  data: 'concat',
  plugins: 'concat',
  requires: 'concat',
  tiers: 'concat',
  devPlugins: 'concat',

  // ── Single-valued configuration — same value passes, difference throws ──
  api: 'single',
  server: 'single',
  runtimeModule: 'single',
  // #5051: the last key still on last-wins; aligned here, see the note above.
  i18n: 'single',
};

/**
 * All array fields on `ObjectStackDefinition` that are simply concatenated.
 * Derived from {@link COMPOSE_KEY_DISPOSITIONS} so the two cannot drift.
 * @internal
 */
const CONCAT_ARRAY_FIELDS = (Object.keys(COMPOSE_KEY_DISPOSITIONS) as (keyof ObjectStackDefinition)[])
  .filter((key) => COMPOSE_KEY_DISPOSITIONS[key] === 'concat');

/**
 * Name a stack the way its author would recognise it (#5005).
 *
 * A composition error is only actionable if it says WHICH stacks disagree, and
 * at compose time the only identity a stack carries is its manifest. Falls back
 * to the positional index for the manifest-less stacks that composition also
 * accepts.
 * @internal
 */
function stackLabel(stack: ObjectStackDefinition, index: number): string {
  const id = stack.manifest?.id ?? stack.manifest?.name;
  return id ? `'${id}' (stack #${index})` : `stack #${index}`;
}

/**
 * Compose a single-valued (non-array) top-level key across stacks (#5005,
 * #5051).
 *
 * Same value everywhere ⇒ that value. Any disagreement ⇒ throw, naming the key,
 * both source stacks and the two ways out. NOT last-wins: silently preferring
 * the later stack is a security downgrade — it is precisely how an earlier
 * stack's `enforceProjectMembership` 403 gate or a tighter rate-limit budget
 * would be switched off by an add-on package, and (since #5051) how an `i18n`
 * locale set would be swapped out from under the `translations` bundles written
 * against it. NOT a deep merge either: that invents a third value neither
 * author wrote.
 * @internal
 */
function composeSingleValue(
  stacks: ObjectStackDefinition[],
  key: string,
): { declared: boolean; value: unknown } {
  let holder = -1;

  for (let i = 0; i < stacks.length; i++) {
    const value = (stacks[i] as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (holder === -1) {
      holder = i;
      continue;
    }
    const held = (stacks[holder] as Record<string, unknown>)[key];
    if (deepEqualAuthored(held, value)) continue;

    throw new Error(
      `composeStacks conflict: top-level key '${key}' is declared with different values by ` +
        `${stackLabel(stacks[holder], holder)} and ${stackLabel(stacks[i], i)}.\n` +
        `composeStacks does not pick a winner for single-valued top-level configuration: ` +
        `overriding would silently drop whichever declaration lost — a stricter setting ` +
        `(an 'api.enforceProjectMembership' 403 gate, a 'server.security.rateLimit' budget), ` +
        `or an 'i18n' locale set the losing stack's own 'translations' bundles are written ` +
        `against — and deep-merging would produce a value neither stack declared.\n` +
        `Fix: make the two '${key}' declarations identical, or remove it from every stack ` +
        `except the one that should own it.`,
    );
  }

  return holder === -1
    ? { declared: false, value: undefined }
    : { declared: true, value: (stacks[holder] as Record<string, unknown>)[key] };
}

/**
 * Compose the `functions` handler collection across stacks (#5005).
 *
 * `functions` is a named collection, not an opaque config blob: composing CRM +
 * Todo must yield BOTH packages' handlers, or every declarative hook, action
 * and script node that resolves a handler by name breaks at boot. So it merges
 * by name — and a name declared twice throws rather than picking a winner,
 * matching `objectConflict: 'error'`.
 *
 * The two authored shapes (map and array) are merged in kind. They are NOT
 * converted into one another: an array entry carries a `packageId` that the map
 * entry has no place for, so a conversion would drop provenance. Mixing the two
 * shapes across composed stacks therefore throws with that instruction.
 * @internal
 */
function composeFunctions(
  stacks: ObjectStackDefinition[],
): { declared: boolean; value: unknown } {
  type ArrayEntry = { name: string };
  const declaring: { index: number; value: unknown }[] = [];

  for (let i = 0; i < stacks.length; i++) {
    const value = (stacks[i] as Record<string, unknown>).functions;
    if (value !== undefined) declaring.push({ index: i, value });
  }
  if (declaring.length === 0) return { declared: false, value: undefined };
  if (declaring.length === 1) return { declared: true, value: declaring[0].value };

  const arrayForm = declaring.filter((d) => Array.isArray(d.value));
  if (arrayForm.length !== 0 && arrayForm.length !== declaring.length) {
    const mapSide = declaring.find((d) => !Array.isArray(d.value))!;
    throw new Error(
      `composeStacks conflict: top-level key 'functions' is declared in the map form by ` +
        `${stackLabel(stacks[mapSide.index], mapSide.index)} and in the array form by ` +
        `${stackLabel(stacks[arrayForm[0].index], arrayForm[0].index)}.\n` +
        `The two shapes cannot be merged without losing information (an array entry carries ` +
        `'packageId', the map entry does not).\n` +
        `Fix: author 'functions' in the same shape in both stacks — the map form ` +
        `({ my_handler: fn }) is preferred.`,
    );
  }

  const seen = new Map<string, number>();
  const claim = (name: string, index: number): void => {
    const first = seen.get(name);
    if (first !== undefined) {
      throw new Error(
        `composeStacks conflict: function '${name}' is defined by both ` +
          `${stackLabel(stacks[first], first)} and ${stackLabel(stacks[index], index)}.\n` +
          `Handlers are resolved by name at boot, so one would silently shadow the other.\n` +
          `Fix: rename one of them (prefix it with its package, e.g. 'crm_${name}'), or ` +
          `declare it in exactly one stack.`,
      );
    }
    seen.set(name, index);
  };

  if (arrayForm.length === declaring.length) {
    const merged: ArrayEntry[] = [];
    for (const { index, value } of declaring) {
      for (const entry of value as ArrayEntry[]) {
        claim(entry.name, index);
        merged.push(entry);
      }
    }
    return { declared: true, value: merged };
  }

  const merged: Record<string, unknown> = {};
  for (const { index, value } of declaring) {
    for (const [name, handler] of Object.entries(value as Record<string, unknown>)) {
      claim(name, index);
      merged[name] = handler;
    }
  }
  return { declared: true, value: merged };
}

const warnedMalformedCollectionKeys = new Set<string>();

/**
 * Report a collection key that carried a non-array value (#5005).
 *
 * The concat rule can only concatenate arrays, so such a value is skipped —
 * and skipping it silently is the same defect in miniature. Only reachable
 * with an unparsed stack (`strict: false`, hand-built object); the strict
 * `defineStack` path rejects the shape outright.
 * @internal
 */
function warnMalformedCollectionKey(key: string): void {
  if (warnedMalformedCollectionKeys.has(key)) return;
  warnedMalformedCollectionKeys.add(key);
  console.warn(
    `composeStacks: top-level key '${key}' is a collection (concatenated across stacks) but at ` +
      `least one stack carries a non-array value for it — that value cannot be composed and was ` +
      `skipped. Author it as an array, or run the stack through strict \`defineStack\` to have ` +
      `the shape rejected where it is written. See objectstack-ai/objectstack#5005.`,
  );
}

const warnedUncomposedStackKeys = new Set<string>();

/**
 * Report a top-level key that reached composition with no declared rule (#5005).
 *
 * The invariant this restores: composition is never silent about a key it did
 * not know what to do with. It still composes the key by the default rule
 * (arrays concatenate, everything else follows the single-value rule) so
 * nothing is lost — but the NEXT top-level key someone adds without teaching
 * `composeStacks` about it announces itself here, instead of being discovered
 * by accident during unrelated work the way `server:` was.
 *
 * Warn-once per key, like the other authoring-time notices in this module.
 * @internal
 */
function warnUncomposedStackKey(key: string, rule: ComposeDisposition): void {
  if (warnedUncomposedStackKeys.has(key)) return;
  warnedUncomposedStackKeys.add(key);
  console.warn(
    `composeStacks: top-level key '${key}' has no declared composition rule — composed with ` +
      `the default (${rule === 'concat' ? 'arrays are concatenated' : 'single value; conflicting declarations throw'}). ` +
      `Declare what composing it means in COMPOSE_KEY_DISPOSITIONS (packages/spec/src/stack.zod.ts) ` +
      `in the same change that declares the key — see objectstack-ai/objectstack#5005.`,
  );
}

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
 * **Single-valued configuration** (`i18n`, `api`, `server`, `runtimeModule`) is
 * neither overridden nor merged: identical declarations pass through, and two
 * stacks declaring *different* values throw an error naming both stacks
 * (#5005; `i18n` joined them in #5051).
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

  // 2. Objects — use conflict strategy
  const objects = mergeObjects(stacks, opts.objectConflict);
  if (objects) {
    composed.objects = objects;
  }

  // 3. Array collections — simple concatenation, in stack order.
  for (const field of CONCAT_ARRAY_FIELDS) {
    const declared = stacks
      .map((s) => (s as Record<string, unknown>)[field])
      .filter((v) => v !== undefined);
    const arrays = declared.filter((v): v is unknown[] => Array.isArray(v));
    if (arrays.length > 0) {
      composed[field] = arrays.flat();
    }
    // A collection key holding something that is not an array cannot be
    // concatenated. `defineStack` rejects that shape, so this is only
    // reachable via `strict: false` or a hand-built stack object — but
    // dropping it without a word is the exact defect #5005 closes.
    if (declared.length !== arrays.length) {
      warnMalformedCollectionKey(field);
    }
  }

  // 4. Named handler functions — merged by name (#5005).
  const functions = composeFunctions(stacks);
  if (functions.declared) {
    composed.functions = functions.value;
  }

  // 5. Every remaining top-level key (#5005) — `api`, `server`,
  //    `runtimeModule` and, since #5051, `i18n`.
  //
  //    This loop is the reason composition can no longer eat a key. It walks
  //    what the STACKS actually carry rather than a whitelist, so a key with a
  //    declared rule gets it, and a key without one is composed by the default
  //    AND reported — instead of being deleted in silence the way `api:` and
  //    `server:` were.
  const remainingKeys: string[] = [];
  for (const stack of stacks) {
    for (const key of Object.keys(stack as Record<string, unknown>)) {
      if ((stack as Record<string, unknown>)[key] === undefined) continue;
      if (key in composed) continue;
      const rule = COMPOSE_KEY_DISPOSITIONS[key as keyof ObjectStackDefinition];
      // Handled above (a declared key whose value happened to be absent from
      // every stack lands here too — nothing to compose, so skip it).
      if (rule !== undefined && rule !== 'single') continue;
      if (!remainingKeys.includes(key)) remainingKeys.push(key);
    }
  }

  for (const key of remainingKeys) {
    const rule = COMPOSE_KEY_DISPOSITIONS[key as keyof ObjectStackDefinition];
    if (rule === undefined) {
      // Not declared on ObjectStackDefinitionSchema at all — reachable via
      // `defineStack(..., { strict: false })` or a hand-built stack object.
      const isArray = stacks.some((s) => Array.isArray((s as Record<string, unknown>)[key]));
      warnUncomposedStackKey(key, isArray ? 'concat' : 'single');
      if (isArray) {
        composed[key] = stacks
          .map((s) => (s as Record<string, unknown>)[key])
          .filter((v): v is unknown[] => Array.isArray(v))
          .flat();
        continue;
      }
    }
    const single = composeSingleValue(stacks, key);
    if (single.declared) composed[key] = single.value;
  }

  return mergeActionsIntoObjects(composed as ObjectStackDefinition);
}
