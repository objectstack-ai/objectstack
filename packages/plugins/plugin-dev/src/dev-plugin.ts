// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import { resolveAllowDevPlugin, resolveTenancyPosture } from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';

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
   * Override which parts of the assembly to enable. By default everything
   * this plugin can wire is enabled. Set a name to `false` to skip it.
   *
   * Available toggles: 'objectql', 'driver', 'auth', 'server', 'rest',
   * 'dispatcher', 'security', 'i18n', 'file-storage', 'realtime'.
   *
   * Toggles for the retired dev stubs (ADR-0115 — 'cache', 'queue', 'ai',
   * 'automation', …) are accepted and ignored: those slots are no longer
   * filled by this plugin at all.
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
 * Escape hatch for {@link assertNotProduction} — deliberately ungrouped and
 * scary-looking per the `OS_ALLOW_{X}` convention (AGENTS.md Prime Directive #9).
 * Parsed by `resolveAllowDevPlugin()` so it shares the family's truthy
 * vocabulary (`1`/`true`/`on`/`yes`) rather than its own strict `=== '1'`.
 */
const ALLOW_IN_PRODUCTION_ENV = 'OS_ALLOW_DEV_PLUGIN' as const;

/**
 * The default dev auth secret.
 *
 * Named rather than inlined at its one use site because the production-override
 * branding has to be able to say whether the operator is still running on it
 * (#3900): a constant shipped inside a public npm package is not a secret, and
 * anyone holding it can mint a session this stack will accept.
 */
const DEV_AUTH_SECRET = 'objectstack-dev-secret-DO-NOT-USE-IN-PRODUCTION!!';

/**
 * [ADR-0115 D6] Refuse to initialize under `NODE_ENV=production`.
 *
 * The stack this plugin assembles is built around a well-known default auth
 * secret and a seeded dev admin; nothing about it belongs in production, and
 * failing the boot beats degrading quietly — a production process that reaches
 * this line is misconfigured in a way no runtime behaviour can make safe.
 * The escape hatch covers the deliberate cases (a staging box mimicking prod,
 * a smoke test that pins `NODE_ENV`), and says at the call site that someone
 * chose this.
 *
 * The throw is not swallowed on any real boot path: `kernel.use()` only
 * registers, `initPluginWithTimeout` does not catch, and `bootstrap()` rethrows
 * — so `os serve`'s outer handler prints the message and exits 1. (That is why
 * this can stay a `throw` where `OS_ALLOW_DEGRADED_TENANCY` needed
 * `process.exit(1)`: that guard sits inside serve's broad AuthPlugin `catch`,
 * this one does not.)
 *
 * @returns `true` when the guard WOULD have refused and the escape hatch
 *   overrode it. Callers MUST brand that state rather than merely proceed —
 *   see {@link productionOverrideWarnings}.
 */
function assertNotProduction(): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  if (resolveAllowDevPlugin()) return true;
  throw new Error(
    '@objectstack/plugin-dev refuses to initialize with NODE_ENV=production. '
    + 'It assembles a development stack around a well-known default auth secret and a seeded '
    + 'dev admin, so a production process must not load it. Remove DevPlugin from this '
    + `deployment's plugin list, or set ${ALLOW_IN_PRODUCTION_ENV}=1 if you deliberately want `
    + 'the dev assembly under a production NODE_ENV.',
  );
}

/**
 * Boot-log branding for an overridden production guard (#3900).
 *
 * An escape hatch that returns silently re-creates, one level up, the exact
 * failure the guard exists to prevent: the process runs the development
 * assembly while every log line and banner reads like an ordinary production
 * start, so the one fact an operator needs is the one fact nothing says.
 * `OS_ALLOW_DEGRADED_TENANCY` (`cli/src/commands/serve.ts`) sets the shape this
 * follows — boot when explicitly told to, then brand the degraded state
 * everywhere an operator looks.
 *
 * Only hazards that are actually live get named. The dev-admin seed is
 * deliberately NOT among them: `plugin-auth`'s `maybeSeedDevAdmin` is
 * hard-gated to `NODE_ENV === 'development'`, so it cannot fire on this path,
 * and warning about it would spend the operator's attention on a non-event.
 */
function productionOverrideWarnings(
  opts: { defaultSecret: boolean; driverEnabled: boolean },
): string[] {
  const lines = [
    `  ⚠ DEV ASSEMBLY UNDER NODE_ENV=production (${ALLOW_IN_PRODUCTION_ENV} is set) — the boot `
    + 'guard was explicitly overridden. This process is running the DEVELOPMENT assembly, which '
    + 'is not hardened for production traffic (ADR-0115 D6).',
  ];
  if (opts.defaultSecret) {
    lines.push(
      '    • Auth secret is the default published inside @objectstack/plugin-dev. It is public, so '
      + 'anyone can mint a session this stack accepts. Pass `authSecret` explicitly.',
    );
  }
  if (opts.driverEnabled) {
    lines.push(
      '    • Data goes to the in-memory driver with persistence disabled — every record is lost '
      + 'when this process exits.',
    );
  }
  return lines;
}

/**
 * Development Assembly Plugin for ObjectStack
 *
 * One plugin that wires the **real** platform stack for local development.
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
 * ## What it assembles (all real implementations)
 *
 * | Service      | Package                           | Description                               |
 * |--------------|-----------------------------------|-------------------------------------------|
 * | ObjectQL     | `@objectstack/objectql`           | Data engine (query, CRUD, hooks)          |
 * | Driver       | `@objectstack/driver-memory`      | In-memory database (no DB install)        |
 * | Auth         | `@objectstack/plugin-auth`        | Authentication with dev credentials       |
 * | Security     | `@objectstack/plugin-security`    | RBAC, RLS, field-level masking            |
 * | HTTP Server  | `@objectstack/plugin-hono-server` | HTTP server on configured port            |
 * | REST API     | `@objectstack/rest`               | Auto-generated CRUD + metadata endpoints  |
 * | Dispatcher   | `@objectstack/runtime`            | Auth, GraphQL, packages, storage, etc.    |
 * | App/Metadata | `@objectstack/runtime`            | Project metadata (objects, views, apps)   |
 * | Storage      | `@objectstack/service-storage`    | file-storage service (local-disk adapter) |
 * | Realtime     | `@objectstack/service-realtime`   | realtime service (in-memory adapter)      |
 * | I18n         | `@objectstack/service-i18n`       | When the stack declares translations      |
 *
 * Every part is loaded via dynamic import and skipped (with a log line) when
 * its package is not installed, and can be disabled via `options.services`.
 *
 * ## Empty slots stay empty (ADR-0115)
 *
 * This plugin registers **no service implementations of its own**. A
 * capability whose plugin is not installed is absent, exactly as in
 * production: its routes answer 404/501 and discovery reports it
 * `unavailable`. The retired stub table used to fill every empty slot with a
 * fabricated implementation — allow-all security answers, success reports
 * for work that never ran — which made "the capability is present" mean
 * different things in dev and production, and twice shipped answers a
 * consumer trusted (ADR-0076 D12). To use a capability locally, install its
 * real service (e.g. `@objectstack/service-analytics` for `/analytics` — it
 * runs an InMemory strategy).
 *
 * ## Production guard (ADR-0115 D6)
 *
 * `init()` refuses to run when `NODE_ENV === 'production'`: the assembly is
 * built around a well-known default auth secret and a seeded dev admin.
 * Escape hatch for the rare deliberate case: `OS_ALLOW_DEV_PLUGIN=1`.
 *
 * Taking the escape hatch is never silent (#3900). The boot log names the
 * live hazards — a published default auth secret, an in-memory driver with
 * persistence off — and the ready banner repeats the brand, so a process
 * running the dev assembly under a production `NODE_ENV` cannot look like an
 * ordinary production start.
 */
export class DevPlugin implements Plugin {
  name = 'com.objectstack.plugin.dev';
  type = 'standard';
  version = '1.0.0';

  private options: Required<
    Pick<DevPluginOptions, 'port' | 'seedAdminUser' | 'authSecret' | 'verbose'>
  > & DevPluginOptions;

  private childPlugins: Plugin[] = [];

  /**
   * Set when {@link assertNotProduction} was overridden by
   * `OS_ALLOW_DEV_PLUGIN`. Carried from `init()` to `start()` so the ready
   * banner carries the same brand as the boot log (#3900).
   */
  private productionOverride = false;

  constructor(options: DevPluginOptions = {}) {
    this.options = {
      port: 3000,
      seedAdminUser: true,
      authSecret: DEV_AUTH_SECRET,
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
    this.productionOverride = assertNotProduction();

    const enabled = (name: string) => this.options.services?.[name] !== false;

    // Brand the override BEFORE any assembly work, so the warning survives an
    // assembly step that later throws — a boot that died under an overridden
    // guard is exactly when the operator most needs to know the guard was off.
    if (this.productionOverride) {
      for (const line of productionOverrideWarnings({
        defaultSecret: this.options.authSecret === DEV_AUTH_SECRET,
        driverEnabled: enabled('driver'),
      })) {
        ctx.logger.warn(line);
      }
    }

    ctx.logger.info('🚀 DevPlugin initializing — assembling the development stack');

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
        // Ephemeral, like every other service this plugin stubs (cache, queue,
        // job, i18n, storage, search are all in-memory). Stated explicitly
        // rather than inherited: the driver used to default to writing
        // `.objectstack/data/memory-driver.json` into the CWD, which made this
        // stack the one piece of DevPlugin that quietly outlived the process.
        const driver = new InMemoryDriver({ persistence: false });
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

    // 3d. Optional capability services (ADR-0115 D4) — the slots the retired
    //     dev stubs used to fake are filled by the REAL service packages when
    //     they are installed, following the same auto-detect pattern as 3b:
    //     `service-storage` registers `file-storage` (local-disk adapter, real
    //     files under ./storage), `service-realtime` registers `realtime`
    //     (its default in-memory adapter). Not installed → the slot stays
    //     empty, exactly as in production.
    if (enabled('file-storage')) {
      try {
        const { StorageServicePlugin } = await import('@objectstack/service-storage') as any;
        this.childPlugins.push(new StorageServicePlugin());
        ctx.logger.info('  ✔ Storage service enabled (@objectstack/service-storage, local adapter)');
      } catch {
        ctx.logger.info('  ℹ @objectstack/service-storage not installed — the file-storage slot stays empty');
      }
    }
    if (enabled('realtime')) {
      try {
        const { RealtimeServicePlugin } = await import('@objectstack/service-realtime') as any;
        this.childPlugins.push(new RealtimeServicePlugin());
        ctx.logger.info('  ✔ Realtime service enabled (@objectstack/service-realtime, in-memory adapter)');
      } catch {
        ctx.logger.info('  ℹ @objectstack/service-realtime not installed — the realtime slot stays empty');
      }
    }

    // 4. Auth Plugin
    let authMounted = false;
    if (enabled('auth')) {
      try {
        const { AuthPlugin } = await import('@objectstack/plugin-auth') as any;
        // [ADR-0108 / #3723] Nothing to wire: the organization-role vocabulary
        // is closed, so DevPlugin's "equivalent to the full stack" claim holds
        // with no parameter to remember. A stack's `position` / `permission`
        // names are positions, not org roles.
        const authPlugin = new AuthPlugin({
          secret: this.options.authSecret,
          baseUrl: this.options.authBaseUrl,
        });
        this.childPlugins.push(authPlugin);
        authMounted = true;
        ctx.logger.info('  ✔ Auth plugin enabled (dev credentials)');
      } catch {
        ctx.logger.warn('  ✘ @objectstack/plugin-auth not installed — skipping auth');
      }

      // ADR-0048 — the platform apps (Setup/Account) moved out of
      // plugin-auth's manifest into their own one-app packages. Register each
      // after AuthPlugin so they load alongside the auth objects they navigate.
      // NOTE: @objectstack/studio is intentionally NOT default-loaded — the
      // console ships a dedicated Studio surface at /_console/studio/<pkg>/<pillar>,
      // so Studio no longer needs to exist as a navigable app tile.
      for (const spec of [
        ['@objectstack/setup', 'createSetupAppPlugin'],
        ['@objectstack/account', 'createAccountAppPlugin'],
      ] as const) {
        try {
          const mod: any = await import(/* @vite-ignore */ spec[0]);
          this.childPlugins.push(mod[spec[1]]());
          ctx.logger.info(`  ✔ App package enabled (${spec[0]})`);
        } catch {
          ctx.logger.warn(`  ✘ ${spec[0]} not installed — skipping its app`);
        }
      }
    }

    // 5. Security Plugin (RBAC, RLS, field-level masking)
    // OrganizationsPlugin (when multi-org; ENTERPRISE `@objectstack/organizations`,
    // ADR-0081 D2) MUST register BEFORE SecurityPlugin because
    // SecurityPlugin.start() probes the `org-scoping` service (the historical
    // name the enterprise plugin keeps registering) and caches the result for
    // the lifetime of the plugin.
    if (enabled('security')) {
      // [ADR-0105 D1 / #5262] Key off the resolved POSTURE, exactly as
      // `serve.ts` does — ⛔ never `resolveMultiOrgEnabled()`. That boolean was
      // DEMOTED to a back-compat input of `resolveTenancyPosture()`, so a dev
      // stack configured the documented way (`OS_TENANCY_POSTURE=isolated|group`,
      // legacy boolean unset) read `false` here and never loaded the enterprise
      // runtime at all — SecurityPlugin then probed an absent `org-scoping`,
      // stripped the wildcard `tenant_isolation` RLS, and the stack served
      // traffic in the ADR-0093 D5 degraded state while the `tenancy` service
      // reported the wall as requested. Both walled postures need this package:
      // gating on the legacy boolean also let `OS_TENANCY_POSTURE=group` skip it.
      //
      // REQUESTED posture is the only coherent judge here — this branch is what
      // MOUNTS the wall, so asking "is the wall up?" would be circular.
      const tenancyPosture = resolveTenancyPosture();
      const multiTenant = postureEnforcesWall(tenancyPosture);
      if (multiTenant) {
        try {
          const organizationsPkg = '@objectstack/organizations';
          const mod: any = await import(/* webpackIgnore: true */ organizationsPkg);
          this.childPlugins.push(new mod.OrganizationsPlugin());
          ctx.logger.info(`  ✔ Organizations plugin enabled (posture '${tenancyPosture}': organization_id auto-stamp, per-org seed)`);
        } catch {
          // Names the posture that was actually requested, not one knob's
          // spelling of it: the old text asserted `OS_MULTI_ORG_ENABLED=true`
          // at an operator who may well have set only `OS_TENANCY_POSTURE`.
          ctx.logger.warn(`  ✘ tenancy posture '${tenancyPosture}' requested but @objectstack/organizations (enterprise) not installed — running single-org, organization wall INACTIVE (ADR-0093 D5)`);
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
        // [#3963] The auth-less fail-open carve-out is gone. It used to pass an
        // EXPLICIT `requireAuth: false` when no auth was mounted, on the grounds
        // that nobody could authenticate so the deny default would brick the
        // playground's data API. That reasoning inverts the right conclusion: a
        // stack with no auth has no security model, so it should not serve a data
        // API at all — and leaving the back door here would have made the dev
        // plugin the one surface that still opens the whole data plane.
        if (!authMounted) {
          throw new Error(
            '[dev] Cannot enable the data API: no auth is mounted in this stack, so no caller could '
            + 'ever authenticate and anonymous access to object data is always denied (#3963). '
            + 'Install/enable plugin-auth (or the `auth` tier), or drop the REST API from this dev stack.',
          );
        }
        this.childPlugins.push(createRestApiPlugin());
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

    // ── No stub registration (ADR-0115 D1) ──────────────────────────────
    // The stub table that used to fill every remaining slot is retired. A
    // slot no child plugin filled stays EMPTY — the honest production
    // semantic: routes answer 404/501, discovery reports `unavailable`, and
    // in-process consumers handle absence exactly as they already must in
    // production. To use a capability locally, install its real service.

    // The security slots deserve one loud line when empty (#4126): faking an
    // authorization decision is the one thing ADR-0076 D12 forbids a fallback
    // to do, so the slots stay empty rather than stubbed — but "no RBAC/RLS/
    // masking is being enforced" is worth saying in the boot log of a stack
    // that expected them.
    if (enabled('security')) {
      const missing = ['security.permissions', 'security.rls', 'security.fieldMasker'].filter((svc) => {
        try { ctx.getService(svc); return false; } catch { return true; }
      });
      if (missing.length > 0) {
        ctx.logger.warn(
          `  ⚠ No security services (${missing.join(', ')}) — SecurityPlugin is not loaded, so RBAC, `
          + 'row-level security and field masking are NOT enforced. The slots stay empty rather than '
          + 'being stubbed: a fake that answers "allowed" is worse than an absent one. Install '
          + '@objectstack/plugin-security to enforce them.',
        );
      }
    }

    ctx.logger.info(`DevPlugin initialized ${this.childPlugins.length} plugin(s)`);
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
    // The banner is the one surface an operator reliably reads, so the
    // overridden guard is branded here too and not only in the init log it
    // scrolled past ten seconds ago (#3900).
    if (this.productionOverride) {
      ctx.logger.warn(
        `   ⚠ DEV ASSEMBLY under NODE_ENV=production (${ALLOW_IN_PRODUCTION_ENV} is set) — `
        + 'this is NOT a production stack',
      );
    }
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
