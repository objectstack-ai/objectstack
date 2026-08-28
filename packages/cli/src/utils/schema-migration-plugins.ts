// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'node:path';
import fs from 'node:fs';
import { isAppPluginLike } from './graft-runtime-hooks.js';

/**
 * The object set a SCHEMA migration is planned against (#12938).
 *
 * ## What was wrong
 *
 * `os migrate plan` / `os migrate apply` boot through `createStandaloneStack`,
 * whose plugin list is the data stack (`DefaultDatasourcePlugin`,
 * `MetadataPlugin`, `ObjectQLPlugin`) plus `AppPlugin` when a compiled artifact
 * is found — and, in that file's own words, it "never loads
 * `objectstack.config.ts`". No platform plugin was composed either: the sibling
 * DATA subcommands reach `PlatformObjectsPlugin` through
 * {@link ./data-migration-plugins.js}, and `plan`/`apply` passed no
 * `extraPlugins` at all.
 *
 * `detectManagedDrift()` iterates the driver's `managedObjectFields`, which only
 * ever holds what got REGISTERED. So on a real deployment the pair diffed a
 * five-table subset — `sys_metadata`, `sys_metadata_audit`,
 * `sys_metadata_commit`, `sys_metadata_history`, `sys_view_definition` — and
 * reported `0` drift over it. That failure is silent in the direction that reads
 * as success: with nothing registered there is no drift, so the command printed
 * "Physical schema is in sync with metadata — nothing to migrate."
 *
 * And the driver's OWN drift message prescribes this command. The
 * `replace_unique_index` warning `reconcileAndWarnDrift` emits at boot — with
 * the FULL registered object set, so it names tables like `sys_position`
 * correctly — ends `run "os migrate apply"`. Measured on a control plane
 * carrying ~80 `sys_*` tables: the boot detector reported ten findings while
 * `os migrate plan` against the same database examined five tables and answered
 * "in sync".
 *
 * ## What this composes, and why exactly this
 *
 * The set is derived from `serve`'s own assembly rather than hand-picked:
 *
 *  - **The host config's plugins**, when an `objectstack.config.{ts,js,mjs}` is
 *    present — this is `serve`'s `plugins = config.plugins` step. On a
 *    deployment whose whole object set comes from its config (ObjectStack
 *    Cloud's control plane is the measured one: `createCloudStack()` returns the
 *    plugins, and the app has no compiled artifact at all) this is the ONLY half
 *    that matters.
 *  - **`AppPlugin(config)`**, when the config carries top-level metadata and
 *    brings no `AppPlugin` of its own — `serve` step 3, same presence test
 *    ({@link isAppPluginLike}), so top-level `objects`/`flows` reach the
 *    registry here exactly as they do there.
 *  - **`PlatformObjectsPlugin`**, when absent — `serve` step 5c. It is the one
 *    plugin `serve` composes UNCONDITIONALLY; everything else it injects
 *    (the auth family, i18n, observability, the HTTP server) sits behind a tier,
 *    an env var or a capability, and the auth family additionally behind "the
 *    config brought no `AuthPlugin`". Composing a tier-gated plugin here would
 *    be inventing an object set no boot of this deployment has.
 *
 * ## Phase 1 only for host plugins — and why that is the contract, not a dodge
 *
 * `os migrate plan` is a declared dry run: the boot defers schema DDL,
 * suppresses the artifact seed and (since #9380) passes
 * `runPlatformMigrations: false` for exactly this reason — "a repair that fires
 * under them destroys the very evidence they were run to collect".
 *
 * Host plugins are arbitrary code, and the shipped ones write. Measured
 * 2026-08-28, `SecurityPlugin` composed into a deferred `plan` boot: **14
 * `Insert operation failed` records against `sys_permission_set`** — its
 * built-in permission-set / position bootstrap firing from `start()` and its
 * `kernel:ready` hooks. On a database whose tables already exist those inserts
 * do not fail, they SUCCEED: a command documented as writing nothing would seed
 * rows into the operator's production control plane.
 *
 * What a schema command needs from a plugin is its DECLARATIONS, and the kernel
 * contract puts those in `init()` — "register services, schemas, routes" —
 * while `start()` is "begin work that needs every service up" (AGENTS.md →
 * Patterns → Plugin). `SecurityPlugin` is the reference: `init()` hands
 * `securityObjects` to the `manifest` service; every seeding path is registered
 * inside `start()`. So a host plugin is composed for Phase 1 and its Phase 2 is
 * SUPPRESSED ({@link composeForDeclarations}). Same measurement with the
 * suppression in place: the same 16 managed tables, and **0** insert attempts.
 *
 * ⚠️ **The residue, stated rather than hidden:** a host plugin that registers
 * its objects in `start()` instead of `init()` is invisible to this
 * composition — its tables stay out of the plan. That is the same class of
 * defect one notch narrower, and it is a real one; it is accepted here because
 * the alternative measured worse (a dry run that writes). The composition says
 * out loud what it did, so a missing table is diagnosable instead of being
 * indistinguishable from "in sync".
 *
 * `PlatformObjectsPlugin` is deliberately NOT suppressed: it is platform
 * infrastructure this CLI already boots fully under the sibling DATA
 * subcommands ({@link ./data-migration-plugins.js}), which are dry-run-by-default
 * too. The line is between plugins this repo owns and has measured, and host
 * code it cannot know.
 */

/**
 * The config spellings `resolveConfigPath()` auto-detects, in its order.
 *
 * Deliberately not `resolveConfigPath()` itself: that helper `process.exit(1)`s
 * when no config is found, which is right for `os build` and wrong here — a
 * project with no config is a legitimate `os migrate` target and must keep
 * behaving exactly as it does today.
 */
const HOST_CONFIG_CANDIDATES = [
  'objectstack.config.ts',
  'objectstack.config.js',
  'objectstack.config.mjs',
] as const;

/** The host config this boot would compose, or `null` when there is none. */
export function findHostConfig(cwd: string = process.cwd()): string | null {
  for (const candidate of HOST_CONFIG_CANDIDATES) {
    const abs = path.resolve(cwd, candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/** The `start()` a declaration-phase composition substitutes. */
async function suppressedStart(): Promise<void> {
  /* Phase 2 is not run for host plugins — see this module's header. */
}

/**
 * A host plugin composed for its DECLARATIONS: `init()` runs, `start()` does
 * not.
 *
 * A Proxy rather than a hand-copied field list on purpose. The kernel reads
 * several identity/ordering members off a plugin instance — `name`, `version`,
 * `type`, `dependencies`, `optionalDependencies`, `requiresServices`,
 * `providesServices`, and `constructor.name` at more than one presence test —
 * and a copy that misses one does not fail, it silently mis-orders the boot or
 * defeats a de-dup check. Forwarding everything and overriding exactly one
 * member is the only shape in which that cannot happen.
 *
 * Two details the trap gets right deliberately:
 *
 *  - methods are bound to the TARGET, so a plugin using real `#private` fields
 *    keeps working (a Proxy receiver would throw on those);
 *  - `constructor` is returned UNBOUND, because `fn.bind(x).name` is
 *    `'bound X'` — binding it would break every `p?.constructor?.name === 'X'`
 *    presence test, including the two this module performs.
 *
 * `destroy()` is forwarded: it is the symmetric teardown of `init()`, and a
 * plugin that connected something during Phase 1 must still be able to close it.
 */
export function composeForDeclarations<T extends object>(plugin: T): T {
  return new Proxy(plugin, {
    get(target, prop) {
      if (prop === 'start') return suppressedStart;
      // Read through the target so getters see the right `this`.
      const value = (target as Record<string | symbol, unknown>)[prop];
      if (typeof value === 'function' && prop !== 'constructor') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    },
  }) as T;
}

/** Whether `plugins` already carries a `PlatformObjectsPlugin` — `serve` 5c's test. */
function hasPlatformObjects(plugins: readonly unknown[]): boolean {
  return plugins.some(
    (p: any) => p?.name === 'com.objectstack.platform-objects'
      || p?.constructor?.name === 'PlatformObjectsPlugin',
  );
}

export interface SchemaMigrationComposition {
  /** Plugins to register after the data stack, in order. */
  plugins: unknown[];
  /** The host config that was composed, or `null` when none was found. */
  hostConfigPath: string | null;
  /**
   * Did that config actually load? `false` means a config EXISTS and this boot
   * could not read it — the one state in which the object set is smaller than
   * the deployment's for a reason that is nobody's intent. Kept apart from
   * `hostConfigPath === null` (no config at all, a legitimate shape) because a
   * consumer asserting coverage cannot tell those two apart from a table count:
   * both raise it above the artifact-less baseline, only one of them means the
   * plan covers the deployment.
   */
  hostConfigLoaded: boolean;
  /**
   * One line per thing this composition did or could not do, for the command to
   * print. Empty when nothing was composed, so a project with neither a config
   * nor an artifact produces byte-identical output to before this existed.
   */
  notes: string[];
}

const NOTHING_COMPOSED: SchemaMigrationComposition = Object.freeze({
  plugins: [],
  hostConfigPath: null,
  hostConfigLoaded: false,
  notes: [],
}) as SchemaMigrationComposition;

/**
 * The plugins `os migrate plan` / `apply` compose on top of the standalone data
 * stack — see this module's header for what and why.
 *
 * @param basePlugins what `createStandaloneStack` already produced, read for the
 *   presence tests (an artifact-derived `AppPlugin`, a `PlatformObjectsPlugin` a
 *   host already brought).
 * @param skipSeedData mirrors the boot's own setting onto a config-derived
 *   `AppPlugin`, so the config path and the artifact path suppress the inline
 *   seed identically.
 */
export async function buildSchemaMigrationPlugins(opts: {
  basePlugins: readonly unknown[];
  cwd?: string;
  skipSeedData?: boolean;
}): Promise<SchemaMigrationComposition> {
  const cwd = opts.cwd ?? process.cwd();
  const hostConfigPath = findHostConfig(cwd);
  const hasArtifactApp = opts.basePlugins.some(isAppPluginLike);

  // Neither a host config nor a compiled artifact: there is no deployment here
  // to mirror, and the five-table data stack is the honest answer. Returning
  // early — rather than composing the platform floor anyway — is what keeps an
  // artifact-less, config-less run byte-identical to the one before this card.
  if (!hostConfigPath && !hasArtifactApp) return NOTHING_COMPOSED;

  const plugins: unknown[] = [];
  const notes: string[] = [];
  let hostConfigLoaded = false;

  if (hostConfigPath) {
    try {
      // Imported here rather than at module scope: `loadConfig` pulls in
      // `bundle-require`/esbuild, and oclif `import()`s every command module on
      // every CLI invocation (see `schema-migrate.ts`'s lazy-import note).
      const { loadConfig } = await import('./config.js');
      const { config } = await loadConfig(hostConfigPath);

      const hostPlugins: unknown[] = Array.isArray(config?.plugins) ? config.plugins : [];
      for (const plugin of hostPlugins) {
        if (plugin && typeof plugin === 'object') plugins.push(composeForDeclarations(plugin));
      }

      // `serve` step 3, same predicate: a host config that ALSO carries
      // top-level metadata needs the wrap, or its `objects` never reach the
      // registry and this composition would report a set smaller than the one
      // the deployment serves.
      const configHasMetadata = !!(
        config?.objects || config?.manifest || config?.apps || config?.flows || config?.apis
      );
      const appAlready = hasArtifactApp || hostPlugins.some(isAppPluginLike);
      if (configHasMetadata && !appAlready) {
        const { AppPlugin } = await import('@objectstack/runtime');
        plugins.push(new AppPlugin(config, undefined, { skipSeedData: opts.skipSeedData ?? false }));
      }

      hostConfigLoaded = true;
      notes.push(
        `Composed the host stack from ${path.relative(cwd, hostConfigPath) || hostConfigPath}: `
        + `${hostPlugins.length} plugin(s), registered for their declarations only `
        + '(init runs, start does not — a plan writes nothing).',
      );
    } catch (error: any) {
      // Loud, and on stderr in both modes (`--json` reserves stdout, and the
      // reservation is already installed by the time this runs). NOT fatal: a
      // config that cannot load — a missing env var is the common one — used to
      // be irrelevant to this command, and turning that into a failed `plan`
      // would break a command that works today. Say what was lost instead.
      const message = error?.message ?? String(error);
      const line =
        `Host config ${hostConfigPath} could not be loaded: ${message}. `
        + 'The plan below covers ONLY the objects the data stack registered — it does NOT '
        + "cover this deployment's own objects, so an empty plan here is UNMEASURED, not "
        + '"in sync". Fix the config (or its environment) and re-run.';
      // eslint-disable-next-line no-console
      console.warn(`[migrate] ⚠ ${line}`);
      notes.push(line);
    }
  }

  // `serve` 5c. Platform infrastructure every served kernel gets — the
  // `sys_migration` ledger, `sys_secret`, the platform metadata tables — so it
  // belongs in any plan that claims to describe a served deployment. Composed
  // fully (not declaration-only): the sibling DATA subcommands already boot it
  // this way, and it is this repo's own plugin rather than host code.
  if (!hasPlatformObjects([...opts.basePlugins, ...plugins])) {
    const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
    plugins.push(new PlatformObjectsPlugin());
    notes.push('Composed PlatformObjectsPlugin (the platform floor `os serve` composes unconditionally).');
  }

  return { plugins, hostConfigPath, hostConfigLoaded, notes };
}
