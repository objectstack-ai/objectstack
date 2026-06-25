// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import path from 'path';
import fs from 'fs';
import net from 'net';
import chalk from 'chalk';
import { bundleRequire } from 'bundle-require';
import { loadConfig, BUNDLE_REQUIRE_EXTERNALS } from '../utils/config.js';
import { isHostConfig, shouldBootWithLibrary } from '../utils/plugin-detection.js';
import { readEnvWithDeprecation } from '@objectstack/types';
import { resolveObjectStackHome } from '@objectstack/runtime';
import { LOG_LEVELS, resolveLogLevel, readLogLevelEnv } from '../utils/log-level.js';
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
  CONSOLE_PATH,
  resolveConsolePath,
  hasConsoleDist,
  createConsoleStaticPlugin,
} from '../utils/console.js';
import dotenvFlow from 'dotenv-flow';

// ---------------------------------------------------------------------------
// Observability bootstrap for `objectstack serve`
//
// Reads OS_OBS_* env vars and returns a `{ metrics, errorReporter }` block
// to hand off to `createDispatcherPlugin`. Default is fully noop so the
// CLI imposes no runtime cost when observability isn't configured.
//
// Env knobs (also documented in apps/cloud/server/observability.ts — keep
// the two in sync if you tweak names):
//   OS_OBS_EXPORTER       noop (default) | console | json | otlp
//   OS_OTLP_ENDPOINT      OTLP/HTTP root, e.g. https://otlp.grafana.net/otlp
//   OS_OTLP_HEADERS       comma-separated Key=Value; values may be URL-encoded
//                         (Grafana ships `Authorization=Basic%20<base64>`)
//   OS_OBS_SERVICE_NAME   resource attr, default `objectstack`
//   OS_OBS_DEPLOYMENT_ENV resource attr, default `production`
//   OS_OTLP_FLUSH_MS      buffer flush interval (default 10000)
// ---------------------------------------------------------------------------

function parseObsHeaders(spec: string | undefined): Record<string, string> {
  if (!spec) return {};
  const out: Record<string, string> = {};
  for (const pair of spec.split(',')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    const k = pair.slice(0, i).trim();
    const raw = pair.slice(i + 1).trim();
    if (!k) continue;
    let v = raw;
    try { v = decodeURIComponent(raw); } catch { /* keep raw */ }
    out[k] = v;
  }
  return out;
}

async function buildServeObservability(): Promise<{ metrics: any; errorReporter: any } | undefined> {
  const exporter = (process.env.OS_OBS_EXPORTER ?? 'noop').toLowerCase();
  if (exporter === 'noop') return undefined; // dispatcher falls back to its own NoopMetricsRegistry
  let mod: any;
  try {
    mod = await import('@objectstack/observability');
  } catch {
    return undefined; // observability pkg not installed — silently skip
  }
  try {
    let metrics: any;
    if (exporter === 'console' || exporter === 'json') {
      metrics = new mod.ConsoleMetricsRegistry();
    } else if (exporter === 'otlp') {
      const endpoint = process.env.OS_OTLP_ENDPOINT;
      if (!endpoint) {
        console.warn('[observability] OS_OBS_EXPORTER=otlp but OS_OTLP_ENDPOINT is empty — falling back to noop');
        return undefined;
      }
      const resource = {
        'service.name': process.env.OS_OBS_SERVICE_NAME ?? 'objectstack',
        'deployment.environment': process.env.OS_OBS_DEPLOYMENT_ENV ?? 'production',
      };
      metrics = new mod.OtlpHttpMetricsRegistry({
        endpoint,
        headers: parseObsHeaders(process.env.OS_OTLP_HEADERS),
        resource,
        onError: (err: unknown) => {
          console.warn('[observability] OTLP export failed:', (err as any)?.message ?? err);
        },
      });
      const flushMs = Number(process.env.OS_OTLP_FLUSH_MS ?? '10000');
      if (flushMs > 0) {
        const timer = setInterval(() => {
          (metrics as any).flush?.().catch(() => { /* swallowed via onError */ });
        }, flushMs);
        if (typeof (timer as any).unref === 'function') (timer as any).unref();
      }
    } else {
      return undefined;
    }
    const errorReporter = new mod.ConsoleErrorReporter();
    return { metrics, errorReporter };
  } catch (err) {
    console.warn('[observability] init failed; falling back to noop:', (err as any)?.message ?? err);
    return undefined;
  }
}

// Probe whether a TCP port can be bound right now.
const isPortAvailable = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
};

// Helper to find available port (dev convenience — see the gated caller).
const getAvailablePort = async (startPort: number): Promise<number> => {
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
    port: Flags.string({ char: 'p', description: 'Server port', default: readEnvWithDeprecation('OS_PORT', 'PORT', { silent: true }) ?? '3000' }),
    dev: Flags.boolean({ description: 'Run in development mode (load devPlugins)' }),
    ui: Flags.boolean({ description: 'Enable the bundled Console portal at /_console/ when @object-ui/console is installed (default: true)', default: true, allowNo: true }),
    console: Flags.boolean({
      description: 'Mount the Console UI at /_console/ when the package is installed (default: true).',
      default: true,
      allowNo: true,
    }),
    server: Flags.boolean({ description: 'Start HTTP server plugin', default: true, allowNo: true }),
    prebuilt: Flags.boolean({ description: 'Skip esbuild/bundle-require — load config as native ESM (production mode)', default: false }),
    preset: Flags.string({
      description: 'Plugin tier preset: minimal | default | full (overridden by config.tiers if set)',
      options: ['minimal', 'default', 'full'],
    }),
    'log-level': Flags.string({
      description: 'Kernel logger level. Defaults to $OS_LOG_LEVEL / $LOG_LEVEL, else `warn` so flow/hook execution failures surface (ADR-0032). Use `silent` to fully quiet the runtime.',
      options: [...LOG_LEVELS],
    }),
    verbose: Flags.boolean({ char: 'v', description: 'Verbose output — shortcut for --log-level debug.' }),
  };

  /**
   * Capabilities auto-added to every app's `requires` for every preset
   * EXCEPT `minimal`. These form the foundation that every server-side
   * runtime expects to exist (background work, settings persistence,
   * transactional mail, file uploads, notifications). Apps may still list
   * these in `requires:` explicitly — duplicates are de-duped.
   *
   * `messaging` is foundational because, post-ADR-0030, notifications flow
   * through a single ingress (`NotificationService.emit`): collaboration
   * `@mention` / assignment (plugin-audit) and the `notify` flow node deliver
   * via the messaging pipeline, and the Console bell reads its materialization
   * (`sys_inbox_message`). Without it those notifications silently no-op.
   *
   * Opt out: `objectstack serve --preset minimal`.
   *
   * Cloud / multi-environment hosts (which live in a separate distribution)
   * mirror this list on their per-project kernels.
   */
  static readonly ALWAYS_ON_CAPABILITIES: readonly string[] = Object.freeze([
    'queue', 'job', 'cache', 'settings', 'email', 'storage', 'sharing', 'messaging',
    // `analytics` is foundational post-ADR-0021: the AnalyticsService backs the
    // dataset/cube query endpoints (`/api/v1/analytics/*`). It must exist even
    // when an app declares no `analyticsCubes`, because a `dataset` can be
    // authored/previewed inline (Studio) and compiled on the fly. Without it the
    // dataset preview + dashboard/report analytics widgets silently no-op.
    'analytics',
  ]);

  /**
   * Auto-registered plugin tiers. Plugins explicitly listed in
   * `config.plugins` are always loaded — tiers only gate the optional
   * auto-registration blocks below (AIService, I18n, UI portals, etc.).
   */
  static readonly TIER_PRESETS: Record<string, string[]> = {
    minimal: ['core'],
    default: ['core', 'i18n', 'ui', 'ai', 'auth'],
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

    const requestedPort = parseInt(flags.port);
    let port = requestedPort;
    // Port-conflict policy differs by mode:
    //
    //  • Dev (`os dev`, or NODE_ENV=development): hop to the next free port
    //    so several example apps can run side-by-side without manual config.
    //
    //  • Production (`os start`): NEVER silently drift off the configured
    //    port. A drifted port breaks reverse-proxy upstreams, better-auth
    //    callback URLs, and CORS trusted-origins in ways that surface as
    //    opaque 403/502s with no obvious cause. Fail loudly so the operator
    //    frees the port (or sets PORT / --port) before anything boots.
    const portAutoShiftAllowed = flags.dev || process.env.NODE_ENV === 'development';
    if (portAutoShiftAllowed) {
      try {
        port = await getAvailablePort(requestedPort);
      } catch {
        // Ignore — fall through and try the requested port.
      }
    } else if (!(await isPortAvailable(requestedPort))) {
      console.log('');
      printError(`Port ${requestedPort} is already in use.`);
      console.log(chalk.dim('  ObjectStack does not auto-select a different port in production mode:'));
      console.log(chalk.dim('  a drifted port silently breaks reverse-proxy, OAuth callback, and CORS config.'));
      console.log(chalk.dim('  Free the port, or pick another via PORT=<port> (or --port <port>).'));
      this.exit(1);
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
    let useEmptyBoot = false;
    if (configMissing) {
      const { resolveDefaultArtifactPath } = await import('@objectstack/runtime');
      const artifactSource = resolveDefaultArtifactPath();
      if (!artifactSource) {
        // Quick-start mode: `objectstack start` lets the user boot an
        // empty kernel with no config and no artifact, then install apps
        // from the marketplace via the Console. The CLI signals this by
        // setting OS_BOOT_EMPTY=1 in the child env.
        if (process.env.OS_BOOT_EMPTY === '1') {
          useEmptyBoot = true;
        } else {
          printError(`Configuration file not found: ${absolutePath}`);
          console.log(chalk.dim('  Hint: Run `objectstack init` to create a new project,'));
          console.log(chalk.dim('        `objectstack start` to boot an empty kernel against your marketplace,'));
          console.log(chalk.dim('        or run `objectstack build` first / set OS_ARTIFACT_PATH.'));
          this.exit(1);
        }
      }
      useArtifactFallback = true;
    }

    // Quiet loading — only show a single spinner line
    console.log('');
    if (useEmptyBoot) {
      console.log(chalk.dim('  No objectstack.config.ts or artifact found — booting empty kernel...'));
    } else if (useArtifactFallback) {
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
          : await bundleRequire({ filepath: absolutePath, external: BUNDLE_REQUIRE_EXTERNALS });

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

      // Package docs (ADR-0046): flat `src/docs/*.md` are collected into the
      // stack at COMPILE time (compile.ts step 3d). The config-load path here
      // re-derives metadata from `defineStack(...)`, which never carries the
      // markdown docs — so without this, `os dev`/`os serve` against a config
      // serves ZERO docs (GET /meta/doc empty) even though `os build` produces
      // them and an artifact boot serves them. Mirror compile's collection so
      // docs render under /docs/<name> in dev exactly as from a built artifact.
      // Collection only (no lint-fail): docs are additive; never block boot.
      if (!useArtifactFallback) {
        try {
          const { collectDocsFromSrc } = await import('../utils/collect-docs.js');
          const collected = collectDocsFromSrc(absolutePath);
          if (collected.docs.length > 0) {
            const byName = new Map<string, any>();
            for (const d of (Array.isArray((config as any).docs) ? (config as any).docs : [])) {
              if (d?.name) byName.set(d.name, d);
            }
            for (const d of collected.docs) byName.set(d.name, d);
            config = { ...config, docs: Array.from(byName.values()) };
          }
        } catch {
          /* docs are additive — never block boot on collection */
        }
      }

      // Boot-mode dispatch: this open-core CLI only supports `standalone`
      // (and the artifact-fallback shortcut). Cloud / multi-environment
      // boot modes live in a separate distribution and are no longer
      // resolved from this package.
      if (useArtifactFallback || shouldBootWithLibrary(config)) {
        // The boot stack returns only `{plugins, api}` — preserve the
        // original stack metadata (notably `requires`, `analyticsCubes`,
        // `tiers`) so the capability resolver further down can read it.
        const originalConfig = config;
        const resolvedMode = config.bootMode ?? process.env.OS_MODE ?? 'standalone';
        if (useArtifactFallback) {
          // Artifact-only boot — no objectstack.config.ts authored.
          // When `useEmptyBoot` is set the user asked for a quick-start
          // ("objectstack start" with nothing to load); skip the
          // "missing artifact" error and assemble a bare kernel that
          // can later install marketplace apps at runtime.
          const { createDefaultHostConfig } = await import('@objectstack/runtime');
          const bootResult = await createDefaultHostConfig({ requireArtifact: !useEmptyBoot, dev: isDev });
          config = { ...originalConfig, ...bootResult } as any;
        } else if (resolvedMode === 'standalone') {
          const { createStandaloneStack } = await import('@objectstack/runtime');
          // Anchor the default sqlite database under the project folder
          // (next to objectstack.config.ts) instead of the global
          // ~/.objectstack home, so per-project data stays per-project.
          const standaloneInput = {
            ...(config.standalone ?? {}),
            projectRoot: (config.standalone?.projectRoot ?? path.dirname(absolutePath)),
            // #2229: dev enables the native-better-sqlite3 → wasm → in-memory
            // step-down in the shared datasource factory; prod fails loudly.
            dev: isDev,
          };
          const bootResult = await createStandaloneStack(standaloneInput);
          config = { ...originalConfig, ...bootResult } as any;
        } else {
          throw new Error(
            `Boot mode '${resolvedMode}' is not available in the open-core CLI.\n`
            + `Only 'standalone' is supported here. Cloud / multi-environment hosts ship\n`
            + `from a separate distribution. Either switch to bootMode='standalone' or use\n`
            + `the cloud-aware CLI.`,
          );
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

      // Resolve the kernel logger level. Honors --verbose / --log-level and
      // $OS_LOG_LEVEL / $LOG_LEVEL, defaulting to `warn` so flow/hook
      // execution failures surface even when the CLI manages its own output
      // (ADR-0032 "fail loudly"; see #1533). `--log-level silent` restores the
      // old fully-quiet behavior.
      const loggerConfig = {
        level: resolveLogLevel({
          verbose: flags.verbose,
          flag: flags['log-level'],
          envLevel: readLogLevelEnv(),
        }),
      };

      // Cluster wiring: env-driven driver selection (mirrors OS_DATABASE_URL).
      // The remote driver self-registers on import; import it dynamically so it
      // works in BOTH config-boot and compiled-artifact mode. Open-core ships
      // only the in-memory driver — remote drivers (e.g. redis) come from the EE
      // distribution; if absent we fall back to the in-memory cluster.
      let clusterConfig: { driver: string; url?: string } | undefined;
      const __clusterDriver = process.env.OS_CLUSTER_DRIVER?.trim();
      if (__clusterDriver && __clusterDriver !== 'memory') {
        // Multi-node authorization gate (open mechanism): a distribution (e.g.
        // an EE license) may deny multi-node. On denial, downgrade to
        // single-node rather than fail — multi-node is an add-on, never brick.
        // Dynamic, non-literal specifier so the CLI does not statically depend
        // on the cluster package (mirrors the remote-driver import below).
        const __clusterPkg: string = '@objectstack/service-cluster';
        const { checkMultiNodeAllowed } = (await import(__clusterPkg)) as {
          checkMultiNodeAllowed: () => { allowed: boolean; reason?: string };
        };
        const __gate = checkMultiNodeAllowed();
        if (!__gate.allowed) {
          console.warn(
            `[cluster] multi-node not authorized (${__gate.reason ?? 'denied'}) — ` +
            `downgrading to single-node (in-memory cluster). Remove OS_CLUSTER_DRIVER to silence.`,
          );
        } else {
          try { await import(`@objectstack/service-cluster-${__clusterDriver}`); }
          catch { /* may already be registered by the loaded config */ }
          clusterConfig = { driver: __clusterDriver, url: process.env.OS_REDIS_URL };
        }
      }
      const runtime = new Runtime({
        kernel: {
            logger: loggerConfig
        },
        cluster: clusterConfig as any,
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
           if (/^wasm-sqlite:\/\//i.test(u) || /\.wasm\.db$/i.test(u)) return 'sqlite-wasm';
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
             const filePath = (databaseUrl ?? ':memory:').replace(/^file:/, '').replace(/^sqlite:/, '').replace(/^sql:\/\//, '');
             // Probe-by-connect with a dev-only native → wasm → in-memory
             // step-down (#2229). better-sqlite3 loads its native addon lazily
             // (first query), so an ABI mismatch is invisible here and would
             // otherwise surface much later as a runtime crash. resolveSqliteDriver
             // forces the load and degrades gracefully in dev / fails loudly in prod.
             const { resolveSqliteDriver } = await import('@objectstack/service-datasource');
             const resolved = await resolveSqliteDriver({
               filename: filePath,
               dev: isDev,
               // #2186: in dev, self-heal a persisted DB when a metadata change
               // relaxes a constraint (loosen-only; never destructive / never in prod).
               autoMigrate: isDev ? 'safe' : undefined,
               warn: (m) => console.warn(chalk.yellow(m)),
             });
             await kernel.use(new DriverPlugin(resolved.driver));
             trackPlugin(resolved.engine === 'memory' ? 'MemoryDriver' : resolved.engine === 'sqlite-wasm' ? 'SqliteWasmDriver' : 'SqlDriver');
             resolvedDriverLabel = resolved.label;
             resolvedDatabaseUrl = resolved.engine === 'memory' ? '(in-memory)' : (databaseUrl ?? ':memory:');
           } else if (driverType === 'sqlite-wasm' || driverType === 'wasm-sqlite' || driverType === 'wasm') {
             const { SqliteWasmDriver } = await import('@objectstack/driver-sqlite-wasm');
             const filePath = (databaseUrl ?? ':memory:').replace(/^file:/, '').replace(/^wasm-sqlite:\/\//, '').replace(/^sqlite:/, '');
             await kernel.use(new DriverPlugin(new SqliteWasmDriver({
               filename: filePath,
               persist: 'on-disconnect',
             }) as any));
             trackPlugin('SqliteWasmDriver');
             resolvedDriverLabel = 'SqliteWasmDriver';
             resolvedDatabaseUrl = databaseUrl ?? ':memory:';
           } else if (driverType === 'postgres' || driverType === 'postgresql' || driverType === 'pg') {
             const { SqlDriver } = await import('@objectstack/driver-sql');
             await kernel.use(new DriverPlugin(new SqlDriver({
               client: 'pg',
               connection: databaseUrl,
               pool: { min: 0, max: 5 },
               autoMigrate: isDev ? 'safe' : undefined, // #2186 dev loosen-only self-heal
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
               autoMigrate: isDev ? 'safe' : undefined, // #2186 dev loosen-only self-heal
             }) as any));
             trackPlugin('MySQLDriver');
             resolvedDriverLabel = 'SqlDriver(mysql2)';
             resolvedDatabaseUrl = databaseUrl;
           } else if (isDev) {
             // Default in dev (no DB configured): prefer native SQLite for
             // production-like SQL at native speed, with a graceful step-down to
             // wasm SQLite (real SQL + on-disk persistence) then in-memory when the
             // native better-sqlite3 binary is unavailable — not built, ABI mismatch
             // after a Node upgrade (e.g. NODE_MODULE_VERSION change), or a blocked
             // prebuild download. Shared with the explicit-file branch and the
             // datasource factory via resolveSqliteDriver (#2229), which probes by
             // actually opening a connection + running SELECT 1 (better-sqlite3 loads
             // its native addon lazily at first query, not at construction).
             const { resolveSqliteDriver } = await import('@objectstack/service-datasource');
             const resolved = await resolveSqliteDriver({
               filename: ':memory:',
               dev: true,
               autoMigrate: 'safe', // #2186 dev loosen-only self-heal
               warn: (m) => console.warn(chalk.yellow(m)),
             });
             await kernel.use(new DriverPlugin(resolved.driver));
             trackPlugin(resolved.engine === 'memory' ? 'MemoryDriver' : resolved.engine === 'sqlite-wasm' ? 'SqliteWasmDriver' : 'SqlDriver');
             resolvedDriverLabel = resolved.label;
             resolvedDatabaseUrl = resolved.engine === 'memory' ? '(in-memory)' : ':memory:';
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
      // In multi-tenant cloud deployments (e.g. *.objectos.ai), every
      // public hostname is expected to map to a `sys_environment` row
      // whose `hostname` column matches the request `Host`. Without this
      // guard, an unknown subdomain like `demo-xxx.objectos.ai` happily
      // renders the control-plane Console SPA (served statically by
      // createConsoleStaticPlugin), making the deployment look like an
      // empty env rather than a missing one. We respond with a clear
      // 404 instead.
      //
      // Activation: only when OS_ROOT_DOMAIN is set (e.g. "objectos.ai").
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
                // ObjectOSEnvironmentPlugin's init which runs in plugin
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
      <a href="https://cloud.objectos.ai/">ObjectStack Cloud console</a>.
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

      // 5. Marketplace browse/install + runtime-config — auto-wired from the
      // open `@objectstack/cloud-connection` package, gated on a resolved
      // cloud URL.
      //
      // History: ADR-0006 Phase 4 deleted the framework's DUPLICATE copies
      // (which lived in `@objectstack/runtime`) because the canonical
      // implementation then lived in the cloud distribution. ADR-0008 then
      // open-sourced that client surface into `@objectstack/cloud-connection`
      // (Apache-2.0, framework-side), so the CLI can wire it again WITHOUT
      // crossing the open-core boundary — there is no longer a cloud-only
      // copy to duplicate. This restores marketplace for `objectstack start`
      // empty-boot, which advertises "boot an empty kernel against your
      // marketplace" but, with no config/artifact, has no host to carry the
      // wiring (the only place it can come from is the CLI itself).
      //
      // Mirrors the objectos-ee single-env host wiring: proxy + install-local
      // + cloud-connection only when `resolveCloudUrl()` is truthy
      // (OS_CLOUD_URL=off -> nothing mounts, preserving the vanilla
      // marketplace-less `objectstack dev`). Each plugin self-registers its
      // own Setup nav bundle in start(), so no manual bundle registration is
      // needed here.
      //
      // SKIPPED in runtime/host-kernel mode: the cloud distribution
      // (objectos-stack) wires its own MarketplaceProxyPlugin on the host
      // kernel, so auto-wiring here would double-mount. Detect runtime mode by
      // ObjectOSEnvironmentPlugin (same signal the AuthPlugin guard below
      // uses); OS_CLOUD_URL alone is NOT a reliable signal -- a regular
      // `objectstack dev` app sets it precisely to enable the marketplace.
      const isRuntimeHostKernel = plugins.some(
        (p: any) => p?.name === 'com.objectstack.runtime.objectos-environment'
          || p?.constructor?.name === 'ObjectOSEnvironmentPlugin'
      );
      if (!isRuntimeHostKernel) {
        try {
          const ccPkg = '@objectstack/cloud-connection';
          const {
            MarketplaceProxyPlugin,
            MarketplaceInstallLocalPlugin,
            RuntimeConfigPlugin,
            createCloudConnectionPlugin,
            resolveCloudUrl,
          } = await import(/* webpackIgnore: true */ ccPkg);
          const marketplaceUrl = resolveCloudUrl();
          if (marketplaceUrl) {
            await kernel.use(new MarketplaceProxyPlugin({ controlPlaneUrl: marketplaceUrl }));
            await kernel.use(new MarketplaceInstallLocalPlugin({ controlPlaneUrl: marketplaceUrl }));
            // Same-origin /cloud-connection/* surface (status + device-code
            // bind + control-plane catalog views) in single-environment mode.
            await kernel.use(createCloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: marketplaceUrl }));
            // Server-pushed runtime config so the Console knows marketplace +
            // install-local are live (same-origin; install into THIS kernel).
            await kernel.use(new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true, installLocal: true }));
            trackPlugin('Marketplace');
          }
        } catch (err: any) {
          console.warn(chalk.yellow(`  \u26a0 Marketplace/cloud-connection wiring failed: ${err?.message ?? err}`));
        }
      }

      // 5c. Auto-register PlatformObjectsPlugin so platform-default
      // translation bundles (Setup App + metadata-type configuration
      // forms shipped by @objectstack/platform-objects) are contributed
      // into the kernel's i18n service. Without this, Setup nav labels
      // and metadata-admin form labels fall back to English literals
      // even when Accept-Language requests another locale.
      const hasPlatformObjectsPlugin = plugins.some(
        (p: any) => p?.name === 'com.objectstack.platform-objects'
          || p?.constructor?.name === 'PlatformObjectsPlugin'
      );
      if (!hasPlatformObjectsPlugin) {
        try {
          const platformPkg = '@objectstack/platform-objects/plugin';
          const { PlatformObjectsPlugin } = await import(/* webpackIgnore: true */ platformPkg);
          await kernel.use(new PlatformObjectsPlugin());
          trackPlugin('PlatformObjects');
        } catch (err: any) {
          console.warn(chalk.yellow(`  ⚠ PlatformObjectsPlugin auto-inject failed: ${err?.message ?? err}`));
        }
      }

      // 5d. Auto-register AuthPlugin (and paired Security/Audit) when the
      // 'auth' tier is enabled and no auth plugin is already configured.
      // The Console expects /api/v1/auth/* to be served by better-auth via
      // @objectstack/plugin-auth. Without this block, running
      // `objectstack dev` on a vanilla user stack would 404 on
      // login/register flows.
      const hasAuthPlugin = plugins.some(
        (p: any) => p?.name === 'com.objectstack.auth' || p?.constructor?.name === 'AuthPlugin'
      );
      if (!hasAuthPlugin && tierEnabled('auth')) {
        try {
          const authPkg = '@objectstack/plugin-auth';
          const { AuthPlugin } = await import(/* webpackIgnore: true */ authPkg);

          // In dev, fall back to a stable local secret so users don't have
          // to set OS_AUTH_SECRET just to try the login/register flow.
          const secret = readEnvWithDeprecation('OS_AUTH_SECRET', ['AUTH_SECRET', 'BETTER_AUTH_SECRET'])
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
          // Detect runtime mode by the presence of ObjectOSEnvironmentPlugin
          // (added by createObjectOSStack). OS_CLOUD_URL alone is NOT a
          // reliable signal — a regular `objectstack dev` app may set it
          // just to enable the marketplace proxy yet still want its own
          // local AuthPlugin.
          const isHostKernel = plugins.some(
            (p: any) => p?.name === 'com.objectstack.runtime.objectos-environment'
              || p?.constructor?.name === 'ObjectOSEnvironmentPlugin'
          );
          if (isHostKernel) {
            console.warn(chalk.yellow(
              '  ⚠ AuthPlugin skipped on host kernel — runtime mode (ObjectOSEnvironmentPlugin detected).\n' +
              '    Auth is owned per-project by ArtifactKernelFactory in the cloud distribution.'
            ));
          } else if (!secret) {
            console.warn(chalk.yellow('  ⚠ AuthPlugin skipped — set OS_AUTH_SECRET to enable authentication in production'));
          } else {
            const baseUrl = readEnvWithDeprecation('OS_AUTH_URL', ['OS_AUTH_BASE_URL', 'AUTH_BASE_URL', 'BETTER_AUTH_URL'])
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
            // Honour `OS_PREVIEW_BASE_DOMAINS` (used by the cloud preview routing)
            // and add `http://*.<base>:*` patterns.
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
            // `localhost:<port>` still works for non-preview Console.
            if (isDev && !trustedOrigins.includes('http://localhost:*')) {
              trustedOrigins.push('http://localhost:*');
            }
            // Per-project subdomains: when OS_ROOT_DOMAIN is set (multi-
            // project hosting under `*.<root>`), every project hostname
            // must be trusted by better-auth or sign-up/sign-in is
            // rejected with "Invalid origin". Mirrors the OS_COOKIE_DOMAIN
            // wildcard semantics — they are always set together.
            const rootDomain = readEnvWithDeprecation('OS_ROOT_DOMAIN', 'ROOT_DOMAIN')?.trim();
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
              // twoFactor stays opt-in until the Console login UI ships the
              // complete TOTP challenge flow. Enabling only the backend plugin
              // lets users enroll but can leave them unable to finish login.
              //
              // (api-key plugin: not yet shipped by better-auth — generic
              // CRUD on `sys_api_key` handles row creation in the meantime.)
              plugins: {
                admin: String(process.env.OS_AUTH_ADMIN ?? 'true').toLowerCase() !== 'false',
                twoFactor: String(process.env.OS_AUTH_TWO_FACTOR ?? 'false').toLowerCase() === 'true',
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

            // ADR-0048 — the platform apps (Setup/Studio/Account) moved out of
            // plugin-auth's manifest into their own one-app packages. Register
            // each after AuthPlugin (best-effort; skipped if not installed).
            for (const [appPkg, factory] of [
              ['@objectstack/setup', 'createSetupAppPlugin'],
              ['@objectstack/studio', 'createStudioAppPlugin'],
              ['@objectstack/account', 'createAccountAppPlugin'],
            ] as const) {
              try {
                const appMod: any = await import(/* webpackIgnore: true */ appPkg);
                await kernel.use(appMod[factory]());
                trackPlugin(appPkg);
              } catch {
                // best-effort — the app package is optional
              }
            }

            // Pair: OrgScopingPlugin (multi-tenant) — optional, must register BEFORE SecurityPlugin
            // OrgScopingPlugin provides `organization_id` auto-stamp, per-org
            // seed-replay, and default-org bootstrap. SecurityPlugin probes
            // the `org-scoping` service at start() time and conditionally
            // strips the wildcard `tenant_isolation` RLS when this plugin
            // is absent — so registration order matters.
            const multiTenant = String(readEnvWithDeprecation('OS_MULTI_ORG_ENABLED', 'OS_MULTI_TENANT') ?? 'false').toLowerCase() !== 'false';
            if (multiTenant) {
              try {
                const orgScopingPkg = '@objectstack/plugin-org-scoping';
                const { OrgScopingPlugin } = await import(/* webpackIgnore: true */ orgScopingPkg);
                await kernel.use(new OrgScopingPlugin());
                trackPlugin('OrgScoping');
              } catch {
                // optional — multi-tenant mode requested but plugin not installed
              }
            }

            // Pair: SecurityPlugin (RBAC) — optional
            try {
              const securityPkg = '@objectstack/plugin-security';
              const { SecurityPlugin, appDefaultProfileName } = await import(/* webpackIgnore: true */ securityPkg);
              // ADR-0056 D7 — honor an app-declared default profile. A stack
              // permission set marked `isProfile && isDefault` becomes the
              // fallback for users with no explicit grants. The SecurityPlugin's
              // own scan only sees its built-in sets, so the CLI passes the
              // declared name through explicitly (undefined → built-in default).
              const appDefaultProfile = appDefaultProfileName((config as any)?.permissions);
              await kernel.use(new SecurityPlugin(appDefaultProfile ? { fallbackPermissionSet: appDefaultProfile } : undefined));
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
        // Read environment-scoping config from the stack's top-level `api` field
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
          // Auto-wire observability from env so production deployments
          // can ship metrics / errors to OTLP backends (Grafana Cloud,
          // Honeycomb, etc.) without app-level glue. Falls back to noop
          // when OS_OBS_EXPORTER is unset / unknown — zero-cost when
          // off, and never crashes boot if exporter init throws.
          const observability = await buildServeObservability();
          await kernel.use(
            createDispatcherPlugin({
              scoping: { enableProjectScoping, projectResolution },
              observability,
            }),
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
      // Resolve optional plugin packages from the HOST APP's context (the app
      // being served declares them as deps — including private packages like
      // @objectstack/service-ai-studio that the framework CLI itself does not
      // depend on). A bare import would resolve relative to the CLI's location
      // and miss a package linked into the app's node_modules. Falls back to a
      // bare import for framework-owned packages.
      const { createRequire: _createRequire } = await import('node:module');
      const { pathToFileURL: _pathToFileURL } = await import('node:url');
      const _nodePath = await import('node:path');
      const _hostRequire = _createRequire(_nodePath.join(process.cwd(), 'package.json'));
      const importFromHost = async (pkg: string): Promise<any> => {
        try {
          return await import(_pathToFileURL(_hostRequire.resolve(pkg)).href);
        } catch {
          return import(/* webpackIgnore: true */ pkg);
        }
      };
      // [CE AI opt-in] Auto-register the headless AI service ONLY when the host
      // app DECLARES the AI service (or the cloud AI Studio that builds on it).
      // Declaration is the edition boundary: a Community-Edition app that omits
      // both gets no AI service, no
      // agents, and no `services.ai` in discovery (so the console hides its AI
      // surface), while MCP and every other capability are unaffected. Gating on
      // a *declared* dep — not mere resolvability — makes this reliable in a
      // workspace/monorepo, where the package stays hoist-resolvable when undeclared.
      const _fs = await import('node:fs');
      const hostDeclaresDependency = (pkg: string): boolean => {
        try {
          const hostPkg = JSON.parse(
            _fs.readFileSync(_hostRequire.resolve('./package.json'), 'utf8'),
          ) as Record<string, Record<string, string> | undefined>;
          return Boolean(
            hostPkg.dependencies?.[pkg] ?? hostPkg.devDependencies?.[pkg]
              ?? hostPkg.optionalDependencies?.[pkg] ?? hostPkg.peerDependencies?.[pkg],
          );
        } catch {
          return false;
        }
      };
      // AI Studio (`@objectstack/service-ai-studio`) attaches its personas via the
      // `ai:ready` hook the base service fires, so declaring Studio implies the base
      // service — load it even when only Studio is in the deps (the base is a
      // transitive dep of Studio, so it stays resolvable).
      const wantsAiService =
        hostDeclaresDependency('@objectstack/service-ai')
        || hostDeclaresDependency('@objectstack/service-ai-studio');
      if (!hasAIPlugin && tierEnabled('ai') && wantsAiService) {
        try {
          const aiPkg = '@objectstack/service-ai';
          const { AIServicePlugin } = await importFromHost(aiPkg);

          // AIServicePlugin will auto-detect LLM provider from environment variables
          // (AI_GATEWAY_MODEL, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY)
          // No need to manually construct the adapter here.
          await kernel.use(new AIServicePlugin());
          trackPlugin('AIService');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const code = (err as { code?: string })?.code;
          const missing = code === 'ERR_MODULE_NOT_FOUND'
            || msg.includes('Cannot find module')
            || msg.includes('Cannot find package');
          if (!missing) {
            console.error('[AI] AIServicePlugin failed to start:', msg);
          }
          // @objectstack/service-ai not installed — AI features unavailable
        }

        // 4b. Auto-register AI Studio (AI-driven metadata authoring / "online
        // development") when the private @objectstack/service-ai-studio package
        // is installed. It is NOT part of the open-source framework: the dynamic
        // import below silently skips when absent, so open-source installs get
        // the generic AI runtime only. Enterprise installs that ship the package
        // get full AI authoring. AIStudioPlugin attaches via the `ai:ready` hook.
        const hasAIStudio = plugins.some(
          (p: any) => p.name === 'com.objectstack.service-ai-studio'
              || p.constructor?.name === 'AIStudioPlugin'
        );
        if (!hasAIStudio) {
          try {
            const studioPkg = '@objectstack/service-ai-studio';
            const { AIStudioPlugin } = await importFromHost(studioPkg);
            await kernel.use(new AIStudioPlugin());
            trackPlugin('AIStudio');
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const code = (err as { code?: string })?.code;
            const missing = code === 'ERR_MODULE_NOT_FOUND'
              || msg.includes('Cannot find module')
              || msg.includes('Cannot find package');
            if (!missing) {
              console.error('[AI Studio] AIStudioPlugin failed to start:', msg);
            }
            // @objectstack/service-ai-studio not installed — AI authoring unavailable
          }
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
          // Self-contained: AutomationServicePlugin seeds all built-in node
          // executors itself (ADR-0018), so flows have executors with no
          // companion node-pack plugins.
          pkg: '@objectstack/service-automation',
          export: 'AutomationServicePlugin',
          nameMatch: ['service-automation', 'AutomationServicePlugin'],
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
        messaging: {
          // Backs the `notify` flow node (ADR-0012): delivers to a user's
          // channels (inbox by default → `sys_inbox_message` rows). Without
          // this the notify node degrades to a logged no-op.
          pkg: '@objectstack/service-messaging',
          export: 'MessagingServicePlugin',
          nameMatch: ['service-messaging', 'MessagingServicePlugin'],
        },
        triggers: {
          // Makes autolaunched flows actually fire. The automation engine ships
          // the `FlowTrigger` wiring; these plugins are the concrete triggers:
          // record-change (ObjectQL lifecycle hooks) + schedule (cron/interval
          // via the job service — so pair `triggers` with `job`).
          pkg: '@objectstack/trigger-record-change',
          export: 'RecordChangeTriggerPlugin',
          nameMatch: ['trigger-record-change', 'RecordChangeTriggerPlugin'],
          extras: [
            {
              pkg: '@objectstack/trigger-schedule',
              export: 'ScheduleTriggerPlugin',
              nameMatch: ['trigger-schedule', 'ScheduleTriggerPlugin'],
            },
            {
              // Inbound webhook/HTTP trigger (ADR-0041 Tier 1) — arms
              // `type: 'api'` flows with HMAC-verified, queue-backed hooks.
              pkg: '@objectstack/trigger-api',
              export: 'ApiTriggerPlugin',
              nameMatch: ['trigger-api', 'ApiTriggerPlugin'],
            },
          ],
        },
        realtime: {
          pkg: '@objectstack/service-realtime',
          export: 'RealtimeServicePlugin',
          nameMatch: ['service-realtime', 'RealtimeServicePlugin'],
        },
        // `feed` removed (ADR-0052 §5): `sys_comment`/`sys_activity` (durable,
        // default-loaded, UI-wired) is the canonical record collaboration +
        // timeline backend. `@objectstack/service-feed` was an in-memory,
        // non-durable, UI-unconsumed parallel implementation — retired to end
        // the split-brain. The unified typed timeline lives on `sys_activity`.
        mcp: {
          pkg: '@objectstack/mcp',
          export: 'MCPServerPlugin',
          nameMatch: ['mcp-server', 'MCPServerPlugin', 'mcp'],
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
        webhooks: {
          pkg: '@objectstack/plugin-webhooks',
          export: 'WebhookOutboxPlugin',
          nameMatch: ['plugin-webhook-outbox', 'WebhookOutboxPlugin'],
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

      // Shared dev crypto provider for ALL of sys_secret (datasource creds
      // below + secret fields after start). One instance ⇒ one key, so every
      // encrypted secret decrypts under the same provider. Created lazily by
      // whichever block runs first.
      let sharedCryptoProvider: any = undefined;

      // ── External Datasource Federation (ADR-0015) ─────────────────
      // Federation (introspect / draft / import / validate of external
      // tables) ships in the open framework.
      try {
        const dsMod: any = await import('@objectstack/service-datasource');
        const { ExternalDatasourceServicePlugin } = dsMod;

        if (
          ExternalDatasourceServicePlugin &&
          !hasPluginMatching(['service-external-datasource', 'ExternalDatasourceServicePlugin'])
        ) {
          await kernel.use(new ExternalDatasourceServicePlugin());
          trackPlugin('ExternalDatasourceServicePlugin');
        }

        // Gate 2 (ADR-0015 §5.2): on kernel:ready, validate every federated
        // object against its remote table and apply the datasource's
        // `external.validation.onMismatch` policy. No-op when the
        // `external-datasource` service isn't registered (federation unused).
        const { createExternalValidationPlugin } = await import('@objectstack/runtime');
        if (
          createExternalValidationPlugin &&
          !hasPluginMatching(['external-validation', 'ExternalValidationPlugin'])
        ) {
          await kernel.use(createExternalValidationPlugin());
          trackPlugin('ExternalValidationPlugin');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Cannot find module') && !msg.includes('ERR_MODULE_NOT_FOUND')) {
          console.error(`[Datasource] federation wiring failed: ${msg}`);
        }
      }

      // ── Runtime Datasource Admin (ADR-0015 Addendum) ──────────────
      // The "Add Datasource" wizard backend: list / test / create / update /
      // remove datasources defined in the UI at runtime. This is open-source
      // *mechanism* (`@objectstack/service-datasource`); the tier line
      // falls on which ICryptoProvider / driver factory a host injects, not on
      // whether the UI can manage datasources. Mounted by default so a
      // self-host runtime is a complete low-code platform out of the box.
      //
      // Credentials are bound through the SAME crypto provider used for
      // `secret` fields below (`sharedCryptoProvider`), so every secret in
      // `sys_secret` (settings, secret fields, datasource creds) shares one
      // key. Wired BEFORE runtime.start() so the plugin's kernel:ready boot
      // rehydration (which decrypts persisted creds) has its binder ready.
      try {
        const adminMod: any = await import('@objectstack/service-datasource');
        const {
          DatasourceAdminServicePlugin,
          createDefaultDatasourceDriverFactory,
          createDatasourceSecretBinder,
          registerDatasourceAdminRoutes,
        } = adminMod;

        if (
          DatasourceAdminServicePlugin &&
          !hasPluginMatching(['service-datasource-admin', 'DatasourceAdminServicePlugin'])
        ) {
          // Lazy data-engine surface for the secret store (resolved per call
          // so it works whether the engine is registered as 'data' or
          // 'objectql', and regardless of init ordering).
          const resolveEngine = (): any =>
            kernel.getService?.('data') ?? kernel.getService?.('objectql');
          const lazySecretEngine = {
            insert: (o: string, d: any, opt?: any) => resolveEngine()?.insert(o, d, opt),
            delete: (o: string, opt?: any) => resolveEngine()?.delete(o, opt),
            find: (o: string, q?: any) => resolveEngine()?.find(o, q),
          };

          // Fail-closed binder over the shared dev crypto provider. If the
          // provider can't be created, leave `secrets` undefined — the plugin
          // then rejects secret-bearing create/update instead of storing
          // cleartext (by design).
          let secrets: any = undefined;
          try {
            const { LocalCryptoProvider } = await import(
              /* webpackIgnore: true */ '@objectstack/service-settings'
            );
            // First block to touch `sharedCryptoProvider` (still undefined
            // here), so create it directly; the secret-field wiring below
            // reuses this instance so every sys_secret shares one key.
            sharedCryptoProvider = new LocalCryptoProvider();
            secrets = createDatasourceSecretBinder({
              engine: lazySecretEngine,
              cryptoProvider: sharedCryptoProvider,
            });
          } catch (cryptoErr: any) {
            // Best-effort fail-closed: leave `secrets` undefined so the plugin
            // rejects secret-bearing create/update rather than storing
            // cleartext. A production deployment with no stable key still
            // aborts boot loudly at the secret-field wiring below (where
            // LocalCryptoProvider's "Refusing to start in production" error is
            // rethrown), so we don't duplicate that abort here.
            console.warn(
              chalk.yellow(
                `  ⚠ datasource admin: no CryptoProvider (${cryptoErr?.message ?? cryptoErr}); secret-bearing datasource create/update will fail closed`,
              ),
            );
          }

          await kernel.use(
            new DatasourceAdminServicePlugin({
              driverFactory: createDefaultDatasourceDriverFactory(),
              secrets,
            }),
          );
          trackPlugin('DatasourceAdminServicePlugin');

          // REST routes under /api/v1/datasources. Registered via a tiny
          // plugin so it resolves http.server during init (same pattern as
          // the hostname guard above).
          const adminRoutePlugin: any = {
            name: 'com.objectstack.cli.datasource-admin-routes',
            version: '1.0.0',
            init: async (ctx: any) => {
              try {
                const httpServer: any =
                  ctx.getService?.('http.server') ?? ctx.getService?.('http-server');
                if (!httpServer || typeof httpServer.get !== 'function') {
                  ctx.logger?.warn?.(
                    '[datasource-admin] http.server unavailable; REST routes not installed',
                  );
                  return;
                }
                registerDatasourceAdminRoutes(httpServer, ctx, '/api/v1');
              } catch (routeErr: any) {
                ctx.logger?.warn?.(
                  `[datasource-admin] route registration failed: ${routeErr?.message ?? routeErr}`,
                );
              }
            },
          };
          await kernel.use(adminRoutePlugin);
          trackPlugin('DatasourceAdminRoutes');

          if (isDev) {
            console.log(
              chalk.dim('  ↪ datasource admin: runtime UI lifecycle wired (/api/v1/datasources)'),
            );
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Cannot find module') && !msg.includes('ERR_MODULE_NOT_FOUND')) {
          console.error(`[Datasource] runtime-UI admin wiring failed: ${msg}`);
        }
      }

      // ── UI portals ────────────────────────────────────────────────
      // In dev mode, the bundled Console portal is enabled by default
      // (use --no-ui to disable). Always serve the pre-built `dist/` — no
      // Vite dev server, no extra port.
      const enableUI = flags.ui && tierEnabled('ui');

      if (enableUI) {
        // Pre-detect Console availability. The `--no-console` flag (or
        // OS_DISABLE_CONSOLE=1 env var) lets a host (e.g. apps/cloud)
        // opt out of the Console entirely — useful for control-plane
        // deployments where the runtime Console is meaningless.
        const consoleEnabled = flags.console && process.env.OS_DISABLE_CONSOLE !== '1';
        const consolePath = consoleEnabled ? resolveConsolePath() : null;
        const consoleWillMount = !!(consolePath && hasConsoleDist(consolePath));

        // ── Console portal ──────────────────────────────────────────
        // The opinionated, fork-ready runtime console (`@object-ui/console`,
        // published from the objectstack-ai/objectui monorepo) mounts under
        // `/_console/`. When present, it owns the root `/` redirect
        // (preferred default UI). It is optional — we only mount it when
        // the package resolves and a pre-built `dist/` is present.
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

      // ── Secret-field CryptoProvider wiring (host composition root) ──
      // objectql's `secret` field type encrypts on write to `sys_secret`
      // and fails closed when no ICryptoProvider is registered. objectql
      // must NOT depend on a crypto implementation (layering), so the
      // host injects one here. Dev/self-host gets a LocalCryptoProvider
      // (AES-256-GCM keyed off `OS_SECRET_KEY` or a persisted dev key);
      // production hosts swap this for a KMS/Vault-backed provider (e.g.
      // via an env-gated branch or a dedicated plugin) before secrets are
      // written. We resolve the data engine by its registered service name
      // and feature-detect `setCryptoProvider` so older engines / alternate
      // data services degrade gracefully (writing a secret then fails
      // closed, as designed, rather than silently storing cleartext).
      try {
        const dataEngine: any =
          kernel.getService?.('data') ?? kernel.getService?.('objectql');
        if (dataEngine && typeof dataEngine.setCryptoProvider === 'function') {
          if (!sharedCryptoProvider) {
            const { LocalCryptoProvider } = await import(
              /* webpackIgnore: true */ '@objectstack/service-settings'
            );
            // In production LocalCryptoProvider throws when no stable key
            // (OS_SECRET_KEY / persisted file) is available — the fail-loud
            // guard against silently minting an ephemeral key and losing
            // every sys_secret value after a restart. Let that error be loud:
            // secret writes must not proceed under an unstable key.
            sharedCryptoProvider = new LocalCryptoProvider();
          }
          dataEngine.setCryptoProvider(sharedCryptoProvider);
          if (isDev) {
            console.log(
              chalk.dim(
                '  ↪ secret fields: LocalCryptoProvider wired (dev) — set OS_SECRET_KEY and swap for KMS/Vault in production',
              ),
            );
          }
        }
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes('Refusing to start in production')) {
          // Fail-loud config error: print the actionable guidance verbatim.
          console.error(chalk.red(msg));
          throw err;
        }
        // Otherwise non-fatal: without a provider, secret writes fail closed
        // by design. Surface a hint so operators know why a `secret` field
        // write might reject.
        console.warn(
          chalk.yellow(
            `  ⚠ secret fields: no CryptoProvider wired (${msg}); writing a secret field will fail closed`,
          ),
        );
      }

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
      // factory (EnvironmentKernelFactory) instead of serve.ts's own
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

      // Surface the dev admin seeded this boot (if any) in the banner. The
      // seed runs in-process during runtime.start() under serve's boot-quiet
      // window, so plugin-auth records the result on the `auth` service and
      // we print it here, after stdout is restored. Visible in both
      // `serve --dev` and `os dev` (the child's stdout is inherited).
      let seededAdmin: { email: string; password: string } | undefined;
      try {
        const authSvc: any = kernel.getService?.('auth');
        if (authSvc?.devSeedResult?.email) seededAdmin = authSvc.devSeedResult;
      } catch { /* auth service not present — nothing to show */ }

      // ── Clean startup summary ──────────────────────────────────────
      printServerReady({
        port,
        configFile: relativeConfig,
        isDev,
        pluginCount: loadedPlugins.length,
        pluginNames: loadedPlugins,
        uiEnabled: enableUI,
        consolePath: loadedPlugins.includes('ConsoleUI') ? CONSOLE_PATH : undefined,
        driverLabel: resolvedDriverLabel,
        databaseUrl: redactDbUrl(resolvedDatabaseUrl),
        multiTenant: String(readEnvWithDeprecation('OS_MULTI_ORG_ENABLED', 'OS_MULTI_TENANT') ?? 'false').toLowerCase() !== 'false',
        seededAdmin,
      });

      // ── Publish the actually-bound port ────────────────────────────
      // `port` here is the port the HTTP server actually bound — already
      // resolved past any dev auto-shift (busy 3000 → 3001). Publish it so
      // supervisors and the `os dev` parent never have to guess:
      //   • IPC: when spawned with an 'ipc' channel (as `os dev` does), the
      //     parent learns the real port without polling.
      //   • runtime.json: a small state file under OS_HOME for external
      //     supervisors / health checks (pid + port + url).
      const runtimeUrl = `http://localhost:${port}`;
      try {
        if (typeof process.send === 'function') {
          process.send({ type: 'objectstack:listening', port: Number(port), url: runtimeUrl });
        }
      } catch { /* IPC channel closed — best-effort */ }
      try {
        const environmentId = process.env.OS_ENVIRONMENT_ID ?? 'env_local';
        const runtimeFile = path.join(resolveObjectStackHome(), `runtime.${environmentId}.json`);
        fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
        fs.writeFileSync(runtimeFile, JSON.stringify({
          pid: process.pid,
          port: Number(port),
          url: runtimeUrl,
          environmentId,
          startedAt: new Date().toISOString(),
        }, null, 2));
        const cleanupRuntimeFile = () => { try { fs.rmSync(runtimeFile, { force: true }); } catch { /* noop */ } };
        process.on('exit', cleanupRuntimeFile);
      } catch { /* non-fatal — supervision file is best-effort */ }

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
 * (e.g. when the example app's preset or `EnvironmentKernelFactory` wired
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
