// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CORE_PLUGIN_TYPES } from './plugin.zod';
import { retiredKey } from '../shared/retired-key';
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
 * Trust / isolation tier the plugin DECLARES (ADR-0025 §3.6):
 * - `node`    — in-process, full PluginContext (first-party / verified only)
 * - `sandbox` — QuickJS-WASM, capability-gated surface
 * - `worker`  — out-of-process (reserved)
 *
 * ⚠️ WHERE THIS IS ENFORCED, AND WHERE IT IS NOT — the two halves are not the
 * same answer, so read both before treating a declared tier as isolation.
 *
 * ENFORCED at the cloud marketplace **publish gate**: an unverified publisher
 * requesting the `node` tier is hard-rejected (HTTP 422) and the submission is
 * forced to manual review. That gate is a real consumer of this key, which is
 * why the tier is not a candidate for retirement.
 *
 * NOT ENFORCED at load. Load-side enforcement is **not implemented** — nothing
 * dispatches on the tier (its only reads are two CLI progress lines that echo
 * the value), so a locally installed plugin runs in-process with a full
 * PluginContext whatever tier it declares. `sandbox` and `worker` therefore
 * name the isolation the publish gate assumes, not isolation the loader
 * applies; a local install is not confined by this field. The QuickJS runner
 * under `packages/runtime/src/sandbox/` is the hook / action SCRIPT-BODY
 * sandbox and is never reached from a plugin's declared tier.
 *
 * Enforcing the tier at load is tracked as its own decision (v18 direction);
 * do not read this field as an isolation guarantee until it lands.
 */
export const PluginRuntimeSchema = z
  .enum(['node', 'sandbox', 'worker'])
  .describe(
    'Plugin trust tier the plugin declares (ADR-0025 §3.6) — enforced at the cloud '
    + 'marketplace publish gate (an unverified publisher requesting `node` is rejected with '
    + 'HTTP 422 and forced to manual review); load-side enforcement is NOT implemented, so a '
    + 'locally installed plugin is not isolated by the tier it declares',
  );

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
 * Computed at build time (`os plugin build`) and self-checked by the
 * publisher at the `os plugin publish` preflight. Unpack-time
 * re-verification (ADR §3.5 step 5) is the cloud control plane's
 * obligation and is not implemented in this repo (#11331).
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
   * REMOVED (#11332, ADR-0049 enforce-or-remove).
   *
   * `configuration` declared a per-plugin settings surface — `{ title,
   * properties }`, a simplified JSON-Schema map — and NOTHING read the
   * container anywhere: no settings UI rendered it, no loader resolved a
   * setting from it. Its `properties.*.secret` flag is why this is a
   * false-compliance finding rather than tidying: the describe() promised
   * "value is encrypted/masked (e.g. API Keys)" while nothing encrypted,
   * masked, resolved or even parsed the value — an author writing
   * `secret: true` next to an API key got exactly the same handling as
   * `secret: false`. Tombstoned rather than deleted because `ManifestSchema`
   * is not `.strict()`: a plain deletion would silently strip the key (the
   * `loading` precedent below).
   */
  configuration: retiredKey(
    '`manifest.configuration` was removed in @objectstack/spec 17 (ADR-0049 ' +
    'enforce-or-remove) — nothing ever read the block: no settings UI rendered it and ' +
    'no loader resolved a setting from it, so authoring it configured nothing. Worse, ' +
    '`properties.*.secret` promised "value is encrypted/masked (e.g. API Keys)" while ' +
    'nothing encrypted, masked or even parsed the flag — a false assurance about ' +
    'credential handling. Delete the key. A plugin is configured by the host that ' +
    'composes it: pass options to its constructor in ' +
    '`defineStack({ plugins: [new MyPlugin({ … })] })`, which is the enforced channel. ' +
    'A declarative settings surface must be designed with an enforcing reader first, ' +
    'not revived here.',
  ),

  /**
   * Contribution Points (VS Code Style).
   *
   * TEN MEMBERS REMOVED in v17.x (ADR-0049 enforce-or-remove): nine at
   * #10724 — `events`, `menus`, `themes`, `translations`, `actions`,
   * `drivers`, `fieldTypes`, `functions`, `commands` — and `routes` at
   * #10726, its own enforce-or-remove fork, maintainer-ruled Option B
   * 2026-08-22 (remove; author-facing materials redirect to the imperative
   * `http.server` mount) once the cloud census (#10812) closed clean. The
   * census behind them (#10627, re-verified at claim time, three repos with
   * control probes) measured exactly ONE non-test read of
   * `manifest.contributes` in the entire monorepo —
   * `packages/objectql/src/engine.ts` reading `kinds` — so every other
   * member parsed, entered the manifest, and changed nothing.
   * Tombstoned rather than deleted because this object is not `.strict()`:
   * a plain deletion would silently strip the key, replacing an inert
   * declaration with an invisible one (the `loading` precedent below).
   *
   * Survivor: `kinds` (live reader: engine → `registry.registerKind`) —
   * the block's sole remaining live member.
   */
  contributes: z.object({
    /**
     * Register new Metadata Kinds (identifiers).
     *
     * A declared kind is registered by the engine (`registry.registerKind`,
     * keyed on `id`) and served back through `GET /metadata/kind`. It does
     * NOT extend file-type discovery: artifact discovery globs `filePatterns`
     * off the metadata type registry (`metadata-plugin.zod.ts`), which this
     * declaration never fed — the former `globs` sub-field promised exactly
     * that and was retired for it (#11169).
     */
    kinds: z.array(z.object({
      id: z.string().describe('The generic identifier of the kind (e.g., "sys.bi.report")'),
      /** REMOVED (#11169) — discovery reads the metadata type registry's `filePatterns`, never this. */
      globs: retiredKey(
        '`manifest.contributes.kinds[].globs` was removed in @objectstack/spec 17 (' +
        'ADR-0049 enforce-or-remove) — it never had an effect: file-type discovery globs ' +
        '`filePatterns` off the metadata type registry, which `contributes.kinds` does not ' +
        'extend (`metadata-plugin.zod.ts` states this outright), so the watch patterns ' +
        'declared here were stored, served back through `GET /metadata/kind`, and never ' +
        "consulted. Delete the key; the kind's `id` (and optional `description`) still " +
        'register. If plugin-extensible file-type discovery is wanted, it must be designed ' +
        'against the `filePatterns` registry, not revived here.',
      ),
      description: z.string().optional().describe('Description of what this kind represents'),
    })).optional().describe('Metadata kind identifiers this package registers'),

    /** REMOVED (#10724) — the declaration drove nothing; subscribe in plugin code. */
    events: retiredKey(
      '`manifest.contributes.events` was removed in @objectstack/spec 17 (' +
      'ADR-0049 enforce-or-remove) — nothing ever read the list: its only in-repo ' +
      'author already subscribed imperatively in plugin code, so the declaration was ' +
      'decorative. Delete the key. Subscribe to system events in the plugin itself — ' +
      "`ctx.hook('kernel:ready', …)` (or the events service) from `init`/`start` is " +
      'the enforced channel; record lifecycle hooks register on the data engine.',
    ),

    /** REMOVED (#10724) — use app `navigation` / `manifest.navigationContributions`. */
    menus: retiredKey(
      '`manifest.contributes.menus` was removed in @objectstack/spec 17 (' +
      'ADR-0049 enforce-or-remove) — no renderer ever read it; two alias maps already ' +
      'redirected this spelling to `navigation`. Delete the key. Declare navigation in ' +
      "the app's `navigation` tree, or inject items into another package's app via " +
      '`manifest.navigationContributions` (ADR-0029 D7), which the engine registers.',
    ),

    /** REMOVED (#10724) — this `{id,label,path}` shape had no reader anywhere. */
    themes: retiredKey(
      '`manifest.contributes.themes` was removed in @objectstack/spec 17 (' +
      'ADR-0049 enforce-or-remove) — it never had an effect: theme registration reaches ' +
      'the registry only through the stack-level `themes` collection (a ' +
      '`ThemeSchema` surface, unrelated to this `{ id, label, path }` shape), never ' +
      'through `contributes.themes`. Delete the key; declare themes in the stack ' +
      '`themes` collection instead.',
    ),

    /** REMOVED (#10724) — use the `translation` metadata type / stack `translations`. */
    translations: retiredKey(
      '`manifest.contributes.translations` was removed in @objectstack/spec 17 ' +
      '(ADR-0049 enforce-or-remove) — no loader ever read these `{ locale, ' +
      'path }` entries; authoring them registered no translations. Delete the key. ' +
      'Declare translations as `translation` metadata: `defineTranslationBundle({ … })` ' +
      "in the stack's `translations` collection (`defineStack({ translations: […] })`), " +
      'which the engine registers and the i18n pipeline serves.',
    ),

    /** REMOVED (#10724) — use the stack `actions` collection / `registerAction`. */
    actions: retiredKey(
      '`manifest.contributes.actions` was removed in @objectstack/spec 17 (' +
      'ADR-0049 enforce-or-remove) — nothing ever read it; actions declared here were ' +
      'never invocable. Delete the key. Declare actions in the stack `actions` ' +
      'collection (registered by the engine) or register imperatively via ' +
      '`engine.registerAction`.',
    ),

    /** REMOVED (#10724) — a driver is a `driver.*` kernel service, not a declaration. */
    drivers: retiredKey(
      '`manifest.contributes.drivers` was removed in @objectstack/spec 17 (' +
      'ADR-0049 enforce-or-remove) — it never had an effect: a storage driver is wired ' +
      'by registering a kernel SERVICE named `driver.*` (the objectql plugin picks it ' +
      'up and calls `registerDriver`), and its only in-repo author was registered that ' +
      'way, not by this declaration. Delete the key.',
    ),

    /** REMOVED (#10724) — no field-type registration seam exists. */
    fieldTypes: retiredKey(
      '`manifest.contributes.fieldTypes` was removed in @objectstack/spec 17 (' +
      'ADR-0049 enforce-or-remove) — there is no `registerFieldType` seam anywhere: ' +
      'the declaration advertised an extension point the platform does not have, so ' +
      'authoring it configured nothing. Delete the key. The field-type vocabulary is ' +
      'the spec `FieldType` enum; extending it is a spec change, not a manifest ' +
      'declaration.',
    ),

    /** REMOVED (#10724) — use `defineStack({ functions })` → `registerFunction`. */
    functions: retiredKey(
      '`manifest.contributes.functions` was removed in @objectstack/spec 17 (' +
      'ADR-0049 enforce-or-remove) — nothing ever read it; ObjectQL functions declared ' +
      'here were never registered. Delete the key. Declare functions on the stack ' +
      '(`defineStack({ functions: […] })`), which the hook binder registers via ' +
      '`engine.registerFunction`.',
    ),

    /** REMOVED (#10726) — mount code-handler routes on the `http.server` service; declarative endpoints are `defineStack({ apis })`. */
    routes: retiredKey(
      '`manifest.contributes.routes` was removed in @objectstack/spec 17 (' +
      'ADR-0049 enforce-or-remove) — nothing ever read it: the HttpDispatcher never ' +
      'registered a prefix from the declaration, so an entry here parsed cleanly and ' +
      'served nothing while published material kept recommending it. Delete the key. ' +
      'A route that needs real handler CODE is mounted imperatively: resolve the ' +
      '`http.server` service from the plugin context and register the handler on ' +
      '`kernel:ready`. A declarative endpoint over a pipeline the platform already ' +
      'runs (query/return records, trigger a flow) is `defineStack({ apis })`.',
    ),

    /**
     * REMOVED (#10724) — CLI commands are oclif-auto-discovered, never resolved
     * from this declaration. The JSDoc that used to sit here described
     * Commander.js runtime resolution as current behaviour; that contradicted
     * `cli-extension.zod.ts`, which records the oclif migration: "The
     * `objectstack.config.ts` plugins array no longer determines CLI commands."
     */
    commands: retiredKey(
      '`manifest.contributes.commands` was removed in @objectstack/spec 17 (' +
      'ADR-0049 enforce-or-remove) — the CLI never resolved commands from this ' +
      'declaration: commands are auto-discovered through oclif\'s native plugin system ' +
      "(the plugin package declares an `oclif` section in its own `package.json`; see " +
      '`cli-extension.zod.ts`), and the `objectstack.config.ts` plugins array no longer ' +
      'determines CLI commands. Delete the key.',
    ),
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
   * REMOVED (#11332, ADR-0049 enforce-or-remove).
   *
   * `capabilities` carried the whole `PluginCapabilityManifestSchema` block —
   * `implements`, `provides`, `requires`, `extensionPoints`, `extensions` —
   * and NOTHING read the container anywhere, which settles every key beneath
   * it at once. Its describe() sold "plugin interoperability and automatic
   * discovery"; no discovery path ever consulted it, and real dependency
   * resolution runs off top-level `manifest.dependencies`, not
   * `capabilities.requires`. The bare `.capabilities` hits a re-measurement
   * will find belong to other surfaces entirely (driver loader contracts,
   * the QuickJS sandbox argument set, REST discovery, the ADR-0066
   * stack-level `capabilities` collection) — none is reached from a
   * manifest. `PluginCapabilityManifestSchema` itself stays exported: the
   * plugin-registry surface (`plugin-registry.zod.ts`) still declares it.
   * Tombstoned rather than deleted because `ManifestSchema` is not
   * `.strict()` (the `loading` precedent below).
   */
  capabilities: retiredKey(
    '`manifest.capabilities` was removed in @objectstack/spec 17 (ADR-0049 ' +
    'enforce-or-remove) — no discovery path ever consulted the block: nothing read ' +
    '`implements`, `provides`, `requires`, `extensionPoints` or `extensions`, so the ' +
    'declared "interoperability and automatic discovery" never happened. Delete the ' +
    'key. Real dependency resolution runs off top-level `manifest.dependencies`, ' +
    'which stays. Capability-based discovery must be designed with an enforcing ' +
    'reader first, not revived here.',
  ),

  /**
   * REMOVED (#11332, ADR-0049 enforce-or-remove).
   *
   * `extensions` was an untyped escape hatch — `z.record(z.string(),
   * z.unknown())` — with zero readers anywhere, so whatever an author parked
   * here was stored and never consulted. Its emptiness in-repo was itself
   * evidence: an untyped catch-all with no users is a cheaper removal than
   * one with unknown users. Tombstoned rather than deleted because
   * `ManifestSchema` is not `.strict()` (the `loading` precedent below).
   */
  extensions: retiredKey(
    '`manifest.extensions` was removed in @objectstack/spec 17 (ADR-0049 ' +
    'enforce-or-remove) — an untyped map with zero readers: whatever was parked here ' +
    'was stored and never consulted. Delete the key. Extend the platform through the ' +
    'enforced channels instead: `contributes.kinds` registers metadata kinds, ' +
    '`navigationContributions` injects navigation into other packages\' apps, and ' +
    'code-level extension happens in the plugin itself (`init`/`start`).',
  ),

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
   * REMOVED in v17 (#4914, ADR-0049 enforce-or-remove).
   *
   * `loading` carried the whole `PluginLoadingConfig` block — `strategy`,
   * `preload`, `codeSplitting`, `dynamicImport`, `initialization`,
   * `dependencyResolution`, `hotReload`, `caching`, `sandboxing`, `monitoring`
   * — and NOTHING read any of it. It parsed, it entered the manifest, and it
   * changed nothing. Tombstoned rather than deleted because `ManifestSchema` is
   * not `.strict()`: a plain deletion would silently strip the key, replacing an
   * inert declaration with an invisible one.
   *
   * See `plugin-loading.zod.ts` for the full record, including why `sandboxing`
   * made this a security concern and not merely tidying.
   */
  loading: retiredKey(
    '`manifest.loading` was removed in @objectstack/spec 17.0.0 (ADR-0049 ' +
    'enforce-or-remove) — the entire block (`strategy`, `preload`, `codeSplitting`, ' +
    '`dynamicImport`, `initialization`, `dependencyResolution`, `hotReload`, `caching`, ' +
    '`sandboxing`, `monitoring`) had no runtime reader in any repo, so authoring it ' +
    'configured nothing. Delete the key. Plugins are composed at boot — `defineStack` ' +
    'registers them and the kernel runs `init` then `start` in an order topologically ' +
    "resolved from each composed plugin's own `dependencies` / `optionalDependencies` " +
    '(`resolvePluginOrder`); the set is fixed until the process restarts. ' +
    '⚠️ `loading.sandboxing` in particular never isolated anything: it did not run ' +
    'plugins in a process, vm, iframe or web-worker, and `allowedServices` gated no ' +
    'call. If you were relying on it for isolation, you had none — and the plugin trust ' +
    'tier (`manifest.runtime`) does not give it back: that tier is enforced at the cloud ' +
    'marketplace PUBLISH gate only (an unverified publisher requesting the `node` tier is ' +
    'rejected with HTTP 422 and forced to manual review), while load-side enforcement is ' +
    'NOT implemented, so a locally installed plugin is not isolated by the tier it ' +
    'declares. Use the permission declarations, which are enforced.',
  ),

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
   * Trust / isolation tier the plugin DECLARES (ADR-0025 §3.6).
   * Unset implies a pure-metadata package (no executable code).
   *
   * ⚠️ Enforced at the cloud marketplace **publish gate** only — an unverified
   * publisher requesting the `node` tier is hard-rejected (HTTP 422) and forced
   * to manual review. **Load-side enforcement is not implemented**: a locally
   * installed plugin is not isolated by the tier it declares. See
   * {@link PluginRuntimeSchema} for the full split.
   */
  runtime: PluginRuntimeSchema.optional()
    .describe(
      'Plugin trust tier the plugin declares (ADR-0025 §3.6) — enforced at the cloud '
      + 'marketplace publish gate (unverified publisher requesting `node` → HTTP 422 + manual '
      + 'review); load-side enforcement is NOT implemented, so a locally installed plugin is '
      + 'not isolated by the tier it declares',
    ),

  /**
   * Dependency packaging strategy for code-bearing plugins (ADR-0025 §3.3).
   */
  packaging: PluginPackagingSchema.optional()
    .describe('Dependency packaging strategy (ADR-0025 §3.3)'),

  /**
   * Per-file content digests of the packaged artifact (ADR-0025 §3.2).
   * Computed at build, self-checked at the publish preflight; unpack-time
   * verification is the cloud control plane's obligation, not yet
   * implemented (#11331).
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

