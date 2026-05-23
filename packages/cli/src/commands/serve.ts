// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import path from 'path';
import fs from 'fs';
import net from 'net';
import chalk from 'chalk';
import { bundleRequire } from 'bundle-require';
import { loadConfig } from '../utils/config.js';
import { isHostConfig, shouldBootWithLibrary } from '../utils/plugin-detection.js';
import {
  printHeader,
  printKV,
  printSuccess,
  printError,
  printStep,
  printInfo,
  printServerReady,
} from '../utils/format.js';
import {
  STUDIO_PATH,
  resolveStudioPath,
  hasStudioDist,
  createStudioStaticPlugin,
  createStudioWriteApiPlugin,
} from '../utils/studio.js';
import {
  ACCOUNT_PATH,
  resolveAccountPath,
  hasAccountDist,
  createAccountStaticPlugin,
} from '../utils/account.js';
import {
  CONSOLE_PATH,
  resolveConsolePath,
  hasConsoleDist,
  createConsoleStaticPlugin,
} from '../utils/console.js';
import dotenvFlow from 'dotenv-flow';

// Helper to find available port
const getAvailablePort = async (startPort: number): Promise<number> => {
  const isPortAvailable = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: any) => {
        resolve(false);
      });
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port);
    });
  };

  let port = startPort;
  while (!(await isPortAvailable(port))) {
    port++;
    if (port > startPort + 100) {
       throw new Error(`Could not find an available port starting from ${startPort}`);
    }
  }
  return port;
};

export default class Serve extends Command {
  static override description = 'Start ObjectStack server. Reads `objectstack.config.ts` if present; otherwise falls back to `dist/objectstack.json` (or OS_ARTIFACT_PATH, including http(s):// URLs) as a portable artifact.';

  static override args = {
    config: Args.string({ description: 'Configuration file path', required: false, default: 'objectstack.config.ts' }),
  };

  static override flags = {
    port: Flags.string({ char: 'p', description: 'Server port', default: process.env.PORT ?? '3000' }),
    dev: Flags.boolean({ description: 'Run in development mode (load devPlugins)' }),
    ui: Flags.boolean({ description: 'Enable Studio UI at /_studio/ (default: true)', default: true, allowNo: true }),
    console: Flags.boolean({
      description: 'Mount the Console UI at /_console/ when the package is installed (default: true). When disabled, Studio claims the root redirect.',
      default: true,
      allowNo: true,
    }),
    server: Flags.boolean({ description: 'Start HTTP server plugin', default: true, allowNo: true }),
    prebuilt: Flags.boolean({ description: 'Skip esbuild/bundle-require — load config as native ESM (production mode)', default: false }),
    preset: Flags.string({
      description: 'Plugin tier preset: minimal | default | full (overridden by config.tiers if set)',
      options: ['minimal', 'default', 'full'],
    }),
  };

  /**
   * Capabilities auto-added to every app's `requires` for every preset
   * EXCEPT `minimal`. These form the foundation that every server-side
   * runtime expects to exist (background work, settings persistence,
   * transactional mail, file uploads). Apps may still list these in
   * `requires:` explicitly — duplicates are de-duped.
   *
   * Opt out: `objectstack serve --preset minimal`.
   *
   * Mirrored on hosted objectos per-project kernels by
   * `mountDefaultProjectPlugins()` in `@objectstack/service-cloud`.
   */
  static readonly ALWAYS_ON_CAPABILITIES: readonly string[] = Object.freeze([
    'queue', 'job', 'cache', 'settings', 'email', 'storage',
  ]);

  /**
   * Auto-registered plugin tiers. Plugins explicitly listed in
   * `config.plugins` are always loaded — tiers only gate the optional
   * auto-registration blocks below (AIService, I18n, Studio UI, etc.).
   */
  static readonly TIER_PRESETS: Record<string, string[]> = {
    minimal: ['core'],
    default: ['core', 'i18n', 'ui', 'auth'],
    full: ['core', 'i18n', 'ui', 'ai', 'auth'],
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Serve);

    // When --dev is passed, set NODE_ENV early so any runtime modules
    // imported below (and any deps that branch on NODE_ENV at import
    // time) see development mode. We deliberately do NOT inherit
    // NODE_ENV from the parent `os dev` spawn — see the note in
    // commands/dev.ts for why.
    if (flags.dev && !process.env.NODE_ENV) {
      process.env.NODE_ENV = 'development';
    }

    let port = parseInt(flags.port);
    try {
      const availablePort = await getAvailablePort(port);
      if (availablePort !== port) {
        port = availablePort;
      }
    } catch (e) {
      // Ignore error and try with original port
    }

    // Load .env files following Vite/Next.js convention
    const mode = flags.dev ? 'development'
      : (process.env.NODE_ENV === 'test' ? 'test'
        : (process.env.NODE_ENV || 'production'));
    dotenvFlow.config({ node_env: mode, silent: true });

    const isDev = flags.dev || process.env.NODE_ENV === 'development';

    const absolutePath = path.resolve(process.cwd(), args.config!);
    const relativeConfig = path.relative(process.cwd(), absolutePath);

    // ── Artifact-first fallback ──────────────────────────────────────
    // If the user did not author an `objectstack.config.ts`, but a
    // compiled artifact is reachable (explicit OS_ARTIFACT_PATH —
    // including http(s):// URLs — or the canonical
    // `<cwd>/dist/objectstack.json`), boot from that artifact alone.
    // This is the same capability previously hard-coded in
    // `apps/objectos/objectstack.config.ts`, lifted into the framework
    // so any project can `objectstack start` against just a
    // `dist/objectstack.json`.
    const configMissing = !fs.existsSync(absolutePath);
    let useArtifactFallback = false;
    if (configMissing) {
      const { resolveDefaultArtifactPath } = await import('@objectstack/runtime');
      const artifactSource = resolveDefaultArtifactPath();
      if (!artifactSource) {
        printError(`Configuration file not found: ${absolutePath}`);
        console.log(chalk.dim('  Hint: Run `objectstack init` to create a new project,'));
        console.log(chalk.dim('        or run `objectstack build` first, or set OS_ARTIFACT_PATH.'));
        this.exit(1);
      }
      useArtifactFallback = true;
    }

    // Quiet loading — only show a single spinner line
    console.log('');
    if (useArtifactFallback) {
      console.log(chalk.dim('  No objectstack.config.ts found — booting from artifact (default host)...'));
    } else {
      console.log(chalk.dim(`  Loading ${relativeConfig}...`));
    }

    // Track loaded plugins for summary
    const loadedPlugins: string[] = [];
    const shortPluginName = (raw: string) => {
      // Map verbose internal IDs to short display names
      if (raw.includes('objectql')) return 'ObjectQL';
      if (raw.includes('driver') && raw.includes('memory')) return 'MemoryDriver';
      if (raw.startsWith('plugin.app.')) return raw.replace('plugin.app.', '').split('.').pop() || raw;
      if (raw.includes('hono')) return 'HonoServer';
      return raw;
    };
    const trackPlugin = (name: string) => { loadedPlugins.push(shortPluginName(name)); };

    // Track resolved storage driver + redacted URL for the startup banner.
    let resolvedDriverLabel: string | undefined;
    let resolvedDatabaseUrl: string | undefined;
    const redactDbUrl = (url: string | undefined): string | undefined => {
      if (!url) return undefined;
      try {
        // Redact passwords inside connection URLs: protocol://user:****@host/db
        return url.replace(/(\/\/[^/@:]+):[^/@]+@/, '$1:****@');
      } catch {
        return url;
      }
    };

    // Save original console/stdout methods — we'll suppress noise during boot
    const originalConsoleLog = console.log;
    const originalConsoleDebug = console.debug;
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    let bootQuiet = false;

    const restoreOutput = () => {
      bootQuiet = false;
      process.stdout.write = origStdoutWrite;
      console.log = originalConsoleLog;
      console.debug = originalConsoleDebug;
    };

    const portShifted = parseInt(flags.port) !== port;

    try {
      // ── Suppress ALL runtime noise during boot ────────────────────
      // Multiple sources write to stdout during startup:
      //   • Pino-pretty (direct process.stdout.write)
      //   • ObjectLogger browser fallback (console.log)
      //   • SchemaRegistry (console.log)
      // We capture stdout entirely, then restore after runtime.start().
      bootQuiet = true;
      process.stdout.write = (chunk: any, ...rest: any[]) => {
        if (bootQuiet) return true;  // swallow
        return (origStdoutWrite as any)(chunk, ...rest);
      };
      console.log = (...args: any[]) => { if (!bootQuiet) originalConsoleLog(...args); };
      console.debug = (...args: any[]) => { if (!bootQuiet) originalConsoleDebug(...args); };

      // Load configuration
      // --prebuilt: load as native ESM (no esbuild, no bundle-require) —
      // intended for production where the config has been compiled to dist/.
      // --artifact-fallback: skip config loading entirely; the default-host
      // helper will synthesize a stack from the artifact JSON below.
      const { mod } = useArtifactFallback
        ? { mod: { default: {} as any } }
        : flags.prebuilt
          ? { mod: await import(absolutePath.startsWith('/') ? `file://${absolutePath}` : absolutePath) }
          : await bundleRequire({ filepath: absolutePath });

      let config = mod.default || mod;

      if (!useArtifactFallback && !config) {
        throw new Error(`No default export found in ${args.config}`);
      }

      // Preserve module-level named exports (e.g. `onEnable`, `onDisable`
      // lifecycle hooks) that would otherwise be dropped when we unwrap
      // `mod.default`. Without this AppPlugin can never invoke runtime hooks
      // declared as `export const onEnable = ...` alongside the default
      // `defineStack(...)` export.
      if (mod.default != null && config !== mod) {
        const merged: any = { ...config };
        for (const key of Object.keys(mod)) {
          if (key === 'default' || key in merged) continue;
          merged[key] = (mod as any)[key];
        }
        config = merged;
      }

      // Boot-mode dispatch: standalone goes directly through
      // `@objectstack/runtime` (no cloud dependencies). runtime/cloud
      // modes go through `@objectstack/service-cloud`.
      if (useArtifactFallback || shouldBootWithLibrary(config)) {
        // The boot stack returns only `{plugins, api}` — preserve the
        // original stack metadata (notably `requires`, `analyticsCubes`,
        // `tiers`) so the capability resolver further down can read it.
        const originalConfig = config;
        const resolvedMode = config.bootMode ?? process.env.OS_MODE ?? 'standalone';
        if (useArtifactFallback) {
          // Artifact-only boot — no objectstack.config.ts authored.
          // Always use the default-host helper which is standalone-only
          // and never depends on @objectstack/service-cloud.
          const { createDefaultHostConfig } = await import('@objectstack/runtime');
          const bootResult = await createDefaultHostConfig();
          config = { ...originalConfig, ...bootResult } as any;
        } else if (resolvedMode === 'standalone') {
          const { createStandaloneStack } = await import('@objectstack/runtime');
          const bootResult = await createStandaloneStack(config.standalone);
          config = { ...originalConfig, ...bootResult } as any;
        } else {
          // Cloud / multi-project boot modes require @objectstack/service-cloud.
          // When the package is unavailable (e.g. someone vendored only the
          // public framework), fail with a clear, actionable error instead of
          // an opaque module-not-found stack trace.
          let createBootStack: any;
          try {
            ({ createBootStack } = await import('@objectstack/service-cloud'));
          } catch (err) {
            throw new Error(
              `Boot mode '${resolvedMode}' requires @objectstack/service-cloud, which is not installed.\n`
              + `Either install it (\`pnpm add @objectstack/service-cloud\`) or switch to bootMode='standalone'.\n`
              + `Underlying error: ${(err as Error)?.message ?? String(err)}`,
            );
          }
          const bootResult = await createBootStack({
            mode: config.bootMode,
            runtime: config.runtime ?? config.project,
            cloud: config.cloud,
          });
          config = { ...originalConfig, ...bootResult } as any;
        }
      }

      // ── Resolve plugin tiers ──────────────────────────────────────
      // Precedence: config.requires (capability declarations) >
      //             config.tiers > --preset > built-in default.
      //
      // `requires: ['ai', 'automation', ...]` is the recommended
      // app-level way to declare platform dependencies. The CLI
      // expands each capability name into the matching tier so the
      // optional auto-registration blocks below light up without
      // extra flags. Explicitly-listed `config.plugins` always load
      // and shadow any capability resolution (i.e. an explicit
      // instance wins over the auto-loader).
      const presetName = flags.preset ?? (isDev ? 'default' : 'default');
      const presetTiers = Serve.TIER_PRESETS[presetName] ?? Serve.TIER_PRESETS.default;
      const requires: string[] = Array.isArray((config as any).requires)
        ? (config as any).requires.filter((c: unknown) => typeof c === 'string')
        : [];
      // Auth callbacks (password-reset, email-verification, magic-link,
      // invitation) depend on the email service. Auto-pull `email` when
      // `auth` is required so transactional mail works out of the box
      // (LogTransport fallback when no provider is configured).
      if (requires.includes('auth') && !requires.includes('email')) {
        requires.push('email');
      }
      // Default capability slate — every preset except `minimal` gets the
      // foundational services (queue + job + cache + settings + email +
      // storage). Opt out with `objectstack serve --preset minimal`.
      // Keeping `auth → email` above as a defensive rule for users who
      // explicitly opt into `minimal` but still enable auth.
      const ALWAYS_CAPS = Serve.ALWAYS_ON_CAPABILITIES;
      if (presetName !== 'minimal') {
        for (const cap of ALWAYS_CAPS) {
          if (!requires.includes(cap)) requires.push(cap);
        }
      }
      // The email + approvals + reports services schedule background work
      // (durable retries, SLA escalation, scheduled digests). Auto-pull
      // 'job' and 'queue' so plugins can opt into durable scheduling.
      // IMPORTANT: prepend, so their plugins load (and their kernel:ready
      // hooks fire) BEFORE consumers like email/approvals that subscribe
      // to queues during their own kernel:ready phase.
      const NEEDS_JOB_OR_QUEUE = ['email', 'approvals', 'reports', 'auth'];
      if (NEEDS_JOB_OR_QUEUE.some((c) => requires.includes(c))) {
        if (!requires.includes('queue')) requires.unshift('queue');
        if (!requires.includes('job')) requires.unshift('job');
      }
      // Capability → tier: any capability that is gated by a tier
      // here automatically opens that tier when listed in `requires`.
      // Capabilities NOT in this map (e.g. `automation`, `analytics`,
      // `audit`) bypass tier gating and are loaded directly by the
      // capability-resolver block further down.
      const CAPABILITY_TO_TIER: Record<string, string> = {
        ai: 'ai',
        i18n: 'i18n',
        ui: 'ui',
        auth: 'auth',
      };
      const requiredTiers = requires
        .map((c) => CAPABILITY_TO_TIER[c])
        .filter((t): t is string => typeof t === 'string');
      const baseTiers =
        Array.isArray((config as any).tiers) && (config as any).tiers.length > 0
          ? (config as any).tiers
          : presetTiers;
      const tiers: Set<string> = new Set([...baseTiers, ...requiredTiers]);
      const tierEnabled = (t: string) => tiers.has(t);
      const requiresCapability = (c: string) => requires.includes(c);

      // Import ObjectStack runtime
      const { Runtime } = await import('@objectstack/runtime');

      // Set kernel logger to 'silent' — the CLI manages its own output
      const loggerConfig = { level: 'silent' as const };

      const runtime = new Runtime({
        kernel: {
            logger: loggerConfig
        }
      });
      const kernel = runtime.getKernel();

      // Load plugins from configuration
      let plugins = config.plugins || [];

      // Merge devPlugins if in dev mode
      if (flags.dev && config.devPlugins) {
        plugins = [...plugins, ...config.devPlugins];
      }

      // 1. Auto-register ObjectQL Plugin if objects define but plugins missing
      const hasObjectQL = plugins.some((p: any) => p.name?.includes('objectql') || p.constructor?.name?.includes('ObjectQL'));
      if (config.objects && !hasObjectQL) {
         try {
           const { ObjectQLPlugin } = await import('@objectstack/objectql');
           await kernel.use(new ObjectQLPlugin());
           trackPlugin('ObjectQL');
         } catch (e: any) {
           // silent
         }
      }

      // 2. Auto-register storage driver
      // Priority:
      //   1. OS_DATABASE_DRIVER env var (explicit override)
      //   2. URL scheme inferred from OS_DATABASE_URL
      //        mongodb://, mongodb+srv://       → mongodb
      //        postgres://, postgresql://       → postgres
      //        mysql://, mysql2://              → mysql
      //        libsql://, http(s):// + .turso.  → turso
      //        file:, sqlite:, *.db, :memory:   → sqlite
      //   3. Default: InMemoryDriver in dev mode
      const hasDriver = plugins.some((p: any) => p.name?.includes('driver') || p.constructor?.name?.includes('Driver'));
      if (!hasDriver && config.objects) {
         const explicitDriver = (process.env.OS_DATABASE_DRIVER ?? '').toLowerCase().trim();
         const databaseUrl = process.env.OS_DATABASE_URL;

         const inferDriverFromUrl = (url: string | undefined): string => {
           if (!url) return '';
           const u = url.trim();
           if (/^mongodb(\+srv)?:\/\//i.test(u)) return 'mongodb';
           if (/^postgres(ql)?:\/\//i.test(u)) return 'postgres';
           if (/^mysql2?:\/\//i.test(u)) return 'mysql';
           if (/^libsql:\/\//i.test(u)) return 'turso';
           if (/^https?:\/\//i.test(u) && /\.turso\./i.test(u)) return 'turso';
           if (/^file:/i.test(u) || /^sqlite:/i.test(u) || u === ':memory:' || /\.(db|sqlite|sqlite3)$/i.test(u)) return 'sqlite';
           return '';
         };

         const driverType = explicitDriver || inferDriverFromUrl(databaseUrl);

         try {
           const { DriverPlugin } = await import('@objectstack/runtime');

           if (driverType === 'mongodb' || driverType === 'mongo') {
             const { MongoDBDriver } = await import('@objectstack/driver-mongodb');
             await kernel.use(new DriverPlugin(new MongoDBDriver({
               url: databaseUrl ?? 'mongodb://localhost:27017/objectstack',
             }) as any));
             trackPlugin('MongoDBDriver');
             resolvedDriverLabel = 'MongoDBDriver';
             resolvedDatabaseUrl = databaseUrl ?? 'mongodb://localhost:27017/objectstack';
           } else if (driverType === 'sqlite' || driverType === 'sql') {
             const { SqlDriver } = await import('@objectstack/driver-sql');
             const filePath = (databaseUrl ?? ':memory:').replace(/^file:/, '').replace(/^sqlite:/, '').replace(/^sql:\/\//, '');
             await kernel.use(new DriverPlugin(new SqlDriver({
               client: 'better-sqlite3',
               connection: { filename: filePath },
               useNullAsDefault: true,
             }) as any));
             trackPlugin('SqlDriver');
             resolvedDriverLabel = 'SqlDriver(sqlite)';
             resolvedDatabaseUrl = databaseUrl ?? ':memory:';
           } else if (driverType === 'postgres' || driverType === 'postgresql' || driverType === 'pg') {
             const { SqlDriver } = await import('@objectstack/driver-sql');
             await kernel.use(new DriverPlugin(new SqlDriver({
               client: 'pg',
               connection: databaseUrl,
               pool: { min: 0, max: 5 },
             }) as any));
             trackPlugin('PostgresDriver');
             resolvedDriverLabel = 'SqlDriver(pg)';
             resolvedDatabaseUrl = databaseUrl;
           } else if (driverType === 'mysql' || driverType === 'mysql2') {
             const { SqlDriver } = await import('@objectstack/driver-sql');
             await kernel.use(new DriverPlugin(new SqlDriver({
               client: 'mysql2',
               connection: databaseUrl,
               pool: { min: 0, max: 5 },
             }) as any));
             trackPlugin('MySQLDriver');
             resolvedDriverLabel = 'SqlDriver(mysql2)';
             resolvedDatabaseUrl = databaseUrl;
           } else if (driverType === 'turso' || driverType === 'libsql') {
             const { TursoDriver } = await import('@objectstack/driver-turso');
             await kernel.use(new DriverPlugin(new TursoDriver({
               url: databaseUrl ?? 'file:./local.db',
               authToken: process.env.OS_DATABASE_AUTH_TOKEN,
             } as any) as any));
             trackPlugin('TursoDriver');
             resolvedDriverLabel = 'TursoDriver';
             resolvedDatabaseUrl = databaseUrl ?? 'file:./local.db';
           } else if (isDev) {
             // Default in dev: in-memory driver
             const { InMemoryDriver } = await import('@objectstack/driver-memory');
             await kernel.use(new DriverPlugin(new InMemoryDriver()));
             trackPlugin('MemoryDriver');
             resolvedDriverLabel = 'InMemoryDriver';
             resolvedDatabaseUrl = '(in-memory)';
           }
         } catch (e: any) {
           // silent
         }
      }

      // 3. Auto-register AppPlugin if config contains app definitions
      // (objects / manifest / apps / flows / apis). Even host/aggregator
      // configs (those whose `plugins` array contains instantiated plugins)
      // need this wrap when they ALSO carry top-level metadata — otherwise
      // top-level `flows`, `objects`, etc. never reach the ObjectQL registry
      // and downstream services like AutomationServicePlugin start with 0 flows.
      //
      // To avoid double-registration when the host already wraps itself with
      // an AppPlugin (e.g. apps/objectos's dev-workspace stack), we skip if
      // any plugin in `plugins[]` is already an AppPlugin instance.
      const hasAppPluginAlready = plugins.some(
        (p: any) => p && (p.type === 'app' || p.constructor?.name === 'AppPlugin' || (p.name && typeof p.name === 'string' && p.name.startsWith('plugin.app.')))
      );
      const configHasMetadata = !!(
        config.objects || config.manifest || config.apps || config.flows || config.apis
      );
      if (!hasAppPluginAlready && configHasMetadata) {
        try {
            const { AppPlugin } = await import('@objectstack/runtime');
            await kernel.use(new AppPlugin(config));
            trackPlugin('App');
        } catch (e: any) {
            // silent
        }
      }

      // 3b. Auto-register I18nServicePlugin if config contains translations/i18n
      // This ensures i18n REST routes work out of the box without manual plugin registration.
      const hasI18nPlugin = plugins.some(
        (p: any) => p.name === 'com.objectstack.service.i18n'
            || p.constructor?.name === 'I18nServicePlugin'
      );
      // Check the top-level config AND any nested AppPlugin bundles in the
      // `plugins` array — host/aggregator configs (e.g. apps/objectos) don't
      // define translations themselves but compose multiple `new AppPlugin(...)`
      // entries, each carrying its own translations.
      const pluginBundleHasTranslations = (bundle: any): boolean => {
        if (!bundle || typeof bundle !== 'object') return false;
        if (Array.isArray(bundle.translations) && bundle.translations.length > 0) return true;
        if (bundle.i18n) return true;
        if (bundle.manifest && (
          (Array.isArray(bundle.manifest.translations) && bundle.manifest.translations.length > 0)
          || bundle.manifest.i18n
        )) return true;
        return false;
      };
      const anyAppPluginHasTranslations = plugins.some((p: any) => {
        if (!p) return false;
        // AppPlugin instances expose their bundle on `.bundle`
        if (p.bundle && pluginBundleHasTranslations(p.bundle)) return true;
        return false;
      });
      const configHasTranslations = (
        pluginBundleHasTranslations(config)
        || anyAppPluginHasTranslations
      );
      if (!hasI18nPlugin && configHasTranslations && tierEnabled('i18n')) {
        try {
          // Dynamic import with variable to prevent tsc from resolving the optional package
          const i18nPkg = '@objectstack/service-i18n';
          const { I18nServicePlugin } = await import(/* webpackIgnore: true */ i18nPkg);
          const i18nCfg = config.i18n || config.manifest?.i18n || {};
          await kernel.use(new I18nServicePlugin({
            defaultLocale: i18nCfg.defaultLocale,
            fallbackLocale: i18nCfg.fallbackLocale || i18nCfg.defaultLocale || 'en',
          }));
          trackPlugin('I18nService');
        } catch {
          // @objectstack/service-i18n not installed — kernel memory fallback will handle i18n
        }
      } else if (!hasI18nPlugin && !configHasTranslations) {
        // No translations and no explicit i18n plugin — this is fine, kernel fallback works
      }

      // Add HTTP server plugin BEFORE config plugins so that the
      // http-server service is available for any plugin that needs it
      // during init/start (e.g. AuthPlugin).
      // Skip if config already contains a HonoServerPlugin to avoid
      // duplicate registration.
      const configHasHonoServer = plugins.some(
        (p: any) => p.name === 'com.objectstack.server.hono' || p.constructor?.name === 'HonoServerPlugin'
      );

      if (flags.server && !configHasHonoServer) {
        try {
          const { HonoServerPlugin } = await import('@objectstack/plugin-hono-server');
          const serverPlugin = new HonoServerPlugin({ port });
          await kernel.use(serverPlugin);
          trackPlugin('HonoServer');
        } catch (e: any) {
          console.warn(chalk.yellow(`  ⚠ HTTP server plugin not available: ${e.message}`));
        }
      }

      // Unknown-environment hostname guard.
      //
      // In multi-tenant cloud deployments (e.g. *.objectos.app), every
      // public hostname is expected to map to a `sys_environment` row
      // whose `hostname` column matches the request `Host`. Without this
      // guard, an unknown subdomain like `demo-xxx.objectos.app` happily
      // renders the control-plane Console SPA (served statically by
      // createConsoleStaticPlugin), making the deployment look like an
      // empty env rather than a missing one. We respond with a clear
      // 404 instead.
      //
      // Activation: only when OS_ROOT_DOMAIN is set (e.g. "objectos.app").
      // Reserved subdomains (cloud/www/api/docs/admin/app and the apex)
      // bypass the check so platform surfaces keep working. Non-root
      // hostnames (custom domains, localhost, *.workers.dev) pass through
      // unchanged. Infra paths under /_admin or /.well-known are always
      // allowed so health checks / cert flows aren't broken.
      //
      // Implemented as a Plugin so the middleware is wired during init
      // (when http.server is available) and BEFORE start() runs on the
      // Console static plugin / route-registering plugins. Hono's
      // `app.use('*')` is order-independent for matching, so as long as
      // the middleware is added before kernel:listening fires, it
      // intercepts every request regardless of which plugin registered
      // its handler.
      const __rootDomain = (process.env.OS_ROOT_DOMAIN || '').trim().toLowerCase();
      if (__rootDomain) {
        const RESERVED = new Set(['', 'cloud', 'www', 'api', 'docs', 'admin', 'app']);
        const guardPlugin: any = {
          name: 'com.objectstack.cli.unknown-hostname-guard',
          version: '1.0.0',
          init: async (ctx: any) => {
            try {
              const httpServer: any = ctx.getService?.('http.server') ?? ctx.getService?.('http-server');
              const rawApp = httpServer?.getRawApp?.();
              if (!rawApp || typeof rawApp.use !== 'function') {
                ctx.logger?.warn?.('[unknown-hostname-guard] http.server unavailable; guard not installed');
                return;
              }
              const getEnvRegistry = () => {
                try {
                  return ctx.getService?.('env-registry') ?? null;
                } catch {
                  return null;
                }
              };
              rawApp.use('*', async (c: any, next: any) => {
                const rawHost = c.req.header('host') || '';
                const host = rawHost.split(':')[0].toLowerCase();
                if (!host) return next();
                const isPlatformHost = host === __rootDomain || host.endsWith('.' + __rootDomain);
                if (!isPlatformHost) return next();
                const sub = host === __rootDomain ? '' : host.slice(0, -(__rootDomain.length + 1));
                const head = sub.split('.').pop() || '';
                if (RESERVED.has(sub) || RESERVED.has(head)) return next();
                const p = c.req.path;
                if (p.startsWith('/_admin/') || p === '/_admin' || p.startsWith('/.well-known/')) {
                  return next();
                }
                // Health and readiness endpoints must always answer 200
                // regardless of whether the requested hostname maps to
                // an env — Cloudflare's container probe (and any
                // upstream load balancer) hits whatever Host header is
                // currently bound to the worker. Returning 404 here on
                // an unmapped hostname would kill the container.
                if (p === '/api/v1/health' || p === '/api/v1/ready' || p === '/health') {
                  return next();
                }
                // Resolve env-registry lazily on each request — it may
                // not be registered yet at init() time (registered by
                // ObjectOSProjectPlugin's init which runs in plugin
                // dependency order; we don't want to rely on ordering).
                const registry: any = getEnvRegistry();
                if (!registry || typeof registry.resolveByHostname !== 'function') {
                  return next();
                }
                try {
                  const hit = await registry.resolveByHostname(host);
                  if (hit) return next();
                } catch {
                  return next();
                }
                // Content negotiation: browsers (Accept: text/html) get
                // a clean 404 page; API clients (curl/fetch with JSON
                // accept) get a structured error body.
                const accept = (c.req.header('accept') || '').toLowerCase();
                const wantsHtml = accept.includes('text/html');
                if (wantsHtml) {
                  const safeHost = host.replace(/[<>&"']/g, (ch: string) => ((({
                    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
                  } as Record<string, string>)[ch]) ?? ch));
                  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>404 — Environment not found</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #fafafa;
    color: #111;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0b0b0c; color: #e8e8e8; }
    .card { background: #141417; border-color: #26262b; }
    .host { background: #1c1c20; border-color: #2d2d33; color: #d0d0d0; }
    .muted { color: #8b8b94; }
    a { color: #6ea8fe; }
  }
  .card {
    max-width: 520px;
    width: 100%;
    background: #fff;
    border: 1px solid #e6e6e6;
    border-radius: 12px;
    padding: 32px;
    box-shadow: 0 1px 2px rgba(0,0,0,.04);
    text-align: center;
  }
  .code { font: 600 64px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 0; letter-spacing: -2px; }
  h1 { font-size: 20px; margin: 16px 0 8px; font-weight: 600; }
  p { margin: 8px 0; }
  .muted { color: #666; font-size: 14px; }
  .host {
    display: inline-block;
    margin-top: 16px;
    padding: 6px 12px;
    background: #f4f4f5;
    border: 1px solid #e4e4e7;
    border-radius: 6px;
    font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #444;
    word-break: break-all;
  }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main class="card">
    <p class="code">404</p>
    <h1>Environment not found</h1>
    <p class="muted">No ObjectStack environment is bound to this hostname.</p>
    <div class="host">${safeHost}</div>
    <p class="muted" style="margin-top:24px">
      If you own this domain, bind it to an environment in the
      <a href="https://cloud.objectos.app/">ObjectStack Cloud console</a>.
    </p>
  </main>
</body>
</html>`;
                  return c.html(html, 404);
                }
                return c.json(
                  {
                    error: 'environment_not_found',
                    message: `No environment is bound to hostname '${host}'.`,
                    hostname: host,
                  },
                  404,
                );
              });
              ctx.logger?.info?.('[unknown-hostname-guard] installed', { rootDomain: __rootDomain });
            } catch (err: any) {
              ctx.logger?.warn?.('[unknown-hostname-guard] install failed', { error: err?.message ?? err });
            }
          },
        };
        try {
          await kernel.use(guardPlugin);
          trackPlugin('UnknownHostnameGuard');
        } catch {
          // Best-effort.
        }
      }

      // 5. Auto-register Studio single-project signal in dev mode.
      //
      // `objectstack dev` runs a vanilla user stack (e.g. examples/app-crm)
      // as a single project — there is no apps/cloud control plane and no
      // org/project picker is meaningful. Without this plugin Studio would
      // fall back to its multi-project default and ask the user to "Create
      // organization" before showing any platform metadata.
      //
      // The plugin only registers `GET /api/v1/studio/runtime-config`
      // (returning `{ singleProject: true, defaultOrgId, defaultProjectId }`)
      // — no identity seed, since CLI dev mode has no sys_organization /
      // sys_project tables to write into. Skipped when the user config
      // already carries a single-project / multi-project plugin.
      const hasProjectModePlugin = plugins.some((p: any) => {
        const n = p?.name ?? p?.constructor?.name ?? '';
        return n === 'com.objectstack.studio.single-project'
          || n === 'com.objectstack.multi-project'
          || n === 'com.objectstack.studio.runtime-config';
      });
      if (isDev && !hasProjectModePlugin) {
        try {
          const cloudPkg = '@objectstack/service-cloud';
          const { createSingleProjectPlugin } = await import(/* webpackIgnore: true */ cloudPkg);
          await kernel.use(createSingleProjectPlugin({
            projectId: process.env.OS_PROJECT_ID ?? 'proj_local',
            orgId: process.env.OS_ORG_ID ?? 'org_local',
            orgName: 'Local',
          }));
          trackPlugin('SingleProject');
        } catch {
          // @objectstack/service-cloud not installed — Studio falls back
          // to multi-project mode (org/project picker visible).
        }
      }

      // 5b. Auto-register MarketplaceProxyPlugin so the runtime console's
      // marketplace browse UI works in `objectstack dev` without manually
      // wiring the plugin into every user's objectstack.config.ts.
      //
      // The default control-plane URL is the public ObjectStack cloud —
      // users get a working marketplace out of the box. Override with
      // OS_CLOUD_URL=<your-cloud>, or opt out with OS_CLOUD_URL=off
      // / =local for fully air-gapped setups.
      const hasMarketplaceProxy = plugins.some(
        (p: any) => p?.name === 'com.objectstack.runtime.marketplace-proxy'
          || p?.constructor?.name === 'MarketplaceProxyPlugin'
      );
      if (!hasMarketplaceProxy) {
        try {
          const runtimePkg = '@objectstack/runtime';
          const { MarketplaceProxyPlugin, MarketplaceInstallLocalPlugin, resolveCloudUrl } = await import(/* webpackIgnore: true */ runtimePkg);
          const effectiveCloudUrl = (typeof resolveCloudUrl === 'function'
            ? resolveCloudUrl()
            : (process.env.OS_CLOUD_URL?.trim() || 'https://cloud.objectos.app')) as string;
          if (effectiveCloudUrl) {
            await kernel.use(new MarketplaceProxyPlugin({ controlPlaneUrl: effectiveCloudUrl }));
            trackPlugin('MarketplaceProxy');
            // Pair the catalog proxy with the install-local handler. The two
            // share the same /api/v1/marketplace prefix; the proxy delegates
            // /install-local to this plugin (see proxy `next()` check).
            try {
              await kernel.use(new MarketplaceInstallLocalPlugin({ controlPlaneUrl: effectiveCloudUrl }));
              trackPlugin('MarketplaceInstallLocal');
            } catch (err: any) {
              console.warn(chalk.yellow(`  ⚠ MarketplaceInstallLocalPlugin auto-inject failed: ${err?.message ?? err}`));
            }
            if (!process.env.OS_CLOUD_URL) {
              console.log(chalk.dim(`  · Marketplace pointed at default cloud (${effectiveCloudUrl}). Override with OS_CLOUD_URL, or disable with OS_CLOUD_URL=off.`));
            }
          }
          // else: user disabled cloud via OS_CLOUD_URL=off/local — skip.
        } catch (err: any) {
          console.warn(chalk.yellow(`  ⚠ MarketplaceProxyPlugin auto-inject failed: ${err?.message ?? err}`));
        }
      }

      // 5c. Auto-register AuthPlugin (and paired Security/Audit) when the
      // 'auth' tier is enabled and no auth plugin is already configured.
      // The Studio + Account portals expect /api/v1/auth/* to be served by
      // better-auth via @objectstack/plugin-auth. Without this block,
      // running `objectstack dev` on a vanilla user stack would 404 on
      // login/register flows.
      const hasAuthPlugin = plugins.some(
        (p: any) => p?.name === 'com.objectstack.auth' || p?.constructor?.name === 'AuthPlugin'
      );
      if (!hasAuthPlugin && tierEnabled('auth')) {
        try {
          const authPkg = '@objectstack/plugin-auth';
          const { AuthPlugin } = await import(/* webpackIgnore: true */ authPkg);

          // In dev, fall back to a stable local secret so users don't have
          // to set AUTH_SECRET just to try the login/register flow.
          const secret = process.env.AUTH_SECRET
            ?? process.env.OS_AUTH_SECRET
            ?? (isDev ? 'dev-only-insecure-secret-change-me-in-production' : undefined);

          // Guard: in cloud-connected runtime mode (e.g. objectos worker)
          // the host kernel is a pure routing shell. Auth is owned by each
          // per-project kernel (`ArtifactKernelFactory` injects an
          // `AuthPlugin` per project against the project's own DB so users
          // persist and stay isolated per subdomain). Injecting a host-level
          // AuthPlugin here would compete with the per-project one — its
          // shared OS_AUTH_SECRET would erroneously validate cookies across
          // unrelated projects. Refuse to inject in runtime mode.
          //
          // Detect runtime mode by the presence of ObjectOSProjectPlugin
          // (added by createObjectOSStack). OS_CLOUD_URL alone is NOT a
          // reliable signal — a regular `objectstack dev` app may set it
          // just to enable the marketplace proxy yet still want its own
          // local AuthPlugin.
          const isHostKernel = plugins.some(
            (p: any) => p?.name === 'com.objectstack.runtime.objectos-project'
              || p?.constructor?.name === 'ObjectOSProjectPlugin'
          );
          if (isHostKernel) {
            console.warn(chalk.yellow(
              '  ⚠ AuthPlugin skipped on host kernel — runtime mode (ObjectOSProjectPlugin detected).\n' +
              '    Auth is owned per-project by ArtifactKernelFactory (see service-cloud).'
            ));
          } else if (!secret) {
            console.warn(chalk.yellow('  ⚠ AuthPlugin skipped — set AUTH_SECRET to enable authentication in production'));
          } else {
            const baseUrl = process.env.AUTH_BASE_URL
              ?? process.env.OS_BASE_URL
              ?? `http://localhost:${port}`;

            const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
            if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
              socialProviders.google = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
            if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
              socialProviders.github = { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET };

            // Trusted origins (CSRF). better-auth uses a `*` glob that
            // does NOT cross dot-separators, so `http://localhost:*` does
            // not cover `http://<sub>.localhost:*`. Build the allow-list
            // explicitly:
            //   - explicit `OS_TRUSTED_ORIGINS` (comma-separated) wins
            //   - else dev / preview defaults below
            const trustedOrigins: string[] = [];
            const explicitTrusted = process.env.OS_TRUSTED_ORIGINS?.trim();
            if (explicitTrusted) {
              explicitTrusted.split(',').map(s => s.trim()).filter(Boolean).forEach(o => {
                if (!trustedOrigins.includes(o)) trustedOrigins.push(o);
              });
            }
            // Always add the configured baseUrl so first-party redirects work.
            try {
              const u = new URL(baseUrl);
              const baseOrigin = `${u.protocol}//${u.host}`;
              if (!trustedOrigins.includes(baseOrigin)) trustedOrigins.push(baseOrigin);
            } catch { /* ignore malformed baseUrl */ }
            // Preview-mode subdomain wildcards (`<commit>--<pid>.<base>`).
            // Honour `OS_PREVIEW_BASE_DOMAINS` (used by service-cloud's
            // preview routing) and add `http://*.<base>:*` patterns.
            const previewMode = (process.env.OS_PREVIEW_MODE ?? '').trim().toLowerCase();
            const isPreviewMode = previewMode === '1' || previewMode === 'true' || previewMode === 'yes';
            if (isPreviewMode) {
              const baseDomains = (process.env.OS_PREVIEW_BASE_DOMAINS
                ?? 'preview.objectstack.ai,localhost')
                .split(',').map(s => s.trim()).filter(Boolean);
              for (const dom of baseDomains) {
                const isLoopback = dom === 'localhost' || dom.endsWith('.localhost');
                const scheme = isLoopback ? 'http' : 'https';
                const portSuffix = isLoopback ? ':*' : '';
                const wildcard = `${scheme}://*.${dom}${portSuffix}`;
                if (!trustedOrigins.includes(wildcard)) trustedOrigins.push(wildcard);
              }
            }
            // Dev convenience: keep `http://localhost:*` so plain
            // `localhost:<port>` still works for non-preview Studio/Console.
            if (isDev && !trustedOrigins.includes('http://localhost:*')) {
              trustedOrigins.push('http://localhost:*');
            }
            // Per-project subdomains: when OS_ROOT_DOMAIN is set (multi-
            // project hosting under `*.<root>`), every project hostname
            // must be trusted by better-auth or sign-up/sign-in is
            // rejected with "Invalid origin". Mirrors the OS_COOKIE_DOMAIN
            // wildcard semantics — they are always set together.
            const rootDomain = (process.env.OS_ROOT_DOMAIN ?? process.env.ROOT_DOMAIN)?.trim();
            if (rootDomain) {
              const wildcard = `https://*.${rootDomain}`;
              if (!trustedOrigins.includes(wildcard)) trustedOrigins.push(wildcard);
            }

            // Collect application-defined org roles from the stack so
            // Better-Auth's organization plugin accepts invitations to
            // those roles (otherwise it 400s with `ROLE_NOT_FOUND`).
            // Sources:
            //   - top-level `roles[]` (role hierarchy entries)
            //   - `permissions[]` PermissionSets where `isProfile === true`
            //     (these double as role identifiers; e.g. CRM Profiles)
            // Real RBAC enforcement is still owned by SecurityPlugin, which
            // matches these names against `permission` metadata entries.
            const additionalOrgRoles = new Set<string>();
            try {
              const stackAny: any = config ?? {};
              const collect = (arr: any) => {
                if (!Array.isArray(arr)) return;
                for (const r of arr) {
                  const n = typeof r === 'string' ? r : (r && typeof r.name === 'string' ? r.name : null);
                  if (n && n !== 'owner' && n !== 'admin' && n !== 'member') additionalOrgRoles.add(n);
                }
              };
              collect(stackAny.roles);
              if (Array.isArray(stackAny.permissions)) {
                for (const p of stackAny.permissions) {
                  if (p && typeof p.name === 'string' && p.isProfile !== false) {
                    if (p.name !== 'owner' && p.name !== 'admin' && p.name !== 'member') additionalOrgRoles.add(p.name);
                  }
                }
              }
            } catch {
              // best-effort
            }

            await kernel.use(new AuthPlugin({
              secret,
              baseUrl,
              socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
              trustedOrigins: trustedOrigins.length ? trustedOrigins : undefined,
              ...(additionalOrgRoles.size > 0 ? { additionalOrgRoles: Array.from(additionalOrgRoles) } : {}),
              // Enable the admin plugin by default so the Setup app's
              // ban/unban/set-password/impersonate/set-role row actions
              // resolve to real endpoints. The plugin self-gates by role
              // (only users whose `role` column is `admin` can hit
              // /admin/* endpoints), so leaving it on for everyone is
              // safe. Opt-out via OS_AUTH_ADMIN=false.
              //
              // Similarly enable twoFactor by default — it powers the
              // Setup app's `sys_two_factor` toolbar actions (Enable 2FA,
              // Disable 2FA). Opt-out via OS_AUTH_TWO_FACTOR=false.
              //
              // (api-key plugin: not yet shipped by better-auth — generic
              // CRUD on `sys_api_key` handles row creation in the meantime.)
              plugins: {
                admin: String(process.env.OS_AUTH_ADMIN ?? 'true').toLowerCase() !== 'false',
                twoFactor: String(process.env.OS_AUTH_TWO_FACTOR ?? 'true').toLowerCase() !== 'false',
              },
              advanced: process.env.OS_COOKIE_DOMAIN
                ? ({
                    crossSubDomainCookies: {
                      enabled: true,
                      domain: process.env.OS_COOKIE_DOMAIN,
                    },
                  } as any)
                : undefined,
            }));
            trackPlugin('Auth');

            // Pair: SecurityPlugin (RBAC) — optional
            try {
              const securityPkg = '@objectstack/plugin-security';
              const { SecurityPlugin } = await import(/* webpackIgnore: true */ securityPkg);
              // `OS_MULTI_TENANT=false` disables wildcard tenant_isolation
              // RLS policies and the `organization_id` auto-injection on
              // insert. Keep multi-tenant on by default — most ObjectStack
              // deployments are multi-org.
              const multiTenant = String(process.env.OS_MULTI_TENANT ?? 'true').toLowerCase() !== 'false';
              await kernel.use(new SecurityPlugin({ multiTenant }));
              trackPlugin('Security');
            } catch {
              // optional
            }

            // Pair: AuditPlugin — optional
            try {
              const auditPkg = '@objectstack/plugin-audit';
              const { AuditPlugin } = await import(/* webpackIgnore: true */ auditPkg);
              await kernel.use(new AuditPlugin());
              trackPlugin('Audit');
            } catch {
              // optional
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('Cannot find module') && !msg.includes('ERR_MODULE_NOT_FOUND')) {
            console.warn(chalk.yellow(`  ⚠ AuthPlugin failed to load: ${msg}`));
          }
          // @objectstack/plugin-auth not installed — login/register endpoints unavailable
        }
      }

      if (plugins.length > 0) {
        for (const plugin of plugins) {
          try {
            let pluginToLoad = plugin;

            // Resolve string references (package names)
            if (typeof plugin === 'string') {
              try {
                 const imported = await import(plugin);
                 pluginToLoad = imported.default || imported;
              } catch (importError: any) {
                 throw new Error(`Failed to import plugin '${plugin}': ${importError.message}`);
              }
            }

            // Wrap raw config objects (no init/start) into AppPlugin
            // This handles plugins defined as plain { name, objects, ... } bundles
            if (pluginToLoad && typeof pluginToLoad === 'object' && !pluginToLoad.init) {
              try {
                const { AppPlugin } = await import('@objectstack/runtime');
                pluginToLoad = new AppPlugin(pluginToLoad);
              } catch (e: any) {
                // Fall through to kernel.use which will report the error
              }
            }

            await kernel.use(pluginToLoad);
            const pluginName = plugin.name || plugin.constructor?.name || 'unnamed';
            trackPlugin(pluginName);
          } catch (e: any) {
            console.error(chalk.red(`  ✗ Failed to load plugin: ${e.message}`));
          }
        }
      }

      // Register REST API and Dispatcher plugins (consume http.server + protocol services)
      if (flags.server) {
        // Read project-scoping config from the stack's top-level `api` field
        // (e.g. { api: { enableProjectScoping: true, projectResolution: 'auto' } }).
        // Forwarded to both REST and Dispatcher plugins so they mount scoped
        // routes consistently.
        const apiConfig = (config as any).api ?? {};
        const enableProjectScoping = apiConfig.enableProjectScoping ?? false;
        const projectResolution = apiConfig.projectResolution ?? 'auto';
        // `requireAuth: true` rejects anonymous requests on `/api/v1/data/*`
        // with HTTP 401 before they reach ObjectQL. Default-on when the
        // stack opts in OR when the resolved tier set includes `auth`
        // (because anonymous data access is almost never desirable when
        // auth is enabled). Apps can override via stack `api.requireAuth`.
        const requireAuth = apiConfig.requireAuth ?? (tierEnabled('auth') ? true : false);

        try {
          const { createRestApiPlugin } = await import('@objectstack/rest');
          await kernel.use(
            createRestApiPlugin({ api: { api: { enableProjectScoping, projectResolution, requireAuth } } as any }),
          );
          trackPlugin('RestAPI');
        } catch (e: any) {
          // @objectstack/rest is optional
        }

        // Register Dispatcher plugin (auth, graphql, analytics, packages, hub, storage, automation)
        try {
          const { createDispatcherPlugin } = await import('@objectstack/runtime');
          await kernel.use(
            createDispatcherPlugin({ scoping: { enableProjectScoping, projectResolution } }),
          );
          trackPlugin('Dispatcher');
        } catch (e: any) {
          // optional
        }
      }

      // 4. Auto-register AIServicePlugin if not already loaded by config plugins.
      // Registered AFTER Dispatcher so that the ai:routes hook listener is
      // already in place when AIServicePlugin.start() fires the hook.
      const hasAIPlugin = plugins.some(
        (p: any) => p.name === 'com.objectstack.service-ai'
            || p.constructor?.name === 'AIServicePlugin'
      );
      if (!hasAIPlugin && tierEnabled('ai')) {
        try {
          const aiPkg = '@objectstack/service-ai';
          const { AIServicePlugin } = await import(/* webpackIgnore: true */ aiPkg);

          // AIServicePlugin will auto-detect LLM provider from environment variables
          // (AI_GATEWAY_MODEL, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY)
          // No need to manually construct the adapter here.
          await kernel.use(new AIServicePlugin());
          trackPlugin('AIService');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('Cannot find module') && !msg.includes('ERR_MODULE_NOT_FOUND')) {
            console.error('[AI] AIServicePlugin failed to start:', msg);
          }
          // @objectstack/service-ai not installed — AI features unavailable
        }
      }

      // 5. Capability resolver — auto-load service plugins declared in
      // `requires: [...]` that are NOT tier-gated. Each entry maps to a
      // package + factory; if the user already provided an explicit
      // instance via `plugins: [...]` we skip (explicit wins).
      //
      // Adding a new built-in capability is a one-line change here.
      type CapabilitySpec = {
        pkg: string;
        export: string;            // named export to import
        nameMatch: string[];       // plugin.name / constructor.name fragments to detect dupes
        configKey?: string;        // optional config field passed as constructor arg
        extras?: Array<{ pkg: string; export: string; nameMatch: string[] }>;
      };
      const CAPABILITY_PROVIDERS: Record<string, CapabilitySpec> = {
        automation: {
          pkg: '@objectstack/service-automation',
          export: 'AutomationServicePlugin',
          nameMatch: ['service-automation', 'AutomationServicePlugin'],
          // The default node packs ship from the same package; auto-register them
          // so flows actually have executors. Users can opt out by listing
          // their own subset explicitly in `plugins: []` (which sets
          // `nameMatch` to skip these auto-loads).
          extras: [
            { pkg: '@objectstack/service-automation', export: 'CrudNodesPlugin',   nameMatch: ['crud-nodes', 'CrudNodesPlugin'] },
            { pkg: '@objectstack/service-automation', export: 'LogicNodesPlugin',  nameMatch: ['logic-nodes', 'LogicNodesPlugin'] },
            { pkg: '@objectstack/service-automation', export: 'HttpConnectorPlugin', nameMatch: ['http-connector', 'HttpConnectorPlugin'] },
            { pkg: '@objectstack/service-automation', export: 'ScreenNodesPlugin', nameMatch: ['screen-nodes', 'ScreenNodesPlugin'] },
          ],
        },
        analytics: {
          pkg: '@objectstack/service-analytics',
          export: 'AnalyticsServicePlugin',
          nameMatch: ['service-analytics', 'AnalyticsServicePlugin'],
          configKey: 'analyticsCubes',
        },
        audit: {
          pkg: '@objectstack/plugin-audit',
          export: 'AuditPlugin',
          nameMatch: ['audit', 'AuditPlugin'],
        },
        cache: {
          pkg: '@objectstack/service-cache',
          export: 'CacheServicePlugin',
          nameMatch: ['service-cache', 'CacheServicePlugin'],
        },
        storage: {
          pkg: '@objectstack/service-storage',
          export: 'StorageServicePlugin',
          nameMatch: ['service-storage', 'StorageServicePlugin'],
        },
        queue: {
          pkg: '@objectstack/service-queue',
          export: 'QueueServicePlugin',
          nameMatch: ['service-queue', 'QueueServicePlugin'],
        },
        job: {
          pkg: '@objectstack/service-job',
          export: 'JobServicePlugin',
          nameMatch: ['service-job', 'JobServicePlugin'],
        },
        realtime: {
          pkg: '@objectstack/service-realtime',
          export: 'RealtimeServicePlugin',
          nameMatch: ['service-realtime', 'RealtimeServicePlugin'],
        },
        feed: {
          pkg: '@objectstack/service-feed',
          export: 'FeedServicePlugin',
          nameMatch: ['service-feed', 'FeedServicePlugin'],
        },
        mcp: {
          pkg: '@objectstack/plugin-mcp-server',
          export: 'MCPServerPlugin',
          nameMatch: ['mcp-server', 'MCPServerPlugin'],
        },
        marketplace: {
          pkg: '@objectstack/service-package',
          export: 'PackageServicePlugin',
          nameMatch: ['service-package', 'PackageServicePlugin'],
        },
        email: {
          pkg: '@objectstack/plugin-email',
          export: 'EmailServicePlugin',
          nameMatch: ['plugin-email', 'EmailServicePlugin'],
        },
        sharing: {
          pkg: '@objectstack/plugin-sharing',
          export: 'SharingServicePlugin',
          nameMatch: ['plugin-sharing', 'SharingServicePlugin', 'SharingPlugin'],
        },
        reports: {
          pkg: '@objectstack/plugin-reports',
          export: 'ReportsServicePlugin',
          nameMatch: ['plugin-reports', 'ReportsServicePlugin'],
        },
        approvals: {
          pkg: '@objectstack/plugin-approvals',
          export: 'ApprovalsServicePlugin',
          nameMatch: ['plugin-approvals', 'ApprovalsServicePlugin'],
        },
        settings: {
          pkg: '@objectstack/service-settings',
          export: 'SettingsServicePlugin',
          nameMatch: ['service-settings', 'SettingsServicePlugin'],
        },
      };

      const hasPluginMatching = (fragments: string[]) =>
        plugins.some((p: any) => {
          const n = String(p?.name ?? '');
          const c = String(p?.constructor?.name ?? '');
          return fragments.some((f) => n.includes(f) || c.includes(f));
        });

      for (const cap of requires) {
        const spec = CAPABILITY_PROVIDERS[cap];
        if (!spec) continue; // tier-gated capabilities (ai/i18n/ui/auth) handled above
        if (hasPluginMatching(spec.nameMatch)) continue;

        try {
          const mod: any = await import(/* webpackIgnore: true */ spec.pkg);
          const Ctor = mod[spec.export];
          if (!Ctor) {
            console.warn(chalk.yellow(`  ⚠ Capability "${cap}": ${spec.pkg} did not export ${spec.export}`));
            continue;
          }
          // analytics needs cubes from config, others take no args
          let arg: any;
          if (spec.configKey === 'analyticsCubes') {
            const cubes = (config as any).analyticsCubes ?? (config as any).cubes ?? [];
            arg = { cubes };
          } else if (cap === 'email') {
            // Compose EmailServicePlugin options from config.email + OS_EMAIL_* env.
            // Env precedence: env beats config so operators can override per-environment.
            const cfgEmail = (config as any).email ?? {};
            const envProvider = process.env.OS_EMAIL_PROVIDER;
            const provider = (envProvider || cfgEmail.provider || 'log').toLowerCase();
            const apiKey = process.env.OS_EMAIL_API_KEY || cfgEmail.apiKey;
            const envFrom = process.env.OS_EMAIL_FROM;
            // OS_EMAIL_FROM supports either "addr@x" or "Name <addr@x>".
            let defaultFrom = cfgEmail.defaultFrom;
            if (envFrom) {
              const m = envFrom.match(/^\s*(?:"?([^"<]*?)"?\s*<\s*([^>]+)\s*>|(\S+))\s*$/);
              if (m) {
                const name = (m[1] ?? '').trim();
                const address = (m[2] ?? m[3] ?? '').trim();
                if (address) defaultFrom = name ? { name, address } : { address };
              }
            }
            const retries = process.env.OS_EMAIL_RETRIES
              ? Number(process.env.OS_EMAIL_RETRIES)
              : cfgEmail.retries;
            const defaultTemplateContext = {
              appName: process.env.OS_APP_NAME || cfgEmail.appName || (config as any).appName || 'ObjectStack',
              ...(cfgEmail.defaultTemplateContext || {}),
            };
            // Provide a sensible fallback `from` so templates can render
            // even before operators configure SMTP/SaaS. The log transport
            // simply prints to stdout; the address never leaves the box.
            if (!defaultFrom) {
              const slug = String(defaultTemplateContext.appName || 'objectstack')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'objectstack';
              defaultFrom = { name: defaultTemplateContext.appName, address: `no-reply@${slug}.local` };
            }
            arg = {
              provider,
              ...(apiKey ? { apiKey } : {}),
              defaultFrom,
              ...(retries != null && !Number.isNaN(retries) ? { retries } : {}),
              defaultTemplateContext,
            };
            if (provider !== 'log' && !apiKey) {
              console.warn(chalk.yellow(
                `  ⚠ Capability "email": provider='${provider}' but no apiKey found (set OS_EMAIL_API_KEY or config.email.apiKey). Falling back to LogTransport.`,
              ));
              arg.provider = 'log';
            }
          } else if (cap === 'storage') {
            // Storage is now in the default capability slate. If the host
            // hasn't configured a backend explicitly we fall back to the
            // local-disk driver under `.objectstack/data/uploads/` so
            // avatars / attachments / report files work out of the box.
            // In production mode we emit a single loud warning so the
            // operator knows to point storage at S3 / GCS / Azure before
            // shipping (data on a single pod is volatile / non-replicated).
            const cfgStorage = (config as any).storage;
            if (cfgStorage && (cfgStorage.driver || cfgStorage.adapter)) {
              arg = cfgStorage;
            } else {
              const root = process.env.OS_STORAGE_ROOT || '.objectstack/data/uploads';
              arg = { driver: 'local', root };
              if (!isDev) {
                console.warn(chalk.yellow(
                  `  ⚠ StorageServicePlugin using local driver (${root}) — switch to S3/GCS/Azure for production (set config.storage or OS_STORAGE_*).`,
                ));
              }
            }
          }
          await kernel.use(arg !== undefined ? new Ctor(arg) : new Ctor());
          trackPlugin(spec.export);

          if (spec.extras) {
            for (const ex of spec.extras) {
              if (hasPluginMatching(ex.nameMatch)) continue;
              try {
                const exMod: any = await import(/* webpackIgnore: true */ ex.pkg);
                const ExCtor = exMod[ex.export];
                if (ExCtor) {
                  await kernel.use(new ExCtor());
                  trackPlugin(ex.export);
                }
              } catch {
                // optional extra — silently skip
              }
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('Cannot find module') && !msg.includes('ERR_MODULE_NOT_FOUND')) {
            console.error(`[Capability:${cap}] failed to load ${spec.pkg}: ${msg}`);
          } else {
            console.warn(chalk.yellow(`  ⚠ Capability "${cap}" required but ${spec.pkg} is not installed`));
          }
        }
      }

      // ── Studio UI ─────────────────────────────────────────────────
      // In dev mode, Studio UI is enabled by default (use --no-ui to disable).
      // Always serves the pre-built dist/ — no Vite dev server, no extra port.
      const enableUI = flags.ui && tierEnabled('ui');

      if (enableUI) {
        // Pre-detect Console availability so we can demote Studio's root
        // redirect when the Console is going to claim `/`.
        // The `--no-console` flag (or OS_DISABLE_CONSOLE=1 env var) lets a
        // host (e.g. apps/cloud) opt out of the Console entirely so Studio
        // owns `/` — useful for control-plane deployments where the
        // runtime Console is meaningless.
        const consoleEnabled = flags.console && process.env.OS_DISABLE_CONSOLE !== '1';
        const consolePath = consoleEnabled ? resolveConsolePath() : null;
        const consoleWillMount = !!(consolePath && hasConsoleDist(consolePath));

        // The `OS_DISABLE_STUDIO=1` env var lets a host (e.g. apps/cloud,
        // which is a pure control plane) opt out of the Studio designer
        // entirely while keeping Account/Console. Studio is meaningless
        // when there are no per-project kernels in the same process.
        const studioEnabled = process.env.OS_DISABLE_STUDIO !== '1';

        if (studioEnabled) {
          const studioPath = resolveStudioPath();
          if (!studioPath) {
            console.warn(chalk.yellow(`  ⚠ @objectstack/studio not found — skipping UI`));
          } else if (hasStudioDist(studioPath)) {
            const distPath = path.join(studioPath, 'dist');
            // Write API must register BEFORE the static plugin so its POST
            // routes win over `/_studio/*` GET fallback (Hono matches by
            // method, but registering first keeps semantics obvious).
            await kernel.use(createStudioWriteApiPlugin(process.cwd(), { isDev }));
            await kernel.use(createStudioStaticPlugin(distPath, {
              isDev,
              rootRedirect: !consoleWillMount,
            }));
            trackPlugin('StudioUI');
          } else {
            console.warn(chalk.yellow(`  ⚠ Studio dist not found — run "pnpm --filter @objectstack/studio build" first`));
          }
        }

        // ── Account portal ─────────────────────────────────────────
        // The account portal sits next to Studio under `/_account/` and
        // follows the same enable rules — it's a self-service surface
        // for end-users (login, organizations, profile, sessions).
        const accountPath = resolveAccountPath();
        if (!accountPath) {
          console.warn(chalk.yellow(`  ⚠ @objectstack/account not found — skipping Account UI`));
        } else if (hasAccountDist(accountPath)) {
          const accountDistPath = path.join(accountPath, 'dist');
          await kernel.use(createAccountStaticPlugin(accountDistPath, { isDev }));
          trackPlugin('AccountUI');
        } else {
          console.warn(chalk.yellow(`  ⚠ Account dist not found — run "pnpm --filter @objectstack/account build" first`));
        }

        // ── Console portal ──────────────────────────────────────────
        // The opinionated, fork-ready runtime console (`@object-ui/console`,
        // published from the objectstack-ai/objectui monorepo) mounts under
        // `/_console/` exactly like Studio/Account. When present, it owns
        // root `/` redirect (preferred default UI). It is optional — we
        // only mount it when the package resolves and a pre-built `dist/`
        // is present.
        if (consolePath) {
          if (consoleWillMount) {
            const consoleDistPath = path.join(consolePath, 'dist');
            await kernel.use(createConsoleStaticPlugin(consoleDistPath, { isDev }));
            trackPlugin('ConsoleUI');
          } else {
            console.warn(chalk.yellow(`  ⚠ Console dist not found — install \`@object-ui/console\` (already built) or run \`pnpm --filter @object-ui/console build\` in the objectui workspace`));
          }
        }
      }

      // Boot the runtime
      await runtime.start();

      // Brief delay to allow logger writes to flush before restoring stdout
      await new Promise(r => setTimeout(r, 100));
      restoreOutput();

      // ── Migrate-and-exit short-circuit ─────────────────────────────
      // Out-of-band migration mode: the caller (e.g.
      // `apps/cloud/scripts/migrate.ts`) just wants the kernel
      // bootstrap (ObjectQLPlugin → schema sync → metadata hydration)
      // to run once against the configured database, then exit. The
      // HTTP server has already bound `port` at this point but we
      // never accept a request — shutdown immediately so the deploy
      // pipeline can move on.
      if (process.env.OS_MIGRATE_AND_EXIT === '1') {
        console.log(chalk.green(`✓ Migration complete (${loadedPlugins.length} plugins started against ${redactDbUrl(resolvedDatabaseUrl) || 'configured DB'})`));
        try {
          await kernel.shutdown();
        } catch (err: any) {
          console.warn(chalk.yellow(`  ⚠ shutdown warning: ${err?.message ?? err}`));
        }
        process.exit(0);
      }

      // ── Driver introspection ──────────────────────────────────────
      // When the driver was registered by an app preset / per-project
      // factory (ProjectKernelFactory) instead of serve.ts's own
      // OS_DATABASE_URL fallback, `resolvedDriverLabel` is still
      // unset. Probe well-known service names so the banner can show
      // *something* useful regardless of who wired the driver.
      if (!resolvedDriverLabel) {
        try {
          const probe = describeRegisteredDriver(kernel);
          if (probe) {
            resolvedDriverLabel = probe.label;
            resolvedDatabaseUrl = probe.url;
          }
        } catch {
          // best-effort only
        }
      }

      // ── Clean startup summary ──────────────────────────────────────
      printServerReady({
        port,
        configFile: relativeConfig,
        isDev,
        pluginCount: loadedPlugins.length,
        pluginNames: loadedPlugins,
        uiEnabled: enableUI,
        studioPath: STUDIO_PATH,
        accountPath: ACCOUNT_PATH,
        consolePath: loadedPlugins.includes('ConsoleUI') ? CONSOLE_PATH : undefined,
        driverLabel: resolvedDriverLabel,
        databaseUrl: redactDbUrl(resolvedDatabaseUrl),
        multiTenant: String(process.env.OS_MULTI_TENANT ?? 'true').toLowerCase() !== 'false',
      });

      // Kernel already registers SIGINT/SIGTERM handlers during bootstrap.
      // No duplicate handler needed here — just keep the process alive.

    } catch (error: any) {
      restoreOutput();
      console.log('');
      printError(error.message || String(error));
      if (process.env.DEBUG) console.error(chalk.dim(error.stack));
      this.exit(1);
    }
  }
}

/**
 * Best-effort driver introspection.
 *
 * Drivers register themselves under the kernel service name
 * `driver.{driver.name}` (see `DriverPlugin.init`). We probe a list of
 * well-known names and return a single-line label + redacted URL so the
 * startup banner can show *something* even when the driver wasn't
 * registered through this command's own `OS_DATABASE_URL` fallback
 * (e.g. when the example app's preset or `ProjectKernelFactory` wired
 * it). Returns `null` when nothing matches; the caller treats that as
 * "no driver info available" and skips the line.
 */
function describeRegisteredDriver(kernel: any): { label: string; url: string } | null {
  const candidates = [
    'driver.com.objectstack.driver.sql',
    'driver.com.objectstack.driver.mongodb',
    'driver.com.objectstack.driver.turso',
    'driver.com.objectstack.driver.memory',
    'driver.sql', 'driver.mongodb', 'driver.turso', 'driver.memory',
  ];
  for (const name of candidates) {
    let driver: any;
    try { driver = kernel?.getService?.(name); } catch { /* not registered */ }
    if (!driver) continue;

    // SqlDriver: `{ client, connection: string | { filename, host, ... } }`
    const cfg = driver.config;
    if (cfg) {
      const client = cfg.client;
      const conn = cfg.connection;
      let url = '';
      if (typeof conn === 'string') {
        url = conn;
      } else if (conn && typeof conn === 'object') {
        url = conn.filename
          ?? (conn.host ? `${conn.host}${conn.port ? `:${conn.port}` : ''}${conn.database ? `/${conn.database}` : ''}` : '');
      }
      const label = client ? `SqlDriver(${client})` : (driver.name ?? 'SqlDriver');
      return { label, url: url || '(unknown)' };
    }

    // MongoDB / Turso drivers expose the URL on the instance itself.
    if (driver.url) {
      const label = driver.constructor?.name ?? driver.name ?? 'Driver';
      return { label, url: String(driver.url) };
    }

    // InMemoryDriver — no URL.
    return {
      label: driver.constructor?.name ?? driver.name ?? 'Driver',
      url: '(in-memory)',
    };
  }
  return null;
}
