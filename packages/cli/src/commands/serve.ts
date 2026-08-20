// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import path from 'path';
import fs from 'fs';
import net from 'net';
import chalk, { chalkStderr } from 'chalk';
import { bundleRequire } from 'bundle-require';
import { loadConfig, BUNDLE_REQUIRE_EXTERNALS } from '../utils/config.js';
import { mergeBootConfig } from '../utils/merge-boot-config.js';
import { isHostConfig, shouldBootWithLibrary } from '../utils/plugin-detection.js';
import { readInternalArtifactPath } from '../utils/internal-artifact-channel.js';
import {
  resolveDriverType,
  resolveStorageDefinition,
  loadTursoDriverFactory,
  isTursoDriverId,
  MissingDriverPackageError,
  UnsupportedDriverError,
} from '../utils/storage-driver.js';
// [ADR-0105 D1] `resolveMultiOrgEnabled` is deliberately NOT imported here: the
// posture is the authoritative knob and `resolveTenancyPosture()` already folds
// the legacy boolean in as its unset-fallback. serve's last direct reader of the
// boolean was the banner, and that was exactly the drift #4801 fixed.
import { readEnvWithDeprecation, resolveTenancyPosture, resolveAllowDegradedTenancy, isMcpServerEnabled, stampSearchPinyinEnabled, isModuleNotFoundError } from '@objectstack/types';
import { PLATFORM_CAPABILITY_TOKENS, PLATFORM_ALWAYS_ON_CAPABILITIES } from '@objectstack/spec/kernel';
// The posture vocabulary, read from the package that DEFINES it (#5359) — the
// boot gate's fix list enumerates the accepted values, and a second literal
// list would be free to drift the day a posture is added.
import { TENANCY_POSTURES, type TenancyPosture } from '@objectstack/spec/security';
import { missingProviderMessage } from '../utils/capability-preflight.js';
// The mail provider vocabulary, read from the package that materialises the
// transports rather than restated here (#5132) — `resolveEmailCapabilityArg`
// has to refuse exactly the configurations `makeTransport` cannot build, and
// two literal lists for one vocabulary is the drift #5094 was filed for. Values
// only (no plugin class): `os serve` loads `EmailServicePlugin` itself through
// the capability loop's dynamic import, host copy first.
import { isEmailTransportProvider, emailProviderRequiresApiKey, unsupportedProviderFix } from '@objectstack/plugin-email';
// The SMS provider vocabulary, read from the package that materialises the
// transports, for the same reason and by the same rule as the mail one above
// (#5713). `resolveSmsCapabilityArg` has to refuse exactly the tags
// `makeSmsTransport` cannot build — restating `log`/`aliyun`/`twilio` here would
// be the second literal #5094 was filed for. Values only (no plugin class): the
// capability loop dynamic-imports `SmsServicePlugin` itself, host copy first.
import { isSmsTransportProvider, SMS_TRANSPORT_PROVIDERS } from '@objectstack/service-sms';
import { resolveObjectStackHome } from '@objectstack/runtime';
import { LOG_LEVELS, resolveLogLevel, readLogLevelEnv } from '../utils/log-level.js';
import { BootLogCapture, isVerboseBootLevel } from '../utils/boot-log-capture.js';
import { graftAuthoredRuntimeMembers, isAppPluginLike } from '../utils/graft-runtime-hooks.js';
import { redactConnectionUrl, describeDriverConnection } from '../utils/connection-display.js';
// Shared with @objectstack/verify and the dogfood multi-org probes (#4700) —
// node-only, hence the `/node` subpath rather than the edge-safe root export.
import {
  createHostImporter,
  hostImportFailureKind,
  isDeclaredByHost,
  readHostDeclaration,
} from '@objectstack/types/node';
import {
  printHeader,
  printKV,
  printSuccess,
  printError,
  printStep,
  printInfo,
  printServerReady,
  printBootDiagnostics,
  type AutomationReadySummary,
  type SeedSourceSummary,
} from '../utils/format.js';
import { redirectStdoutToStderr } from '../utils/json-stdout.js';
import {
  CONSOLE_PATH,
  resolveConsolePath,
  hasConsoleDist,
  decideConsoleMount,
  formatConsoleShaDriftWarning,
  formatConsoleShaDriftRefusal,
  createConsoleStaticPlugin,
  createRuntimeAssetsPlugin,
  type ConsoleShaDrift,
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

/**
 * The IDENTITIES a capability provider registers under: full `plugin.name` ids
 * (`com.objectstack.mcp`) and/or exported class names (`MCPServerPlugin`).
 *
 * Compared EXACTLY by {@link Serve.providesCapability} — never as substrings.
 * These used to be free-form *fragments* tested with `String.includes()`; see
 * that method for the whole class of bug that spelling caused (#7652).
 */
type CapabilityIdentities = string[];

type CapabilitySpec = {
  pkg: string;
  export: string;                    // named export to import
  identities: CapabilityIdentities;  // exact provider identities — see the type
  configKey?: string;                // optional config field passed as constructor arg
  extras?: Array<{ pkg: string; export: string; identities: CapabilityIdentities }>;
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
      description: 'Kernel logger level. Defaults to $OS_LOG_LEVEL / $LOG_LEVEL, else `warn` so flow/hook execution failures surface (ADR-0032). Boot-phase warnings are replayed under the startup banner; `debug`/`info` stream the whole boot live instead. Use `silent` to fully quiet the runtime.',
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
   * DERIVED from `@objectstack/spec`'s `PLATFORM_ALWAYS_ON_CAPABILITIES`, where
   * the slate and its per-entry rationale now live. This used to BE the
   * declaration, under a comment noting that cloud / multi-environment hosts
   * "mirror this list on their per-project kernels" — with nothing making that
   * true. They had diverged: the hosted slate was missing `sms`, `messaging` and
   * `analytics`, so an app that worked under `objectstack serve` silently lost
   * dataset previews and `notify` deliveries once hosted (cloud#925, #3786).
   *
   * Kept as a re-export rather than deleted so `Serve.ALWAYS_ON_CAPABILITIES`
   * stays a stable handle for existing callers and tests — one declaration, two
   * readers.
   */
  static readonly ALWAYS_ON_CAPABILITIES: readonly string[] = PLATFORM_ALWAYS_ON_CAPABILITIES;

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

  /**
   * True when a dynamic `import()` / `require.resolve()` failed because the
   * module is simply NOT INSTALLED — as opposed to the module being present but
   * throwing while it loads (a real crash). Checking `err.code` FIRST is the
   * #1595 fix: ESM reports a missing package as `err.code ===
   * 'ERR_MODULE_NOT_FOUND'` with the human message `Cannot find package '...'`.
   *
   * Thin delegate to the shared classifier in `@objectstack/types` — one owner
   * across the CLI's optional-plugin guards, the capability resolver, and
   * (at its next framework pin bump) cloud's objectos-runtime loader, so the
   * parallel loaders can't drift apart and re-introduce that bug (#1597, #3265).
   */
  static isModuleNotFoundError(err: unknown): boolean {
    return isModuleNotFoundError(err);
  }

  /**
   * Resolve HOW an optional, separately-published service plugin (e.g.
   * `@objectstack/service-ai`, `@objectstack/service-ai-studio`) should load,
   * from explicit INTENT rather than mere package presence (#1597).
   *
   * Two orthogonal axes decide the outcome — the app's declared intent and the
   * license TIER (an orthogonal DENY):
   *
   *   tierAllowed=false               → 'off'      never load (CE / `tiers` sans the feature)
   *   required=true  (+ tierAllowed)  → 'required' MUST load; a missing package is fail-fast
   *   declared=true  (+ tierAllowed)  → 'auto'     opt-in convenience; best-effort load
   *   neither declared nor required   → 'off'      skip, with NO speculative import
   *
   * `required` is an explicit capability declaration (`requires: [...]`), NOT
   * "the package happens to be installed". `declared` means the host app listed
   * the package in its OWN package.json — a deliberate authoring act, the opt-in
   * path — resolved WITHOUT importing anything. The caller maps the result:
   * 'required'/'auto' → attempt load (fail-fast only when 'required'); 'off' → skip.
   */
  static resolveOptionalPluginLoad(opts: {
    tierAllowed: boolean;
    required: boolean;
    declared: boolean;
  }): 'required' | 'auto' | 'off' {
    if (!opts.tierAllowed) return 'off';
    if (opts.required) return 'required';
    if (opts.declared) return 'auto';
    return 'off';
  }

  /**
   * Tier-gated capability tokens → the tier each one opens when listed in
   * `requires`. These have no CAPABILITY_PROVIDERS entry — their loading is
   * resolved by dedicated blocks in run() (`ai`/`ai-studio` by the intent-driven
   * AI block (#1597), `i18n`/`ui`/`auth` by their tier blocks).
   */
  static readonly CAPABILITY_TO_TIER: Record<string, string> = {
    ai: 'ai',
    // `ai-studio` (AI-driven authoring) rides on the base AI service, so
    // requiring it opens the same `ai` tier (#1597).
    'ai-studio': 'ai',
    i18n: 'i18n',
    ui: 'ui',
    auth: 'auth',
  };

  /**
   * Is one of `identities` ALREADY loaded — i.e. did the app supply this
   * capability's provider itself, so the resolver must not load a second one?
   *
   * Compares a plugin's `name` and its constructor name against the declared
   * identities by EQUALITY. That exactness is the fix for #7652, not a detail:
   *
   * This check used to treat `identities` as free-form fragments and test them
   * with `String.includes()`. Substring matching cannot tell a capability's
   * PROVIDER from one of its CONSUMERS, because a consumer is conventionally
   * named after the thing it consumes — so any plugin whose name merely
   * CONTAINED a fragment satisfied the capability and SUPPRESSED the real
   * provider. The stock showcase hit exactly that: it loads
   * `com.objectstack.connector.mcp` (the outbound MCP *client* connector),
   * whose name contains the `mcp` fragment, so `MCPServerPlugin` never loaded
   * and the MCP endpoint the boot banner advertises answered 501.
   *
   * `mcp` was not the only fragment short enough to collide (`audit` was one
   * consumer away from the same fate, and every class-name fragment was
   * satisfied by any class merely ENDING in it, e.g. `MyAuditPlugin` for
   * `AuditPlugin`). Equality closes the class: a plugin either IS the provider
   * or it is not, and no naming convention can blur that.
   *
   * Both directions matter. Tightening the comparison must not stop a genuine
   * provider being recognised, so the registry below declares each provider's
   * REAL registered `name` (measured from its package, and pinned by
   * `serve-capability-identity.test.ts` so a rename can't silently reintroduce
   * double-loading) alongside its exported class name.
   */
  static providesCapability(plugins: readonly unknown[], identities: readonly string[]): boolean {
    const wanted = new Set(identities.filter((id) => id !== ''));
    if (wanted.size === 0) return false;
    return plugins.some((p) => {
      const name = (p as { name?: unknown } | null | undefined)?.name;
      const ctor = (p as { constructor?: { name?: unknown } } | null | undefined)?.constructor?.name;
      return (
        (typeof name === 'string' && wanted.has(name)) ||
        (typeof ctor === 'string' && wanted.has(ctor))
      );
    });
  }

  /**
   * Identities of the local-install surface (`MarketplaceInstallLocalPlugin`),
   * matched EXACTLY by {@link Serve.providesCapability}.
   *
   * Used by the offline arm of the marketplace wiring (#8343) to leave a host
   * config that already wires its own install-local strictly alone. Declared
   * here rather than inline so the same drift test that pins
   * CAPABILITY_PROVIDERS can pin these against the real plugin.
   */
  static readonly INSTALL_LOCAL_IDENTITIES: readonly string[] = [
    'com.objectstack.runtime.marketplace-install-local',
    'MarketplaceInstallLocalPlugin',
  ];

  /**
   * Identities of the server-pushed runtime-config surface
   * (`RuntimeConfigPlugin`), matched EXACTLY by {@link Serve.providesCapability}.
   *
   * Same job as {@link Serve.INSTALL_LOCAL_IDENTITIES}, one plugin over, and
   * the stakes are higher: `RuntimeConfigPlugin` carries the host's branding
   * (product name, logo, PWA colors) AND the open-core `resolveFeatures` seam.
   * `kernel.use` keys by name (`Kernel.use` -> `this.plugins.set(name, meta)`),
   * so an unguarded mount does not double-mount — it REPLACES, and a host that
   * wired its own would lose its white-label chrome and its distribution's
   * feature policy at once, reporting the framework defaults instead.
   */
  static readonly RUNTIME_CONFIG_IDENTITIES: readonly string[] = [
    'com.objectstack.runtime.runtime-config',
    'RuntimeConfigPlugin',
  ];

  /**
   * Identities of the marketplace BROWSE surface (`MarketplaceProxyPlugin`),
   * matched EXACTLY by {@link Serve.providesCapability}.
   *
   * Cloud-arm counterpart of {@link Serve.INSTALL_LOCAL_IDENTITIES} (#8357).
   * The host's instance carries its own `controlPlaneUrl`, its public-snapshot
   * base URL and its LRU cache tuning — none of which the CLI's auto-wiring
   * can know, because it constructs from `resolveCloudUrl()` alone.
   */
  static readonly MARKETPLACE_PROXY_IDENTITIES: readonly string[] = [
    'com.objectstack.runtime.marketplace-proxy',
    'MarketplaceProxyPlugin',
  ];

  /**
   * Identities of the same-origin cloud-connection surface
   * (`CloudConnectionPlugin`, built by `createCloudConnectionPlugin`), matched
   * EXACTLY by {@link Serve.providesCapability}.
   *
   * Both spellings matter here for a reason the other three do not have: the
   * host reaches this plugin through a FACTORY, so the only class name in
   * play is the one the factory returns. `createCloudConnectionPlugin` is not
   * an identity — a factory function is not what lands in the kernel.
   */
  static readonly CLOUD_CONNECTION_IDENTITIES: readonly string[] = [
    'com.objectstack.cloud.connection',
    'CloudConnectionPlugin',
  ];

  /**
   * Constructor options for the `RuntimeConfigPlugin` the marketplace wiring
   * mounts — ONE object, shared by both arms on purpose (#8389).
   *
   * The offline arm's payload is meant to be the cloud arm's payload minus
   * whatever the runtime genuinely lacks, and `features.marketplace` is now
   * derived per request from the serving app's route table (#8356) rather than
   * declared here. So the difference between the two arms must come from what
   * is MOUNTED, never from a second copy of these options drifting away from
   * the first. Two literals would let exactly that happen silently.
   *
   * `controlPlaneUrl: ''` is deliberate and is NOT the trap
   * {@link Serve.OFFLINE_CONTROL_PLANE} exists for: `RuntimeConfigPlugin`'s
   * constructor special-cases the empty string as "stay on this origin" and
   * bypasses `resolveCloudUrl()` entirely, while `MarketplaceInstallLocalPlugin`
   * re-resolves what it is handed and would substitute the PUBLIC default
   * cloud. The two neighbouring mounts therefore need DIFFERENT spellings of
   * "no cloud"; harmonising them in either direction breaks one of them.
   */
  static readonly RUNTIME_CONFIG_OPTIONS: Readonly<{
    controlPlaneUrl: string;
    singleEnvironment: boolean;
    installLocal: boolean;
  }> = Object.freeze({
    controlPlaneUrl: '',
    singleEnvironment: true,
    installLocal: true,
  });

  /**
   * The `controlPlaneUrl` the offline install-local mount is constructed with.
   *
   * A named constant rather than an inline `'off'` so a test can assert the
   * property the call site depends on — `resolveCloudUrl(this) === ''`. The
   * tempting value is the empty `marketplaceUrl` the wiring block already
   * holds, and it is wrong in a way no local reading reveals: `resolveCloudUrl`
   * treats `''` as "unset" and substitutes the PUBLIC default cloud, so an
   * air-gapped runtime's catalog branch would dial out instead of answering
   * 503. Spelled as one of the documented disable sentinels, it resolves to
   * no cloud at all.
   */
  static readonly OFFLINE_CONTROL_PLANE = 'off';

  /**
   * Which half of the marketplace wiring this boot should mount (#8343).
   *
   * Pure + static so the decision is readable and testable on its own, the
   * same reason {@link Serve.providesCapability} is: the call site sits deep
   * inside `run()` behind a dynamic import, where the only way to observe a
   * mounting rule is to boot a kernel.
   *
   * The two arms are deliberately asymmetric, because the two surfaces need
   * different things:
   *
   *  - `cloudSurfaces` — the ARM SELECTOR, not a mount decision: true when this
   *    boot takes the cloud-connected arm at all (proxy + install-local +
   *    cloud-connection + runtime-config). Those surfaces *are* the control
   *    plane's client, so a resolved URL is their precondition. WHICH of them
   *    the CLI actually mounts is carried by the four `cloud*` flags below.
   *  - `offlineInstallLocal` — the air-gapped install surface. Its inline
   *    branch reads no URL at all, so a control plane is precisely what it
   *    does NOT need; gating it on one is what left a self-hosted EE box with
   *    no install route at all.
   *  - `offlineRuntimeConfig` — the server-pushed runtime config that lets the
   *    Console DISCOVER the above (#8389). Also reads no control plane: it
   *    reports this origin (`controlPlaneUrl: ''`), and since #8356
   *    `features.marketplace` is derived from the serving app's route table,
   *    so on a runtime with no proxy it reports `false` by observation. That
   *    derivation is what unblocked this mount: before it, reporting
   *    install-local truthfully would have cost a false browse claim, which is
   *    why #8343 shipped the offline arm with install-local ALONE and left the
   *    working route undiscoverable.
   *
   * The two offline flags are computed INDEPENDENTLY rather than sharing one
   * gate, because each guards a different host-owned plugin and the two
   * host configurations are not the same configuration. A host that wires its
   * own install-local (so this rule leaves it alone) may still have no
   * runtime-config at all — that box has the #8389 defect just as much as an
   * unconfigured one, and one shared gate would silently exclude it.
   *
   * `isRuntimeHostKernel` is restated here (the call site checks it too, to
   * skip the dynamic import) so this function is the whole rule in one place:
   * the cloud distribution wires its own marketplace on the host kernel, so
   * NO arm mounts there.
   *
   * ## The cloud arm honours the host too (#8357)
   *
   * Every mount on BOTH arms is now per-surface, under the same
   * `providesCapability` rule: the CLI's auto-wiring is a FALLBACK for hosts
   * that wire nothing, never a second opinion about a surface the host already
   * composed. `objectos-ee`'s single-environment config is exactly such a host
   * — it wires proxy, install-local, cloud-connection and runtime-config
   * itself — and it is NOT covered by the `isRuntimeHostKernel` guard above,
   * which detects `ObjectOSEnvironmentPlugin`: only the `OS_MULTI_TENANT`
   * branch constructs one, via `createObjectOSStack`. Hanging this rule off
   * that sentinel would leave the shipped single-environment shape unguarded.
   *
   * What this fixes is PRECEDENCE, not a live downgrade — say it plainly,
   * because the two read alike and only one is true. Measured on this tree:
   * the CLI's wiring block runs several hundred lines BEFORE `config.plugins`
   * are registered, and `Kernel.use` -> `this.plugins.set(name, meta)`
   * overwrites by name, so today the host's instance is the one that survives
   * — the CLI's is constructed, registered and then dropped. The host winning
   * is therefore an ACCIDENT OF ORDERING between two blocks that never mention
   * each other, not a rule anything states or pins; it inverts silently if
   * either block moves, and on a kernel whose `use` rejects duplicates
   * (`LiteKernel` throws) it is the HOST's registration that fails instead.
   * Checking presence makes the outcome independent of all of that, and stops
   * the CLI constructing four plugins it is about to discard.
   */
  static planMarketplaceWiring(input: {
    isRuntimeHostKernel: boolean;
    marketplaceUrl: string;
    plugins: readonly unknown[];
  }): {
    cloudSurfaces: boolean;
    cloudProxy: boolean;
    cloudInstallLocal: boolean;
    cloudConnection: boolean;
    cloudRuntimeConfig: boolean;
    offlineInstallLocal: boolean;
    offlineRuntimeConfig: boolean;
  } {
    const NO_CLOUD_ARM = {
      cloudSurfaces: false,
      cloudProxy: false,
      cloudInstallLocal: false,
      cloudConnection: false,
      cloudRuntimeConfig: false,
    } as const;

    if (input.isRuntimeHostKernel) {
      return { ...NO_CLOUD_ARM, offlineInstallLocal: false, offlineRuntimeConfig: false };
    }
    if (input.marketplaceUrl) {
      return {
        cloudSurfaces: true,
        // Each surface is guarded on its OWN presence, never on a shared gate:
        // a host may compose any subset of the four (objectos-ee wires
        // runtime-config unconditionally but the other three only when it has
        // a resolved cloud URL), and one gate would either overwrite what the
        // host did wire or withhold what it did not.
        cloudProxy: !Serve.providesCapability(input.plugins, Serve.MARKETPLACE_PROXY_IDENTITIES),
        cloudInstallLocal: !Serve.providesCapability(input.plugins, Serve.INSTALL_LOCAL_IDENTITIES),
        cloudConnection: !Serve.providesCapability(input.plugins, Serve.CLOUD_CONNECTION_IDENTITIES),
        cloudRuntimeConfig: !Serve.providesCapability(input.plugins, Serve.RUNTIME_CONFIG_IDENTITIES),
        offlineInstallLocal: false,
        offlineRuntimeConfig: false,
      };
    }
    return {
      ...NO_CLOUD_ARM,
      // A host config that wires its own install-local keeps it — see the
      // call site for why replacing it would be a silent downgrade.
      offlineInstallLocal: !Serve.providesCapability(input.plugins, Serve.INSTALL_LOCAL_IDENTITIES),
      // Same rule, same reason, for the runtime-config surface — replacing a
      // host's own would drop its branding and its resolveFeatures policy.
      offlineRuntimeConfig: !Serve.providesCapability(input.plugins, Serve.RUNTIME_CONFIG_IDENTITIES),
    };
  }

  /**
   * Registry of `requires` token → built-in service-plugin provider for the
   * standalone serve path. Keys are canonical kebab-case platform capability
   * tokens — a drift test asserts every key is in the spec-owned
   * PLATFORM_CAPABILITY_TOKENS vocabulary (framework#3265). Adding a built-in
   * capability = one entry here + its token in the spec vocabulary.
   *
   * `identities` are matched EXACTLY (see {@link Serve.providesCapability}), so
   * each entry names the provider's real registered `plugin.name` — NOT a
   * shortened fragment of it. Before #7652 most of these name fragments were in
   * fact dead (`service-cache` never matched `com.objectstack.service.cache`:
   * dash vs dot), and the entries were carried entirely by their class name.
   */
  static readonly CAPABILITY_PROVIDERS: Record<string, CapabilitySpec> = {
    automation: {
      // Self-contained: AutomationServicePlugin seeds all built-in node
      // executors itself (ADR-0018), so flows have executors with no
      // companion node-pack plugins.
      pkg: '@objectstack/service-automation',
      export: 'AutomationServicePlugin',
      identities: ['com.objectstack.service-automation', 'AutomationServicePlugin'],
    },
    analytics: {
      pkg: '@objectstack/service-analytics',
      export: 'AnalyticsServicePlugin',
      identities: ['com.objectstack.service-analytics', 'AnalyticsServicePlugin'],
      configKey: 'analyticsCubes',
    },
    audit: {
      pkg: '@objectstack/plugin-audit',
      export: 'AuditPlugin',
      identities: ['com.objectstack.audit', 'AuditPlugin'],
    },
    cache: {
      pkg: '@objectstack/service-cache',
      export: 'CacheServicePlugin',
      identities: ['com.objectstack.service.cache', 'CacheServicePlugin'],
    },
    storage: {
      pkg: '@objectstack/service-storage',
      export: 'StorageServicePlugin',
      identities: ['com.objectstack.service.storage', 'StorageServicePlugin'],
    },
    queue: {
      pkg: '@objectstack/service-queue',
      export: 'QueueServicePlugin',
      identities: ['com.objectstack.service.queue', 'QueueServicePlugin'],
    },
    job: {
      pkg: '@objectstack/service-job',
      export: 'JobServicePlugin',
      identities: ['com.objectstack.service.job', 'JobServicePlugin'],
    },
    messaging: {
      // Backs the `notify` flow node (ADR-0012): delivers to a user's
      // channels (inbox by default → `sys_inbox_message` rows). Without
      // this the notify node degrades to a logged no-op.
      pkg: '@objectstack/service-messaging',
      export: 'MessagingServicePlugin',
      identities: ['com.objectstack.service.messaging', 'MessagingServicePlugin'],
    },
    triggers: {
      // Makes autolaunched flows actually fire. The automation engine ships
      // the `FlowTrigger` wiring; these plugins are the concrete triggers:
      // record-change (ObjectQL lifecycle hooks) + schedule (cron/interval
      // via the job service — so pair `triggers` with `job`).
      pkg: '@objectstack/trigger-record-change',
      export: 'RecordChangeTriggerPlugin',
      identities: ['com.objectstack.trigger.record-change', 'RecordChangeTriggerPlugin'],
      extras: [
        {
          pkg: '@objectstack/trigger-schedule',
          export: 'ScheduleTriggerPlugin',
          identities: ['com.objectstack.trigger.schedule', 'ScheduleTriggerPlugin'],
        },
        {
          // Declarative time-relative sweep (#1874) — arms flows whose start
          // node declares `config.timeRelative` (fire daily for records whose
          // date field is within N days / at T-minus offsets). Ships in
          // @objectstack/trigger-schedule; needs the job service + ObjectQL.
          pkg: '@objectstack/trigger-schedule',
          export: 'TimeRelativeTriggerPlugin',
          identities: ['com.objectstack.trigger.time-relative', 'TimeRelativeTriggerPlugin'],
        },
        {
          // Inbound webhook/HTTP trigger (ADR-0041 Tier 1) — arms
          // `type: 'api'` flows with HMAC-verified, queue-backed hooks.
          pkg: '@objectstack/trigger-api',
          export: 'ApiTriggerPlugin',
          identities: ['com.objectstack.trigger.api', 'ApiTriggerPlugin'],
        },
      ],
    },
    realtime: {
      pkg: '@objectstack/service-realtime',
      export: 'RealtimeServicePlugin',
      identities: ['com.objectstack.service.realtime', 'RealtimeServicePlugin'],
    },
    // `feed` removed (ADR-0052 §5): `sys_comment`/`sys_activity` (durable,
    // default-loaded, UI-wired) is the canonical record collaboration +
    // timeline backend. `@objectstack/service-feed` was an in-memory,
    // non-durable, UI-unconsumed parallel implementation — retired to end
    // the split-brain. The unified typed timeline lives on `sys_activity`.
    mcp: {
      pkg: '@objectstack/mcp',
      export: 'MCPServerPlugin',
      identities: ['com.objectstack.mcp', 'MCPServerPlugin'],
    },
    marketplace: {
      pkg: '@objectstack/service-package',
      export: 'PackageServicePlugin',
      identities: ['package-service', 'PackageServicePlugin'],
    },
    email: {
      pkg: '@objectstack/plugin-email',
      export: 'EmailServicePlugin',
      identities: ['com.objectstack.service.email', 'EmailServicePlugin'],
    },
    sms: {
      // #2780 — backs phone-number OTP sign-in/reset (plugin-auth) and
      // the messaging `sms` channel. Provider config lives in the `sms`
      // settings namespace (OS_SMS_* env keys win at the resolver);
      // unconfigured ⇒ dev LogSmsTransport (no real send).
      pkg: '@objectstack/service-sms',
      export: 'SmsServicePlugin',
      identities: ['com.objectstack.service.sms', 'SmsServicePlugin'],
    },
    sharing: {
      pkg: '@objectstack/plugin-sharing',
      export: 'SharingServicePlugin',
      identities: ['com.objectstack.service.sharing', 'SharingServicePlugin'],
    },
    // #2486 — auto-required above when resolveSearchPinyinEnabled()
    // (explicit env, else any configured zh-* locale) says on.
    'pinyin-search': {
      pkg: '@objectstack/plugin-pinyin-search',
      export: 'PinyinSearchPlugin',
      identities: ['com.objectstack.plugin.pinyin-search', 'PinyinSearchPlugin'],
    },
    reports: {
      pkg: '@objectstack/plugin-reports',
      export: 'ReportsServicePlugin',
      identities: ['com.objectstack.service.reports', 'ReportsServicePlugin'],
    },
    approvals: {
      pkg: '@objectstack/plugin-approvals',
      export: 'ApprovalsServicePlugin',
      identities: ['com.objectstack.service.approvals', 'ApprovalsServicePlugin'],
    },
    settings: {
      pkg: '@objectstack/service-settings',
      export: 'SettingsServicePlugin',
      identities: ['com.objectstack.service.settings', 'SettingsServicePlugin'],
    },
    webhooks: {
      pkg: '@objectstack/plugin-webhooks',
      export: 'WebhookOutboxPlugin',
      identities: ['com.objectstack.plugin-webhook-outbox', 'WebhookOutboxPlugin'],
    },
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Serve);

    // ── stdout belongs to the protocol, never to diagnostics (#7915) ──
    // Everything `serve` and the kernel it boots would write to stdout is
    // forwarded to stderr, for the whole life of the process. Held, never
    // released: this is not a window, it is the process's output policy.
    //
    // WHY, and why UNCONDITIONALLY. With `OS_MCP_STDIO_ENABLED=true` the MCP
    // stdio transport owns stdout, and that protocol is newline-delimited JSON:
    // a conforming client `JSON.parse`s every line it reads, so each banner or
    // log line reaches it as a transport error. Measured on the #7915 repro
    // (#7645 had to be fixed first for the channel to carry anything at all):
    // the `initialize` result arrived on line 517, behind 516 lines of banner
    // and kernel log — which reads as "the transport is broken".
    //
    // The tempting fix is "redirect when the stdio transport is active". It is
    // the wrong one: a conditional needs a reliable signal at the moment each
    // line prints — before the config is read, before the plugin is loaded —
    // and it fails SILENTLY and in the worse direction when that signal is
    // wrong or late. A frame-corrupting line that appears only in some boots is
    // far harder to find than one that always does. Banners, boot progress and
    // kernel logs are diagnostics, not program output; stderr is where a CLI
    // puts diagnostics, mounted transport or not, and in a terminal it costs
    // nothing because both streams render.
    //
    // Covers writers this file does not own — `ObjectLogger` routes
    // debug/info/warn to `process.stdout` directly (packages/core), and stray
    // `console.log`s live in several packages the boot touches (the
    // `[StandaloneStack] no compiled artifact …` line is one). That is why the
    // redirection is on the STREAM: `LoggerConfig` has a level but no
    // destination knob, so there is nothing else to point at stderr. Same route
    // `--json` takes for the same reason (#6217, `utils/json-stdout.ts`).
    //
    // The MCP transport is the one writer that must still reach the real
    // stdout, and it holds its own channel to it (`packages/mcp`,
    // protocol-stdout.ts) rather than depending on who booted it.
    redirectStdoutToStderr();

    // Colour follows the stream the text actually lands on. `chalk`'s default
    // level is decided from stdout, so with the lines above moved to stderr a
    // `serve > log` in a terminal would print an uncoloured banner to a TTY,
    // and a `serve 2> log` would write ANSI escapes into the file. Both are
    // cosmetic, both are wrong, and one assignment fixes them: every writer in
    // this process shares the same chalk instance.
    chalk.level = chalkStderr.level;

    /**
     * Whether the boot-quiet window (further down) is currently open.
     *
     * Declared here rather than beside the window because {@link printDiagnostic}
     * reads it, and this command's first human line prints long before the
     * window opens.
     */
    let bootQuiet = false;

    /**
     * One human line from `serve`, written straight to **stderr** (#7915).
     *
     * Every `console.log` in this command was one of these: a banner line, a
     * boot-progress note, an error explanation — diagnostics, all of them. They
     * are written explicitly rather than left to the redirect above so the
     * stream choice is visible at the call site; the redirect stays because it
     * also covers the writers this file does not own.
     *
     * Suppressed while the boot-quiet window is open, exactly as `console.log`
     * was: that window exists to keep the banner readable, and moving the
     * stream must not turn a quiet boot into a noisy one.
     */
    const printDiagnostic = (text = '') => {
      if (!bootQuiet) process.stderr.write(text + '\n');
    };

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
      // One write, for the reason spelled out at the "Nothing to serve" exit
      // below: `this.exit(1)` reaches `process.exit` without draining a piped
      // stdout, so a multi-call diagnostic loses its tail. Same defect, same
      // shape — this one is fixed by construction (the e2e that measured the
      // truncation drives the other exit; reaching this one needs a busy port in
      // production mode).
      printDiagnostic(
        '\n'
        + chalk.red(`  ✗ Port ${requestedPort} is already in use.\n`)
        + chalk.dim('     ObjectStack does not auto-select a different port in production mode:\n')
        + chalk.dim('     a drifted port silently breaks reverse-proxy, OAuth callback, and CORS config.\n')
        + chalk.dim('     Free the port, or pick another via PORT=<port> (or --port <port>).'),
      );
      this.exit(1);
    }

    // Load .env files following Vite/Next.js convention
    const mode = flags.dev ? 'development'
      : (process.env.NODE_ENV === 'test' ? 'test'
        : (process.env.NODE_ENV || 'production'));
    dotenvFlow.config({ node_env: mode, silent: true });

    // ── Tenancy-posture boot gate (#5359) ────────────────────────────
    // Resolve the posture ONCE, here, and refuse an unrecognized value
    // EXPLICITLY — before a config is read, before a plugin is loaded,
    // before the kernel bootstraps.
    //
    // `resolveTenancyPosture()` throws on an unrecognized value and its
    // message says "Refusing to boot". Reaching that refusal by letting the
    // throw escape from wherever the first read happened to sit made the
    // refusal arrive wrong in two ways:
    //
    //   • serve's first read sat inside the broad AuthPlugin `try` further
    //     down, whose catch only warns. So the first thing an operator saw
    //     for a typo'd env var was
    //     `⚠ AuthPlugin failed to load: Invalid OS_TENANCY_POSTURE="…"` —
    //     an env-spelling mistake disguised as a plugin-loading problem.
    //   • Boot then continued, degraded and without plugin-auth, through the
    //     whole capability slate (persisting a generated dev crypto key to
    //     disk on the way) until the next UNGUARDED read — ObjectQL's
    //     `SchemaRegistry` constructor, during kernel Phase 1 — aborted
    //     `runtime.start()` and surfaced as a bare `printError`: the
    //     resolver's sentence with no prescription and no ADR reference.
    //
    // Reading it here makes the refusal the FIRST thing that happens and
    // gives it the ADR-0093 D5 shape: an explicit FATAL carrying a fix list,
    // and `process.exit(1)` rather than a throw — a throw is what the
    // swallowing catch below turns back into a warning.
    //
    // Placement is load-bearing twice over:
    //   • AFTER `dotenvFlow.config()` — OS_TENANCY_POSTURE is routinely set in
    //     a `.env` file, and a gate above that load would read it as unset,
    //     pass, and hand the invalid value straight back to the swallowing path.
    //   • OUTSIDE every `try` in this method, so nothing can demote it.
    //
    // Every later read of the posture — serve's own below, AuthPlugin's
    // `createTenancyService({ requested: resolveTenancyPosture() })`,
    // ObjectQL's `SchemaRegistry` — is downstream of this gate, so none of
    // them can be the one that reports a typo'd posture.
    const postureGate = resolveTenancyPostureOrRefusal();
    if (!postureGate.ok) {
      console.error(postureGate.fatal);
      process.exit(1);
    }
    const tenancyPosture = postureGate.posture;

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

    // ── Artifact-pinned boot (#8368) ─────────────────────────────────
    // `OS_ARTIFACT_URL` names the artifact BY REFERENCE — an https:// URL
    // fetched at boot, or a file:// URL read directly (the volume-mount
    // workflow) — with an optional SRI-style `#sha256=` integrity pin in the
    // fragment. It is resolved here, before anything else looks for an
    // artifact, and it wins over every local lookup:
    //
    //   --artifact  >  OS_ARTIFACT_URL  >  OS_INTERNAL_ARTIFACT_PATH
    //               >  OS_ARTIFACT_PATH  >  <cwd>/dist/…
    //
    // `OS_INTERNAL_ARTIFACT_PATH` is the CLI's private parent-to-child channel:
    // an `os start` / `os dev` supervisor resolved an artifact through its own
    // ladder and is handing the answer down. It sits BELOW the reference (a
    // supervisor that saw OS_ARTIFACT_URL resolves nothing and sends nothing,
    // and `os dev` sends its answer unconditionally, so the reference has to
    // keep outranking it) and ABOVE the operator's OS_ARTIFACT_PATH (which the
    // supervisor no longer overwrites on the way down, so only a higher rung
    // keeps `--artifact` beating an exported OS_ARTIFACT_PATH the way it does
    // today). See `utils/internal-artifact-channel.ts` for why the CLI stopped
    // writing the operator's knob at all.
    //
    // Beating OS_ARTIFACT_PATH is not a nicety, it is the acceptance
    // criterion: the official runtime image sets
    // `ENV OS_ARTIFACT_PATH=/srv/app/objectstack.json`, so on a container that
    // carries no app at all that variable is always set and always points at a
    // file that does not exist. Without this precedence, "runtime container +
    // one env var" would refuse with "the artifact named by OS_ARTIFACT_PATH
    // does not exist" and the feature would be unreachable exactly where it
    // was designed to be used.
    //
    // It also wins over an `objectstack.config.ts` that happens to be in the
    // cwd. Setting this variable is an explicit instruction to boot a specific
    // published artifact; silently preferring whatever source tree the process
    // is standing in would make the deployed app depend on the container's
    // working directory.
    //
    // The resolver hands back a LOCAL path — remote bytes are materialised
    // under `<home>/artifacts` — so nothing downstream of this line ever sees
    // the URL. That is what keeps a pre-signed reference out of the banner,
    // the metadata service's artifact-source record and every log line, and it
    // also means the bytes that were hashed are the bytes that boot.
    let pinnedArtifact: { localPath: string; display: string } | undefined;
    const artifactUrlEnv = process.env.OS_ARTIFACT_URL;
    if (artifactUrlEnv && artifactUrlEnv.trim() !== '') {
      const runtimeMod = await import('@objectstack/runtime');
      const { resolveArtifactReference, resolveArtifactFetchTimeoutMs, resolveObjectStackHome } = runtimeMod;
      try {
        const resolved = await resolveArtifactReference(artifactUrlEnv, {
          homeDir: resolveObjectStackHome(),
          fetchTimeoutMs: resolveArtifactFetchTimeoutMs(process.env),
          // The cache-fallback warning must survive the boot-quiet window —
          // "this instance is serving cached content" is the one degraded-boot
          // note an operator must not miss.
          warn: (m) => process.stderr.write(chalk.yellow(m) + '\n'),
        });
        pinnedArtifact = { localPath: resolved.localPath, display: resolved.display };
        printDiagnostic();
        printDiagnostic(chalk.dim(
          `  Artifact (OS_ARTIFACT_URL): ${resolved.display}`
          + ` [${resolved.origin}${resolved.expectedSha256 ? `, sha256 verified` : ', unpinned'}]`,
        ));
        useArtifactFallback = true;
      } catch (err: any) {
        // Every message from the resolver is already scrubbed of the URL's
        // credential-bearing parts, so it is printed verbatim. ONE write, for
        // the reason spelled out at the "Nothing to serve" exit below.
        printDiagnostic(
          '\n'
          + chalk.red(`  ✗ Cannot boot from OS_ARTIFACT_URL.\n`)
          + chalk.dim('     ') + String(err?.message ?? err).split('\n').join('\n     ') + '\n'
          + '\n'
          + chalk.dim('     The boot is refused rather than degraded — container orchestration\n')
          + chalk.dim('     should retry, and a runtime told to serve one specific artifact must\n')
          + chalk.dim('     never invent a different one.'),
        );
        this.exit(1);
      }
    }

    if (configMissing && !pinnedArtifact) {
      const { resolveDefaultArtifactPath } = await import('@objectstack/runtime');
      // A supervising `os start` / `os dev` passes its already-resolved answer
      // as the explicit override — the same position `OS_ARTIFACT_PATH` used to
      // occupy when the supervisor wrote it, so a named-but-missing artifact is
      // still a loud refusal rather than a silent empty boot.
      const artifactSource = resolveDefaultArtifactPath(readInternalArtifactPath());
      if (!artifactSource) {
        // Quick-start mode: `objectstack start` lets the user boot an
        // empty kernel with no config and no artifact, then install apps
        // from the marketplace via the Console. The CLI signals this by
        // setting OS_BOOT_EMPTY=1 in the child env.
        if (process.env.OS_BOOT_EMPTY === '1') {
          useEmptyBoot = true;
        } else {
          // Say WHERE it looked. "Not found" alone cannot distinguish the two
          // things that actually happen — a typo'd filename and the wrong cwd
          // (running from a monorepo root instead of the app folder) — and the
          // second is the common one, which listing the searched paths makes
          // self-evident. This stays an ERROR rather than degrading into an
          // empty boot: `os serve` was told to load something, and inventing a
          // zero-object platform instead would hide the mistake behind a
          // running server. Booting with no app at all is a real, supported
          // thing (`os serve` on a config with no metadata, or `os start`) —
          // but it is a stated intent, not a guess made on the user's behalf.
          // ONE write, deliberately. `this.exit(1)` unwinds to oclif's
          // `process.exit`, which does NOT wait for a piped stdout to drain — so
          // a diagnostic split across several `console.log` calls gets
          // truncated mid-message, and the reader loses exactly the part that
          // says where to look. (Measured: as separate calls, only the first two
          // lines survived a pipe.) An error whose tail can vanish is the #4012
          // shape all over again; assembling it into a single write keeps it
          // inside one pipe-buffer flush.
          printDiagnostic(
            chalk.red('  ✗ Nothing to serve — no config and no compiled artifact.') + '\n'
            + chalk.dim(`     Looked for a config at:    ${absolutePath}\n`)
            + chalk.dim(`     Looked for an artifact at: ${path.resolve(process.cwd(), 'dist/objectstack.json')}\n`)
            + chalk.dim('     Neither OS_ARTIFACT_URL nor OS_ARTIFACT_PATH is set.\n')
            + '\n'
            + chalk.dim('     Hint: `objectstack init` scaffolds a new project;\n')
            + chalk.dim('           `objectstack start` boots an app-less kernel against your marketplace;\n')
            + chalk.dim('           `objectstack build` (or OS_ARTIFACT_PATH) supplies a compiled artifact;\n')
            + chalk.dim('           OS_ARTIFACT_URL=https://…/objectstack.json boots a published artifact\n')
            + chalk.dim('           by reference (optionally pinned with #sha256=<64 hex chars>).\n')
            + chalk.dim('           Already have a project? Check your working directory.'),
          );
          this.exit(1);
        }
      }
      useArtifactFallback = true;
    }

    // Quiet loading — only show a single spinner line
    printDiagnostic();
    if (useEmptyBoot) {
      printDiagnostic(chalk.dim('  No objectstack.config.ts or artifact found — booting empty kernel...'));
    } else if (pinnedArtifact) {
      printDiagnostic(chalk.dim('  Booting from the artifact named by OS_ARTIFACT_URL (default host)...'));
    } else if (useArtifactFallback) {
      printDiagnostic(chalk.dim('  No objectstack.config.ts found — booting from artifact (default host)...'));
    } else {
      printDiagnostic(chalk.dim(`  Loading ${relativeConfig}...`));
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

    // Track resolved storage driver + connection target for the startup banner.
    // The value lands here raw when it came from this command's own
    // OS_DATABASE_URL fallback and already-redacted when it came from probing a
    // registered driver, so it is redacted at print time — `redactConnectionUrl`
    // is idempotent, so the second pass over an already-clean URL is a no-op.
    let resolvedDriverLabel: string | undefined;
    let resolvedDatabaseUrl: string | undefined;

    // Resolve the kernel logger level up front. It decides more than the
    // logger's own threshold: it decides whether the boot-quiet window below
    // runs at all, so it has to be known BEFORE the window opens rather than
    // at the `new Runtime(...)` call further down.
    const bootLogLevel = resolveLogLevel({
      verbose: flags.verbose,
      flag: flags['log-level'],
      envLevel: readLogLevelEnv(),
    });
    // `--verbose` / `--log-level debug|info` asks to watch the boot happen.
    // Blanking stdout through it would be the flag defeating itself, so at
    // those levels the window never opens and boot output streams live — the
    // banner just prints at the end of it (#4012).
    const verboseBoot = isVerboseBootLevel(bootLogLevel);

    // Save original console/stdout methods — we'll suppress noise during boot.
    // `origStdoutWrite` is the redirected write installed at the top of `run()`,
    // NOT the real stdout: restoring it hands the stream back to the stderr
    // forwarder, which is where every diagnostic belongs (#7915).
    const originalConsoleLog = console.log;
    const originalConsoleDebug = console.debug;
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    // Everything the quiet window intercepts lands here instead of being
    // dropped on the floor, so boot-phase `logger.warn` survives to be
    // replayed under the banner (#4012).
    const bootLogs = new BootLogCapture();
    /** Diagnostics to replay, or `undefined` when the boot had nothing to say. */
    const collectBootDiagnostics = () => {
      const lines = bootLogs.diagnostics();
      return lines.length > 0 ? { lines, dropped: bootLogs.droppedCount } : undefined;
    };

    const restoreOutput = () => {
      bootQuiet = false;
      process.stdout.write = origStdoutWrite;
      console.log = originalConsoleLog;
      console.debug = originalConsoleDebug;
    };

    try {
      // ── Hold back runtime noise during boot ───────────────────────
      // Multiple sources write to stdout during startup:
      //   • Pino-pretty (direct process.stdout.write)
      //   • ObjectLogger browser fallback (console.log)
      //   • SchemaRegistry (console.log)
      // We intercept stdout entirely, then restore after runtime.start().
      //
      // Intercepted is not discarded (#4012): `ObjectLogger` routes `warn` to
      // stdout — only `error`/`fatal` go to stderr — so dropping these bytes
      // dropped every boot-phase warning a plugin logged, on both `os serve`
      // and `os dev` (which inherits this child's stdio), at every log level.
      // The chatter still never reaches the banner; the kernel-logger records
      // among it are buffered and replayed once the banner has printed.
      bootQuiet = !verboseBoot;
      if (!verboseBoot) {
        process.stdout.write = (chunk: any, ...rest: any[]) => {
          if (bootQuiet) {
            bootLogs.write(chunk, typeof rest[0] === 'string' ? rest[0] : undefined);
            // Honor the write callback so a caller awaiting drain still resumes.
            const cb = rest.find((a) => typeof a === 'function');
            if (cb) cb();
            return true;
          }
          return (origStdoutWrite as any)(chunk, ...rest);
        };
        console.log = (...args: any[]) => { if (!bootQuiet) originalConsoleLog(...args); };
        console.debug = (...args: any[]) => { if (!bootQuiet) originalConsoleDebug(...args); };
      }

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

      // Preserve module-level named exports (e.g. the `onEnable` runtime hook
      // and `functions`) that would otherwise be dropped when we unwrap
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
          const bootResult = await createDefaultHostConfig({
            requireArtifact: !useEmptyBoot,
            dev: isDev,
            // #8368: the already-fetched, already-verified LOCAL copy. Passing
            // it explicitly (rather than re-deriving from the environment) is
            // what stops the loader from fetching the URL a second time — a pin
            // that verifies one response while a different response boots would
            // verify nothing.
            // Same reasoning one rung down: when no reference is in play, a
            // supervisor's resolved answer is handed over explicitly instead of
            // being re-derived from the environment.
            ...(pinnedArtifact
              ? { artifactPath: pinnedArtifact.localPath }
              : (() => {
                const internal = readInternalArtifactPath();
                return internal ? { artifactPath: internal } : {};
              })()),
          });
          // [#4002] `api` merges per key — see mergeBootConfig. A shallow spread
          // let the boot builder's two scoping keys wipe the author's whole `api`
          // block, silently dropping `requireAuth` / `enforceProjectMembership`.
          config = mergeBootConfig(originalConfig as any, bootResult as any) as any;
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
          // [#4002] Per-key `api` merge — see mergeBootConfig.
          config = mergeBootConfig(originalConfig as any, bootResult as any) as any;
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
      // Dedupe `requires` (Set keeps first-seen order). The deprecated
      // `aiStudio`/`aiSeat` alias canonicalization was removed in framework#3308
      // — legacy spellings are now unknown tokens (warned below, rejected at
      // authoring by defineStack).
      const rawRequires: string[] = Array.isArray((config as any).requires)
        ? (config as any).requires.filter((c: unknown) => typeof c === 'string')
        : [];
      const requires: string[] = [...new Set(rawRequires)];
      // Snapshot the app's EXPLICIT capability declarations BEFORE the platform
      // appends its own convenience defaults (auth→email, mcp, pinyin-search,
      // ALWAYS_ON_CAPABILITIES, queue/job). Only these explicit declarations carry
      // "required" INTENT (#1597): a declared capability whose provider package is
      // absent is a hard boot error, whereas an auto-injected default that happens
      // to be absent stays best-effort (warn + continue).
      const declaredRequires = new Set<string>(requires);
      // Auth callbacks (password-reset, email-verification, magic-link,
      // invitation) depend on the email service. Auto-pull `email` when
      // `auth` is required so transactional mail works out of the box
      // (LogTransport fallback when no provider is configured).
      if (requires.includes('auth') && !requires.includes('email')) {
        requires.push('email');
      }
      // MCP is a default-on core capability: serve `/api/v1/mcp` unless
      // `OS_MCP_SERVER_ENABLED=false` opts out. The dispatcher gates the route
      // on the SAME decision point (`isMcpServerEnabled`), so serving the
      // route without also loading the MCP plugin would 501 every request
      // (#2698: the default must yield a connectable MCP endpoint). Explicit
      // `requires: ['mcp']` in config works regardless of the env var.
      if (isMcpServerEnabled() && !requires.includes('mcp')) {
        requires.push('mcp');
      }
      // Pinyin search recall (#2486): locale-gated platform capability. When
      // `OS_SEARCH_PINYIN_ENABLED` is unset, the default derives from the
      // stack's configured locales (any `zh-*` → on), and the resolved
      // decision is stamped back into the env var — every later consumer
      // (each engine's SchemaRegistry provisioning the `__search` companion
      // column, the plugin's own gate) reads the same answer via the no-arg
      // `resolveSearchPinyinEnabled()`. The shared `stampSearchPinyinEnabled`
      // helper is also what `createStandaloneStack` stamps from the compiled
      // artifact, so serve/dev and `os migrate plan`/`apply` cannot compute
      // different schema views of the same source tree (#3955).
      if (stampSearchPinyinEnabled((config as any).i18n)) {
        if (!requires.includes('pinyin-search')) requires.push('pinyin-search');
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
      // (Serve.CAPABILITY_TO_TIER) automatically opens that tier when listed
      // in `requires`. Capabilities NOT in that map (e.g. `automation`,
      // `analytics`, `audit`) bypass tier gating and are loaded directly by
      // the capability-resolver block further down.
      const CAPABILITY_TO_TIER = Serve.CAPABILITY_TO_TIER;
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

      // The kernel logger level. Honors --verbose / --log-level and
      // $OS_LOG_LEVEL / $LOG_LEVEL, defaulting to `warn` so flow/hook
      // execution failures surface even when the CLI manages its own output
      // (ADR-0032 "fail loudly"; see #1533). `--log-level silent` restores the
      // fully-quiet behavior. Resolved above the boot-quiet window, which
      // keys off it too (#4012).
      const loggerConfig = { level: bootLogLevel };

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
          checkMultiNodeAllowed: (requested?: number) => MultiNodeGateVerdict;
        };
        // Ask the gate about the topology the operator actually DECLARED.
        // Calling zero-arg leaves `requested` undefined, which a cap-aware gate
        // has nothing to clamp against — so the licensed-overflow verdict was
        // unreachable from here, not merely unread.
        //
        // `OS_CLUSTER_REPLICAS` is a **declared desired count**, identical in
        // every replica, not a live membership count — no membership count
        // exists at boot (see the gate module's own note). For an *advisory*
        // message that is the right input by construction: the operator is being
        // told about the configuration they wrote. It is NOT sufficient input
        // for enforcement, which is why enforcement is a separate mechanism.
        //
        // `Number(undefined)` is `NaN`, which the gate normalizes to "not
        // declared" — normalization lives at the seam on purpose, so there is
        // deliberately no `?? 0` or pre-parse here.
        const __gate = checkMultiNodeAllowed(Number(process.env.OS_CLUSTER_REPLICAS));
        if (!__gate.allowed) {
          console.warn(
            `[cluster] multi-node not authorized (${__gate.reason ?? 'denied'}) — ` +
            `downgrading to single-node (in-memory cluster). Remove OS_CLUSTER_DRIVER to silence.`,
          );
        } else {
          // Licensed-overflow advisory: the cluster IS entitled to run, it just
          // asked for more nodes than it paid for. Distinct from the denial
          // above, and deliberately not a downgrade.
          const __capAdvisory = formatMultiNodeCapAdvisory(__gate);
          if (__capAdvisory) console.warn(__capAdvisory);
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
      //        wasm-sqlite://, *.wasm.db        → sqlite-wasm
      //        memory://, mingo://              → memory (mingo InMemoryDriver)
      //        file:, sqlite:, *.db, :memory:   → sqlite (SQLite's own in-memory mode)
      //   3. Default: dev SQLite (native → wasm → in-memory step-down); prod none
      //
      // Kind-resolution and construction live in utils/storage-driver.ts so the
      // whole dispatch is unit-testable (storage-driver.test.ts). #3276: the
      // `memory` kind now maps to the mingo InMemoryDriver instead of silently
      // falling through to the dev SQLite `:memory:` default.
      // A DefaultDatasourcePlugin counts as a driver provider (#3826): the
      // standalone stack now DECLARES its `default` datasource and connects it
      // at boot through the datasource connection service, so building a
      // storage driver here would construct a duplicate pool the engine then
      // discards as already-registered.
      const hasDriver = plugins.some((p: any) =>
        p.name?.includes('driver') ||
        p.constructor?.name?.includes('Driver') ||
        p.name === 'com.objectstack.runtime.default-datasource' ||
        p.constructor?.name === 'DefaultDatasourcePlugin');
      if (!hasDriver && config.objects) {
         const databaseUrl = process.env.OS_DATABASE_URL;
         const driverType = resolveDriverType(process.env.OS_DATABASE_DRIVER, databaseUrl);
         // libSQL/Turso's credential is the only one that does NOT ride inside the
         // URL (`--database-auth-token`, forwarded by `os start` / `os dev` as
         // OS_DATABASE_AUTH_TOKEN; TURSO_AUTH_TOKEN is the vendor's own name, kept
         // as-is per Prime Directive #9's third-party exceptions).
         const databaseAuthToken = process.env.OS_DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;

         try {
           // #3826: the fallback no longer constructs a driver — it declares
           // the `default` datasource and lets the runtime's
           // DefaultDatasourcePlugin connect it at boot through the shared
           // DatasourceConnectionService (one connect path, one failure
           // verdict incl. OS_ALLOW_DRIVER_CONNECT_FAILURE, retained status in
           // Setup → Datasources). URL→config translation stays host-side in
           // resolveStorageDefinition. The dev sqlite step-down (#2229) and
           // the loosen-only self-heal (#2186, via config.autoMigrate) now run
           // inside the factory at connect.
           const { DriverPlugin, DefaultDatasourcePlugin } = await import('@objectstack/runtime');
           const resolution = resolveStorageDefinition(driverType, { databaseUrl, isDev, authToken: databaseAuthToken });
           if (resolution) {
             // #5602: libSQL/Turso is the one kind the shared open-core factory
             // cannot build — `@objectstack/driver-turso` is an OPTIONAL peer, so
             // the CLI loads it here and injects it through the plugin's documented
             // host-factory seam. Everything else about the boot is unchanged: same
             // connect path, same bootCritical verdict, same escape hatch. A missing
             // package throws MissingDriverPackageError BEFORE the plugin exists, so
             // the operator sees the install command rather than a connect failure —
             // and never a silent SQLite fallback.
             const hostFactory = isTursoDriverId(resolution.driverId)
               ? await loadTursoDriverFactory()
               : undefined;
             await kernel.use(new DefaultDatasourcePlugin(
               { driver: resolution.driverId, config: resolution.config },
               { dev: isDev, ...(hostFactory ? { factory: hostFactory } : {}) },
             ));
             trackPlugin(resolution.trackName);
             resolvedDriverLabel = resolution.label;
             resolvedDatabaseUrl = resolution.displayUrl;

             // ADR-0057 §3.6 (#2834 ②): provision the dedicated `telemetry`
             // datasource — a sibling SQLite file the engine routes every
             // telemetry/event/audit-classed object to, so platform-generated
             // growth can never again bloat the business DB. Dev default-on
             // for file-backed primaries; `OS_TELEMETRY_DB=0` opts out,
             // `OS_TELEMETRY_DB=<path>` opts in anywhere (incl. serve). Gated on
             // an explicit SQLite primary (`sqliteFilePath`, unset for the mingo
             // memory driver AND the dev-default `:memory:` store). The old
             // `resolution.engine !== 'memory'` refinement is unknowable now
             // that the primary connects later (#3826); the telemetry
             // provision's own `telemetry.engine !== 'memory'` check below
             // still guards the ABI-broken step-down case. The telemetry
             // driver itself stays a pre-built DriverPlugin — the documented
             // escape hatch for named auxiliary drivers.
             if (resolution.sqliteFilePath) {
               const { resolveTelemetryDbPath } = await import('../utils/telemetry-datasource.js');
               const telemetryPath = resolveTelemetryDbPath({ primaryPath: resolution.sqliteFilePath, env: process.env, dev: isDev });
               if (telemetryPath) {
                 try {
                   const { resolveSqliteDriver } = await import('@objectstack/service-datasource');
                   const telemetry = await resolveSqliteDriver({
                     filename: telemetryPath,
                     dev: isDev,
                     autoMigrate: isDev ? 'safe' : undefined,
                     warn: (m) => console.warn(chalk.yellow(m)),
                   });
                   if (telemetry.engine !== 'memory') {
                     // The engine keys datasources by driver name — the
                     // lifecycle router looks this exact name up. The driver
                     // name is the WHOLE wiring: DriverPlugin.init registers
                     // `driver.telemetry`, ObjectQL's discovery loop adopts
                     // it, and lifecycle-classed objects route to it. (An
                     // options bag once also asked for `datasourceName:
                     // 'telemetry'` metadata registration — inert since
                     // inception, retired in #4320.)
                     Object.defineProperty(telemetry.driver, 'name', { value: 'telemetry' });
                     await kernel.use(new DriverPlugin(telemetry.driver));
                     trackPlugin('TelemetryDatasource');
                     printDiagnostic(chalk.dim(`  telemetry datasource: ${telemetryPath} (lifecycle-classed system data; OS_TELEMETRY_DB=0 to disable)`));
                   }
                 } catch {
                   // Best-effort: a failed telemetry provision must never block
                   // boot — objects simply stay on the primary datasource.
                 }
               }
             }
           }
         } catch (e: any) {
           // "declared ≠ enforced" guard (#3276-class): a selection the CLI
           // RECOGNIZED but cannot honour must fail LOUDLY, never silently fall
           // through to the SQLite default and ignore the engine that was asked for.
           // Re-throw so run()'s fatal handler restores output, prints the
           // actionable message, and exits 1 (in dev AND prod). All OTHER driver
           // construction errors keep the prior best-effort silent behavior.
           //   • UnsupportedDriverError — recognized kind, no usable definition
           //     (`--database-driver turso` with no URL to connect to).
           //   • MissingDriverPackageError (#5602) — the optional driver package for
           //     a `libsql://` selection is not installed. Fatal for the same reason
           //     and with the same remedy shape: the message carries the exact
           //     install command, and there is deliberately no SQLite fallback.
           if (e instanceof UnsupportedDriverError) throw e;
           if (e instanceof MissingDriverPackageError) throw e;
           // Same class of fatal (#3724): a driver that refuses to run in this
           // deployment's tenancy mode — driver-mongodb has no row-level tenant
           // isolation and rejects a non-`single` posture. Swallowing it would
           // boot the server with NO driver at all, burying "your database
           // cannot isolate tenants" under a later, unrelated failure. Matched
           // by `code` (duck-typed) so the CLI keeps no dependency on the
           // driver package and cross-realm `instanceof` can't bite.
           if (e?.code === 'MONGODB_MULTI_TENANT_UNSUPPORTED') throw e;
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
      const hasAppPluginAlready = plugins.some(isAppPluginLike);
      const configHasMetadata = !!(
        config.objects || config.manifest || config.apps || config.flows || config.apis
      );
      // ORDERING (#4085 → #4131/ADR-0116): the wrap is APPENDED to `plugins`
      // rather than registered here — but the append is no longer what makes
      // the boot correct. AppPlugin now DECLARES its ordering contract
      // (`optionalDependencies: ['com.objectstack.engine.objectql']`,
      // `requiresServices: ['manifest']`), so the kernel hoists the engine
      // ahead of it in every slot, and a composition that genuinely lacks a
      // manifest provider fails as a named ordering error instead of the
      // mislabelled "Service 'manifest' is async - use await" crash #4085
      // produced. Appending is kept so both boot paths (config-derived wrap
      // here, `createStandaloneStack`'s own AppPlugin) share one plugin
      // order and one story in the boot logs.
      if (!hasAppPluginAlready && configHasMetadata) {
        try {
            const { AppPlugin } = await import('@objectstack/runtime');
            plugins = [...plugins, new AppPlugin(config)];
        } catch (e: any) {
            // Non-fatal — the platform still boots, just without this app's
            // metadata. But it must SAY so: this catch was silent, and the two
            // things it swallows (a malformed envelope AppPlugin rejects by
            // construction, an unresolvable @objectstack/runtime) both leave a
            // server answering with zero objects and no stated reason — the
            // same class of invisible boot failure as #4085 itself.
            console.warn(chalk.yellow(
              `  ⚠ Skipped registering the app defined in this config: ${e?.message ?? e}\n`
              + '    Its objects/flows will NOT be served. Fix the config (or pin an AppPlugin in `plugins`).',
            ));
        }
      } else if (hasAppPluginAlready) {
        // #4095 — skipping the wrap above also discards the authored module's
        // CODE. On the config-boot path the bundle already in `plugins[]` came
        // from `createStandaloneStack()` reading `dist/objectstack.json`, and a
        // JSON artifact cannot carry a function: the app booted with every
        // `script` action DECLARED and no handler registered, so each one 404'd
        // at dispatch. Move the executable members onto that bundle (the
        // bundle's own value always wins, so a host that wrapped itself on
        // purpose is untouched) and say so out loud when they have nowhere to go
        // — that silent drop is what hid this.
        // Success is silent: on the config-boot path this is now the normal
        // route by which handlers reach the engine, and the observable proof is
        // that the actions dispatch.
        const graft = graftAuthoredRuntimeMembers(plugins, config);
        if (graft.orphaned.length > 0) {
          console.warn(chalk.yellow(
            `  ⚠ ${relativeConfig} exports ${graft.orphaned.join(' / ')} but no app bundle claimed `
            + `${graft.orphaned.length === 1 ? 'it' : 'them'}`
            + `${graft.reason === 'ambiguous-app-plugin'
              ? ' — several apps are registered and the config declares no manifest.id to match'
              : ' — no registered app bundle has a matching manifest.id'}`
            + '. Action handlers registered there will NOT be reachable (they 404 at dispatch).',
          ));
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

      // ── Observability backends (#9832) ──────────────────────────────────
      // Auto-wire observability from env so production deployments can ship
      // metrics / errors to OTLP backends (Grafana Cloud, Honeycomb, …)
      // without app-level glue. Falls back to noop when OS_OBS_EXPORTER is
      // unset / unknown — zero-cost when off, and never crashes boot if
      // exporter init throws.
      //
      // Built EXACTLY ONCE per serve process, and this is the only call site.
      // The dispatcher block further down reads THIS binding rather than
      // calling again: a second `buildServeObservability()` would construct a
      // SECOND exporter — for `OS_OBS_EXPORTER=otlp` two
      // `OtlpHttpMetricsRegistry` instances with two independent flush timers,
      // double-exporting every series to the same backend.
      //
      // Registered as a SERVICE here — ahead of the transport (immediately
      // below), the dispatcher, and the capability providers (cache, storage)
      // — because every consumer resolves the canonical chain (explicit
      // option → `observability:metrics` service → nothing) inside its OWN
      // `init()`, and the kernel runs all of Phase 1 in resolved order with
      // registration order preserved between plugins that have no edge
      // (`resolvePluginOrder`). Registering after a consumer is registering
      // too late: that consumer has already fallen through to its no-op and
      // will never look again. This is exactly what `ObservabilityServicePlugin`'s
      // own JSDoc tells hosts to do ("Register this plugin BEFORE any plugin
      // that wants to consume the services").
      //
      // Deliberately NOT gated on `flags.server`: cache and storage are
      // registered on the `--no-server` path too, and their metrics are just
      // as real there.
      //
      // Registered ONLY when a backend is actually configured. An all-noop
      // registration would still be truthy at every consumer's step 2 and
      // would arm the transport's per-request middleware seam on deployments
      // that export nothing — the per-request cost #9650 deliberately kept off
      // an unconfigured deployment.
      const observability = await buildServeObservability();
      // Skip if the config already mounts its own — `ctx.registerService`
      // throws on a duplicate name, which would turn a host that wired its own
      // backends into a boot failure.
      const configHasObservabilityService = plugins.some(
        (p: any) => p.name === 'com.objectstack.observability.service'
            || p.constructor?.name === 'ObservabilityServicePlugin'
      );
      if (observability && !configHasObservabilityService) {
        try {
          const { ObservabilityServicePlugin } = await import('@objectstack/runtime');
          await kernel.use(new ObservabilityServicePlugin({
            metrics: observability.metrics,
            errors: observability.errorReporter,
          }));
          trackPlugin('ObservabilityService');
        } catch {
          // @objectstack/runtime unavailable — every consumer keeps its no-op
          // default, exactly as before this block existed.
        }
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

      // ── Dev-only: metadata HMR SSE endpoint for host/aggregator configs ──
      //
      // Host configs (their `plugins[]` holds instantiated Plugin objects) skip
      // the standalone stack — see `shouldBootWithLibrary()`. That stack is the
      // only place `@objectstack/metadata`'s MetadataPlugin gets composed, and
      // MetadataPlugin is what registers `GET /api/v1/dev/metadata-events` in
      // its start(). So when serving a host config the Console's dev
      // metadata-HMR reloader hits a 404 and the page never auto-reloads after
      // a recompile.
      //
      // Compose a lightweight, artifact-sourced MetadataPlugin here so the
      // endpoint exists regardless of boot shape. Guards:
      //   • `isDev` only — production / cloud host deployments are untouched.
      //   • `flags.server` — pointless without an HTTP server to mount it on.
      //   • skipped when a MetadataPlugin is already present (the standalone /
      //     artifact-fallback paths compose their own upstream).
      //   • skipped when no local compiled artifact resolves to source from.
      // Registered AFTER the HonoServer plugin so the `http-server` service
      // (and its `getRawApp()`) is available when MetadataPlugin.start() mounts
      // the route.
      if (isDev && flags.server) {
        const hasMetadataPlugin = plugins.some(
          (p: any) => p?.constructor?.name === 'MetadataPlugin'
        );
        if (!hasMetadataPlugin) {
          try {
            const { resolveDefaultArtifactPath } = await import('@objectstack/runtime');
            // `os dev` is the only caller that reaches here, and it is a
            // supervisor: read its channel, or the artifact this HMR watcher
            // polls would silently drift to `<cwd>/dist/objectstack.json`
            // whenever `os dev --artifact <elsewhere>` was used.
            const hmrArtifactPath = resolveDefaultArtifactPath(readInternalArtifactPath());
            if (hmrArtifactPath && !/^https?:\/\//i.test(hmrArtifactPath)) {
              const { MetadataPlugin } = await import('@objectstack/metadata');
              // Mirror the standalone stack's dev config exactly
              // (packages/runtime/src/standalone-stack.ts): declarative
              // metadata is loaded from the compiled artifact — no source-file
              // scanner (redundant + EMFILE-prone) — and `artifactWatch` polls
              // the single artifact file so an `os dev` recompile broadcasts a
              // reload over the SSE stream.
              await kernel.use(new MetadataPlugin({
                watch: false,
                artifactWatch: true,
                artifactSource: { mode: 'local-file', path: hmrArtifactPath },
              }));
              trackPlugin('Metadata');
            }
          } catch (e: any) {
            console.warn(chalk.yellow(`  ⚠ Dev metadata-HMR endpoint not enabled: ${e?.message}`));
          }
        }
      }

      // Serve /runtime/assets/* unconditionally — branding logos, favicons,
      // and other static runtime assets must resolve even when the Console
      // dist hasn't been built yet.  The directory is resolved as:
      //   1. OS_RUNTIME_ASSETS_DIR env var (explicit override)
      //   2. process.cwd() + '/assets' (when CLI cwd is a runtime/ package)
      // Silently skips if no assets directory exists.
      const runtimeAssetsDir = (
        process.env.OS_RUNTIME_ASSETS_DIR?.trim() ||
        path.resolve(process.cwd(), 'assets')
      );
      await kernel.use(createRuntimeAssetsPlugin(runtimeAssetsDir));

      // Unknown-environment hostname guard.
      //
      // Activation only: everything the guard decides, and why, lives on
      // `createUnknownHostnameGuardPlugin()` below — exported (#9442) so the
      // middleware, bypass matrix and refusal alike, is reachable from a test
      // without booting a real `os serve`.
      //
      // Activated only when OS_ROOT_DOMAIN is set (e.g. "objectos.ai"); with no
      // root domain there is no platform-host namespace to guard, so nothing is
      // installed and every hostname passes through as before.
      const __rootDomain = (process.env.OS_ROOT_DOMAIN || '').trim().toLowerCase();
      if (__rootDomain) {
        const guardPlugin: any = createUnknownHostnameGuardPlugin({ rootDomain: __rootDomain });
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
      // Mirrors the objectos-ee single-env host wiring: the CLOUD-DEPENDENT
      // surfaces (proxy + cloud-connection + runtime-config) only when
      // `resolveCloudUrl()` is truthy. Each plugin self-registers its own
      // Setup nav bundle in start(), so no manual bundle registration is
      // needed here.
      //
      // install-local is DELIBERATELY NOT on that gate (#8343). It is the
      // documented air-gapped path — `os package install ./dist/objectstack.json`
      // hands the compiled artifact over inline, and `handleInstall`'s inline
      // branch never reads `this.cloudUrl` at all — so gating it on a control
      // plane withheld it from the one deployment that cannot have one. A
      // self-hosted EE box could not install a package by ANY route: measured
      // on objectos-ee 4.0.5-rc.1, both GET and POST /marketplace/install-local
      // 404, while its own /runtime/config advertised `installLocal: true`.
      // Note `off` is not an unusual choice there but the SHIPPED DEFAULT --
      // that image's compose file reads `OS_CLOUD_URL: ${OS_CLOUD_URL:-off}`,
      // so every self-hosted stack that does not override it landed here.
      // The package README states the intended contract in as many words —
      // "`OS_CLOUD_URL=off` disables every remote call; air-gapped installs
      // keep working via inline manifests handed to `install-local`" — so the
      // gate contradicted the contract rather than expressing it.
      //
      // What "preserving the vanilla marketplace-less `objectstack dev`" is
      // worth here, measured rather than assumed: a plain `objectstack dev`
      // sets NO OS_CLOUD_URL, and `resolveCloudUrl()` then returns
      // DEFAULT_CLOUD_URL — truthy — so it already mounts install-local (and
      // its "Installed Apps" nav) today. The only runs this changes are those
      // that explicitly opted out (`off`/`none`/`local`/`disabled`), and for
      // them the nav-ownership rule in marketplace-ui.ts ("the entry lives and
      // dies with the capability -> no dead page") is SATISFIED, not violated:
      // the entry now appears exactly when a working offline install surface
      // is behind it. Nothing that makes a remote call mounts under `off`.
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
          const wiring = Serve.planMarketplaceWiring({ isRuntimeHostKernel, marketplaceUrl, plugins });
          if (wiring.cloudSurfaces) {
            // Every mount here is guarded on what the HOST already wired
            // (#8357), the same rule and the same idiom the offline arm below
            // uses. `kernel.use` keys by name, so an unguarded mount is not a
            // harmless double-mount: one of the two instances is discarded,
            // and WHICH one depends on registration order rather than on any
            // stated rule. The host composed its instance deliberately, with
            // arguments the CLI cannot reconstruct from `resolveCloudUrl()`
            // alone — a distinct control plane, a custom install storageDir, a
            // credential path, cache tuning — so the host's is the one that
            // must stand. See `planMarketplaceWiring` for the measurement.
            let mountedAny = false;
            if (wiring.cloudProxy) {
              await kernel.use(new MarketplaceProxyPlugin({ controlPlaneUrl: marketplaceUrl }));
              mountedAny = true;
            }
            if (wiring.cloudInstallLocal) {
              await kernel.use(new MarketplaceInstallLocalPlugin({ controlPlaneUrl: marketplaceUrl }));
              mountedAny = true;
            }
            // Same-origin /cloud-connection/* surface (status + device-code
            // bind + control-plane catalog views) in single-environment mode.
            if (wiring.cloudConnection) {
              await kernel.use(createCloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: marketplaceUrl }));
              mountedAny = true;
            }
            // Server-pushed runtime config so the Console knows marketplace +
            // install-local are live (same-origin; install into THIS kernel).
            if (wiring.cloudRuntimeConfig) {
              await kernel.use(new RuntimeConfigPlugin({ ...Serve.RUNTIME_CONFIG_OPTIONS }));
              mountedAny = true;
            }
            // Report the banner line only when this block actually mounted
            // something. A host that wires the whole set gets no entry from
            // here — it will report its own plugins through the config-plugin
            // loader — and an unconditional `trackPlugin` would otherwise
            // credit the CLI with a mount it did not make.
            if (mountedAny) trackPlugin('Marketplace');
          } else if (wiring.offlineInstallLocal || wiring.offlineRuntimeConfig) {
            // Cloud explicitly disabled -> mount the OFFLINE surfaces only:
            // the install route, and the runtime config that makes it
            // discoverable. Neither dials out. Each is mounted under its own
            // flag, because a host may already provide one and not the other.
            //
            // OFFLINE_CONTROL_PLANE, never the `''` sitting in `marketplaceUrl`:
            // the plugin re-resolves whatever it is handed through
            // `resolveCloudUrl()`, which treats an EMPTY string as "unset" and
            // falls back to the PUBLIC DEFAULT_CLOUD_URL — pointing an
            // air-gapped runtime's catalog branch at cloud.objectos.ai, the
            // opposite of what `off` asked for. See the constant's own note.
            //
            // The presence check is load-bearing, not defensive: `kernel.use`
            // keys plugins by name, so mounting unconditionally would let this
            // `off`-pinned instance REPLACE a host config's own install-local
            // that was constructed with an explicit control-plane URL —
            // silently downgrading that host's catalog capability. A host that
            // wires its own keeps it.
            if (wiring.offlineInstallLocal) {
              await kernel.use(new MarketplaceInstallLocalPlugin({ controlPlaneUrl: Serve.OFFLINE_CONTROL_PLANE }));
              trackPlugin('MarketplaceInstallLocal');
            }
            // ...and the runtime config that lets the Console SEE it (#8389).
            //
            // Without this, #8343's fix left an air-gapped box in a state that
            // reads as "feature missing" from every UI: a working
            // /api/v1/marketplace/install-local route and NO
            // /api/v1/runtime/config at all, so the SPA cannot learn the route
            // exists and renders no install affordance for a capability that
            // works. Discovery is half of shipping the capability.
            //
            // #8343 could not mount this here: the plugin hardcoded
            // `features.marketplace: true`, so telling the Console the truth
            // about install-local meant asserting a browse capability that is
            // definitively absent on this runtime — trading the reported bug
            // for its mirror image. #8356 removed that constraint by deriving
            // the flag from the serving app's route table, so this mount now
            // reports `installLocal: true` AND `marketplace: false` on its own,
            // with no knob and nothing for the wiring to keep in step.
            //
            // Guarded for the same reason the install-local mount above is:
            // `kernel.use` keys by name, so an unconditional mount REPLACES a
            // host's own RuntimeConfigPlugin — silently dropping the branding
            // and the resolveFeatures policy it was constructed with. A host
            // that wires its own keeps it.
            if (wiring.offlineRuntimeConfig) {
              await kernel.use(new RuntimeConfigPlugin({ ...Serve.RUNTIME_CONFIG_OPTIONS }));
              trackPlugin('RuntimeConfig');
            }
          }
        } catch (err: any) {
          console.warn(chalk.yellow(`  \u26a0 Marketplace/cloud-connection wiring failed: ${err?.message ?? err}`));
        }
      }

      // 5c. Auto-register PlatformObjectsPlugin. It carries platform
      // infrastructure every served kernel needs: the `sys_migration`
      // data-migration flag ledger + fresh-datastore attestation (#4243 —
      // without it the engine's deployment gates read "no ledger" and fall
      // back to the lax legacy posture), the `sys_secret` cipher store
      // (#4270 — the engine's secret-field write path and the datasource
      // credential binder fail CLOSED without it; the crypto wiring below
      // assumes the table exists), and the platform-default
      // translation bundles (Setup App + metadata-type configuration
      // forms). Without the latter, Setup nav labels and metadata-admin
      // form labels fall back to English literals even when
      // Accept-Language requests another locale.
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

      // Host-app package resolution — shared by every optional / enterprise
      // package loaded from here down.
      //
      // Node ESM resolves a bare `import(pkg)` against the IMPORTER's own
      // realpath. The CLI is reached through a workspace/`link:` dependency, so
      // that realpath is inside the FRAMEWORK workspace: a bare import can only
      // see what the framework itself installed. A package supplied by the app
      // being served — a cloud-private one such as `@objectstack/organizations`,
      // or anything a customer installs into their own project — is invisible
      // to it no matter what the host app declares. Resolve from the host root
      // instead; the CLI's own resolution stays as the fallback for the
      // framework-owned packages the CLI depends on.
      //
      // #4719: "resolve from the host root" now means "resolve what the host
      // root DECLARES". The host lookup was a CJS require, CJS honours
      // NODE_PATH, and the pnpm bin shim exports NODE_PATH pointing at the
      // hoisted workspace store — so anything transitively reachable from
      // anywhere in the workspace resolved as if the app had declared it, and
      // whether the D5 wall below fired came down to whether `serve` was reached
      // through that shim. The declaration is the contract; reachability is not.
      //
      // Defined HERE, above the auth block, because the enterprise organizations
      // load inside it needs it: this helper used to be declared *after* that
      // block, so the organizations load fell back to a bare import, resolved in
      // the framework workspace, never found the cloud-private package, and every
      // walled-posture deployment hit the ADR-0093 D5 fail-fast and exited 1
      // (cloud#1013).
      const hostRoot = process.cwd();
      const importFromHost = createHostImporter(hostRoot);

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
          const secret = readEnvWithDeprecation('OS_AUTH_SECRET', ['AUTH_SECRET', 'BETTER_AUTH_SECRET'], { silent: true })
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
            const baseUrl = readEnvWithDeprecation('OS_AUTH_URL', 'BETTER_AUTH_URL', { silent: true })
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
            const rootDomain = readEnvWithDeprecation('OS_ROOT_DOMAIN', 'ROOT_DOMAIN', { silent: true })?.trim();
            if (rootDomain) {
              const wildcard = `https://*.${rootDomain}`;
              if (!trustedOrigins.includes(wildcard)) trustedOrigins.push(wildcard);
            }

            // [ADR-0108 / #3723] Nothing to wire: the organization-role
            // vocabulary is closed (owner/admin/delegated_admin/member). A
            // stack's declared `position` / `permission` names are NOT org
            // roles — they are positions, assigned through `sys_user_position`
            // or an invitation carrying placement (ADR-0105 D8).
            await kernel.use(new AuthPlugin({
              secret,
              baseUrl,
              socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
              trustedOrigins: trustedOrigins.length ? trustedOrigins : undefined,
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
                // ADR-0069 D1: reject breached passwords (Have I Been Pwned).
                // Opt-in; the auth Settings toggle (password_reject_breached) is
                // the primary control, OS_AUTH_PASSWORD_REJECT_BREACHED the
                // operator override (env wins in buildPluginList()).
                passwordRejectBreached:
                  String(process.env.OS_AUTH_PASSWORD_REJECT_BREACHED ?? 'false').toLowerCase() === 'true',
                // #2766/#2780 — phone-number sign-in (phone+password always;
                // OTP sign-in/reset once the sms capability has a deliverable
                // provider). Opt-in: without this env the config flag had no
                // `objectstack serve` switch at all.
                phoneNumber:
                  String(process.env.OS_AUTH_PHONE_NUMBER_ENABLED ?? 'false').toLowerCase() === 'true',
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

            // ADR-0048 — the platform apps (Setup/Account) moved out of
            // plugin-auth's manifest into their own one-app packages. Register
            // each after AuthPlugin (best-effort; skipped if not installed).
            // NOTE: @objectstack/studio is intentionally NOT default-loaded — the
            // console ships a dedicated Studio surface at /_console/studio/<pkg>/<pillar>,
            // so Studio no longer needs to exist as a navigable app tile.
            for (const [appPkg, factory] of [
              ['@objectstack/setup', 'createSetupAppPlugin'],
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

            // Pair: OrganizationsPlugin (multi-org, ENTERPRISE) — must register
            // BEFORE SecurityPlugin. The multi-org runtime (`organization_id`
            // auto-stamp, per-org seed replay, multi-org default-org bootstrap)
            // lives in the closed-source `@objectstack/organizations` package
            // (ADR-0105 D12; it registers the historical `org-scoping` service
            // SecurityPlugin probes at start() to keep vs strip the wildcard
            // `tenant_isolation` RLS — so registration order matters). Without
            // it, deployments are single-org: the open member-management
            // basics (plugin-auth's default-org bootstrap + better-auth
            // invitations) still work.
            // [ADR-0105 D1] Key off the resolved POSTURE, not the legacy boolean.
            // Both walled postures (`group` and `isolated`) need this package:
            // gating on `OS_MULTI_ORG_ENABLED` alone would let
            // `OS_TENANCY_POSTURE=group` skip the load AND the fail-fast below,
            // silently degrading to an unwalled single-org deployment — the exact
            // ADR-0049 class this guard exists to close.
            // #5359 — reuse the value the boot gate resolved at the top of
            // `run()`. Re-invoking the resolver here is what put the throw
            // inside this swallowing `try` in the first place; by the time
            // control reaches this line the posture is known-valid.
            const multiTenant = tenancyPosture !== 'single';
            if (multiTenant) {
              // #4818 — TWO STAGES, TWO FAILURES, TWO DIAGNOSES. `import` and
              // `kernel.use(new mod.OrganizationsPlugin())` used to share one
              // `try`, so anything the plugin threw while CONSTRUCTING or
              // MOUNTING was reported as "@objectstack/organizations could not
              // be loaded" — i.e. as an absent package — and was swallowed by
              // OS_ALLOW_DEGRADED_TENANCY. Those are different facts with
              // different remedies (install it vs. address what the plugin
              // reported), and the escape hatch only ever meant "the capability
              // is ABSENT and I accept the degradation".
              //
              // The classifier is WHICH STAGE THREW — deliberately not the
              // error's shape. The framework must not know any of the plugin's
              // private refusal semantics (a layering violation that would need
              // updating per refusal reason), and the package is loaded through
              // `importFromHost`, so CLI and plugin may hold different module
              // instances: `instanceof` and named `code` checks are both
              // fragile here. Stage is the only classifier that needs to know
              // nothing about the plugin's internals.
              const organizationsPkg = '@objectstack/organizations';
              let orgMod: any;
              // ── Stage 1: import. Failure here = the package is ABSENT. ──
              try {
                // Resolve from the HOST APP (cloud#1013). This package is
                // cloud-private: it is installed in the served app's
                // node_modules, never in the framework workspace the CLI's own
                // realpath points at, so a bare import here could never find it
                // — `objectstack serve` failed the fail-fast below on EVERY
                // self-hosted walled-posture deployment, and the only way past
                // it was OS_ALLOW_DEGRADED_TENANCY=1, i.e. exactly the unwalled
                // state D5 exists to prevent. The host app declares the package;
                // this resolves it from there.
                orgMod = await importFromHost(organizationsPkg);
              } catch (orgErr) {
                // ADR-0093 D5 — degraded tenancy fails fast. Multi-org was
                // requested but the enterprise package can't provide tenant
                // isolation: `tenant_isolation` RLS would be stripped and every
                // org boundary inert. A deployment that asked for isolation must
                // NOT serve traffic pretending to have it (ADR-0049 at the
                // deployment layer). Refuse to boot unless the operator has
                // explicitly opted into the degraded state.
                //
                // process.exit (not throw): this catch sits inside the broad
                // AuthPlugin try below, which swallows errors — a throw would be
                // caught and boot would silently continue degraded, which is the
                // exact footgun this guard closes.
                const cause = orgErr instanceof Error ? orgErr.message : String(orgErr);
                if (!resolveAllowDegradedTenancy()) {
                  // #4719 — TWO ABSENCES, TWO REMEDIES. Until the host lookup was
                  // gated on the host's declaration, both arrived here as one
                  // MODULE_NOT_FOUND and got one piece of advice: "declare it in
                  // the app's package.json". For an operator who HAD declared it
                  // and whose install was pruned, that sent them to re-read a
                  // file that was already correct. The importer now says which
                  // one it is, so this text can too.
                  const declaration = readHostDeclaration('@objectstack/organizations', hostRoot);
                  const remedy =
                    hostImportFailureKind(orgErr) === 'declared-unresolvable'
                      ? '      • this app DECLARES @objectstack/organizations ' +
                        `(${declaration.field}: ${JSON.stringify(declaration.specifier)}) — the\n` +
                        '        declaration is NOT the problem and re-reading package.json will not help.\n' +
                        `        Repair the INSTALL in ${hostRoot}: run \`pnpm install\`, check that a\n` +
                        '        production prune did not drop it, and that its dist is actually built — or\n'
                      : '      • add @objectstack/organizations (the enterprise multi-org runtime) to THIS APP\n' +
                        "        — declare it in the app's package.json and install; the CLI resolves it from the\n" +
                        '          app, not from the framework it is linked out of. Being merely reachable\n' +
                        '          through NODE_PATH / a hoisted workspace store is deliberately not enough\n' +
                        '          (#4719) — that made this wall depend on how the process was launched — or\n';
                  console.error(
                    chalk.red(
                      `\n  ✖ FATAL: tenancy posture '${tenancyPosture}' was requested but ` +
                        '@objectstack/organizations could not be loaded,\n' +
                        '    so the organization wall is INACTIVE. Refusing to boot — a deployment that requested\n' +
                        '    multi-organization isolation must not serve traffic without it (ADR-0093 D5).\n\n' +
                        '    Fix one of:\n' +
                        remedy +
                        "      • set OS_TENANCY_POSTURE=single (or unset OS_MULTI_ORG_ENABLED) to run single-org, or\n" +
                        '      • set OS_ALLOW_DEGRADED_TENANCY=1 to boot in an explicitly degraded single-org state.\n\n' +
                        `    cause: ${cause}\n`,
                    ),
                  );
                  process.exit(1);
                }
                // Explicitly opted into degraded operation — boot, but brand it
                // loudly. The `tenancy` service also reports `degraded: true` to
                // /auth/config and the Setup dashboard so it stays visible.
                console.warn(
                  chalk.yellow(
                    `  ⚠ DEGRADED TENANCY (OS_ALLOW_DEGRADED_TENANCY=1): posture '${tenancyPosture}' requested but ` +
                      '@objectstack/organizations is unavailable — booting with the organization wall INACTIVE. ' +
                      'Organization boundaries are NOT enforced. (ADR-0093 D5)',
                  ),
                );
                // Degraded boot: `orgMod` stays undefined, so stage 2 below is
                // skipped. Nothing was loaded, so nothing can be mounted.
              }

              // ── Stage 2: construct + mount. Failure here = the package IS
              // present and the plugin itself declined. Report what it said,
              // verbatim, and exit unconditionally: OS_ALLOW_DEGRADED_TENANCY
              // does not cover this (#4818). Honouring it here would move
              // whatever gate the plugin is enforcing onto an env var. ──
              if (orgMod) {
                try {
                  await kernel.use(new orgMod.OrganizationsPlugin());
                  trackPlugin('Organizations');
                } catch (mountErr) {
                  // The framework does NOT interpret this error — it does not
                  // know why the plugin refused and must not guess a cause.
                  // Surface the plugin's own words (plus any `code` it carries,
                  // printed generically) and let them be the authority.
                  const mountMessage = mountErr instanceof Error ? mountErr.message : String(mountErr);
                  const mountCode = (mountErr as any)?.code;
                  // process.exit (not throw): this sits inside the broad
                  // AuthPlugin try below, which swallows errors — a throw would
                  // be caught and boot would continue with the wall inactive.
                  console.error(
                    chalk.red(
                      `\n  ✖ FATAL: tenancy posture '${tenancyPosture}' was requested and ` +
                        '@objectstack/organizations WAS found and loaded,\n' +
                        '    but its OrganizationsPlugin refused to mount, so the organization wall is INACTIVE.\n' +
                        '    Refusing to boot — a deployment that requested multi-organization isolation must not\n' +
                        '    serve traffic without it (ADR-0093 D5).\n\n' +
                        '    This is NOT a missing-package problem: the runtime is installed and resolvable here,\n' +
                        '    so module resolution / NODE_PATH / dependency pruning are not the place to look.\n\n' +
                        '    The plugin reported (verbatim — the framework does not interpret it):\n' +
                        (mountCode !== undefined ? `      code: ${String(mountCode)}\n` : '') +
                        `      ${mountMessage}\n\n` +
                        '    Fix one of:\n' +
                        '      • resolve what the plugin reported above — its message is the authority on the\n' +
                        '        remedy; this CLI has no further detail to add, or\n' +
                        "      • set OS_TENANCY_POSTURE=single (or unset OS_MULTI_ORG_ENABLED) to run single-org.\n\n" +
                        '    OS_ALLOW_DEGRADED_TENANCY does NOT apply to this failure and will not get past it:\n' +
                        '    it covers an ABSENT multi-org runtime the operator accepts doing without, not a\n' +
                        '    present one that declined to mount. (#4818)\n',
                    ),
                  );
                  process.exit(1);
                }
              }
            }

            // Pair: SecurityPlugin (RBAC) — optional
            try {
              const securityPkg = '@objectstack/plugin-security';
              const { SecurityPlugin, appSecurityPluginOptions } = await import(/* webpackIgnore: true */ securityPkg);
              // ADR-0056 D7 — honor an app-declared default profile. A stack
              // permission set marked `isDefault` becomes the baseline for
              // users with no explicit grants. The SecurityPlugin's own scan
              // only sees its built-in sets, so the declared name is passed
              // through explicitly (undefined → built-in default).
              //
              // [#7001] Resolved through the SHARED helper rather than
              // open-coded here. This was the only boot path that did it at
              // all: `@objectstack/verify`'s `bootStack` constructed a vanilla
              // `new SecurityPlugin()`, so an app's own dogfood suite ran
              // against a boot without the profile the CLI gave its users. The
              // two now agree by construction — one helper, one call shape, and
              // `serve-verify-security-parity.contract.test.ts` fails if either
              // side open-codes its way back out.
              await kernel.use(new SecurityPlugin(appSecurityPluginOptions(config)));
              trackPlugin('Security');
            } catch {
              // optional
            }

            // Pair: AuditPlugin — optional
            //
            // [#9863 / #9864] Registered with NO options, so record-view
            // auditing (`readAudit`) is off on this path. The one way an app
            // turns it on today is to put its own
            // `new AuditPlugin({ readAudit: … })` in the stack's `plugins`
            // array, which this file registers further down — AFTER this line.
            // Both instances carry the name `com.objectstack.audit`, so the
            // app's supersedes this one and the opt-in takes effect.
            //
            // That is a DECLARED contract now, not the accident #9863 found it
            // as: duplicate registration by name overwrites — last-one-wins,
            // with a `warn` naming both versions — identically on both kernels,
            // stated in `packages/core/src/plugin-registration.ts` and pinned
            // against `ObjectKernel` AND `LiteKernel` by
            // `packages/core/src/plugin-registration.contract.test.ts` (#9864,
            // maintainer ruling 2026-08-19, option B). Before that ruling the
            // behaviour was undeclared, untested and order-dependent, and
            // `LiteKernel.use()` threw on the very same input.
            //
            // ⚠️ The dependency is on the ORDER as much as on the overwrite:
            // this registration must stay ABOVE the stack's `plugins` loop, or
            // the CLI's option-less instance would supersede the app's
            // configured one instead. #9863 remains open on its own question —
            // whether `os serve` should grow an `appAuditPluginOptions(config)`
            // helper like its `SecurityPlugin` sibling above, rather than
            // reaching the capability only through a supersede.
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
          if (!Serve.isModuleNotFoundError(err)) {
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

            // [#9863 / #9864] The superseding half of the pair documented at
            // the `AuditPlugin` auto-registration above: a stack plugin whose
            // `name` matches one auto-registered earlier REPLACES it, by
            // declared contract (`packages/core/src/plugin-registration.ts`),
            // with a `warn` naming both versions. That is how an app supplies
            // options to a plugin this CLI mounts without them.
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
        // Per-project membership (sys_environment_member 403 gate) is, by
        // default, ON whenever project-scoping is on. A host can opt OUT
        // (env-native auth IS the membership — ADR-0024 D9) by setting
        // `api.enforceProjectMembership: false`. Undefined → dispatcher default.
        const enforceProjectMembership = apiConfig.enforceProjectMembership;
        // [#4910] The stack's top-level `server:` block — deliberately narrow:
        // only keys with a consumer are declared, and both of these have one in
        // the dispatcher's inbound rate limiter. Read here, next to `api:`, for
        // the same reason that one is: this is the single place the authored
        // stack is turned into plugin configuration.
        //
        // NOTE the budget is deliberately NOT validated here. An unusable one
        // (`maxRequests: 0`) throws out of `createInboundRateLimitMiddleware`
        // during the dispatcher plugin's `init()`, which the kernel runs at
        // BOOTSTRAP — outside the optional-plugin `catch` below, which only
        // guards the `import`/`use` registration. So a nonsense budget fails the
        // boot with a prescriptive message instead of silently disarming the
        // limiter or, worse, silently dropping the whole dispatcher.
        const serverConfig = (config as any).server ?? {};
        const rateLimitConfig = {
            ...(serverConfig.security?.rateLimit ? { budget: serverConfig.security.rateLimit } : {}),
            trustProxy: serverConfig.trustProxy === true,
        };
        // [#3963] Anonymous access to object data is denied unconditionally —
        // there is no `api.requireAuth` opt-out any more (auth is a kernel
        // concern; every legitimately session-less surface derives its own narrow
        // authorization from a declaration instead).
        //
        // The CLI used to hand an EXPLICIT fail-open to a stack with no auth at
        // all, reasoning that nobody could authenticate against it so denying
        // would brick its data API. Under A1 that inverts the conclusion: a stack
        // with no auth has no security model, so it must not serve a data API —
        // and it should say so at boot instead of quietly serving object data to
        // the internet. Auth availability = the tier auto-registers it OR the
        // stack mounts AuthPlugin explicitly.
        if (flags.server && !(tierEnabled('auth') || hasAuthPlugin)) {
          throw new Error(
            'This stack mounts no auth, so no caller can authenticate — and anonymous access to object '
            + 'data is always denied (#3963), which would leave the data API unusable.\n'
            + 'Fix it one of two ways:\n'
            + `  • enable auth — add the 'auth' tier (or mount AuthPlugin in \`plugins\`);\n`
            + '  • or serve without the data API — run with --no-server, or drop the REST/dispatcher plugins.\n'
            + "Publishing a genuinely public surface does not need anonymous data access: use a public form "
            + "view, a share link, or `book.audience: 'public'`.",
          );
        }

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
          // `observability` is the ONE block built above (#9832), reused
          // here rather than rebuilt: a second `buildServeObservability()`
          // call would stand up a second exporter with its own flush timer.
          // Passing it explicitly keeps the dispatcher on step 1 of the
          // resolution chain, so its behaviour is unchanged by the service
          // registration above — and because `armHttpRequestCounter` latches
          // per server object (#9835), the transport having armed the same
          // registry in Phase 1 makes this plugin's arming a no-op instead of
          // a second observer on the same series.
          await kernel.use(
            createDispatcherPlugin({
              scoping: { enableProjectScoping, projectResolution },
              enforceProjectMembership,
              observability,
              rateLimit: rateLimitConfig,
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
      // `importFromHost` (declared above, before the auth block) resolves
      // optional plugin packages from the HOST APP's context — the app being
      // served declares them as deps, including private packages like
      // @objectstack/service-ai-studio that the framework CLI itself does not
      // depend on.
      // [CE AI opt-in] Auto-register the headless AI service ONLY when the host
      // app DECLARES the AI service (or the cloud AI Studio that builds on it).
      // Declaration is the edition boundary: a Community-Edition app that omits
      // both gets no AI service, no
      // agents, and no `services.ai` in discovery (so the console hides its AI
      // surface), while MCP and every other capability are unaffected. Gating on
      // a *declared* dep — not mere resolvability — makes this reliable in a
      // workspace/monorepo, where the package stays hoist-resolvable when undeclared.
      //
      // #4719 — this used to be a local re-implementation of that read. It was
      // right, and it was the ONLY place in the boot path that asked the question
      // the right way: the enterprise organizations load two blocks up asked
      // "does it resolve", which a hoisted store answered yes to regardless. Both
      // now go through the one owner in `@objectstack/types/node`, so "declared"
      // cannot mean two different things in one file (Prime Directive #12).
      const hostDeclaresDependency = (pkg: string): boolean => isDeclaredByHost(pkg, hostRoot);
      // `wantsAiService` is the AUTO (opt-in) signal: the host app listed the base
      // AI service — or the Studio that builds on it — in its OWN package.json. This
      // is a package.json READ (a deliberate authoring act), not a speculative
      // import: gating on a *declared* dep, not mere resolvability, is reliable in a
      // workspace/monorepo where a package stays hoist-resolvable when undeclared.
      // Studio implies the base service (it attaches via the `ai:ready` hook the base
      // fires; the base is a transitive dep of Studio, so it stays resolvable).
      const wantsAiService =
        hostDeclaresDependency('@objectstack/service-ai')
        || hostDeclaresDependency('@objectstack/service-ai-studio');

      // Load an optional, separately-published service plugin by INTENT (#1597).
      // `required` (from an explicit `requires: [...]` capability) makes a missing
      // OR crashing package a HARD boot error — a declared-but-broken capability
      // must fail-fast, never boot silently degraded (the outer boot catch prints
      // the message and exits 1). `auto` (the package is merely DECLARED as a dep)
      // is best-effort: a genuine crash is surfaced loudly, an absent package is the
      // expected quiet skip. Presence is never inferred by importing-and-catching —
      // the caller already decided to attempt this from intent, so the module-not-
      // found test only WORDS the failure, it never decides whether to load.
      // Returns true when the plugin was registered.
      const loadOptionalServicePlugin = async (
        pkg: string,
        exportName: string,
        opts: { required: boolean; label: string; track: string; capability: string },
      ): Promise<boolean> => {
        try {
          const mod: any = await importFromHost(pkg);
          const Ctor = mod[exportName];
          if (typeof Ctor !== 'function') {
            const detail = `${pkg} did not export ${exportName}`;
            if (opts.required) {
              throw new Error(`[${opts.label}] required but ${detail}.`);
            }
            console.warn(chalk.yellow(`  ⚠ ${opts.label}: ${detail} — skipping`));
            return false;
          }
          await kernel.use(new Ctor());
          trackPlugin(opts.track);
          return true;
        } catch (err: unknown) {
          if (opts.required) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
              // #3366 — an absent provider is classified by edition: a cloud-only
              // capability (e.g. `ai` → @objectstack/service-ai) says so instead of
              // the un-followable "add it to your dependencies". Same wording the
              // `os build` preflight prints, so boot and preflight read identically.
              Serve.isModuleNotFoundError(err)
                ? missingProviderMessage(opts.capability)
                : `[${opts.label}] failed to start: ${msg}`,
            );
          }
          // auto (opt-in): non-fatal. A real crash is surfaced; a missing package is
          // the expected "not installed" path and stays quiet.
          if (!Serve.isModuleNotFoundError(err)) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[${opts.label}] failed to start: ${msg}`);
          }
          return false;
        }
      };

      // Base AI service — enable from declared INTENT, not package presence (#1597):
      //   • `requires: ['ai']` (or `['ai-studio']`, which implies the base) ⇒ required
      //     → a missing/broken package aborts startup (fail-fast).
      //   • package declared in the app's package.json (but not required) ⇒ auto
      //     → load best-effort.
      //   • otherwise ⇒ skip, with NO speculative import.
      // The `ai` tier is the orthogonal DENY: a Community-Edition deployment whose
      // `tiers` omit `ai` never loads it, whatever the intent — so a CE app that
      // omits AI gets no AI service, no agents, and no `services.ai` in discovery
      // (the console hides its AI surface), while every other capability is unaffected.
      const aiRequired =
        declaredRequires.has('ai') || declaredRequires.has('ai-studio');
      const aiDecision = Serve.resolveOptionalPluginLoad({
        tierAllowed: tierEnabled('ai'),
        required: aiRequired,
        declared: wantsAiService,
      });
      if (!hasAIPlugin && aiDecision !== 'off') {
        // AIServicePlugin auto-detects its LLM provider from environment
        // (AI_GATEWAY_MODEL, OPENAI_API_KEY, ANTHROPIC_API_KEY,
        // GOOGLE_GENERATIVE_AI_API_KEY) — no adapter to construct here.
        const aiLoaded = await loadOptionalServicePlugin(
          '@objectstack/service-ai',
          'AIServicePlugin',
          { required: aiDecision === 'required', label: 'AI', track: 'AIService', capability: 'ai' },
        );

        // AI Studio (AI-driven metadata authoring / "online development") builds on
        // the base service and attaches via its `ai:ready` hook, so only attempt it
        // once the base actually loaded. It is NOT part of the open-source framework:
        //   • `requires: ['ai-studio']` ⇒ required → fail-fast if the private package
        //     is absent (an app that advertises Studio must ship it).
        //   • package declared but not required ⇒ auto (best-effort).
        //   • otherwise ⇒ skip — this is the control-plane host path (apps/cloud ships
        //     no Studio and MUST boot clean, cloud#107): not declared + not required
        //     ⇒ no import, no error.
        if (aiLoaded) {
          const hasAIStudio = plugins.some(
            (p: any) => p.name === 'com.objectstack.service-ai-studio'
                || p.constructor?.name === 'AIStudioPlugin'
          );
          if (!hasAIStudio) {
            const studioDecision = Serve.resolveOptionalPluginLoad({
              tierAllowed: tierEnabled('ai'),
              required: declaredRequires.has('ai-studio'),
              declared: hostDeclaresDependency('@objectstack/service-ai-studio'),
            });
            if (studioDecision !== 'off') {
              await loadOptionalServicePlugin(
                '@objectstack/service-ai-studio',
                'AIStudioPlugin',
                { required: studioDecision === 'required', label: 'AI Studio', track: 'AIStudio', capability: 'ai-studio' },
              );
            }
          }
        }
      }

      // 5. Capability resolver — auto-load service plugins declared in
      // `requires: [...]` that are NOT tier-gated. Each entry of
      // Serve.CAPABILITY_PROVIDERS maps a token to a package + factory; if the
      // user already provided an explicit instance via `plugins: [...]` we
      // skip (explicit wins). Adding a new built-in capability = one entry on
      // the static registry + its token in the spec vocabulary (#3265).
      const CAPABILITY_PROVIDERS = Serve.CAPABILITY_PROVIDERS;

      // Exact identity comparison, NOT substring containment — a consumer named
      // after the capability it consumes must never be mistaken for its
      // provider (#7652). See Serve.providesCapability.
      const hasPluginMatching = (identities: readonly string[]) =>
        Serve.providesCapability(plugins, identities);

      for (const cap of requires) {
        const spec = CAPABILITY_PROVIDERS[cap];
        if (!spec) {
          // No provider in this runtime. Tier-gated tokens (ai/ai-studio/i18n/
          // ui/auth) are handled by their dedicated blocks above; other KNOWN
          // vocabulary tokens are provided elsewhere (`hierarchy-security` via
          // an explicit enterprise plugin in `plugins[]`, `ai-seat`/`governance`
          // by cloud's objectos-runtime) — stay quiet for those. An UNKNOWN
          // declared token is a typo that was previously ignored SILENTLY
          // (#3265) — warn loudly. Warn-first: intended to become a hard error
          // once the vocabulary proves complete (Prime Directive #12).
          if (declaredRequires.has(cap) && !PLATFORM_CAPABILITY_TOKENS.includes(cap)) {
            console.warn(chalk.yellow(
              `  ⚠ requires: "${cap}" is not a known platform capability — check for a typo. It was ignored.`,
            ));
          }
          continue;
        }
        if (hasPluginMatching(spec.identities)) continue;

        try {
          const mod: any = await import(/* webpackIgnore: true */ spec.pkg);
          const Ctor = mod[spec.export];
          if (!Ctor) {
            console.warn(chalk.yellow(`  ⚠ Capability "${cap}": ${spec.pkg} did not export ${spec.export}`));
            continue;
          }
          // analytics needs cubes from config, others take no args
          let arg: any;
          if (cap === 'automation') {
            // #3016 — anchor declarative connector file refs (e.g. the openapi
            // provider's `providerConfig.spec: './billing-openapi.json'`) to the
            // project folder (next to objectstack.config.ts), mirroring how the
            // standalone sqlite default is anchored above. Reads are confined to
            // this root by the automation service's package file loader.
            arg = { packageRoot: path.dirname(absolutePath) };
          } else if (spec.configKey === 'analyticsCubes') {
            const cubes = (config as any).analyticsCubes ?? (config as any).cubes ?? [];
            arg = { cubes };
          } else if (cap === 'email') {
            // Throws on a mail configuration that cannot deliver (#5087,
            // #5132) — the catch below turns that into the boot failure /
            // loud error it should be, never a LogTransport substituted
            // behind the operator's back.
            arg = resolveEmailCapabilityArg(
              (config as any).email ?? {},
              process.env,
              (config as any).appName,
            ).options;
          } else if (cap === 'sms') {
            // Compose SmsServicePlugin options from config.sms + OS_SMS_* env
            // (#2780). Same precedence as email: env beats config. Provider
            // credentials normally live in the `sms` settings namespace
            // (bound at kernel:ready); constructor opts cover pre-settings
            // boot and hosts without the settings service.
            //
            // Throws on a provider tag no transport can deliver (#5713) — the
            // catch below turns that into the boot failure / loud error it
            // should be, never a LogSmsTransport substituted behind the
            // operator's back. Same shape as the `email` arm above.
            arg = resolveSmsCapabilityArg((config as any).sms ?? {}, process.env).options;
          } else if (cap === 'storage') {
            // Storage is now in the default capability slate. If the host
            // hasn't configured a backend explicitly we fall back to the
            // local-disk driver under `.objectstack/data/uploads/` so
            // avatars / attachments / report files work out of the box.
            // In production mode we emit a single loud warning so the
            // operator knows to point storage at S3 / GCS / Azure before
            // shipping (data on a single pod is volatile / non-replicated).
            const storageArg = resolveStorageCapabilityArg(resolveStorageLocalRootEnv());
            arg = storageArg.options;
            if (storageArg.localRoot && !isDev) {
              // Names only the channels that actually work — `config.storage`
              // was in this sentence and was never read (framework#4167).
              console.warn(chalk.yellow(
                `  ⚠ StorageServicePlugin using local driver (${storageArg.localRoot}) — switch to S3/GCS/Azure for production (set OS_STORAGE_* or configure storage in Setup → Settings).`,
              ));
            }
          }
          await kernel.use(arg !== undefined ? new Ctor(arg) : new Ctor());
          trackPlugin(spec.export);

          if (spec.extras) {
            for (const ex of spec.extras) {
              if (hasPluginMatching(ex.identities)) continue;
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
          const missing = Serve.isModuleNotFoundError(err);
          // Fail-fast (#1597) for capabilities the app EXPLICITLY declared in
          // `requires`: one that can't be provided — its provider package absent, or
          // its plugin throwing while it starts — is a hard boot error, not a warning
          // to scroll past (declared ≠ enforced, Prime Directive #10). The outer boot
          // catch prints the message and exits 1. Platform-injected convenience
          // defaults (ALWAYS_ON, mcp, pinyin-search, auth→email, queue/job) stay
          // best-effort: absent ⇒ warn, crash ⇒ error, boot continues.
          if (declaredRequires.has(cap)) {
            throw new Error(
              // #3366 — edition-aware message via the shared classifier (same
              // wording the `os build` preflight prints). For these CAPABILITY_
              // PROVIDERS tokens (all open-edition) that's the `pnpm add` hint;
              // the cloud-only tokens surface their edition boundary instead.
              missing
                ? missingProviderMessage(cap)
                : `Capability "${cap}" (${spec.pkg}) failed to start: ${msg}`,
            );
          }
          if (!missing) {
            console.error(`[Capability:${cap}] failed to load ${spec.pkg}: ${msg}`);
          } else {
            console.warn(chalk.yellow(`  ⚠ Capability "${cap}" (auto-enabled default) not installed — skipping ${spec.pkg}`));
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
          !hasPluginMatching(['com.objectstack.service-external-datasource', 'ExternalDatasourceServicePlugin'])
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
          !hasPluginMatching(['com.objectstack.external-validation', 'ExternalValidationPlugin'])
        ) {
          await kernel.use(createExternalValidationPlugin());
          trackPlugin('ExternalValidationPlugin');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!Serve.isModuleNotFoundError(err)) {
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
          !hasPluginMatching(['com.objectstack.service-datasource-admin', 'DatasourceAdminServicePlugin'])
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
            // init() resolves the `http.server` service the hono server plugin
            // provides — order-if-present so route registration is
            // deterministic (ADR-0116, #4471). Soft: without a server plugin
            // the routes degrade on purpose (warn + not installed).
            optionalDependencies: ['com.objectstack.server.hono'],
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
            printDiagnostic(
              chalk.dim('  ↪ datasource admin: runtime UI lifecycle wired (/api/v1/datasources)'),
            );
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!Serve.isModuleNotFoundError(err)) {
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
        // Resolution reports objectui-SHA drift instead of warning about it
        // itself, so the decision below owns the single message about it.
        // (Boxed so the assignment made inside `onDrift` is visible to
        // control-flow analysis after the call returns.)
        const driftBox: { value: ConsoleShaDrift | null } = { value: null };
        const consolePath = consoleEnabled
          ? resolveConsolePath({ onDrift: (d) => { driftBox.value = d; } })
          : null;
        const consoleDrift = driftBox.value;
        const { mount: consoleWillMount, refusedForDrift } = decideConsoleMount({
          hasDist: !!(consolePath && hasConsoleDist(consolePath)),
          drift: consoleDrift,
          isDev,
        });

        // ── Console portal ──────────────────────────────────────────
        // The opinionated, fork-ready runtime console (`@object-ui/console`,
        // published from the objectstack-ai/objectui monorepo) mounts under
        // `/_console/`. When present, it owns the root `/` redirect
        // (preferred default UI). It is optional — we only mount it when
        // the package resolves and a pre-built `dist/` is present, and — in
        // dev — only when that build matches the repo's objectui pin (#7752).
        if (consolePath) {
          if (consoleWillMount) {
            if (consoleDrift) {
              console.warn(chalk.yellow(formatConsoleShaDriftWarning(consoleDrift)));
            }
            const consoleDistPath = path.join(consolePath, 'dist');
            await kernel.use(createConsoleStaticPlugin(consoleDistPath, { isDev }));
            trackPlugin('ConsoleUI');
          } else if (refusedForDrift && consoleDrift) {
            console.error(chalk.red(formatConsoleShaDriftRefusal(consoleDrift)));
          } else {
            console.warn(chalk.yellow(`  ⚠ Console dist not found — install \`@object-ui/console\` (already built) or run \`pnpm --filter @object-ui/console build\` in the objectui workspace`));
          }
        }
      }

      // ── Artifact-pinned boot: migration policy (#8368, acceptance #5) ──
      // Only on the OS_ARTIFACT_URL path. On this path "upgrade the app" is an
      // env change plus a restart, with nobody at a terminal to read a drift
      // warning at the moment it matters — so safe changes are applied and a
      // destructive one refuses the boot instead of being warned about and
      // skipped. Every other boot keeps the standing production policy
      // untouched (schema is never auto-altered under NODE_ENV=production).
      //
      // Registered as a plugin whose `kernel:ready` hook runs the gate: Phase 3
      // is after every plugin's start() — so ObjectQL's schema sync has already
      // created tables and added columns — and before Phase 4 opens the HTTP
      // socket. A throw from a boot-path hook propagates and fails the boot, so
      // "refuse to boot" is literal: the port never binds.
      if (pinnedArtifact) {
        const artifactDisplay = pinnedArtifact.display;
        await kernel.use({
          name: 'com.objectstack.cli.artifact-boot-migration-gate',
          version: '1.0.0',
          init: async (ctx: any) => {
            ctx.hook('kernel:ready', async () => {
              const { findSqlDriverForKernel } = await import('../utils/schema-migrate.js');
              const { runArtifactBootMigrationGate } = await import('../utils/artifact-boot-migration.js');
              const verdict = await runArtifactBootMigrationGate({
                driver: findSqlDriverForKernel(kernel),
                artifactDisplay,
                info: (m) => printDiagnostic(chalk.dim(m)),
                warn: (m) => console.warn(chalk.yellow(m)),
              });
              if (!verdict.ok) {
                // Restore stdout before the refusal so the boot-quiet window
                // cannot swallow the one message that explains the exit.
                restoreOutput();
                console.error('\n' + verdict.refusal);
                throw new Error(
                  `Refusing to boot: ${verdict.destructive.length} destructive schema change(s) `
                  + `required by the artifact named by OS_ARTIFACT_URL. `
                  + `Run 'os migrate apply --allow-destructive' deliberately, then restart.`,
                );
              }
            });
          },
        } as any);
        trackPlugin('ArtifactBootMigrationGate');
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
            printDiagnostic(
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
        // This path exits before the banner, so it has to replay the boot
        // diagnostics itself — a deploy pipeline is precisely where a
        // degraded-boot warning must not vanish (#4012).
        const migrateDiagnostics = collectBootDiagnostics();
        if (migrateDiagnostics) printBootDiagnostics(migrateDiagnostics);
        printDiagnostic(chalk.green(`✓ Migration complete (${loadedPlugins.length} plugins started against ${resolvedDatabaseUrl ? redactConnectionUrl(resolvedDatabaseUrl) : 'configured DB'})`));
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

      // ── Automation wiring summary (2026-07-17 third-party eval) ─────
      // A flow that silently failed to arm logs nothing at all, so no amount of
      // log plumbing answers "did my flows arm?" — the binding STATE has to be
      // read off the live engine. Collect it here (after restore) and surface it
      // in the banner: declared-but-engine-missing, unbound triggered flows, and
      // bound-but-dead (unknown object) flows.
      const automationSummary = collectAutomationSummary(
        kernel,
        Array.isArray((config as any)?.flows) ? (config as any).flows.length : 0,
      );

      // ── Seed outcome summary (#3415/#3430) ─────────────────────────
      // SeedLoader's own result logs are `info`, under the default warn
      // level — a fixture could lose 90% of its rows, or a marketplace
      // package rehydrate onto a fresh DB with zero rows, all with zero
      // terminal signal. (The boot-quiet window hid them at every level on
      // top of that until #4012.) AppPlugin and the
      // marketplace rehydrate/heal path stash a per-source entry on the
      // kernel; print them here, loudly when rows dropped or an install
      // came up empty.
      let seedSummary: SeedSourceSummary[] | undefined;
      try {
        const s: any = kernel.getService?.('seed-summary');
        if (Array.isArray(s) && s.length > 0) seedSummary = s;
      } catch { /* no seeds ran — nothing to show */ }

      // ── Clean startup summary ──────────────────────────────────────
      // #8978 — the Config:/Artifact: row must name what actually booted,
      // never `relativeConfig` unconditionally (see resolveBannerConfigRow).
      printServerReady({
        port,
        ...resolveBannerConfigRow({ relativeConfig, useArtifactFallback, pinnedArtifact }),
        isDev,
        pluginCount: loadedPlugins.length,
        pluginNames: loadedPlugins,
        uiEnabled: enableUI,
        consolePath: loadedPlugins.includes('ConsoleUI') ? CONSOLE_PATH : undefined,
        driverLabel: resolvedDriverLabel,
        databaseUrl: resolvedDatabaseUrl ? redactConnectionUrl(resolvedDatabaseUrl) : undefined,
        // [ADR-0105 D1] #4801 — the banner reads the SAME resolver the runtime
        // wiring above keys off (`resolveTenancyPosture()`), not the legacy
        // boolean `resolveMultiOrgEnabled()`. With `OS_TENANCY_POSTURE=isolated`
        // and `OS_MULTI_ORG_ENABLED` unset, the boolean says `false` while the
        // wall is up — the banner printed `single-tenant` on the same screen
        // that listed `Organizations` in the plugin table (cloud#1020). A
        // diagnostic surface that disagrees with the runtime costs every later
        // investigation an extra lap.
        // #5359 — the value the boot gate resolved once at the top of `run()`,
        // not a fresh parse. The banner reading the resolver directly was also
        // the LAST line of defence against an invalid posture, which made a
        // diagnostic surface load-bearing for a safety property; the gate above
        // owns that refusal now, and this row just reports what it decided.
        tenancyPosture,
        seededAdmin,
        automation: automationSummary,
        seeds: seedSummary,
        // #4012 — every boot-phase `logger.warn` the quiet window intercepted,
        // replayed here. Without this the window is a drain: the ADR-0110 D5
        // `[action-governance]` inventory, degraded-boot notices and flow
        // binding failures all reached stdout and none reached a terminal.
        bootDiagnostics: collectBootDiagnostics(),
        // #3167 — surface the default-on MCP endpoint in the dev loop, where an
        // AI client can connect to operate the running app. Same decision point
        // that auto-loads the plugin + gates the route, so the banner never
        // advertises an endpoint that isn't served.
        mcpEnabled: isMcpServerEnabled(),
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
      printDiagnostic();
      printError(error.message || String(error));
      // A boot that died is when its warnings matter most, and the banner that
      // would normally carry them never printed (#4012).
      const diagnostics = collectBootDiagnostics();
      if (diagnostics) printBootDiagnostics(diagnostics);
      if (process.env.DEBUG) console.error(chalk.dim(error.stack));
      this.exit(1);
    }
  }

}

/**
 * What {@link createUnknownHostnameGuardPlugin} is constructed with.
 */
export interface UnknownHostnameGuardOptions {
  /**
   * The platform apex, e.g. `objectos.ai` — `OS_ROOT_DOMAIN` in production.
   * Normalized here (trim + lowercase) as well as at the call site, so the guard
   * cannot be constructed with a casing the `Host` comparison would then miss.
   */
  rootDomain: string;
  /**
   * Reads the cloud control-plane URL for the `/_console` redirect branch.
   *
   * A FUNCTION, not a string, and called PER REQUEST — that is what production
   * does (`process.env.OS_CLOUD_URL` was read inside the middleware, not at
   * install time), and extracting the seam must not quietly move the read to
   * construction time. Defaults to the same env read.
   */
  readCloudUrl?: () => string;
}

/** The plugin object {@link createUnknownHostnameGuardPlugin} returns. */
export interface UnknownHostnameGuardPlugin {
  name: string;
  version: string;
  optionalDependencies: string[];
  init: (ctx: any) => Promise<void>;
}

/**
 * Subdomains that bypass the guard, plus the apex (`''`).
 *
 * Exported so a test iterates the SAME list the middleware branches on. A copy
 * in the test would go stale the day a subdomain is added here: the new one
 * would ship uncovered while the suite stayed green.
 */
export const UNKNOWN_HOSTNAME_GUARD_RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  '', 'cloud', 'www', 'api', 'docs', 'admin', 'app',
]);

/**
 * Health and readiness paths that always pass through, whatever the hostname.
 *
 * Load-bearing, not a nicety: Cloudflare's container probe (and any upstream
 * load balancer) hits whatever `Host` header is currently bound to the worker,
 * so a 404 here would kill the container. Exported for the same reason as the
 * reserved list — a probe path added here is covered the moment it is added.
 */
export const UNKNOWN_HOSTNAME_GUARD_HEALTH_PATHS: readonly string[] = [
  '/api/v1/health', '/api/v1/ready', '/health',
];

/**
 * The unknown-environment hostname guard, as a mountable plugin (#9442).
 *
 * In multi-tenant cloud deployments (e.g. *.objectos.ai), every public hostname
 * is expected to map to a `sys_environment` row whose `hostname` column matches
 * the request `Host`. Without this guard, an unknown subdomain like
 * `demo-xxx.objectos.ai` happily renders the control-plane Console SPA (served
 * statically by createConsoleStaticPlugin), making the deployment look like an
 * empty env rather than a missing one. It answers a clear 404 instead.
 *
 * The bypass matrix, in the order the middleware applies it:
 *
 *   1. no `Host` header, or a host outside `rootDomain` (custom domains,
 *      localhost, *.workers.dev) — pass through, unjudged;
 *   2. a reserved subdomain or the apex ({@link
 *      UNKNOWN_HOSTNAME_GUARD_RESERVED_SUBDOMAINS}) — pass through, except that
 *      a cloud-connected runtime redirects `/_console` to the control plane so
 *      the Console picks an environment rather than dying on a 404 login;
 *   3. `/_admin`, `/_admin/*` and `/.well-known/*` — always through, so cert
 *      flows are not broken;
 *   4. {@link UNKNOWN_HOSTNAME_GUARD_HEALTH_PATHS} — always through;
 *   5. no env-registry service, or a registry read that throws — through. Every
 *      failure mode falls through rather than refusing;
 *   6. registry hit — through. Registry MISS is the only refusal.
 *
 * Implemented as a Plugin so the middleware is wired during init (when
 * `http.server` is available) and BEFORE start() runs on the Console static
 * plugin / route-registering plugins. Phase 1 `init()` is the REQUIREMENT, not
 * a convenience: Hono composes the handlers a request matched in REGISTRATION
 * order, so a route registered ahead of this middleware answers and never calls
 * `next()`, and the guard never runs for that path. Route registration starts
 * in Phase 2 `start()` (createConsoleStaticPlugin mounts the Console there) and
 * continues in the `kernel:ready` hooks registered from it (HonoServerPlugin's
 * current-user endpoints, plugin-auth's terminal `/api/v1/auth/*`), while both
 * kernels run every plugin's `init()` before the first `start()`
 * (`LiteKernel.bootstrap`, `ObjectKernel.bootstrap`) — so an install from
 * `init()` is ahead of all of it.
 *
 * ⛔ "Added before kernel:listening" is NOT the condition, however natural it
 * reads. `kernel:ready`, `kernel:bootstrapped` and `kernel:listening` all fire
 * strictly AFTER Phase 2, so a guard installed from one of those hooks is
 * registered behind every route and observes NOTHING — no error, no log, no
 * refusal (#9745, measured across three install points). A refusal surface that
 * gates nothing is the failure this guard exists to prevent, so anything
 * modelled on it installs during `init()`. Both directions are pinned in
 * `serve-unknown-hostname-guard.test.ts`.
 *
 * The env-registry is resolved lazily per request on purpose: it is
 * registered by ObjectOSEnvironmentPlugin's init, and the guard must not depend
 * on plugin ordering to work.
 *
 * ⛔ The refusal `c.json({ ... }, 404)` inside the middleware must stay an
 * INLINE OBJECT LITERAL. `scripts/check-route-envelope.mjs` judges the object
 * literal passed to `c.json(...)`; an identifier or a call expression reads to
 * it as a relayed body it must not police. Hoisting that body into a helper —
 * even into this file — leaves the file discovered (the `c.json(` call is still
 * here) while every counter reads zero, so the `{}` entry this file carries in
 * `PLUGIN_ROUTE_MODULES` keeps passing and stops asserting: the #9364
 * conformance pin goes vacuous, silently, with the gate green.
 */
export function createUnknownHostnameGuardPlugin(
  options: UnknownHostnameGuardOptions,
): UnknownHostnameGuardPlugin {
  const rootDomain = (options.rootDomain || '').trim().toLowerCase();
  const readCloudUrl = options.readCloudUrl ?? (() => process.env.OS_CLOUD_URL || '');
  const RESERVED = UNKNOWN_HOSTNAME_GUARD_RESERVED_SUBDOMAINS;
  const HEALTH_PATHS = UNKNOWN_HOSTNAME_GUARD_HEALTH_PATHS;
  return {
    name: 'com.objectstack.cli.unknown-hostname-guard',
    version: '1.0.0',
    // init() resolves the `http.server` service the hono server plugin
    // provides — order-if-present so the middleware install is
    // deterministic (ADR-0116, #4471). Soft: without a server plugin the
    // guard degrades on purpose (warn + not installed).
    optionalDependencies: ['com.objectstack.server.hono'],
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
          const isPlatformHost = host === rootDomain || host.endsWith('.' + rootDomain);
          if (!isPlatformHost) return next();
          const sub = host === rootDomain ? '' : host.slice(0, -(rootDomain.length + 1));
          const head = sub.split('.').pop() || '';
          const p = c.req.path;
          if (RESERVED.has(sub) || RESERVED.has(head)) {
            // A browser loading the Console on a bare/reserved platform host
            // (the apex or `www`/`app`/… — none bind a tenant env) gets the
            // Console SPA, but its `/api/v1/auth/*` calls 404 (no env → no
            // auth) → a dead "Auth request failed with status 404" login.
            // When this runtime is cloud-connected (`OS_CLOUD_URL` set), send
            // Console requests to the cloud control plane to pick/open an
            // environment instead. A self-hosted single-env runtime (no
            // `OS_CLOUD_URL`) keeps the prior pass-through. Non-console paths
            // (infra, health, /api) fall through below unchanged.
            const cloudUrl = readCloudUrl().trim();
            if (cloudUrl && (p === '/_console' || p.startsWith('/_console/'))) {
              return c.redirect(`${cloudUrl.replace(/\/+$/, '')}/_console/`, 302);
            }
            return next();
          }
          if (p.startsWith('/_admin/') || p === '/_admin' || p.startsWith('/.well-known/')) {
            return next();
          }
          // Health and readiness endpoints must always answer 200
          // regardless of whether the requested hostname maps to
          // an env — Cloudflare's container probe (and any
          // upstream load balancer) hits whatever Host header is
          // currently bound to the worker. Returning 404 here on
          // an unmapped hostname would kill the container.
          if (HEALTH_PATHS.includes(p)) {
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
          // The declared `BaseResponseSchema` refusal envelope. This
          // used to answer `{ error: 'environment_not_found', message,
          // hostname }` — the pre-#3675 dialect, where `error` is a bare
          // string so `body.error.message` reads `undefined`, with two
          // stray top-level keys beside it. `hostname` is context and
          // moved into `error.details`, which `ApiErrorSchema` declares
          // for exactly that; the code is now the ADR-0112
          // SCREAMING_SNAKE spelling of the same condition, in the
          // semantic slot consumers branch on.
          return c.json(
            {
              success: false,
              error: {
                code: 'ENVIRONMENT_NOT_FOUND',
                message: `No environment is bound to hostname '${host}'.`,
                details: { hostname: host },
              },
            },
            404,
          );
        });
        ctx.logger?.info?.('[unknown-hostname-guard] installed', { rootDomain });
      } catch (err: any) {
        ctx.logger?.warn?.('[unknown-hostname-guard] install failed', { error: err?.message ?? err });
      }
    },
  };
}

/**
 * What the tenancy-posture boot gate decided (#5359).
 *
 * A verdict object rather than a throw: the caller is `serve`'s `run()`, and the
 * whole point of the gate is that the refusal must NOT travel as an exception —
 * an exception is exactly what the broad AuthPlugin `try` downgraded to a
 * warning while boot carried on unwalled.
 */
export type TenancyPostureGateVerdict =
  | { ok: true; posture: TenancyPosture }
  | { ok: false; fatal: string };

/**
 * One-line prescriptions for the accepted postures, keyed by the vocabulary
 * `@objectstack/spec/security` owns. A posture added there but not described
 * here still gets listed by the gate (bare, without prose) rather than silently
 * dropped from the advice — the fix list can go terse, never stale.
 */
const TENANCY_POSTURE_FIX_HINTS: Readonly<Record<string, string>> = {
  single: 'one organization, no organization wall — the default',
  group: 'organization wall enforced by the open engine, one shared database',
  isolated:
    'organization wall + the enterprise @objectstack/organizations runtime '
    + "(the legacy spelling 'multi' is accepted and normalizes to this)",
};

/**
 * Resolve the deployment's requested tenancy posture, or produce the FATAL text
 * that refuses the boot (#5359).
 *
 * `resolveTenancyPosture()` (`@objectstack/types`) is the authority on the
 * vocabulary and already refuses an unrecognized value — this wrapper does NOT
 * re-decide that, it only changes HOW the refusal travels and what it says.
 *
 * Why the wrapper exists at all: the resolver's refusal is a `throw`, and serve
 * used to take it wherever the first read happened to be. The first read sat
 * inside the broad AuthPlugin `try`, whose catch prints
 * `⚠ AuthPlugin failed to load: …` and continues — so a misspelled env var was
 * announced as a plugin problem, boot proceeded degraded through the whole
 * capability slate, and the real sentence only reached the operator much later,
 * bare, from a generic `printError`. The exit code was right; nothing else was.
 *
 * The message follows ADR-0093 D5's shape (the sibling refusal in this file, for
 * an unavailable multi-org runtime): name the fact, say it is refusing to boot,
 * say why the alternative is unacceptable, then prescribe every way out.
 */
export function resolveTenancyPostureOrRefusal(): TenancyPostureGateVerdict {
  try {
    return { ok: true, posture: resolveTenancyPosture() };
  } catch (err) {
    const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.OS_TENANCY_POSTURE;
    const cause = err instanceof Error ? err.message : String(err);
    const fixes = TENANCY_POSTURES.map((posture) => {
      const hint = TENANCY_POSTURE_FIX_HINTS[posture];
      return `      • set OS_TENANCY_POSTURE=${posture}${hint ? ` — ${hint}` : ''}`;
    }).join('\n');
    return {
      ok: false,
      fatal: chalk.red(
        `\n  ✖ FATAL: OS_TENANCY_POSTURE=${JSON.stringify(String(raw ?? ''))} is not a recognized tenancy posture.\n`
        + '    Refusing to boot. Falling back to a default would silently drop the organization wall a\n'
        + '    walled deployment asked for — a posture typo must never be the thing that removes it\n'
        + '    (ADR-0105 D1; same refusal contract as ADR-0093 D5).\n\n'
        // Deliberately NOT "no port has been bound": serve probes port
        // availability (bind + immediate close) just above this gate, so that
        // sentence would be false in the letter while true in the spirit. What
        // is exactly true is the part an operator needs — no application code
        // ran and nothing ever served a request.
        + '    No config has been loaded, no plugin has been mounted, and the HTTP server was\n'
        + '    never started — this deployment has not served a single request.\n\n'
        + '    Fix one of:\n'
        + `${fixes}\n`
        + '      • unset OS_TENANCY_POSTURE entirely — the posture then derives from OS_MULTI_ORG_ENABLED\n'
        + '        (true ⇒ isolated, anything else ⇒ single).\n\n'
        + '    Checked the process environment and every .env file dotenv-flow loaded for this mode,\n'
        + '    so a stale value in a committed `.env*` is as likely a source as the shell.\n\n'
        + `    cause: ${cause}\n`,
      ),
    };
  }
}

/**
 * Constructor options for `StorageServicePlugin`, plus the local root to name in
 * the production warning (absent when the host configured a backend itself).
 */
export interface StorageCapabilityArg {
  options: Record<string, unknown>;
  localRoot?: string;
}

/**
 * Resolve what `StorageServicePlugin` is constructed with (#4096).
 *
 * Storage is in the default capability slate, so a host that configures nothing
 * still gets local disk under `.objectstack/data/uploads/` and avatars /
 * attachments / report files work out of the box.
 *
 * The fallback used to be `{ driver: 'local', root }` — neither of which
 * `StorageServicePluginOptions` declares. Both were dropped on the floor, so the
 * plugin applied its OWN default (`./storage`), the storage-root env var changed
 * nothing, and uploads landed somewhere the operator never named. The `storage`
 * settings namespace then corrected the root on its first read (its manifest
 * default IS `./.objectstack/data/uploads`), which swapped the adapter and
 * warned about stranded files — on every boot of a healthy server.
 *
 * #4096 fixed the option SHAPE; the value still could not reach the settings
 * side, because the CLI and the settings service spelled the env var
 * differently. {@link resolveStorageLocalRootEnv} is the channel that closes
 * that gap (#4968) — read the root through it, never off `process.env`
 * directly.
 *
 * `config.storage` is deliberately NOT read (framework#4167). It was never a
 * stack key: `ObjectStackDefinitionSchema` does not declare it, and the schema
 * is not `.strict()`, so `defineStack` — which every documented authoring path
 * and every compiled artifact goes through — strips it before `serve` could
 * ever see it. It arrived here only from a bare-object config on the
 * config-boot path, i.e. one unreachable-in-practice combination, where it then
 * ALSO carried the `driver`/`root` spelling the plugin does not read. Honouring
 * it on that one path meant the same authoring key worked in one place and
 * vanished in every other, which is worse than not having it.
 *
 * The storage backend is a deployment concern with two real channels: the
 * `OS_STORAGE_*` env vars (below) and the `storage` settings namespace, which
 * is also the one with proper credential handling. Authors who write `storage:`
 * anyway now get told so — `lintUnknownStackKeys` reports undeclared top-level
 * keys, and `STACK_KEY_GUIDANCE` names both channels.
 */
export function resolveStorageCapabilityArg(envRoot?: string): StorageCapabilityArg {
  const rootDir = envRoot?.trim() || '.objectstack/data/uploads';
  return { options: { adapter: 'local', local: { rootDir } }, localRoot: rootDir };
}

/**
 * The ONE env channel for the local storage root (#4968).
 *
 * The CLI used to invent its own name, `OS_STORAGE_ROOT`, while the settings
 * service derives the env name for the same value from the namespace it owns:
 * `envKeyOf('storage', 'local_root')` = `OS_STORAGE_LOCAL_ROOT`. Nothing in the
 * repo ever set that name, so the two channels never met — the CLI constructed
 * an adapter at the root the operator asked for, and `StorageServicePlugin`
 * then re-resolved from settings at `kernel:ready`, found nothing but the
 * manifest's schema DEFAULT, and swapped the adapter to
 * `./.objectstack/data/uploads`.
 *
 * The consequences were not log noise:
 *
 *  - `OS_STORAGE_ROOT` took effect for exactly one value — the one that happens
 *    to equal the manifest default. Every other value (`/srv/uploads`, a
 *    `--fresh` tempdir) was constructed and then discarded, so an operator
 *    following `backup-restore.mdx` backed up an empty directory.
 *  - `dev --fresh` promised the tempdir "owns ALL persistent state for this
 *    run"; uploads actually landed under the project cwd and survived exit.
 *  - The "adapter swapped … may be unreachable" warning on every clean boot was
 *    ACCURATE — the swap really happened. It is not touched here, and it stops
 *    firing because the swap stops happening.
 *
 * So the fix is at the producer, not in a tolerant consumer: write the name the
 * settings service already declares. The legacy name is read for one more
 * release via {@link readEnvWithDeprecation} and, when it is the one that
 * supplied the value, STAMPED onto the canonical name — the settings service
 * reads `process.env` live through its own `env` reference and only ever looks
 * up `OS_STORAGE_LOCAL_ROOT`, so without the stamp a legacy deployment would
 * keep the exact bug this fixes. With it, settings resolves
 * `source: 'env'`/`locked: true` at the value the adapter was built with,
 * `needsStorageSwap` answers false, and the two channels agree by construction.
 *
 * Side-effecting on purpose, and idempotent: `readEnvWithDeprecation`
 * deduplicates its warning process-wide, and once stamped the canonical branch
 * wins on every later call.
 *
 * @returns The resolved root, or `undefined` when neither name is set (the
 *          caller then falls through to `resolveStorageCapabilityArg`'s
 *          built-in default, which matches the manifest default).
 */
export function resolveStorageLocalRootEnv(): string | undefined {
  const value = readEnvWithDeprecation('OS_STORAGE_LOCAL_ROOT', 'OS_STORAGE_ROOT');
  if (value === undefined) return undefined;
  // Bridge the legacy spelling onto the canonical one the settings service
  // reads. Guarded so we never rewrite a canonical value with itself.
  if (typeof process !== 'undefined' && process.env
    && process.env.OS_STORAGE_LOCAL_ROOT === undefined) {
    process.env.OS_STORAGE_LOCAL_ROOT = value;
  }
  return value;
}

/**
 * Constructor options for `EmailServicePlugin`.
 *
 * There is no `warning` channel here any more (#5132). It carried exactly one
 * message — "provider=resend but no apiKey, falling back to LogTransport" —
 * and that fallback is now a throw, because a mail configuration that cannot
 * deliver has no "degraded but still fine" reading: it is a server that
 * accepts every send and delivers nothing.
 */
export interface EmailCapabilityArg {
  options: Record<string, unknown>;
}

/**
 * The ONE truth table this file reads its `OS_EMAIL_*_ENABLED` booleans with
 * (#5447).
 *
 * Extracted rather than restated: `OS_EMAIL_QUEUE_ENABLED` carried this list
 * inline, and a second boolean flag written a second way is how one env var
 * ends up accepting `on` while its neighbour does not — the operator-visible
 * half of the "two literals describing one vocabulary" trap that split the
 * settings dropdown from the transports (#5094).
 *
 * Tri-state on purpose: `undefined` means the variable is unset and the caller
 * must fall through to config, which is what keeps an absent flag from
 * silently reading as `false` and overriding a config that said `true`.
 * An empty string is a SET variable and resolves to `false`, matching the
 * behaviour `OS_EMAIL_QUEUE_ENABLED` already had.
 */
function envBooleanFlag(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

/**
 * Resolve what `EmailServicePlugin` is constructed with, from `config.email`
 * plus `OS_EMAIL_*` env (env wins, so an operator can override per environment).
 *
 * SMTP (#5087, ADR-0012) is configured through `OS_EMAIL_SMTP_HOST` / `_PORT` /
 * `_SECURE` / `_USER` / `_PASSWORD` — the `OS_{DOMAIN}_{FEATURE}_{QUALIFIER}`
 * shape of Prime Directive #9, grouped with the email vars rather than the bare
 * third-party `SMTP_*` names — layered over `config.email.options`.
 *
 * **Every provider that cannot deliver throws** — `smtp` with no host, and
 * (since #5132) `resend`/`postmark` with no API key, or a provider tag outside
 * `EMAIL_TRANSPORT_PROVIDERS` altogether. The capability loop turns that into a
 * loud failure — a hard boot error when the app declared `requires: ['email']`,
 * otherwise a `console.error` and no email service — which is the point: the
 * alternative (quietly substituting the LogTransport, as this function's
 * `resend`/`postmark` arm used to do for a missing API key) hands the operator a
 * server that accepts every send, records it in `sys_email` as sent, and
 * delivers nothing — the exact declared-but-not-delivered gap #5087 closed
 * inside the plugin, left behind one layer up.
 *
 * Refusing is only defensible because "this environment does not send mail" has
 * a way to say itself: `OS_EMAIL_PROVIDER=log` (the default). An operator who
 * names a delivery provider has declared an intent, and the honest answer to an
 * intent we cannot honour is a failure, not a substitute transport.
 *
 * The provider vocabulary and the "needs an API key" question are both read
 * from `@objectstack/plugin-email` — the package that has to materialise the
 * transport — rather than restated here. Two literals describing one vocabulary
 * is how the settings dropdown and the transports drifted apart (#5094).
 *
 * `OS_EMAIL_QUEUE_ENABLED=true` (or `config.email.queueDelivery`) switches
 * delivery from inline to the durable `sys_job_queue` path (#5160). It reuses
 * `OS_EMAIL_RETRIES` as its attempt budget rather than adding a second retry
 * knob — see `EmailServicePlugin.makeQueueDelivery`.
 *
 * `OS_EMAIL_PERSIST_ENABLED=false` (or `config.email.persist: false`) stops
 * every delivery attempt being written to `sys_email` (#5447). The plugin
 * option has been live since the plugin had one — it builds no
 * `EmailPersistence` when `persist === false` — but nothing carried the
 * declared `config.email.persist` here, so a PII-sensitive deployment that
 * switched persistence off in `objectstack.config.ts` type-checked, parsed,
 * read "Persist to sys_email (default true)" in the generated reference, and
 * went on writing every message body to the database. Resolution order is this
 * function's own, per setting: env > `config.email.persist` > the plugin
 * default (persist ON) — so a config and an env that say nothing leave the
 * option absent and the plugin's default untouched.
 *
 * The template context's `appName` follows the same env-wins rule as every
 * other setting here (#5448): `OS_APP_NAME` > `config.email.appName` >
 * `config.email.defaultTemplateContext.appName` > top-level `config.appName` >
 * `'ObjectStack'`. It used to be the file's one exception — the whole
 * `defaultTemplateContext` was spread OVER the resolved value, so a config that
 * spelled `defaultTemplateContext: { appName: … }` made `OS_APP_NAME` inert and
 * the per-environment override an operator has for a repo-pinned config did
 * nothing, silently, in the mail body AND in the `no-reply@<slug>.local`
 * fallback sender derived from it. Every OTHER key of `defaultTemplateContext`
 * is unchanged: it has no env or dedicated-config carrier, so the author's
 * context is still spread through wholesale.
 */
export function resolveEmailCapabilityArg(
  cfgEmail: Record<string, any> = {},
  env: NodeJS.ProcessEnv = process.env,
  configAppName?: string,
): EmailCapabilityArg {
  const provider = String(env.OS_EMAIL_PROVIDER || cfgEmail.provider || 'log').toLowerCase();
  const apiKey = env.OS_EMAIL_API_KEY || cfgEmail.apiKey;

  // OS_EMAIL_FROM supports either "addr@x" or "Name <addr@x>".
  let defaultFrom = cfgEmail.defaultFrom;
  if (env.OS_EMAIL_FROM) {
    const m = env.OS_EMAIL_FROM.match(/^\s*(?:"?([^"<]*?)"?\s*<\s*([^>]+)\s*>|(\S+))\s*$/);
    if (m) {
      const name = (m[1] ?? '').trim();
      const address = (m[2] ?? m[3] ?? '').trim();
      if (address) defaultFrom = name ? { name, address } : { address };
    }
  }
  const retries = env.OS_EMAIL_RETRIES ? Number(env.OS_EMAIL_RETRIES) : cfgEmail.retries;
  // `OS_EMAIL_QUEUE_ENABLED` — a boolean feature flag, so `_ENABLED` and
  // default-off (Prime Directive #9; a bare `OS_EMAIL_QUEUE` would read as a
  // config value, e.g. a queue name). Whether the declaration can be HONOURED
  // is not knowable here — no kernel exists yet — so the plugin asserts it on
  // `kernel:ready`, where the service registry has settled, and fails the boot
  // there if no durable queue showed up.
  const queueDelivery = envBooleanFlag(env.OS_EMAIL_QUEUE_ENABLED) ?? cfgEmail.queueDelivery;
  // `OS_EMAIL_PERSIST_ENABLED` — the carrier `config.email.persist` never had
  // (#5447). `_ENABLED` is Prime Directive #9's boolean-flag shape; unlike the
  // queue flag it is default-ON rather than default-off, because it does not
  // enable a new capability — it is the off switch for one that has always
  // been on, and a deployment that says nothing must keep its `sys_email`
  // audit trail. Absent from BOTH sources means the key is left out of the
  // constructor options entirely, so the plugin's own default decides.
  const persist = envBooleanFlag(env.OS_EMAIL_PERSIST_ENABLED) ?? cfgEmail.persist;
  // `appName` is resolved AFTER the context spread, not before it (#5448).
  // The other keys of `defaultTemplateContext` are still spread wholesale and
  // are the only source for themselves; `appName` alone has dedicated carriers
  // above it, and this file's stated contract — "env overrides per setting" —
  // has to hold for it like it does for apiKey / defaultFrom / retries /
  // queueDelivery / persist / SMTP. Spreading the context over the resolved
  // value inverted exactly that one key: an author who wrote
  // `defaultTemplateContext: { appName: 'Acme Dev' }` made `OS_APP_NAME`
  // silently inert, so the one lever an operator has for a repo-pinned config
  // deployed to several environments did nothing — and since the fallback
  // sender is slugged from this value, the wrong name reached the envelope as
  // well as the body.
  //
  // `defaultTemplateContext.appName` stays IN the chain rather than losing to
  // the two dedicated sources and vanishing: dropping it would demote every
  // config that spells only the context form straight to 'ObjectStack',
  // trading one silently wrong value for a worse one. Order: env >
  // `config.email.appName` > `config.email.defaultTemplateContext.appName` >
  // top-level `config.appName` > 'ObjectStack'.
  const cfgTemplateContext = cfgEmail.defaultTemplateContext || {};
  const defaultTemplateContext = {
    ...cfgTemplateContext,
    appName: env.OS_APP_NAME || cfgEmail.appName || cfgTemplateContext.appName
      || configAppName || 'ObjectStack',
  };
  // Provide a sensible fallback `from` so templates can render even before
  // operators configure SMTP/SaaS. The log transport simply prints to stdout;
  // the address never leaves the box.
  if (!defaultFrom) {
    const slug = String(defaultTemplateContext.appName || 'objectstack')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'objectstack';
    defaultFrom = { name: defaultTemplateContext.appName, address: `no-reply@${slug}.local` };
  }

  const smtpEnv: Record<string, unknown> = {};
  const smtpHost = env.OS_EMAIL_SMTP_HOST?.trim();
  if (smtpHost) smtpEnv.host = smtpHost;
  if (env.OS_EMAIL_SMTP_PORT) smtpEnv.port = Number(env.OS_EMAIL_SMTP_PORT);
  if (env.OS_EMAIL_SMTP_SECURE != null) {
    const raw = String(env.OS_EMAIL_SMTP_SECURE).trim().toLowerCase();
    smtpEnv.secure = raw !== 'false' && raw !== '0';
  }
  if (env.OS_EMAIL_SMTP_USER) smtpEnv.user = env.OS_EMAIL_SMTP_USER;
  if (env.OS_EMAIL_SMTP_PASSWORD) smtpEnv.password = env.OS_EMAIL_SMTP_PASSWORD;
  const providerOptions = { ...(cfgEmail.options ?? {}), ...smtpEnv };

  const options: Record<string, unknown> = {
    provider,
    ...(apiKey ? { apiKey } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
    defaultFrom,
    ...(retries != null && !Number.isNaN(retries) ? { retries } : {}),
    ...(queueDelivery != null ? { queueDelivery: !!queueDelivery } : {}),
    ...(persist != null ? { persist: !!persist } : {}),
    defaultTemplateContext,
  };

  if (!isEmailTransportProvider(provider)) {
    throw new Error(
      `provider='${provider}' is not a transport this server can deliver through, so no mail would go out — `
      + `${unsupportedProviderFix(provider)} `
      + 'On this boot path the provider is OS_EMAIL_PROVIDER or config.email.provider; set '
      + 'OS_EMAIL_PROVIDER=log if this environment is not meant to send mail.',
    );
  }
  if (provider === 'smtp' && !providerOptions.host) {
    throw new Error(
      "provider='smtp' selects SMTP delivery but no SMTP host is configured — set OS_EMAIL_SMTP_HOST "
      + '(plus OS_EMAIL_SMTP_PORT / _SECURE / _USER / _PASSWORD) or config.email.options.host, '
      + 'or choose another provider.',
    );
  }
  if (emailProviderRequiresApiKey(provider) && !apiKey) {
    throw new Error(
      `provider='${provider}' selects ${provider} delivery but no API key is configured, so every send would `
      + 'be recorded in sys_email as sent and nothing would leave the box — set OS_EMAIL_API_KEY '
      + '(or config.email.apiKey), or set OS_EMAIL_PROVIDER=log if this environment is not meant to send mail.',
    );
  }
  return { options };
}

/** Constructor options for `SmsServicePlugin`, as the capability loop builds them. */
export interface SmsCapabilityArg {
  options: Record<string, unknown>;
}

/**
 * Resolve `SmsServicePlugin` constructor options from `config.sms` + `OS_SMS_*`
 * env, and **refuse a provider tag no transport can deliver through** (#5713).
 *
 * The refusal is the point. Credentials for a real provider normally arrive from
 * the `sms` settings namespace at `kernel:ready`, so this function deliberately
 * does NOT demand them — a bare `OS_SMS_PROVIDER=twilio` on a host whose Twilio
 * keys are stored in Settings is a complete, working configuration and passes
 * through untouched. What it refuses is the one thing settings can never repair:
 * a provider *tag* outside `SMS_TRANSPORT_PROVIDERS`.
 *
 * That tag used to travel all the way into the plugin, which caught the
 * `makeSmsTransport: unknown provider 'twilo'` throw and substituted
 * `LogSmsTransport` behind the operator's back. Measured on `origin/main` before
 * this change, `new SmsServicePlugin({ provider: 'twilo' }).init(ctx)`:
 *
 *   - boots without throwing, registers the `sms` service;
 *   - transport = `LogSmsTransport`, `isConfigured() === false`;
 *   - one `logger.warn` line, then `send()` answers
 *     `{ status: 'sent', messageId: 'dev-sms-…' }`.
 *
 * So a phone-OTP sign-in tells the user "code sent" and nothing leaves the box —
 * the same declared-but-not-delivered shape #5132 closed for mail one layer up,
 * and the same door #5204 closed on the `SettingsService` env branch. This path
 * never reaches `SettingsService`: it runs at kernel-assembly time, before the
 * settings service exists, which is exactly why the `sms` namespace's `select`
 * options table (`sms.manifest.ts`) could not see it.
 *
 * The plugin's fallback is left alone on purpose. For a *known* provider with
 * incomplete constructor credentials it is correct — the settings bind can still
 * swap in a working transport — and it stays the last line of defence for hosts
 * that construct `SmsServicePlugin` themselves. `os serve` simply stops handing
 * it input it cannot use.
 *
 * `OS_SMS_PROVIDER=log` (the default) is how an environment says "this box does
 * not send SMS", which is what makes refusing the rest fair.
 */
export function resolveSmsCapabilityArg(
  cfgSms: Record<string, any> = {},
  env: NodeJS.ProcessEnv = process.env,
): SmsCapabilityArg {
  const provider = String(env.OS_SMS_PROVIDER || cfgSms.provider || 'log').toLowerCase();
  if (!isSmsTransportProvider(provider)) {
    throw new Error(
      `provider='${provider}' is not a transport this server can deliver through, so every OTP and `
      + "notification SMS would be answered status: 'sent' and nothing would leave the box — "
      + `pick one of ${SMS_TRANSPORT_PROVIDERS.join(' / ')} (Settings → SMS Delivery → Provider). `
      + 'On this boot path the provider is OS_SMS_PROVIDER or config.sms.provider; set '
      + 'OS_SMS_PROVIDER=log if this environment is not meant to send SMS.',
    );
  }
  return {
    options: {
      provider,
      ...(cfgSms.providerOptions ? { providerOptions: cfgSms.providerOptions } : {}),
      ...(cfgSms.retries != null ? { retries: cfgSms.retries } : {}),
    },
  };
}

/**
 * The multi-node gate verdict, as `os serve` consumes it.
 *
 * ⚠️ A **structural mirror** of `ResolvedMultiNodeVerdict` in
 * `@objectstack/service-cluster` (`src/multi-node-gate.ts`), not an import: the
 * CLI reaches that package through a dynamic, non-literal specifier so it
 * carries no static dependency on it (open-core ships the memory driver;
 * remote drivers arrive with a distribution). The cast at the call site is the
 * only place the two shapes meet, so nothing about a widening on the producer
 * side propagates here on its own — the narrow `{ allowed, reason }` copy that
 * used to live inline is exactly why a licensed node cap stayed unreportable
 * after the gate learned to express one. `serve-multi-node-cap-advisory.pin.test.ts`
 * pins this declaration against the producer's so the next widening is a
 * decision rather than a silent divergence.
 */
export interface MultiNodeGateVerdict {
  /** Whether a multi-node topology is authorized at all. */
  allowed: boolean;
  /** Surfaced in logs. */
  reason?: string;
  /**
   * How many of the requested nodes the gate admits. Absent when the gate
   * imposes no count cap; `0` when it denied outright.
   */
  admitted?: number;
  /**
   * How many requested nodes exceed what the gate admits. `0` when uncapped,
   * when the request fits, or when no count was declared.
   */
  refused: number;
  /**
   * True only for a **partial** refusal — the licensed-overflow case. `false`
   * for an outright denial, so the two cannot be conflated.
   */
  capped: boolean;
}

/**
 * The operator-facing text for a licensed node-cap overflow, or `null` when
 * there is nothing to say.
 *
 * Clause 3 of the maintainer's 2026-08-13 `max_nodes` ruling (recorded on
 * cloud#1275): a licensed overflow must **refuse the excess, run up to the paid
 * limit, and warn loudly** — explicitly not a whole-cluster degrade. The first
 * two clauses need an atomic slot claim across replicas and are tracked as
 * their own mechanism; this is the third, and it is deliverable on its own
 * because it needs nothing beyond the verdict the gate already returns.
 *
 * ⚠️ **The wording is the deliverable, not decoration.** While the enforcement
 * mechanism is open, nothing is actually refused: the gate is consulted once
 * per process at boot, every replica computes the *same* verdict, and none can
 * know whether it is one of the admitted ones — so all of them join. Phrasing
 * this as "2 replicas refused" would therefore be **false**, and would recreate
 * the very declared-vs-delivered gap the warning exists to close. It says
 * instead that the cap is advisory and that the excess replicas still join,
 * which is exactly what happens today.
 *
 * `capped` alone is the trigger: the producer sets it **only** for the partial
 * (licensed-overflow) case, keeping it `false` for an outright `allowed: false`
 * denial — that one is the unlicensed case and the call site already reports it
 * as a downgrade. Reading `refused > 0` instead would double-report it.
 */
export function formatMultiNodeCapAdvisory(verdict: MultiNodeGateVerdict): string | null {
  // `capped: true` is produced only together with a numeric `admitted` and a
  // positive `refused`. The extra narrowing is the type system asking for that
  // invariant in writing — not tolerance of an off-spec producer: a stale build
  // that set `capped` without a count would get silence rather than a warning
  // with an invented number in it, and a wrong number here is worse than the
  // silence it replaces.
  if (!verdict.capped) return null;
  const admitted = verdict.admitted;
  const excess = verdict.refused;
  if (typeof admitted !== 'number' || excess <= 0) return null;

  const declared = admitted + excess;
  const why = verdict.reason ? ` (${verdict.reason})` : '';
  return (
    `[cluster] licensed node cap exceeded${why}: the licence admits ${admitted} node(s), `
    + `but OS_CLUSTER_REPLICAS declares ${declared} — ${excess} beyond the cap.\n`
    + `[cluster] This cap is ADVISORY and is not enforced yet: nothing is refused, and all `
    + `${declared} replicas will still join the cluster.\n`
    + `[cluster] Reduce OS_CLUSTER_REPLICAS to ${admitted}, or raise the licensed node limit.`
  );
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
 *
 * Reading the address out of a driver is `describeDriverConnection`'s job
 * (#3793) — it is the one place that knows every shape a driver config
 * arrives in, so a DSN-declared datasource no longer falls through to
 * `(unknown)`, and no shape prints credentials.
 */
export function describeRegisteredDriver(kernel: any): { label: string; url: string } | null {
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

    const cfg = driver.config;
    // `client` is a plain string for the stock knex dialects, but a Client
    // *class* for SqliteWasmDriver — interpolating that would paste the whole
    // class source into the banner.
    const label = typeof cfg?.client === 'string'
      ? `SqlDriver(${cfg.client})`
      : (driver.constructor?.name ?? driver.name ?? 'Driver');

    // Read the address by shape, not by which branch matches first. Every
    // driver here has a `config` property — SqlDriver's is knex-shaped,
    // MongoDBDriver's holds a top-level `url`, InMemoryDriver's is `{}` — so
    // returning early on "has a config" meant the mongo and in-memory arms
    // below never ran and every non-SqlDriver boot banner read `(unknown)`.
    // `driver.url` still covers a driver that keeps its DSN on the instance.
    const url = describeDriverConnection(cfg)
      ?? (typeof driver.url === 'string' && driver.url ? redactConnectionUrl(driver.url) : undefined);

    // A memory driver has no address to show — say so, rather than
    // `(unknown)`, which reads as "we looked for one and failed".
    return { label, url: url ?? (name.endsWith('.memory') ? '(in-memory)' : '(unknown)') };
  }
  return null;
}

/**
 * Decide what the ready banner's `Config:`/`Artifact:` row should say
 * (#8978).
 *
 * `relativeConfig` is derived from `args.config` at the top of `run()`,
 * before the artifact-fallback branch is decided, and was being handed to
 * {@link printServerReady} unconditionally. On an `OS_ARTIFACT_URL` boot
 * the `objectstack.config.ts` in cwd is deliberately never executed — the
 * boot diagnostics say so plainly a few lines above the banner — yet the
 * banner still named it. On the plain artifact-fallback path (no config
 * authored, booting from `OS_ARTIFACT_PATH` or the `<cwd>/dist/objectstack.json`
 * convention) the row named a config file that does not exist on disk at
 * all. Both are the same defect: the row is the surface an operator reads
 * to answer "what is this container actually running", and naming what
 * did NOT boot points them at the wrong app (cloud#1292).
 *
 * - `pinnedArtifact` set (OS_ARTIFACT_URL, #8368) → report it. `.display`
 *   is already resolved and already redacted for a pre-signed URL by the
 *   resolver, so it is safe to print as-is.
 * - `useArtifactFallback` set with no `pinnedArtifact` (OS_ARTIFACT_PATH,
 *   the `dist/objectstack.json` convention, or an empty/quick-start boot)
 *   → no config was read and there is no safely-redacted display in hand
 *   here (OS_ARTIFACT_PATH may itself be a credentialed URL) — omit the
 *   row rather than name a nonexistent file or risk leaking a secret.
 * - Neither set → the ordinary config-boot path; report `relativeConfig`
 *   exactly as before.
 */
export function resolveBannerConfigRow(opts: {
  relativeConfig: string;
  useArtifactFallback: boolean;
  pinnedArtifact?: { display: string };
}): { configFile?: string; artifactSource?: string } {
  if (opts.pinnedArtifact) return { artifactSource: opts.pinnedArtifact.display };
  if (opts.useArtifactFallback) return {};
  return { configFile: opts.relativeConfig };
}

/**
 * Collect the automation wiring facts for the startup banner (2026-07-17
 * third-party eval: a flow that failed to arm emits no log line to find, so the
 * banner reads the binding state off the engine instead).
 *
 * Every probe is feature-detected so an older `@objectstack/service-automation`
 * (without `getTriggerBindingAudit` / extended runtime states) degrades to the
 * plain count line instead of crashing the banner. Returns `undefined` when
 * there is nothing automation-related to show at all.
 */
export function collectAutomationSummary(
  kernel: any,
  declaredFlowCount: number,
): AutomationReadySummary | undefined {
  let automation: any;
  try { automation = kernel?.getService?.('automation'); } catch { /* not registered */ }

  if (!automation) {
    return declaredFlowCount > 0
      ? {
          enabled: false,
          declaredFlowCount,
          flowCount: 0,
          boundCount: 0,
          triggerTypes: [],
          unbound: [],
          unknownObject: [],
          draftCount: 0,
        }
      : undefined;
  }

  let states: Array<{ name: string; enabled: boolean; bound: boolean; status?: string; triggerType?: string; object?: string }> = [];
  try { states = automation.getFlowRuntimeStates?.() ?? []; } catch { /* older engine */ }
  if (states.length === 0 && declaredFlowCount === 0) return undefined;

  let triggerTypes: string[] = [];
  try { triggerTypes = automation.getRegisteredTriggerTypes?.() ?? []; } catch { /* older engine */ }

  let unbound: Array<{ flowName: string; triggerType: string; reason: string }> = [];
  try { unbound = automation.getTriggerBindingAudit?.() ?? []; } catch { /* older engine */ }

  // Dead bindings: a bound record-change flow whose target object nobody
  // registered — the hook is filtered to a name that never writes.
  const unknownObject: Array<{ flowName: string; object: string }> = [];
  let ql: any;
  try { ql = kernel?.getService?.('objectql'); } catch { /* absent */ }
  if (ql && typeof ql.getObject === 'function') {
    for (const s of states) {
      if (!s.bound || !s.object || s.triggerType !== 'record_change') continue;
      let known: unknown;
      try { known = ql.getObject(s.object); } catch { known = undefined; }
      if (!known) unknownObject.push({ flowName: s.name, object: s.object });
    }
  }

  return {
    enabled: true,
    declaredFlowCount,
    flowCount: states.length,
    boundCount: states.filter((s) => s.bound).length,
    triggerTypes,
    unbound,
    unknownObject,
    draftCount: states.filter((s) => s.enabled && (s.status ?? 'draft') === 'draft').length,
  };
}
