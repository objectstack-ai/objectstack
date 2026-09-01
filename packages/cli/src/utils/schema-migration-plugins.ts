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
 * ## …and why suppressing `start()` was never the whole guarantee (#13332)
 *
 * That suppression was scoped to the shape of the ONE plugin that had been
 * measured. `composeForDeclarations` overrides `start` and nothing else, while
 * `packages/core/src/kernel.ts` fires `kernel:ready` (Phase 3),
 * `kernel:bootstrapped` (Phase 3.5) and `kernel:listening` (Phase 4)
 * unconditionally after the suppressed start pass. A writing hook REGISTERED
 * from `init()` survives on all three — so "a plan writes nothing" was a
 * property of plugins that happen to seed from `start()`, an unwritten
 * convention nothing checked. Measured downstream: a control plane whose
 * plugin created and updated `sys_ai_model` rows from an `init()`-registered
 * `kernel:ready` hook, on the `apply=false` run that is its mandatory human
 * review gate before a production schema apply.
 *
 * The fix refuses the WRITE rather than the hook
 * ({@link createDeclarationBootWriteGuard}): for the length of the kernel
 * bootstrap, the row-write members of the data-driver contract are refused on
 * every `driver.*` instance the kernel publishes. Phase-agnostic by
 * construction — a fourth phase is covered on the day it ships — and
 * read/log-only hooks still run, which is what an operator reading a plan
 * before a production apply needs them to do. Neutralising `init()`-registered
 * hooks instead would have been neither necessary (a log-only hook violates
 * nothing) nor sufficient (a write arriving by any other path still lands).
 *
 * ⚠️ **The residue, stated rather than hidden:** a host plugin that registers
 * its objects in `start()` instead of `init()` is invisible to this
 * composition — its tables stay out of the plan. That is the same class of
 * defect one notch narrower, and it is a real one; it is accepted here because
 * the alternative measured worse (a dry run that writes). The composition says
 * out loud what it did, so a missing table is diagnosable instead of being
 * indistinguishable from "in sync".
 *
 * ⚠️ **The write guard's own residue, likewise stated:** it covers the driver
 * contract's row writes, which is where every measured instance of this defect
 * landed and the only surface a plugin is supposed to write through. It does
 * NOT cover a driver's raw escape hatches (`driver-sql`'s `execute()` and
 * `getKnex()`), DDL (held back by `deferSchemaDdl`, and FLUSHED on purpose by
 * `apply`), writes a plugin makes outside the database entirely, or work a
 * hook defers past the end of the bootstrap. Each is named here so a future
 * reader can tell a deliberate boundary from an oversight.
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
 *
 * ⚠️ **This suppression is not, on its own, the "writes nothing" guarantee**
 * (#13332). `init()` runs, and every hook it registers fires on the phases
 * `kernel.ts` triggers unconditionally after the suppressed start pass. What
 * makes the sentence true is {@link createDeclarationBootWriteGuard}, which
 * refuses the write itself; this Proxy keeps Phase 2 out of a dry run, which is
 * a different and narrower job.
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

/**
 * The row-write surface of the data-driver contract
 * ({@link @objectstack/spec/contracts.IDataSourceDriver}, declared in
 * `packages/spec/src/contracts/data-driver.ts`) — what
 * {@link createDeclarationBootWriteGuard} refuses.
 *
 * Derived from the CONTRACT rather than from a survey of which plugins write
 * today, and that is the point of the choice. A list of lifecycle phase names
 * goes stale silently — this card started as "`kernel:ready` fires after the
 * suppressed start pass" and was three phases before a line was written
 * (`kernel:ready`, `kernel:bootstrapped`, `kernel:listening`), and a fourth
 * would re-open the hole with nothing turning red. A list of contract members
 * goes stale LOUDLY: adding a write to `IDataSourceDriver` is a spec diff, and
 * every driver in the repo has to implement it.
 *
 * DDL is deliberately absent. `deferSchemaDdl` already holds create-table /
 * add-column back for this boot, and `os migrate apply` FLUSHES exactly that,
 * once, after the operator confirms the plan — guarding it here would refuse
 * the one write these commands exist to make.
 */
const DRIVER_ROW_WRITE_METHODS = [
  'create',
  'update',
  'upsert',
  'delete',
  'bulkCreate',
  'bulkUpdate',
  'bulkDelete',
  'updateMany',
  'deleteMany',
] as const;

/** One refused write, as the plan reports it. */
export interface RefusedDeclarationWrite {
  /** The `driver.*` kernel service the call was made on. */
  driver: string;
  /** The contract method the caller reached for. */
  method: string;
  /** The object named in the call, or `(unknown)` when the call carried none. */
  object: string;
  /** How many times this exact driver/method/object triple was refused. */
  count: number;
}

/**
 * The declaration boot's write guard — the mechanism behind the sentence
 * `buildSchemaMigrationPlugins` prints, "a plan writes nothing" (#13332).
 *
 * ## Why the guard sits at the DRIVER, not at the plugin
 *
 * {@link composeForDeclarations} suppresses a host plugin's `start()`, and that
 * is where every seeder this repo had measured wrote from. It does NOT touch
 * `init()`, and `packages/core/src/kernel.ts` fires `kernel:ready`,
 * `kernel:bootstrapped` and `kernel:listening` unconditionally after the
 * suppressed start pass. A hook REGISTERED from `init()` therefore runs on a
 * plan, on all three — measured downstream as `driver.create` /
 * `driver.update` against `sys_ai_model` on the `apply=false` run that is a
 * control plane's mandatory human review gate.
 *
 * Neutralising `init()`-registered hooks instead would enforce a proxy for the
 * guarantee, and the proxy is neither necessary nor sufficient: a log-only
 * hook violates nothing yet would go silent exactly when an operator is
 * reading the plan before a production apply, while a write reaching the
 * driver by any other path still lands. The guarantee is about WRITES, so the
 * refusal belongs where a write happens. One choke point, phase-agnostic:
 * a phase added to the kernel tomorrow is covered on the day it ships.
 *
 * ## Why the driver INSTANCE, and not the `driver.*` service entry
 *
 * The instance is shared. `ObjectQLPlugin.init()` walks the kernel's
 * `driver.*` services and hands each one to the engine, which keys its
 * registry by `driver.name` and DISCARDS a second instance under a name it
 * already holds. So a wrapper registered in place of the service would be
 * refused by the engine and every `objectql`-mediated write would go straight
 * to the raw driver. Guarding the object itself covers both callers — the
 * plugin that resolves `driver.*` directly and the engine that writes through
 * it — because there is only ever one object.
 *
 * ## What a refusal does, and why it does not throw
 *
 * `context.trigger()` dispatches boot hooks PROPAGATING
 * (`packages/core/src/hook-dispatch.ts`): a handler that throws aborts the
 * bootstrap. Throwing here would turn "your plugin wrote during a dry run"
 * into "you cannot get a plan at all" — on the command whose whole job is to
 * be read before a production apply. So a refused write returns a benign,
 * contract-shaped value, and the run says so out loud: one `console.warn` per
 * driver/method/object triple, plus a line in the composition `notes` the plan
 * prints and the `--json` payload carries. Nothing is hidden; the operator
 * gets both the plan and the list of writes their stack attempted.
 */
export interface DeclarationBootWriteGuard {
  /**
   * Compose this into the boot's plugin list. It arms in Phase 1 — ordered
   * after `DefaultDatasourcePlugin`, which is what registers `driver.*` — and
   * re-scans in Phase 2 so a driver registered by a later `init()` is covered
   * before any hook phase can fire.
   */
  readonly plugin: unknown;
  /** Every refusal recorded so far. */
  readonly refusals: readonly RefusedDeclarationWrite[];
  /**
   * Restore every guarded driver to the methods it had, and return the line
   * for {@link SchemaMigrationComposition.notes} — or `null` when there is
   * nothing to report, so a boot in which nothing tried to write renders
   * byte-identically to before this existed.
   *
   * Called once, by `bootSchemaStack`, the moment the kernel bootstrap
   * returns: everything after that point is work the command was asked for
   * (`apply`'s confirmed DDL flush, the #13028 coverage pass), and it must not
   * meet a guard meant for the boot.
   */
  disarm(): string | null;
}

/** What a refused call hands back — shaped like the contract's return value. */
function refusalValue(method: string, args: readonly unknown[]): unknown {
  const copy = (v: unknown): Record<string, unknown> =>
    (v && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : {});
  switch (method) {
    // Echo the caller's own payload rather than inventing an identity: a
    // fabricated id is a second untruth, and a caller that reads one back
    // gets nothing from a database that was never written.
    case 'create':
    case 'upsert':
      return copy(args[1]);
    case 'update':
      return { ...copy(args[2]), id: args[1] };
    case 'delete':
      return false; // the contract's "not found"
    case 'bulkCreate':
      return Array.isArray(args[1]) ? args[1].map(copy) : [];
    case 'bulkUpdate':
      return Array.isArray(args[1])
        ? args[1].map((u: any) => ({ ...copy(u?.data), id: u?.id }))
        : [];
    case 'updateMany':
    case 'deleteMany':
      return 0; // rows affected
    case 'bulkDelete':
    default:
      return undefined;
  }
}

/**
 * Build the guard. See {@link DeclarationBootWriteGuard} for the seam and the
 * reasoning; this function only assembles it.
 */
export function createDeclarationBootWriteGuard(): DeclarationBootWriteGuard {
  const refusals = new Map<string, RefusedDeclarationWrite>();
  /** Guarded instance -> method -> the own descriptor it had, `undefined` when it had none. */
  const armed = new Map<object, Map<string, PropertyDescriptor | undefined>>();
  /** Instances a runtime refused to let us guard — reported, never swallowed. */
  const unguardable = new Set<string>();
  const warned = new Set<string>();

  const refuse = (driverName: string, method: string) =>
    async function refusedWrite(...args: unknown[]): Promise<unknown> {
      const object = typeof args[0] === 'string' ? args[0] : '(unknown)';
      const key = `${driverName}|${method}|${object}`;
      const seen = refusals.get(key);
      if (seen) seen.count += 1;
      else refusals.set(key, { driver: driverName, method, object, count: 1 });
      if (!warned.has(key)) {
        warned.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[migrate] ⚠ Refused ${method}() on ${object} via ${driverName}: this is a declaration `
          + 'boot, which writes nothing. The plugin that issued it registers a writing hook '
          + 'outside start() — move the write into start(), or out of the boot path.',
        );
      }
      return refusalValue(method, args);
    };

  const armDriver = (serviceName: string, driver: unknown): void => {
    if (!driver || typeof driver !== 'object') return;
    const target = driver as Record<string, unknown>;
    let saved = armed.get(target);
    if (!saved) {
      saved = new Map<string, PropertyDescriptor | undefined>();
      armed.set(target, saved);
    }
    for (const method of DRIVER_ROW_WRITE_METHODS) {
      if (saved.has(method)) continue;                      // already guarded
      if (typeof target[method] !== 'function') continue;    // optional member this driver lacks
      const original = Object.getOwnPropertyDescriptor(target, method);
      try {
        Object.defineProperty(target, method, {
          value: refuse(serviceName, method),
          writable: true,
          configurable: true,
          // Prototype methods are non-enumerable; an own property that shadows
          // one must not start showing up in `for…in` / spread.
          enumerable: original?.enumerable ?? false,
        });
      } catch {
        // A frozen or non-configurable driver. The guarantee cannot be made
        // for it, and saying so beats a silent hole.
        unguardable.add(`${serviceName}.${method}`);
        continue;
      }
      saved.set(method, original);
    }
  };

  const scan = (ctx: any): void => {
    const services: Map<string, unknown> | undefined = ctx?.getServices?.();
    if (!services || typeof services.entries !== 'function') return;
    for (const [name, service] of services.entries()) {
      if (typeof name === 'string' && name.startsWith('driver.')) armDriver(name, service);
    }
  };

  const plugin = {
    name: 'com.objectstack.cli.declaration-boot-write-guard',
    version: '1.0.0',
    /**
     * Ordering, not optionality — the same reason `DeferSchemaDdlPlugin`
     * declares it. `resolvePluginOrder` is a DFS in registration order, so
     * naming the plugin that registers `driver.*` puts our `init()` after it
     * and (because this guard is composed ahead of every host plugin) before
     * any host `init()` can reach a driver. `optionalDependencies` rather than
     * `dependencies` so a stack assembled without that plugin still boots.
     */
    optionalDependencies: ['com.objectstack.runtime.default-datasource'],
    init: async (ctx: any): Promise<void> => { scan(ctx); },
    /**
     * Re-scan in Phase 2. Host `start()`s are suppressed and the hook phases
     * are still ahead, so this is the last point before any host code can run
     * — and it catches a driver registered by an `init()` ordered after ours.
     */
    start: async (ctx: any): Promise<void> => { scan(ctx); },
  };

  const describe = (): string | null => {
    const parts: string[] = [];
    if (refusals.size > 0) {
      const total = [...refusals.values()].reduce((n, r) => n + r.count, 0);
      const detail = [...refusals.values()]
        .map((r) => `${r.method}() on ${r.object}${r.count > 1 ? ` x${r.count}` : ''}`)
        .join(', ');
      parts.push(
        `Refused ${total} write(s) during the declaration boot — a plan writes nothing: ${detail}. `
        + 'A plugin in this stack registers a writing hook outside start(); the plan below is '
        + 'unaffected, but that write WOULD have landed on a served boot of the same stack.',
      );
    }
    if (unguardable.size > 0) {
      parts.push(
        `Could NOT guard ${[...unguardable].sort().join(', ')} — the driver refused the override, `
        + 'so writes through those members were NOT suppressed on this run.',
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  };

  return {
    plugin,
    get refusals(): readonly RefusedDeclarationWrite[] { return [...refusals.values()]; },
    disarm(): string | null {
      for (const [target, saved] of armed) {
        for (const [method, original] of saved) {
          if (original) Object.defineProperty(target, method, original);
          else delete (target as Record<string, unknown>)[method];
        }
      }
      armed.clear();
      return describe();
    },
  };
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
  /**
   * The declaration boot's write guard (#13332), when this composition armed
   * one — `undefined` on a boot that composed nothing, so an artifact-less,
   * config-less run is untouched. `bootSchemaStack` calls
   * {@link DeclarationBootWriteGuard.disarm} the moment the kernel bootstrap
   * returns and appends the line it hands back to {@link notes}.
   */
  writeGuard?: DeclarationBootWriteGuard;
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

  // #13332 — armed FIRST, so its `init()` is ordered ahead of every host
  // plugin's: `resolvePluginOrder` is a DFS in registration order, and a host
  // `init()` that writes directly is only refused if the guard is already on
  // the driver by the time it runs. See {@link DeclarationBootWriteGuard}.
  const writeGuard = createDeclarationBootWriteGuard();
  const plugins: unknown[] = [writeGuard.plugin];
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
        + '(init runs, start does not), with row writes refused at the driver for the '
        + 'whole boot — a plan writes nothing.',
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

  return { plugins, hostConfigPath, hostConfigLoaded, hostConfigError, notes, coverage: null, writeGuard };
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
 *
 * ## The mutation half (#13118), and why it is a caller's claim
 *
 * #12953 ruled the exit STATUS and said nothing about the mutation, so `apply`
 * shipped writing its DDL over the reduced object set and THEN exiting
 * non-zero — the same run saying "this result is UNMEASURED" and "…and I
 * changed your schema on that basis". Maintainer ruling 2026-08-29, verbatim
 * 「同意」, option 2: `os migrate apply` refuses on this path **without touching
 * the database**, and the refusal must say so explicitly, so an operator
 * reading it does not have to guess.
 *
 * That extra sentence is opt-in ({@link UnloadableHostConfigRefusalOptions})
 * rather than automatic. It is a claim about what a particular run did, and the
 * only site that can honestly make it is one that returned before its own
 * mutating work.
 */
export interface UnloadableHostConfigRefusalOptions {
  /**
   * Say, in the refusal itself, that this run performed **no DDL** (#13118).
   *
   * ⛔ Not a default, and deliberately not deduced from the command name. The
   * sentence is a claim about what THIS run did to the operator's database,
   * and only a call site that has actually returned before its mutating work
   * can make it. `os migrate apply` passes `true` because #13118 moved its
   * refusal above `flushSchemaDdl()` / `applyMigrationEntries()`; a future
   * caller that refuses AFTER writing must say nothing here and get the
   * #12953 wording unchanged, rather than inherit a false all-clear by
   * omission.
   *
   * `os migrate plan` never passes it: `plan` writes nothing on ANY path, so
   * the sentence would be noise there — and its message is pinned unchanged by
   * the ruling's "plan 行为不变".
   */
  noDdlExecuted?: boolean;
}

/**
 * The sentence #13118 requires of the MUTATING command's refusal, verbatim.
 *
 * Exported so the pin and the message have one source: an operator reading the
 * refusal "must not have to guess whether the database was touched", and a
 * test that re-spells the sentence stops holding it the day the wording moves.
 */
export const NO_DDL_EXECUTED_NOTICE =
  'NO DDL WAS EXECUTED: this run refused before touching the database, so the physical '
  + 'schema is exactly as it was before the command ran. ';

export function describeUnloadableHostConfig(
  composition: SchemaMigrationComposition,
  options: UnloadableHostConfigRefusalOptions = {},
): string | null {
  if (composition.hostConfigPath === null || composition.hostConfigLoaded) return null;
  const cause = composition.hostConfigError ?? 'the load threw without a message';
  return (
    `Host config ${composition.hostConfigPath} exists but could not be loaded: ${cause}. `
    + 'This run therefore covered ONLY the objects the data stack registered — a fraction of '
    + 'what this deployment serves — so its result is UNMEASURED, not "in sync", and it is '
    + 'reported as a FAILURE rather than as success. '
    + (options.noDdlExecuted === true ? NO_DDL_EXECUTED_NOTICE : '')
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
 * @param options see {@link UnloadableHostConfigRefusalOptions} — `apply`
 *   passes `noDdlExecuted: true` (#13118); `plan` passes nothing.
 * @returns `true` when this run was the refused shape.
 */
export function refuseWhenHostConfigUnloadable(
  composition: SchemaMigrationComposition,
  options: UnloadableHostConfigRefusalOptions = {},
): boolean {
  const line = describeUnloadableHostConfig(composition, options);
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
