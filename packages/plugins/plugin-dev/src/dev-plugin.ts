// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, createMemoryCache, createMemoryQueue, createMemoryJob, createMemoryI18n } from '@objectstack/core';
import { readEnvWithDeprecation } from '@objectstack/types';

/**
 * All 17 core kernel service names as defined in CoreServiceName.
 * @see packages/spec/src/system/core-services.zod.ts
 */
const CORE_SERVICE_NAMES = [
  'metadata', 'data', 'auth',
  'file-storage', 'search', 'cache', 'queue',
  'automation', 'graphql', 'analytics', 'realtime',
  'job', 'notification', 'ai', 'i18n', 'ui', 'workflow',
] as const;

/**
 * Security sub-services registered by the SecurityPlugin.
 */
const SECURITY_SERVICE_NAMES = [
  'security.permissions', 'security.rls', 'security.fieldMasker',
] as const;

/**
 * Contract-compliant dev stub implementations.
 *
 * Each stub implements the interface defined in `packages/spec/src/contracts/`
 * (e.g. ICacheService, IQueueService, IAutomationService, …) so that
 * downstream code calling these services in dev mode receives the correct
 * return types — not just `undefined`.
 *
 * Where an interface method is optional (marked with `?`), the stub only
 * implements the required methods plus any optional ones that have
 * a trivially useful implementation.
 */

/** IStorageService — in-memory file storage stub */
function createStorageStub() {
  const files = new Map<string, { data: Buffer; meta: any }>();
  return {
    _dev: true, _serviceName: 'file-storage',
    async upload(key: string, data: any, options?: any): Promise<void> {
      files.set(key, { data: Buffer.from(data), meta: { contentType: options?.contentType, metadata: options?.metadata } });
    },
    async download(key: string): Promise<Buffer> { return files.get(key)?.data ?? Buffer.alloc(0); },
    async delete(key: string): Promise<void> { files.delete(key); },
    async exists(key: string): Promise<boolean> { return files.has(key); },
    async getInfo(key: string) {
      const f = files.get(key);
      return { key, size: f?.data?.length ?? 0, contentType: f?.meta?.contentType, lastModified: new Date(), metadata: f?.meta?.metadata };
    },
    async list(prefix: string) {
      return [...files.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, f]) =>
        ({ key, size: f.data.length, contentType: f.meta?.contentType, lastModified: new Date() }));
    },
  };
}

/** ISearchService — in-memory full-text search stub */
function createSearchStub() {
  const indexes = new Map<string, Map<string, Record<string, unknown>>>();
  return {
    _dev: true, _serviceName: 'search',
    async index(object: string, id: string, document: Record<string, unknown>): Promise<void> {
      if (!indexes.has(object)) indexes.set(object, new Map());
      indexes.get(object)!.set(id, document);
    },
    async remove(object: string, id: string): Promise<void> { indexes.get(object)?.delete(id); },
    async search(object: string, query: string) {
      const docs = indexes.get(object) ?? new Map();
      const q = query.toLowerCase();
      const hits = [...docs.entries()]
        .filter(([, doc]) => JSON.stringify(doc).toLowerCase().includes(q))
        .map(([id, doc]) => ({ id, score: 1, document: doc }));
      return { hits, totalHits: hits.length, processingTimeMs: 0 };
    },
    async bulkIndex(object: string, documents: Array<{ id: string; document: Record<string, unknown> }>): Promise<void> {
      if (!indexes.has(object)) indexes.set(object, new Map());
      for (const d of documents) {
        indexes.get(object)!.set(d.id, d.document);
      }
    },
    async deleteIndex(object: string): Promise<void> { indexes.delete(object); },
  };
}

/** IAutomationService — no-op flow execution stub */
function createAutomationStub() {
  const flows = new Map<string, unknown>();
  return {
    _dev: true, _serviceName: 'automation',
    async execute(_flowName: string) { return { success: true, output: undefined, durationMs: 0 }; },
    async listFlows(): Promise<string[]> { return [...flows.keys()]; },
    registerFlow(name: string, definition: unknown) { flows.set(name, definition); },
    unregisterFlow(name: string) { flows.delete(name); },
  };
}

/** IGraphQLService — dev stub returning empty data */
function createGraphQLStub() {
  return {
    _dev: true, _serviceName: 'graphql',
    async execute() { return { data: null, errors: [{ message: 'GraphQL not available in dev stub mode' }] }; },
    getSchema() { return 'type Query { _dev: Boolean }'; },
  };
}

/** IAnalyticsService — dev stub returning empty results */
function createAnalyticsStub() {
  return {
    _dev: true, _serviceName: 'analytics',
    async query() { return { rows: [], fields: [] }; },
    async getMeta() { return []; },
    async generateSql() { return { sql: '', params: [] }; },
  };
}

/** IRealtimeService — in-memory pub/sub stub */
function createRealtimeStub() {
  const subs = new Map<string, Function>();
  let subId = 0;
  return {
    _dev: true, _serviceName: 'realtime',
    async publish(event: any): Promise<void> { for (const fn of subs.values()) fn(event); },
    async subscribe(_channel: string, handler: Function): Promise<string> {
      const id = `dev-sub-${++subId}`; subs.set(id, handler); return id;
    },
    async unsubscribe(subscriptionId: string): Promise<void> { subs.delete(subscriptionId); },
  };
}

/** INotificationService — in-memory log stub */
function createNotificationStub() {
  const sent: any[] = [];
  return {
    _dev: true, _serviceName: 'notification',
    async send(message: any) { sent.push(message); return { success: true, messageId: `dev-notif-${sent.length}` }; },
    async sendBatch(messages: any[]) { return messages.map(m => { sent.push(m); return { success: true, messageId: `dev-notif-${sent.length}` }; }); },
    getChannels() { return ['email', 'in-app'] as const; },
  };
}

/** IAIService — dev stub returning placeholder responses */
function createAIStub() {
  return {
    _dev: true, _serviceName: 'ai',
    async chat() { return { content: '[dev-stub] AI not available in development mode', model: 'dev-stub' }; },
    async complete() { return { content: '[dev-stub] AI not available in development mode', model: 'dev-stub' }; },
    async embed() { return [[0]]; },
    async listModels() { return ['dev-stub']; },
  };
}

/** II18nService — delegates to createMemoryI18n from core with locale fallback */
function createI18nStub() {
  const base = createMemoryI18n();
  return {
    ...base,
    _dev: true, _serviceName: 'i18n',
  };
}

/** IUIService — delegates to IMetadataService when available, falls back to in-memory Map */
function createUIStub() {
  const views = new Map<string, any>();
  const dashboards = new Map<string, any>();
  return {
    _dev: true, _serviceName: 'ui',
    _deprecated: 'Use IMetadataService instead. This stub will be removed in v4.0.0.',
    getView(name: string) { return views.get(name); },
    listViews(object?: string) {
      const all = [...views.values()];
      return object ? all.filter(v => v.object === object) : all;
    },
    getDashboard(name: string) { return dashboards.get(name); },
    listDashboards() { return [...dashboards.values()]; },
    registerView(name: string, definition: unknown) { views.set(name, definition); },
    registerDashboard(name: string, definition: unknown) { dashboards.set(name, definition); },
  };
}

/** IWorkflowService — in-memory workflow state stub */
function createWorkflowStub() {
  const states = new Map<string, string>(); // recordKey → currentState
  const key = (obj: string, id: string) => `${obj}:${id}`;
  return {
    _dev: true, _serviceName: 'workflow',
    async transition(t: any) {
      states.set(key(t.object, t.recordId), t.targetState);
      return { success: true, currentState: t.targetState };
    },
    async getStatus(object: string, recordId: string) {
      return { recordId, object, currentState: states.get(key(object, recordId)) ?? 'draft', availableTransitions: [] };
    },
    async getHistory() { return []; },
  };
}

/** IMetadataService — in-memory metadata registry stub (fallback) */
function createMetadataStub() {
  const store = new Map<string, Map<string, unknown>>(); // type → (name → def)
  return {
    _dev: true, _serviceName: 'metadata',
    register(type: string, nameOrDef: string | Record<string, any>, data?: unknown) {
      if (!store.has(type)) store.set(type, new Map());
      if (typeof nameOrDef === 'object' && nameOrDef !== null) {
        const key = nameOrDef.name ?? nameOrDef.id ?? 'unknown';
        store.get(type)!.set(key, nameOrDef);
      } else {
        store.get(type)!.set(nameOrDef, data);
      }
    },
    get(type: string, name: string) { return store.get(type)?.get(name); },
    list(type: string) { return [...(store.get(type)?.values() ?? [])]; },
    unregister(type: string, name: string) { store.get(type)?.delete(name); },
    exists(type: string, name: string) { return store.get(type)?.has(name) ?? false; },
    listNames(type: string) { return [...(store.get(type)?.keys() ?? [])]; },
    getObject(name: string) { return store.get('object')?.get(name); },
    listObjects() { return [...(store.get('object')?.values() ?? [])]; },
    unregisterPackage() {},
  };
}

/** IAuthService — dev auth stub returning success for all */
function createAuthStub() {
  return {
    _dev: true, _serviceName: 'auth',
    async handleRequest() { return new Response(JSON.stringify({ success: true }), { status: 200 }); },
    async verify() { return { success: true, user: { id: 'dev-admin', email: 'admin@dev.local', name: 'Admin', roles: ['admin'] } }; },
    async logout() {},
    async getCurrentUser() { return { id: 'dev-admin', email: 'admin@dev.local', name: 'Admin', roles: ['admin'] }; },
  };
}

/** IDataEngine — minimal no-op data stub (fallback) */
function createDataStub() {
  return {
    _dev: true, _serviceName: 'data',
    async find() { return []; },
    async findOne() { return undefined; },
    async insert(_obj: string, params: any) { return { id: `dev-${Date.now()}`, ...params?.data }; },
    async update(_obj: string, _id: string, params: any) { return params?.data ?? {}; },
    async delete() { return true; },
    async count() { return 0; },
    async aggregate() { return []; },
  };
}

/** Security sub-service stubs (PermissionEvaluator, RLSCompiler, FieldMasker) */
function createSecurityPermissionsStub() {
  return {
    _dev: true, _serviceName: 'security.permissions',
    resolvePermissionSets() { return []; },
    checkObjectPermission() { return true; },
    getFieldPermissions() { return {}; },
  };
}
function createSecurityRLSStub() {
  return {
    _dev: true, _serviceName: 'security.rls',
    compileFilter() { return null; },
    getApplicablePolicies() { return []; },
  };
}
function createSecurityFieldMaskerStub() {
  return {
    _dev: true, _serviceName: 'security.fieldMasker',
    maskResults(results: any) { return results; },
  };
}

/**
 * Map of service names → contract-compliant stub factory functions.
 * Each factory creates a new instance implementing the protocol interface
 * from `packages/spec/src/contracts/`.
 */
const DEV_STUB_FACTORIES: Record<string, () => Record<string, any>> = {
  'cache':       () => ({ ...createMemoryCache(), _dev: true }),
  'queue':       () => ({ ...createMemoryQueue(), _dev: true }),
  'job':         () => ({ ...createMemoryJob(), _dev: true }),
  'file-storage': createStorageStub,
  'search':      createSearchStub,
  'automation':  createAutomationStub,
  'graphql':     createGraphQLStub,
  'analytics':   createAnalyticsStub,
  'realtime':    createRealtimeStub,
  'notification': createNotificationStub,
  'ai':          createAIStub,
  'i18n':        createI18nStub,
  'ui':          createUIStub,
  'workflow':    createWorkflowStub,
  'metadata':    createMetadataStub,
  'data':        createDataStub,
  'auth':        createAuthStub,
  // Security sub-services
  'security.permissions': createSecurityPermissionsStub,
  'security.rls':         createSecurityRLSStub,
  'security.fieldMasker': createSecurityFieldMaskerStub,
};

/**
 * Dev Plugin Options
 *
 * Configuration for the development-mode plugin.
 * All options have sensible defaults — zero-config works out of the box.
 */
export interface DevPluginOptions {
  /**
   * Port for the HTTP server.
   * @default 3000
   */
  port?: number;

  /**
   * Whether to seed a default admin user for development.
   * Creates `admin@dev.local` / `admin` so devs can skip login.
   * @default true
   */
  seedAdminUser?: boolean;

  /**
   * Auth secret for development sessions.
   * @default 'objectstack-dev-secret-DO-NOT-USE-IN-PRODUCTION!!'
   */
  authSecret?: string;

  /**
   * Auth base URL.
   * @default 'http://localhost:{port}'
   */
  authBaseUrl?: string;

  /**
   * Whether to enable verbose logging.
   * @default true
   */
  verbose?: boolean;

  /**
   * Override which services to enable. By default all core services are enabled.
   * Set a service name to `false` to skip it.
   *
   * Available services: 'objectql', 'driver', 'auth', 'server', 'rest',
   * 'dispatcher', 'security', plus any of the 17 CoreServiceName values
   * (e.g. 'cache', 'queue', 'job', 'ui', 'automation', 'workflow', …).
   */
  services?: Partial<Record<string, boolean>>;

  /**
   * Additional plugins to load alongside the auto-configured ones.
   * Useful for adding custom project plugins while still getting the dev defaults.
   */
  extraPlugins?: Plugin[];

  /**
   * Stack definition to load as a project.
   * When provided, the DevPlugin wraps it in an AppPlugin so that all
   * metadata (objects, views, apps, dashboards, etc.) is registered with
   * the kernel and exposed through the REST/metadata APIs.
   *
   * This is what makes `new DevPlugin({ stack: config })` equivalent to
   * a full `os serve --dev` environment: views can be read, modified, and
   * saved through the API.
   *
   * @example
   * ```ts
   * import config from './objectstack.config';
   * plugins: [new DevPlugin({ stack: config })]
   * ```
   */
  stack?: Record<string, any>;
}

/**
 * Development Mode Plugin for ObjectStack
 *
 * A convenience plugin that auto-configures the **entire** platform stack
 * for local development, simulating **all 17+ kernel services** so developers
 * can work in a full-featured API environment without external dependencies.
 *
 * Instead of manually wiring:
 *
 * ```ts
 * plugins: [
 *   new ObjectQLPlugin(),
 *   new DriverPlugin(new InMemoryDriver()),
 *   new AuthPlugin({ secret: '...', baseUrl: '...' }),
 *   new HonoServerPlugin({ port: 3000 }),
 *   createRestApiPlugin(),
 *   createDispatcherPlugin(),
 *   new SecurityPlugin(),
 *   new AppPlugin(config),
 * ]
 * ```
 *
 * You can simply use:
 *
 * ```ts
 * plugins: [new DevPlugin()]
 * ```
 *
 * ## Core services (real implementations)
 *
 * | Service      | Package                           | Description                               |
 * |--------------|-----------------------------------|-------------------------------------------|
 * | ObjectQL     | `@objectstack/objectql`           | Data engine (query, CRUD, hooks)          |
 * | Driver       | `@objectstack/driver-memory`      | In-memory database (no DB install)        |
 * | Auth         | `@objectstack/plugin-auth`        | Authentication with dev credentials       |
 * | Security     | `@objectstack/plugin-security`    | RBAC, RLS, field-level masking            |
 * | HTTP Server  | `@objectstack/plugin-hono-server` | HTTP server on configured port            |
 * | REST API     | `@objectstack/rest`               | Auto-generated CRUD + metadata endpoints  |
 * | Dispatcher   | `@objectstack/runtime`            | Auth, GraphQL, analytics, packages, etc.  |
 * | App/Metadata | `@objectstack/runtime`            | Project metadata (objects, views, apps)   |
 *
 * ## Stub services (contract-compliant in-memory implementations)
 *
 * Any core service not provided by a real plugin is automatically registered
 * as a contract-compliant dev stub that implements the interface from
 * `packages/spec/src/contracts/`. Each stub returns correct types:
 *
 * `cache` (Map-backed), `queue` (in-memory pub/sub), `job` (no-op scheduler),
 * `file-storage` (Map-backed), `search` (in-memory text search),
 * `automation` (no-op flows), `graphql` (placeholder), `analytics` (empty results),
 * `realtime` (in-memory pub/sub), `notification` (log), `ai` (placeholder),
 * `i18n` (Map-backed translations), `ui` (Map-backed views/dashboards),
 * `workflow` (Map-backed state machine)
 *
 * All services can be individually disabled via `options.services`.
 * Peer packages are loaded via dynamic import and silently skipped if missing.
 */
export class DevPlugin implements Plugin {
  name = 'com.objectstack.plugin.dev';
  type = 'standard';
  version = '1.0.0';

  private options: Required<
    Pick<DevPluginOptions, 'port' | 'seedAdminUser' | 'authSecret' | 'verbose'>
  > & DevPluginOptions;

  private childPlugins: Plugin[] = [];

  constructor(options: DevPluginOptions = {}) {
    this.options = {
      port: 3000,
      seedAdminUser: true,
      authSecret: 'objectstack-dev-secret-DO-NOT-USE-IN-PRODUCTION!!',
      verbose: true,
      ...options,
      authBaseUrl: options.authBaseUrl ?? `http://localhost:${options.port ?? 3000}`,
    };
  }

  /**
   * Init Phase
   *
   * Dynamically imports and instantiates all core plugins.
   * Uses dynamic imports so that peer dependencies remain optional —
   * if a package isn't installed the service is silently skipped.
   */
  async init(ctx: PluginContext): Promise<void> {
    ctx.logger.info('🚀 DevPlugin initializing — auto-configuring all services for development');

    const enabled = (name: string) => this.options.services?.[name] !== false;

    // 1. ObjectQL Engine (data layer + metadata service)
    if (enabled('objectql')) {
      try {
        const { ObjectQLPlugin } = await import('@objectstack/objectql');
        const qlPlugin = new ObjectQLPlugin();
        this.childPlugins.push(qlPlugin);
        ctx.logger.info('  ✔ ObjectQL engine enabled (data + metadata)');
      } catch {
        ctx.logger.warn('  ✘ @objectstack/objectql not installed — skipping data engine');
      }
    }

    // 2. In-Memory Driver
    if (enabled('driver')) {
      try {
        const { DriverPlugin } = await import('@objectstack/runtime') as any;
        const { InMemoryDriver } = await import('@objectstack/driver-memory') as any;
        const driver = new InMemoryDriver();
        const driverPlugin = new DriverPlugin(driver, 'memory');
        this.childPlugins.push(driverPlugin);
        ctx.logger.info('  ✔ InMemoryDriver enabled');
      } catch {
        ctx.logger.warn('  ✘ @objectstack/runtime or @objectstack/driver-memory not installed — skipping driver');
      }
    }

    // 3. App Plugin — registers project metadata (objects, views, apps, dashboards, etc.)
    //    This is the key piece that enables full API development:
    //    once metadata is registered, REST endpoints can read/write views, etc.
    if (this.options.stack) {
      try {
        const { AppPlugin } = await import('@objectstack/runtime') as any;
        const appPlugin = new AppPlugin(this.options.stack);
        this.childPlugins.push(appPlugin);
        ctx.logger.info('  ✔ App metadata loaded from stack definition');
      } catch {
        ctx.logger.warn('  ✘ @objectstack/runtime not installed — skipping app metadata');
      }
    }

    // 3b. I18n Plugin — auto-detect translations in stack definition
    //     When the stack contains i18n/translations config, try to use
    //     I18nServicePlugin (from @objectstack/service-i18n) for full-featured
    //     file-based i18n. Falls back to the core in-memory i18n fallback
    //     (with locale resolution) if the package is not installed.
    if (enabled('i18n') && this.options.stack) {
      const stack = this.options.stack;
      const hasTranslations = Array.isArray(stack.translations) && stack.translations.length > 0;
      const hasI18nConfig = !!(stack.i18n || (stack.manifest && stack.manifest.i18n));
      const hasManifestTranslations = !!(stack.manifest && Array.isArray(stack.manifest.translations) && stack.manifest.translations.length > 0);

      if (hasTranslations || hasI18nConfig || hasManifestTranslations) {
        try {
          const { I18nServicePlugin } = await import('@objectstack/service-i18n') as any;
          const i18nConfig = stack.i18n || (stack.manifest || stack)?.i18n || {};
          const i18nPlugin = new I18nServicePlugin({
            defaultLocale: i18nConfig.defaultLocale,
            fallbackLocale: i18nConfig.fallbackLocale || i18nConfig.defaultLocale || 'en',
          });
          this.childPlugins.push(i18nPlugin);
          ctx.logger.info('  ✔ I18nServicePlugin auto-registered (translations detected in stack)');
        } catch {
          ctx.logger.info(
            '  ℹ @objectstack/service-i18n not installed — using core in-memory i18n fallback with locale resolution'
          );
        }
      }
    }

    // 3c. Setup App registration is now handled inside plugin-auth (it
    //     registers the static SETUP_APP from @objectstack/platform-objects/apps
    //     as part of its manifest), so no separate child plugin is needed.

    // 4. Auth Plugin
    if (enabled('auth')) {
      try {
        const { AuthPlugin } = await import('@objectstack/plugin-auth') as any;
        const authPlugin = new AuthPlugin({
          secret: this.options.authSecret,
          baseUrl: this.options.authBaseUrl,
        });
        this.childPlugins.push(authPlugin);
        ctx.logger.info('  ✔ Auth plugin enabled (dev credentials)');
      } catch {
        ctx.logger.warn('  ✘ @objectstack/plugin-auth not installed — skipping auth');
      }
    }

    // 5. Security Plugin (RBAC, RLS, field-level masking)
    // OrgScopingPlugin (when multi-tenant) MUST register BEFORE SecurityPlugin
    // because SecurityPlugin.start() probes the `org-scoping` service and
    // caches the result for the lifetime of the plugin.
    if (enabled('security')) {
      const multiTenant = String(readEnvWithDeprecation('OS_MULTI_ORG_ENABLED', 'OS_MULTI_TENANT') ?? 'false').toLowerCase() !== 'false';
      if (multiTenant) {
        try {
          const { OrgScopingPlugin } = await import('@objectstack/plugin-org-scoping') as any;
          this.childPlugins.push(new OrgScopingPlugin());
          ctx.logger.info('  ✔ Org-scoping plugin enabled (multi-tenant: organization_id auto-stamp, per-org seed)');
        } catch {
          ctx.logger.warn('  ✘ OS_MULTI_TENANT=true but @objectstack/plugin-org-scoping not installed');
        }
      }
      try {
        const { SecurityPlugin } = await import('@objectstack/plugin-security') as any;
        this.childPlugins.push(new SecurityPlugin());
        ctx.logger.info(`  ✔ Security plugin enabled (RBAC, RLS, field masking; multiTenant=${multiTenant})`);
      } catch {
        ctx.logger.debug('  ℹ @objectstack/plugin-security not installed — skipping security');
      }
    }

    // 6. Hono HTTP Server
    if (enabled('server')) {
      try {
        const { HonoServerPlugin } = await import('@objectstack/plugin-hono-server') as any;
        const serverPlugin = new HonoServerPlugin({
          port: this.options.port,
        });
        this.childPlugins.push(serverPlugin);
        ctx.logger.info(`  ✔ Hono HTTP server enabled on port ${this.options.port}`);
      } catch {
        ctx.logger.warn('  ✘ @objectstack/plugin-hono-server not installed — skipping HTTP server');
      }
    }

    // 7. REST API endpoints (CRUD + metadata read/write)
    if (enabled('rest')) {
      try {
        const { createRestApiPlugin } = await import('@objectstack/rest') as any;
        const restPlugin = createRestApiPlugin();
        this.childPlugins.push(restPlugin);
        ctx.logger.info('  ✔ REST API endpoints enabled (CRUD + metadata)');
      } catch {
        ctx.logger.debug('  ℹ @objectstack/rest not installed — skipping REST endpoints');
      }
    }

    // 8. Dispatcher (auth routes, GraphQL, analytics, packages, storage, automation)
    if (enabled('dispatcher')) {
      try {
        const { createDispatcherPlugin } = await import('@objectstack/runtime') as any;
        const dispatcherPlugin = createDispatcherPlugin();
        this.childPlugins.push(dispatcherPlugin);
        ctx.logger.info('  ✔ Dispatcher enabled (auth, GraphQL, analytics, packages, storage)');
      } catch {
        ctx.logger.debug('  ℹ Dispatcher not available — skipping extended API routes');
      }
    }

    // Extra user-provided plugins
    if (this.options.extraPlugins) {
      this.childPlugins.push(...this.options.extraPlugins);
    }

    // Init all child plugins
    for (const plugin of this.childPlugins) {
      try {
        await plugin.init(ctx);
      } catch (err: any) {
        ctx.logger.error(`Failed to init child plugin ${plugin.name}: ${err.message}`);
      }
    }

    // ── Register contract-compliant dev stubs for remaining services ────
    // The kernel defines 17 core services + 3 security services.
    // Real plugins (ObjectQL, Auth, Security, etc.) already registered some.
    // For any service NOT yet registered, we create a contract-compliant
    // dev stub (implementing the interface from packages/spec/src/contracts/)
    // so that the full kernel service map is populated and downstream code
    // receives correct return types (arrays, booleans, objects — not undefined).

    const stubNames: string[] = [];

    for (const svc of CORE_SERVICE_NAMES) {
      if (!enabled(svc)) continue;
      try {
        ctx.getService(svc);
        // Already registered by a real plugin — skip
      } catch {
        const factory = DEV_STUB_FACTORIES[svc];
        ctx.registerService(svc, factory ? factory() : { _dev: true, _serviceName: svc });
        stubNames.push(svc);
      }
    }

    // Security sub-services (if SecurityPlugin wasn't loaded)
    if (enabled('security')) {
      for (const svc of SECURITY_SERVICE_NAMES) {
        try {
          ctx.getService(svc);
        } catch {
          const factory = DEV_STUB_FACTORIES[svc];
          ctx.registerService(svc, factory ? factory() : { _dev: true, _serviceName: svc });
          stubNames.push(svc);
        }
      }
    }

    if (stubNames.length > 0) {
      ctx.logger.info(`  ✔ Contract-compliant dev stubs registered for: ${stubNames.join(', ')}`);
    }

    ctx.logger.info(`DevPlugin initialized ${this.childPlugins.length} plugin(s) + ${stubNames.length} dev stub(s)`);
  }

  /**
   * Start Phase
   *
   * Starts all child plugins and optionally seeds the dev admin user.
   */
  async start(ctx: PluginContext): Promise<void> {
    // Start all child plugins
    for (const plugin of this.childPlugins) {
      if (plugin.start) {
        try {
          await plugin.start(ctx);
        } catch (err: any) {
          ctx.logger.error(`Failed to start child plugin ${plugin.name}: ${err.message}`);
        }
      }
    }

    // Dev admin seeding is now centralised in the runtime
    // (@objectstack/plugin-auth → maybeSeedDevAdmin), which provisions a
    // REAL, loginable platform admin via better-auth's signUpEmail pipeline.
    // The previous raw `sys_user` insert here produced a credential-less,
    // un-loginable row and has been removed. We only translate this plugin's
    // `seedAdminUser` option into the OS_SEED_ADMIN toggle the runtime reads,
    // without clobbering an explicit env value the operator already set.
    if (process.env.OS_SEED_ADMIN == null) {
      process.env.OS_SEED_ADMIN = this.options.seedAdminUser ? '1' : '0';
    }

    ctx.logger.info('─────────────────────────────────────────');
    ctx.logger.info('🟢 ObjectStack Dev Server ready');
    ctx.logger.info(`   http://localhost:${this.options.port}`);
    ctx.logger.info('');
    ctx.logger.info('   API:       /api/v1/data/:object');
    ctx.logger.info('   Metadata:  /api/v1/meta/:type/:name');
    ctx.logger.info('   Discovery: /.well-known/objectstack');
    ctx.logger.info('─────────────────────────────────────────');
  }

  /**
   * Destroy Phase
   *
   * Cleans up all child plugins in reverse order.
   */
  async destroy(): Promise<void> {
    for (const plugin of [...this.childPlugins].reverse()) {
      if (plugin.destroy) {
        try {
          await plugin.destroy();
        } catch {
          // Ignore cleanup errors during dev shutdown
        }
      }
    }
  }

}
