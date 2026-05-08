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
  static override description = 'Start ObjectStack server with plugins from configuration';

  static override args = {
    config: Args.string({ description: 'Configuration file path', required: false, default: 'objectstack.config.ts' }),
  };

  static override flags = {
    port: Flags.string({ char: 'p', description: 'Server port', default: process.env.PORT ?? '3000' }),
    dev: Flags.boolean({ description: 'Run in development mode (load devPlugins)' }),
    ui: Flags.boolean({ description: 'Enable Studio UI at /_studio/ (default: true)', default: true, allowNo: true }),
    server: Flags.boolean({ description: 'Start HTTP server plugin', default: true, allowNo: true }),
    prebuilt: Flags.boolean({ description: 'Skip esbuild/bundle-require — load config as native ESM (production mode)', default: false }),
    preset: Flags.string({
      description: 'Plugin tier preset: minimal | default | full (overridden by config.tiers if set)',
      options: ['minimal', 'default', 'full'],
    }),
  };

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
    
    if (!fs.existsSync(absolutePath)) {
      printError(`Configuration file not found: ${absolutePath}`);
      console.log(chalk.dim('  Hint: Run `objectstack init` to create a new project'));
      this.exit(1);
    }

    // Quiet loading — only show a single spinner line
    console.log('');
    console.log(chalk.dim(`  Loading ${relativeConfig}...`));

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
      const { mod } = flags.prebuilt
        ? { mod: await import(absolutePath.startsWith('/') ? `file://${absolutePath}` : absolutePath) }
        : await bundleRequire({ filepath: absolutePath });

      let config = mod.default || mod;

      if (!config) {
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
      if (shouldBootWithLibrary(config)) {
        // The boot stack returns only `{plugins, api}` — preserve the
        // original stack metadata (notably `requires`, `analyticsCubes`,
        // `tiers`) so the capability resolver further down can read it.
        const originalConfig = config;
        const resolvedMode = config.bootMode ?? process.env.OS_MODE ?? 'standalone';
        if (resolvedMode === 'standalone') {
          const { createStandaloneStack } = await import('@objectstack/runtime');
          const bootResult = await createStandaloneStack(config.standalone);
          config = { ...originalConfig, ...bootResult } as any;
        } else {
          const { createBootStack } = await import('@objectstack/service-cloud');
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

      // 5b. Auto-register AuthPlugin (and paired Security/Audit) when the
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

          if (!secret) {
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

            await kernel.use(new AuthPlugin({
              secret,
              baseUrl,
              socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
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

        try {
          const { createRestApiPlugin } = await import('@objectstack/rest');
          await kernel.use(
            createRestApiPlugin({ api: { api: { enableProjectScoping, projectResolution } } as any }),
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
        const consolePath = resolveConsolePath();
        const consoleWillMount = !!(consolePath && hasConsoleDist(consolePath));

        const studioPath = resolveStudioPath();
        if (!studioPath) {
          console.warn(chalk.yellow(`  ⚠ @objectstack/studio not found — skipping UI`));
        } else if (hasStudioDist(studioPath)) {
          const distPath = path.join(studioPath, 'dist');
          await kernel.use(createStudioStaticPlugin(distPath, {
            isDev,
            rootRedirect: !consoleWillMount,
          }));
          trackPlugin('StudioUI');
        } else {
          console.warn(chalk.yellow(`  ⚠ Studio dist not found — run "pnpm --filter @objectstack/studio build" first`));
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
        // The opinionated, fork-ready runtime console (`@objectstack/console`)
        // mounts under `/_console/` exactly like Studio/Account. When
        // present, it owns root `/` redirect (preferred default UI). It
        // is optional — we only mount it when the package resolves and
        // a pre-built `dist/` is present.
        if (consolePath) {
          if (consoleWillMount) {
            const consoleDistPath = path.join(consolePath, 'dist');
            await kernel.use(createConsoleStaticPlugin(consoleDistPath, { isDev }));
            trackPlugin('ConsoleUI');
          } else {
            console.warn(chalk.yellow(`  ⚠ Console dist not found — run "pnpm --filter @objectstack/console build" first`));
          }
        }
      }

      // Boot the runtime
      await runtime.start();

      // Brief delay to allow logger writes to flush before restoring stdout
      await new Promise(r => setTimeout(r, 100));
      restoreOutput();

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
