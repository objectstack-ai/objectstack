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
 * ⚠️ **The write guard's own residue, likewise stated** — each boundary named
 * here so a future reader can tell a deliberate one from an oversight:
 *
 *  - **`execute()` — the contract's own raw-execution escape hatch.** A
 *    REQUIRED member of `IDataDriver` (`packages/spec/src/contracts/`
 *    `data-driver.ts`, under "Raw Execution (Escape Hatch)") — on every
 *    driver, not a driver-sql extension. It is NOT refused, because a raw
 *    command is opaque to this guard: the contract admits "SQL string, shell
 *    command, or API payload", and classifying SQL text as read-vs-write is
 *    unreliable in both directions (a `SELECT` can quote the word `INSERT` in
 *    a literal; a CTE can write) — while the framework's own boot-legitimate
 *    work runs through this very seam (`metadata-protocol`'s
 *    `ensureOverlayIndex` issues its index DDL here). So a boot-window
 *    `execute()` is FORWARDED and REPORTED instead: one stderr warning per
 *    driver, a line in the composition notes, and the notes stop claiming
 *    "a plan writes nothing" for that run. `getKnex()` (a driver-sql
 *    extension, genuinely off-contract) is not intercepted; it was not the
 *    path any measured instance of this defect took.
 *  - **DDL — and its members split.** `deferSchemaDdl` holds back the
 *    `initObjects`/`syncSchema` path, which `os migrate apply` FLUSHES on
 *    purpose once the operator confirms. `dropTable` (a REQUIRED member of
 *    `IDataDriver`) and driver-sql's `rotateShards` are NOT held back by that
 *    deferral: they run `assertSchemaMutable` — a schemaMode/dialect gate,
 *    not a deferral check — and then execute immediately. They are NOT
 *    refused here either (#14126): refusing DDL an operator's own hook asked
 *    for is a behaviour change beyond what this guard exists for. So a
 *    boot-window call gets exactly the treatment `execute()` gets — FORWARDED
 *    (it executes, today as before), counted per driver/method/object, warned
 *    once per driver on stderr, named in the composition notes, and the notes
 *    withhold "a plan writes nothing" for that run
 *    ({@link DRIVER_IMMEDIATE_DDL_METHODS}). The execution itself stays an
 *    open boundary; what closed is its silence.
 *  - **Engine-held drivers — armed as they are registered (#14126).** The
 *    guard's scan covers the `driver.*` services the kernel publishes, and
 *    the only such registration repo-wide is the DEFAULT datasource's
 *    (`packages/runtime/src/default-datasource-plugin.ts`). Every OTHER
 *    datasource's driver goes straight to `engine.registerDriver` —
 *    `DatasourceConnectionService.connect()`, `AppPlugin`'s
 *    `drivers.register`, `ObjectQL.create` — never through `driver.*`, and
 *    the engine's driver map is private with no public enumerator. So the
 *    guard shadows `registerDriver` on the engine INSTANCE the kernel
 *    publishes (`objectql` / `data`, one object under two names) for the
 *    length of the boot: each driver instance is armed in place as it is
 *    registered, and the SAME instance is forwarded to the engine's own
 *    method — never a wrapper, never a second registration (the engine keeps
 *    the first instance under a held name and discards the second; identity
 *    decides). Drivers the engine ALREADY holds when the guard arms are
 *    reached through its public accessors: the default via
 *    `getDefaultDriverName()` / `getDriverByName()`, and every driver a
 *    registered object resolves to via `getDriverForObject()`. Measured on
 *    this CLI's boot: that set is exactly the default, which the `driver.*`
 *    scan armed first (`DefaultDatasourcePlugin.init()` registers it through
 *    the engine and republishes it as `driver.<name>` before this guard's
 *    `init()` is ordered), so the default keeps its `driver.*` label. What
 *    remains open, stated: an engine the kernel never publishes as a service,
 *    and a non-default driver registered BEFORE the guard armed that no
 *    registered object resolves to at either scan — neither is reachable
 *    from here without an engine change, and neither occurs in this repo's
 *    boot.
 *  - writes a plugin makes outside the database entirely (filesystem,
 *    network).
 *  - work a hook defers past the end of the bootstrap; the guard covers the
 *    boot window.
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
 * ({@link @objectstack/spec/contracts.IDataDriver}, declared in
 * `packages/spec/src/contracts/data-driver.ts`) — what
 * {@link createDeclarationBootWriteGuard} refuses.
 *
 * Derived from the CONTRACT rather than from a survey of which plugins write
 * today, and that is the point of the choice. A list of lifecycle phase names
 * goes stale silently — this card started as "`kernel:ready` fires after the
 * suppressed start pass" and was three phases before a line was written
 * (`kernel:ready`, `kernel:bootstrapped`, `kernel:listening`), and a fourth
 * would re-open the hole with nothing turning red. A list of contract members
 * goes stale LOUDLY: adding a write to `IDataDriver` is a spec diff, and
 * every driver in the repo has to implement it.
 *
 * Three groups of members that can write are deliberately NOT in this list,
 * and each is stated in the module header's residue census rather than
 * silently excluded: `execute()` — the contract's raw-execution escape hatch,
 * forwarded and REPORTED ({@link DRIVER_RAW_EXECUTION_METHODS}) because a raw
 * command cannot be classified as read-vs-write reliably; the IMMEDIATE DDL
 * members `dropTable`/`rotateShards`, forwarded and REPORTED the same way
 * ({@link DRIVER_IMMEDIATE_DDL_METHODS}) because refusing DDL a hook asked for
 * is not this guard's call to make; and the DEFERRED DDL path
 * `initObjects`/`syncSchema`, which `deferSchemaDdl` holds back and
 * `os migrate apply` FLUSHES once the operator confirms — guarding it here
 * would refuse the one write these commands exist to make.
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

/**
 * The contract's raw-execution escape hatch — `IDataDriver.execute()`, a
 * REQUIRED member on every driver (`packages/spec/src/contracts/`
 * `data-driver.ts`, "Raw Execution (Escape Hatch)").
 *
 * FORWARDED and REPORTED during the boot window, never refused, and the
 * reason is stated because it was weighed (#14053 review, R1): the command is
 * `unknown` by contract — "SQL string, shell command, or API payload" — and
 * classifying SQL text as read-vs-write is unreliable in both directions (a
 * `SELECT` can quote the word `INSERT` inside a literal; a CTE can write), so
 * a refusal would either break boot-legitimate reads and the framework's own
 * index DDL (`ensureOverlayIndex` runs through this seam) or rest on a guess.
 * What must never happen instead is the SILENT half: an `execute()` that
 * landed a write while the run printed an unqualified "a plan writes
 * nothing". So every boot-window call is counted per driver, warned once per
 * driver on stderr, and named in the composition notes — which drop the
 * "writes nothing" claim for that run ({@link DeclarationBootWriteGuard}).
 */
const DRIVER_RAW_EXECUTION_METHODS = ['execute'] as const;

/**
 * The DDL members that execute IMMEDIATELY during a declaration boot —
 * `IDataDriver.dropTable()` (a REQUIRED contract member: "Drop the underlying
 * table or collection (destructive)") and driver-sql's `rotateShards()`
 * (`packages/drivers/driver-sql/src/sql-driver.ts`, the lifecycle rotation
 * extension `LifecycleService` calls; it DROPs expired shards). Neither is
 * held back by `deferSchemaDdl`: both run `assertSchemaMutable` — a
 * schemaMode/dialect gate, not a deferral check — and then issue their DDL.
 *
 * FORWARDED and REPORTED, never refused, for a reason weighed on #14126:
 * refusing DDL an operator's own hook asked for is a behaviour change beyond
 * what this guard exists for (keeping a dry run from writing rows behind the
 * operator's back, and saying so), and a served boot of the same stack is
 * entitled to drop a table it declared. What must never happen is the SILENT
 * half — a `DROP TABLE` landing while the run prints an unqualified "a plan
 * writes nothing". So a boot-window call is counted per driver/method/object
 * (unlike a raw command, a DDL call names its object, and an object name is
 * already what the refusal notes echo), warned once per driver on stderr,
 * named in the composition notes, and the notes withhold the claim for that
 * run — the treatment `execute()` gets, decided ONCE for every path the guard
 * forwards rather than refuses ({@link DeclarationBootWriteGuard}).
 */
const DRIVER_IMMEDIATE_DDL_METHODS = ['dropTable', 'rotateShards'] as const;

/**
 * The kernel services under which `ObjectQLPlugin.init()` publishes the
 * engine (`packages/objectql/src/plugin.ts` — `providesServices` names both,
 * and both point at the same `ObjectQL` instance). The guard shadows
 * `registerDriver` on whichever of these it finds, keyed by instance so one
 * engine under two names is shadowed once.
 */
const ENGINE_SERVICES = ['objectql', 'data'] as const;

/** One refused write, as the plan reports it. */
export interface RefusedDeclarationWrite {
  /**
   * The `driver.*` kernel service the call was made on — or `engine.<name>`
   * for a driver the guard reached through the engine instead: registered via
   * `engine.registerDriver` during the boot, or already held by the engine
   * when the guard armed (#14126). One label per instance, decided by which
   * path reached it first; the `driver.*` scan runs first, so the default
   * keeps the label it always had.
   */
  driver: string;
  /** The contract method the caller reached for. */
  method: string;
  /** The object named in the call, or `(unknown)` when the call carried none. */
  object: string;
  /** How many times this exact driver/method/object triple was refused. */
  count: number;
}

/**
 * One driver's boot-window `execute()` traffic, as the plan reports it.
 * Forwarded, not refused — see {@link DRIVER_RAW_EXECUTION_METHODS} for why —
 * and counted per driver rather than per statement: the command is `unknown`
 * by contract, so there is no object name to key on and echoing raw command
 * text into an operator-facing note would leak whatever the caller inlined.
 */
export interface ForwardedRawExecution {
  /** The driver the call was made on, labelled as {@link RefusedDeclarationWrite.driver} is. */
  driver: string;
  /** How many `execute()` calls this driver saw during the guarded window. */
  count: number;
}

/**
 * One immediate-DDL call the boot forwarded, as the plan reports it —
 * `dropTable()` / `rotateShards()` ({@link DRIVER_IMMEDIATE_DDL_METHODS}).
 * Unlike a raw command, a DDL call names its object, so it is keyed like a
 * refusal: per driver/method/object, with a count.
 */
export interface ForwardedImmediateDdl {
  /** The driver the call was made on, labelled as {@link RefusedDeclarationWrite.driver} is. */
  driver: string;
  /** `dropTable` or `rotateShards`. */
  method: string;
  /** The object (table) named in the call, or `(unknown)` when the call carried none. */
  object: string;
  /** How many times this exact driver/method/object triple was forwarded. */
  count: number;
}

/**
 * The declaration boot's write guard — the mechanism behind the sentence the
 * plan's notes print when the boot is over and it held, "a plan writes
 * nothing" (#13332). The sentence is an OUTCOME, so {@link disarm} owns it,
 * under ONE rule for every path (#14053 review, R1; #14126): it is claimed
 * only when it held across everything the guard can see — every write it
 * saw was refused, nothing was forwarded rather than refused (a raw
 * `execute()`, an immediate `dropTable()`/`rotateShards()`), and nothing it
 * set out to guard refused the override (a frozen driver, an engine whose
 * `registerDriver` could not be shadowed). Each of those is NAMED in the
 * notes and withholds the unqualified line. A claim printed over a write the
 * guard let through is the defect this module exists to close, and fixing
 * one such path while leaving another reproduces it at a smaller radius —
 * which is why the rule is decided once, here, and not per path.
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
 * The instance is shared. `ObjectQLPlugin.start()` walks the kernel's
 * `driver.*` services (`packages/objectql/src/plugin.ts` — the discovery loop
 * lives in `start`, not `init`) and hands each one to the engine, which keys
 * its registry by `driver.name` and DISCARDS a second instance under a name it
 * already holds. So a wrapper registered in place of the service would be
 * refused by the engine and every `objectql`-mediated write would go straight
 * to the raw driver. Guarding the object itself covers both callers — the
 * plugin that resolves `driver.*` directly and the engine that writes through
 * it — because there is only ever one object, and the engine's write path is a
 * call-time property lookup on it.
 *
 * ## Why the ENGINE instance is shadowed too (#14126)
 *
 * Only the default datasource is ever published as `driver.*`; every other
 * driver reaches the engine through `engine.registerDriver` alone
 * (`DatasourceConnectionService.connect()`, `AppPlugin`'s `drivers.register`,
 * `ObjectQL.create`), and the engine's driver map is private with no public
 * enumerator. The same in-place technique answers it: `registerDriver` is a
 * prototype method on an ordinary, extensible instance that every caller
 * reaches by a call-time property lookup on the object the kernel publishes
 * (measured on `ObjectQL`: no `freeze`/`seal`, no bound copy of the method
 * anywhere in the repo's runtime), so an own property on that instance is
 * what they all call. The shadow arms the driver instance FIRST and then
 * forwards the SAME instance to the engine's own method — never a wrapper in
 * its place, never a second registration under a held name (the engine keeps
 * the first and discards the second; identity decides) — and `disarm()`
 * deletes the own property so the instance resolves through its prototype
 * again. Drivers the engine already held when the guard armed are reached
 * through its public accessors (the default by name, the rest via the
 * objects that resolve to them); the module header's census states what that
 * cannot reach.
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
   * before any hook phase can fire. Both scans also shadow `registerDriver`
   * on the engine the kernel publishes, so a driver registered at ANY later
   * point of the boot is armed on arrival (#14126).
   */
  readonly plugin: unknown;
  /** Every refusal recorded so far. */
  readonly refusals: readonly RefusedDeclarationWrite[];
  /**
   * Every boot-window `execute()` call seen so far, per driver — forwarded
   * and reported rather than refused ({@link DRIVER_RAW_EXECUTION_METHODS}).
   * Non-empty means the run's notes must not (and do not) claim an
   * unqualified "a plan writes nothing".
   */
  readonly rawExecutions: readonly ForwardedRawExecution[];
  /**
   * Every boot-window `dropTable()` / `rotateShards()` call seen so far —
   * forwarded and reported rather than refused
   * ({@link DRIVER_IMMEDIATE_DDL_METHODS}). Non-empty means the run's notes
   * must not (and do not) claim an unqualified "a plan writes nothing".
   */
  readonly immediateDdl: readonly ForwardedImmediateDdl[];
  /**
   * The kernel service names under which the guard found — and is currently
   * shadowing `registerDriver` on — an engine instance, one entry per
   * distinct instance (`objectql` and `data` are one object, so one entry).
   * Empty on an embedder with no data plane, and after {@link disarm}.
   * Exposed so a pin can assert the shadow is a fact of THIS boot rather
   * than an assumption about it.
   */
  readonly shadowedEngines: readonly string[];
  /**
   * Restore every guarded driver — and every shadowed engine — to the
   * methods it had, and return the line
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
  const rawExecutions = new Map<string, ForwardedRawExecution>();
  const immediateDdl = new Map<string, ForwardedImmediateDdl>();
  /**
   * Guarded instance -> member -> the own descriptor it had, `undefined` when
   * it had none. Drivers AND engines: the restore is the same act for both.
   */
  const armed = new Map<object, Map<string, PropertyDescriptor | undefined>>();
  /** Driver members a runtime refused to let us guard — reported, never swallowed. */
  const unguardable = new Set<string>();
  /** Engines whose `registerDriver` refused the shadow — likewise reported. */
  const unshadowable = new Set<string>();
  /** Engine instance -> the service name it was reached through. */
  const shadowedEngines = new Map<object, string>();
  const warned = new Set<string>();
  const warnedExec = new Set<string>();
  const warnedDdl = new Set<string>();

  /**
   * The object a call names. Row writes take the object NAME first;
   * driver-sql's `rotateShards(objectDef, nowMs)` takes the object
   * DEFINITION, so its name is read off that.
   */
  const objectOf = (args: readonly unknown[]): string => {
    const first = args[0];
    if (typeof first === 'string') return first;
    const name = (first as { name?: unknown } | null | undefined)?.name;
    return typeof name === 'string' ? name : '(unknown)';
  };

  /**
   * Install `value` as an own property shadowing `method` on `target`,
   * remembering what was there so {@link disarm} can put it back. `true`
   * when the shadow is in place — including when it already was.
   */
  const shadow = (
    label: string,
    target: Record<string, unknown>,
    method: string,
    value: (...args: unknown[]) => unknown,
    refused: Set<string>,
  ): boolean => {
    let saved = armed.get(target);
    if (!saved) {
      saved = new Map<string, PropertyDescriptor | undefined>();
      armed.set(target, saved);
    }
    if (saved.has(method)) return true;                     // already guarded
    if (typeof target[method] !== 'function') return false; // member this instance lacks
    const original = Object.getOwnPropertyDescriptor(target, method);
    try {
      Object.defineProperty(target, method, {
        value,
        writable: true,
        configurable: true,
        // Prototype methods are non-enumerable; an own property that shadows
        // one must not start showing up in `for…in` / spread.
        enumerable: original?.enumerable ?? false,
      });
    } catch {
      // A frozen or non-configurable instance. The guarantee cannot be made
      // for it, and saying so beats a silent hole — it is named in the notes
      // and withholds the outcome line.
      refused.add(`${label}.${method}`);
      return false;
    }
    saved.set(method, original);
    return true;
  };

  const refuse = (driverName: string, method: string) =>
    async function refusedWrite(...args: unknown[]): Promise<unknown> {
      const object = objectOf(args);
      const key = `${driverName}|${method}|${object}`;
      const seen = refusals.get(key);
      if (seen) seen.count += 1;
      else refusals.set(key, { driver: driverName, method, object, count: 1 });
      if (!warned.has(key)) {
        warned.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[migrate] ⚠ Refused ${method}() on ${object} via ${driverName}: a declaration `
          + 'boot refuses row writes. The plugin that issued it registers a writing hook '
          + 'outside start() — move the write into start(), or out of the boot path.',
        );
      }
      return refusalValue(method, args);
    };

  /**
   * The escape hatch is forwarded, never refused — see
   * {@link DRIVER_RAW_EXECUTION_METHODS} for the weighed reason — but it is
   * COUNTED and SAID: the one unacceptable outcome is a write landing through
   * `execute()` while the run prints an unqualified "a plan writes nothing".
   */
  const forwardRawExecution = (
    driverName: string,
    original: (...args: unknown[]) => unknown,
    target: object,
  ) =>
    function forwardedExecute(this: unknown, ...args: unknown[]): unknown {
      const seen = rawExecutions.get(driverName);
      if (seen) seen.count += 1;
      else rawExecutions.set(driverName, { driver: driverName, count: 1 });
      if (!warnedExec.has(driverName)) {
        warnedExec.add(driverName);
        // eslint-disable-next-line no-console
        console.warn(
          `[migrate] ⚠ Raw execute() called via ${driverName} during the declaration boot. `
          + 'A raw command cannot be classified as read or write, so it was FORWARDED, not '
          + 'refused — if it wrote, this boot wrote, and the plan\'s notes say so. Issue row '
          + 'writes through the contract methods (which a declaration boot refuses and '
          + 'reports), or move raw commands out of the boot path.',
        );
      }
      return Reflect.apply(original, this ?? target, args);
    };

  /**
   * Immediate DDL is forwarded, never refused — see
   * {@link DRIVER_IMMEDIATE_DDL_METHODS} for the weighed reason — and, like
   * `execute()`, it is COUNTED and SAID: the DDL executed, and the run's
   * notes must not claim otherwise.
   */
  const forwardImmediateDdl = (
    driverName: string,
    method: string,
    original: (...args: unknown[]) => unknown,
    target: object,
  ) =>
    function forwardedDdl(this: unknown, ...args: unknown[]): unknown {
      const object = objectOf(args);
      const key = `${driverName}|${method}|${object}`;
      const seen = immediateDdl.get(key);
      if (seen) seen.count += 1;
      else immediateDdl.set(key, { driver: driverName, method, object, count: 1 });
      if (!warnedDdl.has(driverName)) {
        warnedDdl.add(driverName);
        // eslint-disable-next-line no-console
        console.warn(
          `[migrate] ⚠ ${method}() on ${object} called via ${driverName} during the declaration boot. `
          + 'Immediate DDL is not held back by the schema deferral, so it was FORWARDED, not '
          + 'refused — it executed, this boot changed the physical schema, and the plan\'s notes '
          + 'say so. Move DDL out of the boot path, or behind the served boot it belongs to.',
        );
      }
      return Reflect.apply(original, this ?? target, args);
    };

  const armDriver = (label: string, driver: unknown): void => {
    if (!driver || typeof driver !== 'object') return;
    const target = driver as Record<string, unknown>;
    for (const method of DRIVER_ROW_WRITE_METHODS) {
      shadow(label, target, method, refuse(label, method), unguardable);
    }
    for (const method of DRIVER_RAW_EXECUTION_METHODS) {
      const original = target[method];
      if (typeof original !== 'function') continue;
      shadow(
        label, target, method,
        forwardRawExecution(label, original as (...args: unknown[]) => unknown, target),
        unguardable,
      );
    }
    for (const method of DRIVER_IMMEDIATE_DDL_METHODS) {
      const original = target[method];
      if (typeof original !== 'function') continue;
      shadow(
        label, target, method,
        forwardImmediateDdl(label, method, original as (...args: unknown[]) => unknown, target),
        unguardable,
      );
    }
  };

  /** How a driver reached through the engine is labelled — `engine.<driver.name>`. */
  const engineLabel = (driver: unknown): string => {
    const name = (driver as { name?: unknown } | null | undefined)?.name;
    return `engine.${typeof name === 'string' && name.length > 0 ? name : '(unnamed)'}`;
  };

  /**
   * Arm what the engine ALREADY holds, through the accessors it makes
   * public: the default by name, and every driver a registered object
   * resolves to. Read-only probes — `getDriverForObject` swallows its own
   * resolution errors and records nothing. Idempotent, so the Phase 2 re-scan
   * reaches the objects host `init()`s declared without re-arming anything.
   */
  const armHeldDrivers = (engine: Record<string, unknown>): void => {
    const e = engine as {
      getDefaultDriverName?: () => unknown;
      getDriverByName?: (name: string) => unknown;
      getDriverForObject?: (name: string) => unknown;
      registry?: { getAllObjects?: () => unknown };
    };
    try {
      const name = e.getDefaultDriverName?.();
      if (typeof name === 'string') armDriver(`engine.${name}`, e.getDriverByName?.(name));
    } catch {
      /* an accessor that throws holds nothing this guard can reach */
    }
    if (typeof e.getDriverForObject !== 'function') return;
    let objects: unknown;
    try {
      objects = e.registry?.getAllObjects?.();
    } catch {
      return;
    }
    if (!Array.isArray(objects)) return;
    for (const obj of objects) {
      const objectName = (obj as { name?: unknown } | null | undefined)?.name;
      if (typeof objectName !== 'string') continue;
      let driver: unknown;
      try {
        driver = e.getDriverForObject(objectName);
      } catch {
        continue;
      }
      armDriver(engineLabel(driver), driver);
    }
  };

  /**
   * Shadow `registerDriver` on the engine instance the kernel publishes, so a
   * driver registered by any path — `DatasourceConnectionService.connect()`,
   * `AppPlugin`'s `drivers.register`, `ObjectQL.create` — is armed on
   * arrival. The SAME instance is forwarded: the engine discards a second
   * instance under a held name, so identity is what keeps the engine's
   * registry and the guard's coverage the same set.
   */
  const shadowEngine = (serviceName: string, engine: unknown): void => {
    if (!engine || typeof engine !== 'object') return;
    if (shadowedEngines.has(engine)) return; // `objectql` and `data` are one instance
    const target = engine as Record<string, unknown>;
    const original = target.registerDriver;
    if (typeof original !== 'function') return; // not an engine that registers drivers
    const installed = shadow(
      serviceName,
      target,
      'registerDriver',
      function guardedRegisterDriver(this: unknown, ...args: unknown[]): unknown {
        // Arm BEFORE forwarding: the engine's write path is a call-time
        // lookup on the instance, and a hook may write in the same tick the
        // registration returns.
        armDriver(engineLabel(args[0]), args[0]);
        return Reflect.apply(original as (...a: unknown[]) => unknown, this ?? target, args);
      },
      unshadowable,
    );
    if (!installed) return; // named in `unshadowable`; the outcome line is withheld
    shadowedEngines.set(engine, serviceName);
    armHeldDrivers(target);
  };

  const scan = (ctx: any): void => {
    const services: Map<string, unknown> | undefined = ctx?.getServices?.();
    if (!services || typeof services.entries !== 'function') return;
    // `driver.*` FIRST, so the default keeps the label it always had; the
    // engine's own view of that instance is then already armed and skipped.
    for (const [name, service] of services.entries()) {
      if (typeof name === 'string' && name.startsWith('driver.')) armDriver(name, service);
    }
    for (const [name, service] of services.entries()) {
      if ((ENGINE_SERVICES as readonly string[]).includes(name)) shadowEngine(name, service);
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
    // ONE rule for every path (#14126): the flat claim is printed only when it
    // held across everything the guard can see — nothing forwarded rather
    // than refused (raw execute(), immediate DDL) and nothing it set out to
    // guard refused the override. Each is named below and withholds the
    // sentence; a claim over a write the guard let through is the defect
    // (#14053 review, R1).
    const writesNothingHeld =
      rawExecutions.size === 0 && immediateDdl.size === 0
      && unguardable.size === 0 && unshadowable.size === 0;
    if (refusals.size > 0) {
      const total = [...refusals.values()].reduce((n, r) => n + r.count, 0);
      const detail = [...refusals.values()]
        .map((r) => `${r.method}() on ${r.object}${r.count > 1 ? ` x${r.count}` : ''}`)
        .join(', ');
      parts.push(
        `Refused ${total} write(s) during the declaration boot`
        + `${writesNothingHeld ? ' — a plan writes nothing' : ''}: ${detail}. `
        + 'A plugin in this stack registers a writing hook outside start(); the plan below is '
        + 'unaffected, but that write WOULD have landed on a served boot of the same stack.',
      );
    }
    if (rawExecutions.size > 0) {
      const total = [...rawExecutions.values()].reduce((n, r) => n + r.count, 0);
      const detail = [...rawExecutions.values()]
        .map((r) => `${r.count} via ${r.driver}`)
        .join(', ');
      parts.push(
        `Raw execute() was called ${total} time(s) during the declaration boot (${detail}) and `
        + 'FORWARDED, not refused: a raw command is opaque to this guard — the contract admits '
        + 'any native shape, and SQL text cannot be classified as read-vs-write reliably — so '
        + 'whether this boot wrote is NOT verified, and this run does NOT claim to have '
        + 'written nothing. If those commands only read, nothing was written; if one wrote, it '
        + 'landed. Issue row writes through the contract methods (refused and reported here), '
        + 'or move raw commands out of the boot path.',
      );
    }
    if (immediateDdl.size > 0) {
      const total = [...immediateDdl.values()].reduce((n, d) => n + d.count, 0);
      const detail = [...immediateDdl.values()]
        .map((d) => `${d.method}() on ${d.object} via ${d.driver}${d.count > 1 ? ` x${d.count}` : ''}`)
        .join(', ');
      parts.push(
        `Immediate DDL was called ${total} time(s) during the declaration boot (${detail}) and `
        + 'FORWARDED, not refused: dropTable()/rotateShards() are not held back by the schema '
        + 'deferral, so those calls EXECUTED — this boot changed the physical schema, and this run '
        + 'does NOT claim to have written nothing. A plugin in this stack issues DDL from a hook that '
        + 'runs on a plan; move it out of the boot path, or behind the served boot it belongs to.',
      );
    }
    if (unguardable.size > 0) {
      parts.push(
        `Could NOT guard ${[...unguardable].sort().join(', ')} — the driver refused the override, `
        + 'so calls through those members were neither refused nor reported on this run, and this '
        + 'run does NOT claim to have written nothing.',
      );
    }
    if (unshadowable.size > 0) {
      parts.push(
        `Could NOT shadow ${[...unshadowable].sort().join(', ')} — the engine refused the override, `
        + 'so drivers registered through it during this boot were neither guarded nor reported, and '
        + 'this run does NOT claim to have written nothing.',
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  };

  return {
    plugin,
    get refusals(): readonly RefusedDeclarationWrite[] { return [...refusals.values()]; },
    get rawExecutions(): readonly ForwardedRawExecution[] { return [...rawExecutions.values()]; },
    get immediateDdl(): readonly ForwardedImmediateDdl[] { return [...immediateDdl.values()]; },
    get shadowedEngines(): readonly string[] { return [...shadowedEngines.values()]; },
    disarm(): string | null {
      for (const [target, saved] of armed) {
        for (const [method, original] of saved) {
          if (original) Object.defineProperty(target, method, original);
          else delete (target as Record<string, unknown>)[method];
        }
      }
      armed.clear();
      shadowedEngines.clear();
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
      // The mechanism, not the outcome: whether "a plan writes nothing" HELD
      // is only known once the boot is over, so that sentence belongs to the
      // guard's disarm() note — which drops it if a raw execute() went
      // through (#14053 review, R1) — and must not be pre-claimed here.
      notes.push(
        `Composed the host stack from ${path.relative(cwd, hostConfigPath) || hostConfigPath}: `
        + `${hostPlugins.length} plugin(s), registered for their declarations only `
        + '(init runs, start does not), with the contract\'s row writes refused at the '
        + 'driver for the whole boot.',
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
