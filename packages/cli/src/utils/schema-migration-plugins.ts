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

/**
 * What the composed boot could and could NOT examine (#13028).
 *
 * `managedTables` alone cannot answer that. The count is read off ONE driver —
 * the one `findSqlDriver()` resolves — and a composed host brings its own
 * engine/driver pair, so a plan can report a healthy-looking number while most
 * of the deployment's objects sit on an engine nobody diffed, or on no driver
 * at all. Measured on ObjectStack Cloud's staging control plane before this
 * card: 36 host plugins composed, ~80 `sys_*` tables declared, **8** examined,
 * every signal green.
 *
 * So the plan reports its own boundary. Every field here is a count of objects,
 * not of plugins: which plugin an object came from is not observable at this
 * seam (a manifest registration carries a package id, not a plugin instance),
 * and inventing that attribution would be a second thing that reads like
 * coverage.
 */
export interface SchemaMigrationCoverage {
  /** Objects the composed boot's engine registry holds — the deployment's declared set. */
  registeredObjects: number;
  /** Of those, the ones now bound to the driver this plan diffs. */
  examinedObjects: number;
  /**
   * `registeredObjects - examinedObjects` — declared, and NOT covered by the
   * plan below. Non-zero means the plan is PARTIAL, whatever its findings say.
   */
  unexaminedObjects: number;
  /** Why each unexamined object is unexamined, so the number is actionable. */
  reasons: {
    /** Federated (external) objects — no managed table, correctly out of scope. */
    federated: number;
    /** No driver claims them: `getDriverForObject()` answered nothing. */
    unbound: number;
    /** Their driver cannot register object metadata (a non-SQL driver). */
    unsupported: number;
    /** Bound to a DIFFERENT driver than the one this plan diffs. */
    otherDriver: number;
    /** Their driver REFUSED the registration — the loud one; see `notes`. */
    failed: number;
  };
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
   * The underlying failure, when `hostConfigPath !== null && !hostConfigLoaded`
   * — the message the load threw, carried structurally so the commands can NAME
   * it in their refusal (#12953) instead of re-parsing the prose in `notes`.
   * `null` on every other shape, including a config that loaded.
   */
  hostConfigError: string | null;
  /**
   * One line per thing this composition did or could not do, for the command to
   * print. Empty when nothing was composed, so a project with neither a config
   * nor an artifact produces byte-identical output to before this existed.
   */
  notes: string[];
  /**
   * The boundary of what this plan examined (#13028) — `null` until the boot
   * has started and {@link measureComposedCoverage} has run, and `null`
   * forever on a boot that composed nothing, so an artifact-less, config-less
   * run renders byte-identically to before any of this existed.
   */
  coverage: SchemaMigrationCoverage | null;
}

const NOTHING_COMPOSED: SchemaMigrationComposition = Object.freeze({
  plugins: [],
  hostConfigPath: null,
  hostConfigLoaded: false,
  hostConfigError: null,
  notes: [],
  coverage: null,
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
  let hostConfigError: string | null = null;

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
      // reservation is already installed by the time this runs).
      //
      // ⚠️ This warning is no longer the WHOLE of the response. It used to be —
      // the reasoning was that a config which cannot load (a missing env var is
      // the common one) used to be irrelevant to this command, so failing the
      // run would regress a command that works today. Maintainer ruling
      // 2026-08-29 (#12953), verbatim 「同意」, overrode that: a green exit over
      // an UNMEASURED partial metadata set is the false-green a migration tool
      // must never emit, and the population it "regresses" was computing
      // defective plans all along. The commands now exit non-zero on this path
      // — see {@link describeUnloadableHostConfig}.
      //
      // The warning text and `hostConfigLoaded` stay exactly as they were: the
      // ruling pinned both, because consumers (objectstack-ai/cloud#1705) read
      // the discriminator and a count alone cannot replace it.
      const message = error?.message ?? String(error);
      const line =
        `Host config ${hostConfigPath} could not be loaded: ${message}. `
        + 'The plan below covers ONLY the objects the data stack registered — it does NOT '
        + "cover this deployment's own objects, so an empty plan here is UNMEASURED, not "
        + '"in sync". Fix the config (or its environment) and re-run.';
      // eslint-disable-next-line no-console
      console.warn(`[migrate] ⚠ ${line}`);
      notes.push(line);
      hostConfigError = message;
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

  return { plugins, hostConfigPath, hostConfigLoaded, hostConfigError, notes, coverage: null };
}

/**
 * The one composition shape `os migrate plan` / `apply` must REFUSE (#12953),
 * rendered as the operator-facing error — or `null` when this run is not it.
 *
 * ## Which shape, and why only this one
 *
 * A host config that EXISTS and could not be loaded. The object set the command
 * then diffs is the data stack plus the platform floor: nine tables, none of
 * them this deployment's, and `0` drift over them prints as "in sync". The
 * maintainer ruled that green exit out on 2026-08-29 (verbatim 「同意」) —
 * a green exit over an UNMEASURED partial metadata set is the false-green a
 * migration tool must never emit, and the population this "regresses" was
 * computing defective plans all along.
 *
 * The scope was pinned in the same ruling, in three directions, and the
 * predicate below is written to hold all three:
 *
 *   • config present + unloadable → non-zero (this function answers non-`null`);
 *   • config ABSENT (`hostConfigPath === null`) → today's behaviour, unchanged.
 *     `hostConfigLoaded` is `false` on that path too — which is exactly why the
 *     test is on `hostConfigPath`, not on `hostConfigLoaded` alone;
 *   • config present + loadable → today's behaviour, unchanged.
 *
 * ⛔ Not a general "the composition is partial" refusal. A plan that composed
 * fine but could not EXAMINE everything it declared is #13028's `coverage`
 * block, it stays exit 0, and widening this predicate to cover it would turn a
 * population the ruling deliberately left alone red.
 *
 * The message names the three things the ruling requires of it: the config
 * file, the underlying failure, and the remedy.
 */
export function describeUnloadableHostConfig(
  composition: SchemaMigrationComposition,
): string | null {
  if (composition.hostConfigPath === null || composition.hostConfigLoaded) return null;
  const cause = composition.hostConfigError ?? 'the load threw without a message';
  return (
    `Host config ${composition.hostConfigPath} exists but could not be loaded: ${cause}. `
    + 'This run therefore covered ONLY the objects the data stack registered — a fraction of '
    + 'what this deployment serves — so its result is UNMEASURED, not "in sync", and it is '
    + 'reported as a FAILURE rather than as success. '
    + 'Remedy: supply the environment this config needs (the failure named above says which), '
    + 'or fix the config, then re-run.'
  );
}

/**
 * Apply {@link describeUnloadableHostConfig}'s verdict to the process.
 *
 * A shared choke point rather than two copies, for the reason `apply` already
 * states about `composeHostStack`: the plan an operator reads and the reconcile
 * they confirm must be the same judgement, so the two commands cannot be
 * allowed to drift on it.
 *
 * ⚠️ Writes to **stderr**, in both modes. `printError` writes to stdout, and
 * `--json` reserves stdout for the payload — the payload is still emitted in
 * full on this path, because the ruling kept `composition.hostConfigLoaded` as
 * the machine discriminator its consumers read.
 *
 * ⚠️ Sets `process.exitCode` rather than throwing oclif's `this.exit(1)`: the
 * report — the plan, or the JSON document — has already been written by the
 * time this runs and must survive. `migrate/plan.ts`'s `run()` wrapper reads
 * `process.exitCode` and hands it to `exitOneShotCommand`.
 *
 * @returns `true` when this run was the refused shape.
 */
export function refuseWhenHostConfigUnloadable(
  composition: SchemaMigrationComposition,
): boolean {
  const line = describeUnloadableHostConfig(composition);
  if (line === null) return false;
  // eslint-disable-next-line no-console
  console.error(`[migrate] ✗ ${line}`);
  process.exitCode = 1;
  return true;
}

/**
 * Bind the composed boot's declared objects to their drivers, WITHOUT DDL, and
 * report what the plan can therefore examine (#13028).
 *
 * ## Why this step exists at all
 *
 * What fills a SQL driver's `managedObjectFields` — the map
 * `detectManagedDrift()` diffs the physical schema against — is
 * `registerObjectMetadata()`, and the one pass that drives it for every
 * registered object lives inside `ObjectQLPlugin.start()`. A declaration-phase
 * composition suppresses `start()`; a host that brings its OWN `ObjectQLPlugin`
 * (ObjectStack Cloud's control plane does, behind a lazy wrapper) therefore
 * ends the boot with its objects declared in an engine whose driver was never
 * told about one of them.
 *
 * Measured on that control plane: 36 host plugins composed, ~80 `sys_*` tables
 * declared, **8** examined — and all eight belonged to the single service that
 * provisions its own tables from a `kernel:ready` hook rather than relying on
 * that pass. Every consumer-visible signal was green.
 *
 * ## Why running it here is safe — and why it is the framework's own pass
 *
 * Per object it calls `engine.syncObjectSchema(name)`: the SAME public
 * `IDataEngine` entry point `service-messaging` already uses to provision its
 * tables, reaching `SqlDriver.initObjects` exactly as `ObjectQLPlugin.start()`
 * would have. This boot has DDL DEFERRED, so `initObjects` registers the
 * metadata in memory, records the create-table work as PENDING and returns —
 * no `CREATE TABLE`, no `ALTER TABLE`, and since #13028 not even the
 * `ensureDatabaseExists()` probe (`sql-driver.ts` skips it while deferred, for
 * this call site). A plan still writes nothing, and it costs no round-trips.
 *
 * ⛔ It is NOT the suppressed `start()` re-armed: no host code runs here at
 * all. This is the framework driving its own registry→driver pass over the
 * declarations the host's `init()` already made.
 *
 * ⛔ And it must NOT run on a boot that did not defer: the same call would then
 * take the DDL path and a "plan" would create tables. The caller passes
 * `deferred` rather than this function deducing it — a capability that appears
 * because of a default nobody wrote down is invisible at every call site
 * (AGENTS.md → Route & surface ownership §2).
 *
 * @param kernel the booted kernel.
 * @param plannedDriver the driver whose managed set the plan will diff — the
 *   identity comparison that turns "bound somewhere" into "bound HERE".
 * @param deferred whether this boot armed deferred DDL. `false` reports the
 *   coverage as UNMEASURED instead of syncing.
 */
export async function measureComposedCoverage(
  kernel: unknown,
  plannedDriver: unknown,
  deferred: boolean,
): Promise<{ coverage: SchemaMigrationCoverage; notes: string[] }> {
  const notes: string[] = [];
  const empty: SchemaMigrationCoverage = {
    registeredObjects: 0,
    examinedObjects: 0,
    unexaminedObjects: 0,
    reasons: { federated: 0, unbound: 0, unsupported: 0, otherDriver: 0, failed: 0 },
  };

  if (!deferred) {
    notes.push(
      'This boot did not defer schema DDL, so the declared object set was NOT bound to the driver here — '
      + 'binding it would have run DDL. Coverage below is UNMEASURED, not full.',
    );
    return { coverage: empty, notes };
  }

  const getService = (kernel as { getService?: (name: string) => unknown })?.getService;
  let engine: any;
  try {
    engine = getService?.call(kernel, 'objectql');
  } catch {
    engine = undefined;
  }
  const objects: unknown = engine?.registry?.getAllObjects?.();
  if (
    !Array.isArray(objects)
    || typeof engine?.getDriverForObject !== 'function'
    || typeof engine?.syncObjectSchema !== 'function'
  ) {
    // No engine, or one whose registry cannot be read. ⛔ NOT reported as
    // "zero objects": that answer was never obtained, and the two have
    // opposite consequences (a small deployment vs. a plan that measured
    // nothing). The plan keeps whatever the driver already knew and says why
    // it could not do better.
    notes.push(
      'The composed boot exposes no readable ObjectQL registry, so the plan below covers only what '
      + 'already reached the driver by some other path. That is UNMEASURED coverage, not full coverage.',
    );
    return { coverage: empty, notes };
  }

  let examined = 0;
  let federated = 0;
  let unbound = 0;
  let unsupported = 0;
  let otherDriver = 0;
  let failed = 0;
  const failures = new Map<string, number>();

  for (const obj of objects as Array<{ name: string; external?: unknown }>) {
    // Federated objects have no managed table — `detectManagedDrift` could not
    // diff one if it wanted to. Counted apart from a real gap rather than
    // folded into it.
    if (obj?.external != null) { federated++; continue; }
    const driver = engine.getDriverForObject(obj.name);
    if (!driver) { unbound++; continue; }
    if (driver !== plannedDriver) { otherDriver++; continue; }
    if (typeof (driver as { syncSchema?: unknown }).syncSchema !== 'function') { unsupported++; continue; }
    try {
      await engine.syncObjectSchema(obj.name);
      examined++;
    } catch (e: unknown) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      failures.set(message, (failures.get(message) ?? 0) + 1);
    }
  }

  for (const [message, count] of failures) {
    notes.push(
      `The driver REFUSED schema registration for ${count} object(s) (${message}); `
      + 'those objects are NOT in the plan below.',
    );
  }

  const total = (objects as unknown[]).length;
  const coverage: SchemaMigrationCoverage = {
    registeredObjects: total,
    examinedObjects: examined,
    unexaminedObjects: total - examined,
    reasons: { federated, unbound, unsupported, otherDriver, failed },
  };

  if (coverage.unexaminedObjects > 0) {
    const why = [
      coverage.reasons.federated > 0 ? `${coverage.reasons.federated} federated (no managed table)` : null,
      coverage.reasons.otherDriver > 0 ? `${coverage.reasons.otherDriver} bound to a different datasource` : null,
      coverage.reasons.unbound > 0 ? `${coverage.reasons.unbound} bound to no driver` : null,
      coverage.reasons.unsupported > 0 ? `${coverage.reasons.unsupported} on a driver without schema registration` : null,
      coverage.reasons.failed > 0 ? `${coverage.reasons.failed} refused by their driver` : null,
    ].filter((s): s is string => s !== null);
    notes.push(
      `Coverage: ${coverage.examinedObjects} of ${coverage.registeredObjects} declared object(s) are in the diffed set; `
      + `${coverage.unexaminedObjects} are NOT (${why.join(', ')}). The plan below is PARTIAL — an empty result over `
      + 'those objects is UNMEASURED, not "in sync".',
    );
  }

  return { coverage, notes };
}
