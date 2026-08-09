// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { PluginCapabilityManifestSchema } from './plugin-capability.zod';
import { PluginLoadingConfigSchema } from './plugin-loading.zod';
import { CORE_PLUGIN_TYPES } from './plugin.zod';
import { SeedSchema } from '../data/seed.zod';
import { NavigationContributionSchema } from '../ui/app.zod';

// ─────────────────────────────────────────────────────────────────────
// Plugin distribution (ADR-0025 §3.2) — authoritative shapes.
//
// These are the canonical schemas for a signed, permissioned plugin
// package. The cloud control plane mirrors them when it validates a
// published `.osplugin` manifest and persists the declared metadata onto
// `sys_package_version`; cloud swaps its local stopgap for these imports
// (see cloud docs/design/plugin-distribution-framework-tasks.md F1).
// ─────────────────────────────────────────────────────────────────────

/**
 * Structured permission grants requested by a plugin (ADR-0025 §3.2).
 * Each list scopes one capability surface the plugin may touch. The
 * install-time consent flow (ADR §3.5 step 2) turns this declaration into
 * the persisted `granted_permissions` set enforced at load by the
 * PluginPermissionEnforcer.
 *
 * @example
 * ```jsonc
 * { "services": ["object", "http"], "hooks": ["record.beforeInsert"],
 *   "network": ["api.acme.com"], "fs": [] }
 * ```
 */
export const PluginPermissionsSchema = z
  .object({
    services: z.array(z.string()).optional()
      .describe('Platform services the plugin may resolve (e.g. "object", "http")'),
    hooks: z.array(z.string()).optional()
      .describe('Lifecycle hooks the plugin may register (e.g. "record.beforeInsert")'),
    network: z.array(z.string()).optional()
      .describe('Network hosts the plugin may reach (e.g. "api.acme.com")'),
    fs: z.array(z.string()).optional()
      .describe('Filesystem paths the plugin may access'),
  })
  .strict()
  .describe('Structured plugin permission grants (ADR-0025 §3.2)');

export type PluginPermissions = z.input<typeof PluginPermissionsSchema>;

/**
 * Backward-compatible manifest `permissions` value: either the legacy flat
 * list of permission strings (apps / older packages) or the structured
 * plugin permission block above. New code should prefer the structured form.
 */
export const ManifestPermissionsSchema = z.union([
  z.array(z.string()),
  PluginPermissionsSchema,
]);

export type ManifestPermissions = z.input<typeof ManifestPermissionsSchema>;

/**
 * Compatibility ranges for a plugin (ADR-0025 §3.2, §3.10 #3).
 * `protocol` (the metadata/runtime contract version) is checked first and
 * takes precedence over `platform` (the engine release range), so a plugin
 * keeps working across platform releases that preserve the protocol.
 */
export const PluginEnginesSchema = z
  .object({
    platform: z.string().optional()
      .describe('ObjectStack platform release range (SemVer, e.g. ">=4.0 <5")'),
    protocol: z.string().optional()
      .describe('Runtime/metadata protocol range, checked first (ADR §3.10 #3)'),
  })
  .describe('Plugin compatibility ranges (ADR-0025 §3.2)');

export type PluginEngines = z.input<typeof PluginEnginesSchema>;

/**
 * Trust / isolation tier the plugin runs under (ADR-0025 §3.6):
 * - `node`    — in-process, full PluginContext (first-party / verified only)
 * - `sandbox` — QuickJS-WASM, capability-gated surface
 * - `worker`  — out-of-process (reserved)
 */
export const PluginRuntimeSchema = z
  .enum(['node', 'sandbox', 'worker'])
  .describe('Plugin trust tier (ADR-0025 §3.6)');

export type PluginRuntime = z.input<typeof PluginRuntimeSchema>;

/**
 * Dependency packaging strategy (ADR-0025 §3.3):
 * - `bundled`      — deps pre-bundled into the artifact, no install-time npm
 * - `manifest-deps`— deps resolved at install (`pnpm install`, opt-in)
 */
export const PluginPackagingSchema = z
  .enum(['bundled', 'manifest-deps'])
  .describe('Dependency packaging strategy (ADR-0025 §3.3)');

export type PluginPackaging = z.input<typeof PluginPackagingSchema>;

/**
 * Per-file content digests of the packaged artifact (ADR-0025 §3.2),
 * mapping artifact-relative path → digest string (e.g. "sha256-<base64>").
 * Re-verified by the runtime when it unpacks the `.osplugin` (ADR §3.5
 * step 5).
 */
export const PluginIntegritySchema = z
  .record(z.string(), z.string())
  .describe('Per-file content digests of the plugin artifact (ADR-0025 §3.2)');

export type PluginIntegrity = z.input<typeof PluginIntegritySchema>;

/**
 * Schema for the ObjectStack Manifest.
 * This defines the structure of a package configuration in the ObjectStack ecosystem.
 * All packages (apps, plugins, drivers, modules) must conform to this schema.
 * 
 * @example App Package
 * ```yaml
 * id: com.acme.crm
 * version: 1.0.0
 * type: app
 * name: Acme CRM
 * description: Customer Relationship Management system
 * permissions:
 *   - system.user.read
 *   - system.object.create
 * objects:
 *   - "./src/objects/*.object.yml"
 * ```
 */
export const ManifestSchema = z.object({
  /** 
   * Unique package identifier using reverse domain notation.
   * Must be unique across the entire ecosystem.
   * 
   * @example "com.steedos.crm"
   * @example "org.apache.superset"
   */
  id: z.string().describe('Unique package identifier (reverse domain style)'),
  
  /**
   * Short namespace identifier for metadata scoping AND the mandatory
   * prefix of every object name in this package.
   *
   * **Authoring rule (single canonical style — no alternatives):**
   * Every `object.name` in this stack MUST be `${namespace}_${shortName}`.
   * AI and humans write the full prefixed name verbatim everywhere it
   * appears (`*.object.ts`, view `data.object`, dashboard `object`,
   * report `objectName`, flow / approval / hook references, app
   * navigation `objectName`, seed dataset `externalId`, translation
   * `objects.<name>` keys, permissions, sharing rules).
   *
   * Examples:
   *   namespace: 'todo' → object names: 'todo_task', 'todo_project'
   *   namespace: 'crm'  → object names: 'crm_account', 'crm_contact'
   *
   * `defineStack()` enforces this with a validator that lists every
   * violation and the expected fix. The platform deliberately does NOT
   * provide a `ns('task') → 'todo_task'` helper or a generic factory
   * (`defineObject<'todo'>(...)`) — two writing styles cause AI to
   * guess wrong half the time. The full prefixed literal is the only
   * supported form.
   *
   * Physical storage uses the full prefixed name as the table name, so
   * multiple packages installed in the same database cannot collide.
   *
   * Rules:
   * - 2-20 characters, lowercase letters, digits, and underscores only.
   * - Must be unique within a running instance.
   * - Platform-reserved namespaces: "base", "system", "sys".
   * - Object names starting with `sys_` are reserved for the platform
   *   and exempt from the namespace-prefix check (apps may reference
   *   them but never define them).
   */
  namespace: z.string()
    .regex(/^[a-z][a-z0-9_]{1,19}$/, 'Namespace must be 2-20 chars, lowercase alphanumeric + underscore')
    .optional()
    .describe('Short namespace identifier; also the mandatory prefix of every object name (e.g. "todo" → object names "todo_task", "todo_project")'),

  /**
   * Default datasource for all objects in this package.
   *
   * When set, all objects defined in this package will use this datasource
   * by default unless they explicitly override it with their own `datasource` field.
   *
   * This provides package-level datasource configuration without needing to
   * specify it on every individual object.
   *
   * @example "memory"  // Use in-memory driver for all package objects
   * @example "turso"   // Use Turso/LibSQL for all package objects
   */
  defaultDatasource: z.string().optional().default('default')
    .describe('Default datasource for all objects in this package'),

  /**
   * Package version following semantic versioning (major.minor.patch).
   *
   * @example "1.0.0"
   * @example "2.1.0-beta.1"
   */
  version: z.string().regex(/^\d+\.\d+\.\d+$/).describe('Package version (semantic versioning)'),
  
  /** 
   * Type of the package in the ObjectStack ecosystem.
   * - plugin: General-purpose functionality extension (Runtime: standard)
   * - app: Business application package
   * - driver: Connectivity adapter
   * - server: Protocol gateway (Hono, GraphQL)
   * - ui: Frontend package (Static/SPA)
   * - theme: UI Theme
   * - agent: AI Agent
   * - module: Reusable code library/shared module
   * - objectql: Core engine
   * - adapter: Host adapter (Express, Fastify)
   */
  type: z.enum([
    'plugin',
    ...CORE_PLUGIN_TYPES,
    'module',
    'gateway',  // Deprecated: use 'server'
    'adapter'
  ]).describe('Type of package'),

  /**
   * Deployment scope of this package.
   *
   * - `cloud`:   Control-plane exclusive (tenant management, credentials, package registry…).
   *              Never registered into a project kernel; accessible only via `/api/v1/cloud/*`.
   * - `system`:  Cross-project shared identity (user, org, role, i18n…).
   *              In a project kernel, objects are transparently proxied to the control-plane DB
   *              with an automatic `organization_id` filter for org-scoped tables.
   *              Packages with this scope should also set `defaultDatasource: 'cloud'`.
   * - `project`: Per-project business objects (CRM, custom apps…).
   *              Registered normally into the project DB.
   */
  scope: z.enum(['cloud', 'system', 'project']).default('project')
    .describe('Deployment scope: cloud | system | project'),

  /**
   * Human-readable name of the package.
   * Displayed in the UI for users.
   *
   * @example "Project Management"
   */
  name: z.string().describe('Human-readable package name'),
  
  /** 
   * Brief description of the package functionality.
   * Displayed in the marketplace and plugin manager.
   */
  description: z.string().optional().describe('Package description'),
  
  /**
   * Permissions the package requires — the "Scope" requested at installation.
   *
   * Accepts either the legacy flat list of permission strings, or the
   * structured plugin permission block ({@link PluginPermissionsSchema},
   * ADR-0025 §3.2) that maps to service / hook / network / fs capabilities.
   *
   * @example ["system.user.read", "system.data.write"]
   * @example { "services": ["object", "http"], "hooks": ["record.beforeInsert"] }
   */
  permissions: ManifestPermissionsSchema.optional()
    .describe('Required permissions: legacy string[] or structured plugin block (ADR-0025 §3.2)'),
  
  /** 
   * Glob patterns specifying ObjectQL schemas files.
   * Matches `*.object.yml` or `*.object.ts` files to load business objects.
   * 
   * @example ["./src/objects/*.object.yml"]
   */
  objects: z.array(z.string()).optional().describe('Glob patterns for ObjectQL schemas files'),

  /**
   * Defines system level DataSources.
   * Matches `*.datasource.yml` files.
   * 
   * @example ["./src/datasources/*.datasource.mongo.yml"]
   */
  datasources: z.array(z.string()).optional().describe('Glob patterns for Datasource definitions'),

  /**
   * Package Dependencies.
   * Map of package IDs to version requirements.
   * 
   * @example { "@steedos/plugin-auth": "^2.0.0" }
   */
  dependencies: z.record(z.string(), z.string()).optional().describe('Package dependencies'),

  /**
   * Plugin Configuration Schema.
   * Defines the settings this plugin exposes to the user via UI/ENV.
   * Uses a simplified JSON Schema format.
   * 
   * @example
   * {
   *   "title": "Stripe Config",
   *   "properties": {
   *     "apiKey": { "type": "string", "secret": true },
   *     "currency": { "type": "string", "default": "USD" }
   *   }
   * }
   */
  configuration: z.object({
    title: z.string().optional(),
    properties: z.record(z.string(), z.object({
       type: z.enum(['string', 'number', 'boolean', 'array', 'object']).describe('Data type of the setting'),
       default: z.unknown().optional().describe('Default value'),
       description: z.string().optional().describe('Tooltip description'),
       required: z.boolean().optional().describe('Is this setting required?'),
       secret: z.boolean().optional().describe('If true, value is encrypted/masked (e.g. API Keys)'),
       enum: z.array(z.string()).optional().describe('Allowed values for select inputs'),
    })).describe('Map of configuration keys to their definitions')
  }).optional().describe('Plugin configuration settings'),

  /**
   * Contribution Points (VS Code Style).
   * formalized way to extend the platform capabilities.
   */
  contributes: z.object({
    /**
     * Register new Metadata Kinds (CRDs).
     * Enables the system to parse and validate new file types.
     * Example: Registering a BI plugin to handle *.report.ts
     */
    kinds: z.array(z.object({
      id: z.string().describe('The generic identifier of the kind (e.g., "sys.bi.report")'),
      globs: z.array(z.string()).describe('File patterns to watch (e.g., ["**/*.report.ts"])'),
      description: z.string().optional().describe('Description of what this kind represents'),
    })).optional().describe('New Metadata Types to recognize'),

    /**
     * Register System Hooks.
     * Declares that this plugin listens to specific system events.
     */
    events: z.array(z.string()).optional().describe('Events this plugin listens to'),

    /**
     * Register UI Menus.
     */
    menus: z.record(z.string(), z.array(z.object({
       id: z.string(),
       label: z.string(),
       command: z.string().optional(),
    }))).optional().describe('UI Menu contributions'),

    /**
     * Register Custom Themes.
     */
    themes: z.array(z.object({
      id: z.string(),
      label: z.string(),
      path: z.string(),
    })).optional().describe('Theme contributions'),

    /**
     * Register Translations.
     * Path to translation files (e.g. "locales/en.json").
     */
    translations: z.array(z.object({
      locale: z.string(),
      path: z.string(),
    })).optional().describe('Translation resources'),

    /**
     * Register Server Actions.
     * Invocable functions exposed to Flows or API.
     */
    actions: z.array(z.object({
       name: z.string().describe('Unique action name'),
       label: z.string().optional(),
       description: z.string().optional(),
       input: z.unknown().optional().describe('Input validation schema'),
       output: z.unknown().optional().describe('Output schema'),
    })).optional().describe('Exposed server actions'),

    /**
     * Register Storage Drivers.
     * Enables connecting to new types of datasources.
     */
    drivers: z.array(z.object({
      id: z.string().describe('Driver unique identifier (e.g. "postgres", "mongodb")'),
      label: z.string().describe('Human readable name'),
      description: z.string().optional(),
    })).optional().describe('Driver contributions'),

    /**
     * Register Custom Field Types.
     * Extends the data model with new widget types.
     */
    fieldTypes: z.array(z.object({
      name: z.string().describe('Unique field type name (e.g. "vector")'),
      label: z.string().describe('Display label'),
      description: z.string().optional(),
    })).optional().describe('Field Type contributions'),
    
    /**
     * Register Custom Query Operators/Functions.
     * Extends ObjectQL with new functions (e.g. distance()).
     */
    functions: z.array(z.object({
      name: z.string().describe('Function name (e.g. "distance")'),
      description: z.string().optional(),
      args: z.array(z.string()).optional().describe('Argument types'),
      returnType: z.string().optional(),
    })).optional().describe('Query Function contributions'),

    /**
      * Register API Route Namespaces.
      * Declares the API endpoints this plugin provides to the HttpDispatcher.
      * The kernel routes matching prefixes to this plugin's handler.
      * 
      * @example
      * routes: [
      *   { prefix: '/api/v1/i18n', service: 'i18n', methods: ['getLocales', 'getTranslations'] }
      * ]
      */
    routes: z.array(z.object({
      /** URL path prefix (e.g. "/api/v1/ai") */
      prefix: z.string().regex(/^\//).describe('API path prefix'),
      /** Service name this plugin provides */
      service: z.string().describe('Service name this plugin provides'),
      /** Protocol method names implemented */
      methods: z.array(z.string()).optional()
        .describe('Protocol method names implemented (e.g. ["getLocales", "getTranslations"])'),
    })).optional().describe('API route contributions to HttpDispatcher'),

    /**
      * Register CLI Commands.
      * Allows plugins to extend the ObjectStack CLI with custom commands.
      * Each command entry declares metadata; the actual Commander.js command
      * is resolved at runtime by importing the plugin's module.
      * 
      * The plugin package must export a `commands` array of Commander.js `Command` instances
      * from its main entry point or from the path specified in `module`.
      * 
      * @example
      * ```yaml
      * commands:
      *   - name: marketplace
      *     description: "Manage marketplace apps"
      *     module: "./cli"       # optional, defaults to package main
      *   - name: deploy
      *     description: "Deploy to cloud"
      * ```
      */
    commands: z.array(z.object({
      /** CLI command name (e.g., "marketplace", "deploy"). Must be a valid CLI identifier. */
      name: z.string()
        .regex(/^[a-z][a-z0-9-]*$/, 'Command name must be lowercase alphanumeric with hyphens')
        .describe('CLI command name'),
      /** Brief description shown in `os --help` */
      description: z.string().optional().describe('Command description for help text'),
      /** 
       * Optional module path (relative to package root) that exports the Commander.js commands.
       * If omitted, the CLI will import from the package's main entry point.
       * The module must export a `commands` array of Commander.js `Command` instances,
       * or a single `Command` instance as default export.
       */
      module: z.string().optional().describe('Module path exporting Commander.js commands'),
    })).optional().describe('CLI command contributions'),
  }).optional().describe('Platform contributions'),

  /** 
   * Initial data seeding configuration.
   * Defines default records to be inserted when the package is installed.
   * 
   * Uses the standard SeedSchema which supports idempotent upsert via
   * `externalId`, environment scoping via `env`, and multiple conflict
   * resolution modes.
   * 
   * @deprecated Prefer using the top-level `data` field on the Stack Definition
   * (defineStack({ data: [...] })) for better visibility and metadata registration.
   * This field is retained for backward compatibility with manifest-only packages.
   */
  data: z.array(SeedSchema).optional().describe('Initial seed data (prefer top-level data field)'),

  /**
   * Plugin Capability Manifest.
   * Declares protocols implemented, interfaces provided, dependencies, and extension points.
   * This enables plugin interoperability and automatic discovery.
   */
  capabilities: PluginCapabilityManifestSchema.optional()
    .describe('Plugin capability declarations for interoperability'),

  /** 
   * Extension points contributed by this package.
   * Allows packages to extend UI components, add functionality, etc.
   */
  extensions: z.record(z.string(), z.unknown()).optional().describe('Extension points and contributions'),

  /**
   * Navigation contributions (ADR-0029 D7).
   *
   * Lets this package inject navigation items into apps it does not own
   * (e.g. a capability plugin adding its menu entries into the `setup` app).
   * The runtime merges these into the target app's `navigation` tree by
   * group id + priority. See {@link NavigationContributionSchema}.
   */
  navigationContributions: z.array(NavigationContributionSchema).optional()
    .describe('Navigation items this package contributes into apps owned by other packages'),

  /**
   * Plugin Loading Configuration.
   * Configures how the plugin is loaded, initialized, and managed at runtime.
   * Includes strategies for lazy loading, code splitting, caching, and hot reload.
   */
  loading: PluginLoadingConfigSchema.optional()
    .describe('Plugin loading and runtime behavior configuration'),

  /**
   * Platform Compatibility Requirements.
   * Specifies the minimum ObjectStack platform version required to run this package.
   * Used at install time to prevent incompatible packages from being installed.
   *
   * @example
   * ```yaml
   * engine:
   *   objectstack: ">=3.0.0"
   * ```
   */
  engine: z.object({
    /** ObjectStack platform version requirement (SemVer range) */
    objectstack: z.string()
      .regex(/^[><=~^]*\d+\.\d+\.\d+/)
      .describe('ObjectStack platform version requirement (SemVer range, e.g. ">=3.0.0")'),
  }).optional().describe('Platform compatibility requirements (legacy; superseded by `engines`)'),

  /**
   * Compatibility ranges (ADR-0025 §3.2). Protocol-first: `engines.protocol`
   * is checked before `engines.platform`. Supersedes the legacy single-field
   * `engine`, which is retained for backward compatibility.
   */
  engines: PluginEnginesSchema.optional()
    .describe('Plugin compatibility ranges (ADR-0025 §3.2; supersedes `engine`)'),

  /**
   * Trust / isolation tier the plugin runs under (ADR-0025 §3.6).
   * Unset implies a pure-metadata package (no executable code).
   */
  runtime: PluginRuntimeSchema.optional()
    .describe('Plugin trust tier (ADR-0025 §3.6)'),

  /**
   * Dependency packaging strategy for code-bearing plugins (ADR-0025 §3.3).
   */
  packaging: PluginPackagingSchema.optional()
    .describe('Dependency packaging strategy (ADR-0025 §3.3)'),

  /**
   * Per-file content digests of the packaged artifact (ADR-0025 §3.2),
   * verified at install/load time when the runtime unpacks the `.osplugin`.
   */
  integrity: PluginIntegritySchema.optional()
    .describe('Per-file content digests of the plugin artifact (ADR-0025 §3.2)'),
});

/**
 * TypeScript type inferred from the ManifestSchema.
 * Use this type for type-safe manifest handling in TypeScript code.
 */
export type ObjectStackManifest = z.input<typeof ManifestSchema>;
/** Post-parse shape of {@link ObjectStackManifest} — defaults applied, transforms run (ADR-0122). */
export type ObjectStackManifestParsed = z.infer<typeof ManifestSchema>;

