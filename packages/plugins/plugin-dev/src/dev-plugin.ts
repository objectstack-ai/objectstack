// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import { resolveAllowDegradedTenancy, resolveAllowDevPlugin, resolveTenancyPosture } from '@objectstack/types';
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
   * 'dispatcher', 'security', 'i18n', 'storage', 'realtime'. The storage
   * toggle also accepts its deprecated v17 alias spelling 'file-storage'
   * (#9683) — setting either to `false` skips the storage service.
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
 * The two codes Node's module system raises when a specifier cannot be
 * RESOLVED — the only signal this file uses to tell "the package is not
 * installed" apart from "the package is installed and something in it threw"
 * (#7926).
 *
 * Both spellings are live because this package ships both module formats:
 * the ESM build's `await import()` reaches the ESM loader, which raises
 * `ERR_MODULE_NOT_FOUND`; the CJS build resolves the same call through
 * `require()`, which raises `MODULE_NOT_FOUND`. Measured on node v22.22, both
 * paths, rather than assumed.
 *
 * ⛔ Never classify on the message text instead. A message match is a guess
 * about wording Node is free to change — the class of guess this repo removed
 * from the query normalizer (#4181 / #4121).
 *
 * This is NOT in tension with the "which stage threw" classifier the
 * organizations block below uses, and it is not a competing convention: both
 * refuse to read a *plugin's* private refusal semantics. `ERR_MODULE_NOT_FOUND`
 * is the module system's own verdict about resolution, which is precisely the
 * fact being classified here; the organizations block classifies a *plugin's*
 * refusal, about which the framework knows — and must know — nothing.
 *
 * One honest limit: a package that resolves but whose own dependency does not
 * raises the same code, so the absent arm can fire for a package that is itself
 * installed. That is why both arms print the resolver's own message — it names
 * the specifier that actually failed, so "install X" stays actionable.
 *
 * The code is read through {@link errorChain}, because the failure does not
 * always arrive bare.
 */
const MODULE_NOT_FOUND_CODES: readonly string[] = ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'];

/**
 * The error and everything it was wrapped around, outermost first.
 *
 * Loader failures do not always arrive bare: a host that transforms modules can
 * hand back its own `Error` with the real one on `cause`. Measured, not
 * supposed — `@vitest/mocker`'s `createHelpfulError` does exactly this to any
 * throw from a `vi.mock` factory, which is how this repo's own tests simulate an
 * absent package (`dev-plugin.test.ts`). Reading only the outer error there
 * would classify every simulated-absent package as present-but-failed.
 *
 * Bounded, and cycle-safe: an error chain is untrusted input.
 */
function errorChain(err: unknown, maxDepth = 5): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = err;
  while (current != null && chain.length < maxDepth) {
    if (chain.includes(current)) break;
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/**
 * Whether `err` is the module system reporting that a specifier did not resolve.
 *
 * The OUTERMOST error that carries a `code` decides: a coded error is
 * authoritative about itself, and an uncoded wrapper is transparent. So a
 * constructor's own typed refusal is never re-read as a resolution failure just
 * because something further down the chain happens to be one.
 */
function isModuleNotFound(err: unknown): boolean {
  for (const link of errorChain(err)) {
    const code = (link as { code?: unknown } | null | undefined)?.code;
    if (typeof code === 'string') return MODULE_NOT_FOUND_CODES.includes(code);
  }
  return false;
}

/**
 * The evidence a failed optional load carried, rendered for a log line.
 *
 * Printed by BOTH arms, whole chain included. The defect this replaces (#7926)
 * was a bare `catch` that discarded the one thing capable of naming the real
 * cause: `driver-memory` refused to construct under a multi-tenant posture with
 * a message that named the posture, both env knobs and the remedy, and an
 * operator saw none of it.
 */
function loadFailureDetail(err: unknown): string {
  return errorChain(err)
    .map((link) => {
      const message = link instanceof Error ? link.message : String(link);
      const code = (link as { code?: unknown } | null | undefined)?.code;
      return code === undefined ? message : `code: ${String(code)} — ${message}`;
    })
    .join(' ← caused by: ');
}

/** One optional-service load, as its `catch` needs to describe it. */
interface OptionalLoadSpec {
  /** Every package the `try` block imports — named in the "IS installed" arm. */
  packages: readonly string[];
  /**
   * Today's absent-case line, verbatim: same wording, same advice. An absent
   * optional package is a normal dev-stack state and its diagnosis was already
   * right, so nothing about it changes except that the resolver's own message
   * now rides along.
   */
  absent: string;
  /** Level for the absent case — per slot, since "absent" is normal noise. */
  absentLevel: 'warn' | 'info' | 'debug';
  /** What the stack does without this service, e.g. `'skipping driver'`. */
  outcome: string;
}

/**
 * Report a failed optional-service load, telling ABSENT apart from
 * PRESENT-BUT-FAILED (#7926).
 *
 * Every optional load in `init()` used to end in a bare `catch {}` whose single
 * act was to warn that the package was "not installed". So a package that IS
 * installed and threw while loading or constructing — bad config, a missing
 * peer, a deliberate refusal, a genuine bug — was reported as an absent one,
 * and the operator went off to install something they already had. Worse, the
 * refusal's own message was destroyed on the way: a well-written diagnosis
 * replaced by a false one.
 *
 * The failed arm logs at `error` regardless of the slot's absent level: an
 * absent optional package is ordinary, a present one that threw is a defect in
 * *this* deployment and must not inherit the quiet level that "absent is fine"
 * earned. Same level, and same "verbatim — the framework does not interpret it"
 * discipline, as the child-`init()` failure loop below.
 *
 * What this deliberately does NOT decide: whether DevPlugin should refuse to
 * start when a driver refuses. That is a product-shape question (#7926 scope),
 * so both arms keep today's behaviour — log, skip the slot, boot on.
 */
function reportOptionalLoadFailure(ctx: PluginContext, err: unknown, spec: OptionalLoadSpec): void {
  if (isModuleNotFound(err)) {
    ctx.logger[spec.absentLevel](`${spec.absent} (${loadFailureDetail(err)})`);
    return;
  }
  ctx.logger.error(
    `  ✘ ${spec.packages.join(', ')} ${spec.packages.length > 1 ? 'ARE' : 'IS'} installed but failed `
    + `to initialize — ${spec.outcome}. This is NOT a missing-package problem: the package resolved `
    + 'here, so installing it again will not help. It reported (verbatim — the framework does not '
    + `interpret it): ${loadFailureDetail(err)}`,
  );
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
 * | Storage      | `@objectstack/service-storage`    | storage service (local-disk adapter) |
 * | Realtime     | `@objectstack/service-realtime`   | realtime service (in-memory adapter)      |
 * | I18n         | `@objectstack/service-i18n`       | When the stack declares translations      |
 *
 * Every part is loaded via dynamic import and skipped (with a log line) when
 * its package is not installed, and can be disabled via `options.services`.
 *
 * A load that fails for any OTHER reason — the package is installed and threw
 * while loading or constructing — is reported as its own outcome, at `error`,
 * carrying the underlying `code` and `message` (#7926). Both facts used to
 * arrive as the same "not installed" line, which sent operators to install a
 * package they already had.
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
   * if a package isn't installed the service is skipped with a log line
   * naming it. A package that IS installed and fails to load or construct is
   * a different outcome with a different message (#7926); see
   * {@link reportOptionalLoadFailure}.
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
      } catch (err) {
        reportOptionalLoadFailure(ctx, err, {
          packages: ['@objectstack/objectql'],
          absent: '  ✘ @objectstack/objectql not installed — skipping data engine',
          absentLevel: 'warn',
          outcome: 'skipping data engine',
        });
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
      } catch (err) {
        // [#7926] The measured instance of this defect: `InMemoryDriver`'s
        // constructor refuses a non-`single` tenancy posture (#6915) with a
        // message naming the posture, both env knobs and the `driver-sql`
        // remedy — all of which this catch used to replace with "not installed".
        reportOptionalLoadFailure(ctx, err, {
          packages: ['@objectstack/runtime', '@objectstack/driver-memory'],
          absent: '  ✘ @objectstack/runtime or @objectstack/driver-memory not installed — skipping driver',
          absentLevel: 'warn',
          outcome: 'skipping driver',
        });
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
      } catch (err) {
        // `new AppPlugin(stack)` parses the stack definition, so a malformed
        // stack throws HERE — a construction failure with a real diagnosis,
        // previously reported as an absent @objectstack/runtime.
        reportOptionalLoadFailure(ctx, err, {
          packages: ['@objectstack/runtime'],
          absent: '  ✘ @objectstack/runtime not installed — skipping app metadata',
          absentLevel: 'warn',
          outcome: 'skipping app metadata',
        });
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
        } catch (err) {
          reportOptionalLoadFailure(ctx, err, {
            packages: ['@objectstack/service-i18n'],
            absent: '  ℹ @objectstack/service-i18n not installed — using core in-memory i18n fallback with locale resolution',
            absentLevel: 'info',
            outcome: 'falling back to the core in-memory i18n fallback with locale resolution',
          });
        }
      }
    }

    // 3c. Setup App registration is now handled inside plugin-auth (it
    //     registers the static SETUP_APP from @objectstack/platform-objects/apps
    //     as part of its manifest), so no separate child plugin is needed.

    // 3d. Optional capability services (ADR-0115 D4) — the slots the retired
    //     dev stubs used to fake are filled by the REAL service packages when
    //     they are installed, following the same auto-detect pattern as 3b:
    //     `service-storage` registers `storage` (canonical since #9683) plus
    //     its deprecated `file-storage` alias (local-disk adapter, real
    //     files under ./storage), `service-realtime` registers `realtime`
    //     (its default in-memory adapter). Not installed → the slot stays
    //     empty, exactly as in production. Either toggle spelling skips it.
    if (enabled('storage') && enabled('file-storage')) {
      try {
        const { StorageServicePlugin } = await import('@objectstack/service-storage') as any;
        this.childPlugins.push(new StorageServicePlugin());
        ctx.logger.info('  ✔ Storage service enabled (@objectstack/service-storage, local adapter)');
      } catch (err) {
        reportOptionalLoadFailure(ctx, err, {
          packages: ['@objectstack/service-storage'],
          absent: '  ℹ @objectstack/service-storage not installed — the storage slot stays empty',
          absentLevel: 'info',
          outcome: 'the storage slot stays empty',
        });
      }
    }
    if (enabled('realtime')) {
      try {
        const { RealtimeServicePlugin } = await import('@objectstack/service-realtime') as any;
        this.childPlugins.push(new RealtimeServicePlugin());
        ctx.logger.info('  ✔ Realtime service enabled (@objectstack/service-realtime, in-memory adapter)');
      } catch (err) {
        reportOptionalLoadFailure(ctx, err, {
          packages: ['@objectstack/service-realtime'],
          absent: '  ℹ @objectstack/service-realtime not installed — the realtime slot stays empty',
          absentLevel: 'info',
          outcome: 'the realtime slot stays empty',
        });
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
      } catch (err) {
        reportOptionalLoadFailure(ctx, err, {
          packages: ['@objectstack/plugin-auth'],
          absent: '  ✘ @objectstack/plugin-auth not installed — skipping auth',
          absentLevel: 'warn',
          outcome: 'skipping auth',
        });
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
        } catch (err) {
          reportOptionalLoadFailure(ctx, err, {
            packages: [spec[0]],
            absent: `  ✘ ${spec[0]} not installed — skipping its app`,
            absentLevel: 'warn',
            outcome: 'skipping its app',
          });
        }
      }
    }

    // [#5301] The enterprise organizations plugin, once constructed — held so
    // the child-`init()` loop below can tell ITS refusal apart from every other
    // child plugin's. That loop is best-effort by design (a dev stack survives
    // an absent service), but "the organization wall failed to come up" is the
    // one failure in it that ADR-0093 D5 forbids booting through.
    let organizationsPlugin: Plugin | undefined;

    // 5. Security Plugin (RBAC, RLS, field-level masking)
    // OrganizationsPlugin (when multi-org; ENTERPRISE `@objectstack/organizations`,
    // ADR-0105 D12) MUST register BEFORE SecurityPlugin because
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
        // [#5301] ADR-0093 D5 is enforced HERE, not merely reported. This
        // branch used to `logger.warn` and boot on, so a dev stack that asked
        // for the organization wall and could not get it served traffic with
        // no wall and nobody having agreed to that — while `objectstack serve`
        // refused to boot on the very same fact. D5 is a property of the
        // DEPLOYMENT ("a stack that requested isolation must not serve traffic
        // without it"), not of one entrypoint, so the dev assembly path owes
        // the same answer.
        //
        // `throw`, not `process.exit(1)`. serve.ts needs the exit because its
        // guard sits inside a broad AuthPlugin `try` that swallows throws;
        // DevPlugin is a LIBRARY-shaped assembly plugin with no claim on the
        // host process, and its boot chain does not swallow — `kernel.use()`
        // only registers, `initPluginWithTimeout` does not catch, `bootstrap()`
        // rethrows. So a throw genuinely aborts boot here, exactly as this
        // file's own `assertNotProduction()` already relies on. Killing the
        // host process from a library would additionally take down embedders
        // (tests, scripts, a parent app) that are entitled to catch this.
        //
        // #4818 — TWO STAGES, TWO FAILURES, TWO DIAGNOSES, mirroring serve.ts.
        // `import` and `new OrganizationsPlugin()` shared one `try`, so a
        // plugin that CONSTRUCTED and refused was reported as an absent
        // package. Those are different facts with different remedies (install
        // it vs. address what the plugin reported), and the escape hatch only
        // ever meant "the capability is ABSENT and I accept the degradation".
        // The classifier is WHICH STAGE THREW — deliberately not the error's
        // shape: the framework must not encode any of the plugin's private
        // refusal semantics.
        const organizationsPkg = '@objectstack/organizations';
        let orgMod: any;
        // ── Stage 1: import. Failure here = the package is ABSENT. ──
        try {
          orgMod = await import(/* webpackIgnore: true */ organizationsPkg);
        } catch (orgErr: any) {
          const cause = orgErr instanceof Error ? orgErr.message : String(orgErr);
          if (!resolveAllowDegradedTenancy()) {
            throw new Error(
              `tenancy posture '${tenancyPosture}' was requested but @objectstack/organizations `
              + '(the enterprise multi-org runtime) could not be loaded, so the organization wall is '
              + 'INACTIVE. Refusing to initialize — a stack that requested multi-organization '
              + 'isolation must not serve traffic without it (ADR-0093 D5). Fix one of: '
              + 'install @objectstack/organizations; or set OS_TENANCY_POSTURE=single (and unset '
              + 'OS_MULTI_ORG_ENABLED) to run single-org; or set OS_ALLOW_DEGRADED_TENANCY=1 to boot '
              + `in an explicitly degraded single-org state. cause: ${cause}`,
            );
          }
          // Explicitly opted into degraded operation — boot, but brand it.
          // Names the posture that was actually requested, not one knob's
          // spelling of it: the old text asserted `OS_MULTI_ORG_ENABLED=true`
          // at an operator who may well have set only `OS_TENANCY_POSTURE`.
          ctx.logger.warn(`  ✘ DEGRADED TENANCY (OS_ALLOW_DEGRADED_TENANCY=1): tenancy posture '${tenancyPosture}' requested but @objectstack/organizations (enterprise) not installed — running single-org, organization wall INACTIVE (ADR-0093 D5)`);
          // Degraded boot: `orgMod` stays undefined, so stage 2 is skipped.
          // Nothing was loaded, so nothing can be constructed.
        }

        // ── Stage 2: construct + register. Failure here = the package IS
        // present and the plugin itself declined. Report what it said,
        // verbatim, and refuse unconditionally: OS_ALLOW_DEGRADED_TENANCY does
        // NOT cover this (#4818). Honouring it here would move whatever gate
        // the plugin is enforcing onto an env var. ──
        if (orgMod) {
          try {
            organizationsPlugin = new orgMod.OrganizationsPlugin();
            this.childPlugins.push(organizationsPlugin!);
          } catch (mountErr: any) {
            // The framework does NOT interpret this error — it does not know
            // why the plugin refused and must not guess a cause. Surface the
            // plugin's own words and let them be the authority.
            const mountMessage = mountErr instanceof Error ? mountErr.message : String(mountErr);
            const mountCode = (mountErr as any)?.code;
            throw new Error(
              `tenancy posture '${tenancyPosture}' was requested and @objectstack/organizations WAS `
              + 'found and loaded, but its OrganizationsPlugin refused to be constructed, so the '
              + 'organization wall is INACTIVE. Refusing to initialize (ADR-0093 D5). This is NOT a '
              + 'missing-package problem: the runtime is installed and resolvable here. The plugin '
              + 'reported (verbatim — the framework does not interpret it): '
              + (mountCode !== undefined ? `code: ${String(mountCode)} — ` : '')
              + `${mountMessage}. OS_ALLOW_DEGRADED_TENANCY does NOT apply to this failure and will `
              + 'not get past it: it covers an ABSENT multi-org runtime the operator accepts doing '
              + 'without, not a present one that declined. (#4818)',
            );
          }
          ctx.logger.info(`  ✔ Organizations plugin enabled (posture '${tenancyPosture}': organization_id auto-stamp, per-org seed)`);
        }
      }
      try {
        const { SecurityPlugin } = await import('@objectstack/plugin-security') as any;
        this.childPlugins.push(new SecurityPlugin());
        ctx.logger.info(`  ✔ Security plugin enabled (RBAC, RLS, field masking; multiTenant=${multiTenant})`);
      } catch (err) {
        reportOptionalLoadFailure(ctx, err, {
          packages: ['@objectstack/plugin-security'],
          absent: '  ℹ @objectstack/plugin-security not installed — skipping security',
          absentLevel: 'debug',
          outcome: 'skipping security',
        });
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
      } catch (err) {
        reportOptionalLoadFailure(ctx, err, {
          packages: ['@objectstack/plugin-hono-server'],
          absent: '  ✘ @objectstack/plugin-hono-server not installed — skipping HTTP server',
          absentLevel: 'warn',
          outcome: 'skipping HTTP server',
        });
      }
    }

    // 7. REST API endpoints (CRUD + metadata read/write)
    if (enabled('rest')) {
      // [#3963] The auth-less fail-open carve-out is gone. It used to pass an
      // EXPLICIT `requireAuth: false` when no auth was mounted, on the grounds
      // that nobody could authenticate so the deny default would brick the
      // playground's data API. That reasoning inverts the right conclusion: a
      // stack with no auth has no security model, so it should not serve a data
      // API at all — and leaving the back door here would have made the dev
      // plugin the one surface that still opens the whole data plane.
      //
      // [#7926] This precondition is checked BEFORE the import and is no longer
      // expressed as a `throw` inside the load `try`. It is not a load failure:
      // @objectstack/rest can be installed and perfectly healthy and this stack
      // still must not serve a data API. Routed through the load `catch` it came
      // out as `ℹ @objectstack/rest not installed`, at debug — this card's defect
      // exactly, and the one instance of it the file produced against its OWN
      // words rather than a package's. Only the diagnosis changed: the REST
      // plugin is not registered either way and init still returns.
      if (!authMounted) {
        ctx.logger.warn(
          '  ✘ REST API NOT enabled: no auth is mounted in this stack, so no caller could ever '
          + 'authenticate and anonymous access to object data is always denied (#3963). This is NOT a '
          + 'missing-package problem — @objectstack/rest was never consulted. Install/enable '
          + 'plugin-auth (or the `auth` tier), or drop the REST API from this dev stack.',
        );
      } else {
        try {
          const { createRestApiPlugin } = await import('@objectstack/rest') as any;
          this.childPlugins.push(createRestApiPlugin());
          ctx.logger.info('  ✔ REST API endpoints enabled (CRUD + metadata)');
        } catch (err) {
          reportOptionalLoadFailure(ctx, err, {
            packages: ['@objectstack/rest'],
            absent: '  ℹ @objectstack/rest not installed — skipping REST endpoints',
            absentLevel: 'debug',
            outcome: 'skipping REST endpoints',
          });
        }
      }
    }

    // 8. Dispatcher (auth routes, GraphQL, analytics, packages, storage, automation)
    if (enabled('dispatcher')) {
      try {
        const { createDispatcherPlugin } = await import('@objectstack/runtime') as any;
        const dispatcherPlugin = createDispatcherPlugin();
        this.childPlugins.push(dispatcherPlugin);
        ctx.logger.info('  ✔ Dispatcher enabled (auth, GraphQL, analytics, packages, storage)');
      } catch (err) {
        reportOptionalLoadFailure(ctx, err, {
          packages: ['@objectstack/runtime'],
          absent: '  ℹ Dispatcher not available — skipping extended API routes',
          absentLevel: 'debug',
          outcome: 'skipping extended API routes',
        });
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
        // [#5301] One child's init failure is NOT best-effort: the enterprise
        // organizations plugin declining here means the organization wall a
        // walled posture asked for is INACTIVE, and ADR-0093 D5 forbids serving
        // traffic in that state. This is stage 2's other half — under
        // `objectstack serve` the same refusal reaches the kernel, whose Phase-1
        // loop rethrows, so serve needs no equivalent line; DevPlugin's own loop
        // would otherwise swallow it into a log entry and boot on unwalled,
        // re-opening on `init()` exactly the hole the construct stage closes.
        // A PRESENT plugin that refused is never covered by
        // OS_ALLOW_DEGRADED_TENANCY (#4818) — the hatch means "the runtime is
        // absent and I accept that", so it is deliberately not consulted here.
        if (organizationsPlugin !== undefined && plugin === organizationsPlugin) {
          throw new Error(
            'the enterprise @objectstack/organizations runtime was loaded but its OrganizationsPlugin '
            + `failed to initialize, so the organization wall requested by tenancy posture `
            + `'${resolveTenancyPosture()}' is INACTIVE. Refusing to initialize — a stack that `
            + 'requested multi-organization isolation must not serve traffic without it (ADR-0093 D5). '
            + 'The plugin reported (verbatim — the framework does not interpret it): '
            + `${err?.message ?? String(err)}. OS_ALLOW_DEGRADED_TENANCY does NOT apply: it covers an `
            + 'ABSENT multi-org runtime, not a present one that declined. (#4818)',
          );
        }
        ctx.logger.error(`Failed to init child plugin ${plugin.name}: ${err.message}`);
      }
    }

    // ── No stub registration (ADR-0115 D1) ──────────────────────────────
    // The stub table that used to fill every remaining slot is retired. A
    // slot no child plugin filled stays EMPTY — the honest production
    // semantic: routes answer 404/501, discovery reports `unavailable`, and
    // in-process consumers handle absence exactly as they already must in
    // production. To use a capability locally, install its real service.

    // The security slots deserve one loud line when nothing is enforcing
    // (#4126) — but that question cannot be answered HERE. It is asked in
    // `start()` instead; see `warnIfNothingIsEnforcingSecurity` below for why
    // the phase, and not just the service name, is load-bearing.

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
    // Same reasoning, same surface: "nothing is enforcing security" belongs
    // next to the banner, not buried in the init log (#10036, #3900).
    this.warnIfNothingIsEnforcingSecurity(ctx);
    ctx.logger.info('');
    ctx.logger.info('   API:       /api/v1/data/:object');
    ctx.logger.info('   Metadata:  /api/v1/meta/:type/:name');
    ctx.logger.info('   Discovery: /.well-known/objectstack');
    ctx.logger.info('─────────────────────────────────────────');
  }

  /**
   * One loud line when the stack is enforcing no security at all (#4126,
   * ADR-0076 D12: a fake that answers "allowed" is worse than an absent one,
   * so the slots stay empty — but silence about unenforced RBAC/RLS/masking
   * would be its own kind of fake).
   *
   * ## Why this asks for `security`, and why it asks in `start()` (#10036)
   *
   * This used to probe `security.permissions` / `security.rls` /
   * `security.fieldMasker` from `init()`. Both halves of that were wrong, and
   * they were wrong in the direction that is hardest to notice — silence read
   * as health:
   *
   * - **Wrong signal.** Those three are `SecurityPlugin.init()` registrations.
   *   The `ISecurityService` contract in `@objectstack/spec` names them
   *   "implementation internals and deliberately NOT part of this contract";
   *   the published `security` service is the contract. Their presence answers
   *   "is SecurityPlugin loaded?", which is not the question this warning
   *   asks. The two answers come apart at `start()`: it returns early — when
   *   `objectql`/`metadata` will not resolve, and when the engine cannot take
   *   middleware — BEFORE it publishes `security` and before it registers a
   *   single enforcement middleware. A stack in that state holds all three
   *   internal handles and enforces nothing, so the warning stayed silent in
   *   the one state where its text is literally true. (The same presence
   *   signal misled `plugin-hono-server`'s `/auth/me/permissions`, fixed in
   *   #10035 by this same move — two consumers, two packages, one misread:
   *   that is a property of the signal, not of either reader.)
   *
   * - **Wrong phase.** `security` is registered in `SecurityPlugin.start()`,
   *   which this plugin runs in its OWN `start()`. Asking from `init()` would
   *   find it absent on every stack, healthy ones included — so swapping only
   *   the service name would have turned a false negative into a permanent
   *   false positive. The question is answerable only after the child-start
   *   loop has run.
   *
   * The internal handles keep exactly one honest use, and it is the one they
   * can support: telling "SecurityPlugin was never loaded" apart from
   * "SecurityPlugin loaded and then failed to start", so the operator is
   * pointed at the right fix.
   */
  private warnIfNothingIsEnforcingSecurity(ctx: PluginContext): void {
    if (this.options.services?.['security'] === false) return; // opted out

    // An absent slot may throw OR resolve to undefined depending on the
    // kernel; both mean "nothing is there".
    const resolves = (name: string): boolean => {
      try { return ctx.getService(name) != null; } catch { return false; }
    };

    if (resolves('security')) return; // enforcement middleware is installed

    const loadedButNotEnforcing = ['security.permissions', 'security.rls', 'security.fieldMasker']
      .some(resolves);

    ctx.logger.warn(
      loadedButNotEnforcing
        ? '   ⚠ SecurityPlugin is LOADED but did not finish starting — it published no `security` '
          + 'service, so no enforcement middleware was registered and RBAC, row-level security and '
          + 'field masking are NOT enforced. Its own start() warning above says why (the objectql or '
          + 'metadata service could not be resolved, or the engine does not accept middleware). The '
          + '`security.permissions` / `security.rls` / `security.fieldMasker` handles ARE present — '
          + 'they are registered in init() and mean the plugin loaded, never that anything is being '
          + 'enforced.'
        : '   ⚠ No `security` service — SecurityPlugin is not loaded, so RBAC, row-level security '
          + 'and field masking are NOT enforced. The slots stay empty rather than being stubbed: a '
          + 'fake that answers "allowed" is worse than an absent one. Install '
          + '@objectstack/plugin-security to enforce them.',
    );
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
