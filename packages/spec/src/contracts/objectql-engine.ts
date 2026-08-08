// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `IObjectQLEngine` — the contract of the `objectql` service slot: the FULL
 * engine, where the `data` slot is the same instance seen as `IDataEngine`.
 *
 * ## Why this exists (#4251, closing the #4127-batch-4 record)
 *
 * ObjectQL registers ONE instance under two names — `data` ("ObjectQL
 * implements IDataEngine", its registration comment) and `objectql`. The slot
 * ledger mapped both to `IDataEngine`, and the standing record on
 * `DomainHandlerContext.getObjectQL` explained the remainder honestly: ObjectQL
 * is genuinely wider than `IDataEngine`, nobody had written a contract for the
 * wider part, and typing the whole thing `IDataEngine` would be "the more
 * comfortable-looking lie" — so that accessor stayed `any`, and every consumer
 * of the wider surface declared its own local slice (`AppEngineSurface`,
 * `EngineRegistrySurface`, `EngineExtensionSurface`, `SecurityEngineSurface`,
 * `FreshDatastoreEngine`, …).
 *
 * Seven such local surfaces later, the problem inverted: each was an honest
 * but UNCHECKED claim — `getService<EngineRegistrySurface>('objectql')` is an
 * assertion, and nothing tied any of them to the class, so an engine rename
 * would break every consumer at runtime with zero compile errors. This file is
 * those surfaces merged, deduplicated, and made checkable: `ObjectQL` declares
 * `implements IObjectQLEngine`, so every member here is verified against the
 * implementation on every build, and consumers import ONE declaration instead
 * of maintaining seven.
 *
 * ## The evidence bar (unchanged from the ledger)
 *
 * A member is declared here only where a CROSS-PACKAGE consumer already calls
 * it through the service slot — this is the union of what the deleted local
 * surfaces declared plus the dispatcher's recorded needs (`registry`,
 * `executeAction`), not a transcription of the class. Engine members without
 * such a consumer (e.g. `triggerHooks`, used cross-package only by tests that
 * can import the class) stay OFF the contract until one appears. Widening this
 * is for whoever needs more, with the call site to prove it.
 *
 * ## Types are deliberately loose at the edges
 *
 * Where the real parameter/return types are `packages/objectql`-local
 * (`ServiceObject`, `HookContext`, `InstalledPackage`), the contract says
 * `unknown`/`any` rather than importing them — spec must not depend on the
 * engine package. Consumers that need the shape narrow at the call site, as
 * they always have.
 */

import type { IDataEngine } from './data-engine';
import type { IDataDriver } from './data-driver';
import type { FlowFunctionEffect, FlowFunctionEntry } from '../automation/flow-function.zod';

/**
 * The engine's schema-registry view — the members reached through the
 * `objectql` slot from outside the engine package.
 *
 * ObjectQL exposes the registry as a public `registry` getter over a private
 * `_registry` field. Every consumer belongs on the GETTER: the `/me/apps`
 * handler reaching `_registry` through `as any` while its sibling handler read
 * the public getter (B2), and plugin-security's declared-metadata readers doing
 * the same, are the reaches this view retires.
 *
 * The package-lifecycle block below was missing from the original eight (#4404)
 * and added by #4311's runtime slice. `SchemaRegistry` has always implemented
 * all six; three packages outside the engine have always called them — the
 * `/packages` domain handler in `runtime` (the REST owner of the whole family),
 * `metadata-protocol`'s install/update primitives, and `service-package`'s
 * hydration. Nothing caught the omission because `runtime` had no `typecheck`
 * script, which is #4311's thesis in one line: the narrowing compiled only
 * because no `tsc` ever read the caller.
 */
export interface EngineSchemaRegistryView {
    /** The registered object schema, or `undefined`. */
    getObject(name: string): unknown;
    /** Every registered object schema, optionally scoped to one package. */
    getAllObjects(packageId?: string): unknown[];
    /** Every registered app, nav contributions merged — the `/me/apps` authority. */
    getAllApps(): unknown[];
    /** A registered metadata item by type + name (package-scoped resolution). */
    getItem<T>(type: string, name: string, currentPackageId?: string): T | undefined;
    /** Every registered metadata item of a type, optionally scoped to one package. */
    listItems<T>(type: string, packageId?: string): T[];
    /** Every installed package manifest. */
    getAllPackages(): unknown[];
    /** Remove one registered metadata item (plugin-security's projection cleanup). */
    unregisterItem(type: string, name: string): void;
    /** Seed the persisted disabled-package set before artifact load (AppPlugin boot). */
    setInitialDisabledPackageIds(ids: Iterable<string>): void;

    // ── Package lifecycle (the in-memory half of `/packages`) ────────────
    // The durable half lives in `sys_packages` and is the protocol service's;
    // these six are the registry side the REST handlers fall back to and the
    // protocol service writes through.
    /** One installed package by id, or `undefined` — the duplicate-install guard's reader. */
    getPackage(id: string): unknown;
    /** Register a package manifest in the in-memory registry. */
    installPackage(manifest: unknown, settings?: Record<string, unknown>): unknown;
    /** Drop a package from the registry; `false` when no package had that id. */
    uninstallPackage(id: string): boolean;
    /** Flip a package to enabled; `undefined` when no package had that id. */
    enablePackage(id: string): unknown;
    /** Flip a package to disabled; `undefined` when no package had that id. */
    disablePackage(id: string): unknown;
    /** Merge the human-editable manifest fields (name / description / version) — a metadata edit, not a reinstall. */
    updatePackageManifest(
        id: string,
        patch: { name?: string; description?: string; version?: string },
    ): unknown;
}

/**
 * Options for {@link IObjectQLEngine.transaction} (#5696 — the tightening half
 * of #4619, revising ADR-0119 D1).
 *
 * One member today, deliberately: the surface grows when a consumer proves it
 * needs more, the same evidence bar this file's header sets for members.
 */
export interface EngineTransactionOptions {
    /**
     * Fail CLOSED when the datasource cannot give a real transaction.
     *
     * Default (`undefined` / `false`) keeps ADR-0119 D1's declared degrade: a
     * driver without `beginTransaction` runs the callback with no transaction
     * and no rollback, warning once. That degrade is right for callers who can
     * live without atomicity (test doubles, in-memory drivers) and wrong for
     * callers whose whole reason to open a transaction is the rollback.
     *
     * With `require: true` the engine THROWS instead of degrading, before the
     * callback runs — so a caller that cannot tolerate losing atomicity states
     * it once, at the call site, instead of re-deriving `batchData`'s probe.
     * That probe is the precedent being generalized here (ADR-0119 D4, cited in
     * older text as ADR-0118 D4 — see that ADR's renumbering note): an `atomic`
     * request refuses rather than silently running best-effort.
     */
    require?: boolean;
}

/**
 * What {@link IObjectQLEngine.transaction} tells its callback about the
 * transaction the callback is running in (#5696).
 */
export interface EngineTransactionInfo {
    /**
     * `true` when THIS call opened the transaction and therefore owns its
     * commit/rollback; `false` when it JOINED an already-open ambient one
     * (ADR-0067 D2) and some outer caller owns the outcome.
     *
     * The join is correct and stays — a nested `begin` would take a second
     * connection (deadlocking a single-connection SQLite pool) and would not be
     * covered by the outer rollback. What was missing is that the callback
     * could not TELL: a joined callback's `throw` unwinds work the outer owner
     * may still commit or roll back on its own terms, and guarantees phrased
     * as "this whole unit rolls back together" (`batchData`'s rollback
     * response, ADR-0119 D4) hold only for the owner. A callback that must not
     * promise what it does not control reads `owned` and says so.
     */
    owned: boolean;
}

/**
 * The full ObjectQL engine, as the `objectql` slot's consumers use it.
 *
 * Members beyond {@link IDataEngine} are REQUIRED, not optional: `ObjectQL`
 * implements every one (checked by `implements`), and this contract describes
 * THAT engine — the slot's actual occupant — not a hypothetical minimal one.
 * Callers that tolerate test doubles or foreign engines keep their runtime
 * probes (`typeof ql.registerHook === 'function'`), which is defence the type
 * system does not replace; marking members optional here would only turn every
 * guarded call into a `possibly undefined` error and push code back toward the
 * `any` this contract exists to remove.
 */
export interface IObjectQLEngine extends IDataEngine {
    // ── Schema access ────────────────────────────────────────────────────
    /** The registered schema for an object, or `undefined` — the write guards' `managedBy` source. */
    getSchema(objectName: string): unknown;
    /** Engine-level alias of {@link EngineSchemaRegistryView.getObject} (the migration-flag reader's shape). */
    getObject(name: string): unknown;
    /** The schema registry — see {@link EngineSchemaRegistryView}. */
    readonly registry: EngineSchemaRegistryView;

    // ── Actions ──────────────────────────────────────────────────────────
    registerAction(objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName?: string): void;
    removeActionsByPackage(packageName: string): void;
    /** The dispatcher's action path — one of the two members `getObjectQL` was recorded as needing. */
    executeAction(objectName: string, actionName: string, ctx: any): Promise<any>;

    // ── Hook / middleware seams ──────────────────────────────────────────
    /**
     * Register a code-path hook.
     *
     * `object` is an ALLOW list (absent = global, `'*'` = every object);
     * `excludeObjects` subtracts from whatever that admits, so the scope a
     * registration expresses is
     * `matches(entry, X) = allowMatches(entry, X) && !excludeMatches(entry, X)`.
     *
     * The subtraction half exists because an allow list cannot express "global,
     * except these" over an OPEN universe (#5928): `/meta` PUT registers new
     * objects into a live engine, so a registrant that enumerated the complement
     * of its skip list would silently stop covering every object created after
     * boot — the compliance-relevant direction of that failure is what ruled the
     * enumerate-the-complement option out. Declared here rather than left to a
     * predicate callback so the scope stays static, printable in the
     * registration log, and introspectable.
     *
     * NOT mirrored onto the authorable `HookSchema` (`data/hook.zod.ts`): the
     * consumer is plugin code, and no metadata author needs "global minus a
     * list" today.
     */
    registerHook(
        event: string,
        handler: (context: any) => Promise<void> | void,
        options?: {
            object?: string | string[];
            /** Object name(s) subtracted from `object`'s admitted set (#5928). */
            excludeObjects?: string | string[];
            priority?: number;
            packageId?: string;
        },
    ): void;
    unregisterHooksByPackage(packageId: string): number;
    /**
     * The third parameter is the owning `packageId`, or a record that also
     * carries what the function DECLARES about itself (#4396) — today its data
     * `effect`, which a `script` node reads back to report its run honestly.
     */
    registerFunction(
        name: string,
        handler: (context: any) => Promise<void> | void,
        packageIdOrOptions?: string | { packageId?: string; effect?: FlowFunctionEffect },
    ): void;
    registerMiddleware(
        fn: (opCtx: any, next: () => Promise<void>) => Promise<void>,
        options?: { object?: string },
    ): void;
    /** Bind declarative Hook metadata — AppPlugin's app-bundle path. */
    bindHooks(
        hooks: unknown[] | undefined,
        opts?: {
            packageId?: string;
            /** Handlers, or declaration records stating each function's effect (#4396). */
            functions?: Record<string, FlowFunctionEntry>;
            bodyRunner?: unknown;
            strict?: boolean;
            warnLegacyHandler?: boolean;
            metrics?: unknown;
        },
    ): void;

    // ── Default runners & hook metrics (first-wins setters, #4251) ───────
    setDefaultBodyRunner(runner: any): boolean;
    getDefaultBodyRunner(): any;
    setDefaultActionRunner(runner: (actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined): boolean;
    getDefaultActionRunner(): ((actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined) | undefined;
    setHookMetricsRecorder(recorder: unknown): void;
    getHookMetricsRecorder(): any;

    // ── Boot-time wiring (AppPlugin / metadata-protocol) ─────────────────
    /** Register a driver; the optional second argument makes it the default. */
    registerDriver(driver: IDataDriver, isDefault?: boolean): void;
    /** Install the stack's datasource-mapping rules. Rule shape is engine-local; see `setDatasourceMapping` on the class. */
    setDatasourceMapping(rules: unknown[]): void;
    /** Register an app/plugin manifest (objects, apps, metadata items) — MetadataProtocolPlugin's table-provisioning path. */
    registerApp(manifest: any): void;

    // ── Operations ───────────────────────────────────────────────────────
    /** Per-driver health probe — the readiness gate's source. A driver with no probe reports healthy. */
    checkDriversHealth(opts?: { timeoutMs?: number }): Promise<Array<{ driverName: string; healthy: boolean }>>;
    /** True when this boot created the datastore from empty — platform-objects' fresh-datastore attestation. */
    wasDatastoreCreatedFromEmpty(): boolean;
    /** Drop the memoized migration-flag reads (the attestation may race a fast boot's first read). */
    invalidateDataMigrationFlags(): void;

    // ── Transactions (ADR-0119 D1, revised by #5696/#5351) ───────────────
    /**
     * Run `callback` inside ONE driver transaction — the ADR-0034 ambient
     * transaction. The callback receives a context carrying the handle, which
     * callers thread to downstream engine calls as `{ context: trxCtx }`;
     * operations issued during the callback ALSO bind to it ambiently
     * (`AsyncLocalStorage`), so hook bodies, validation predicates and internal
     * reference reads reuse the transaction's connection without threading it
     * by hand. Commit on resolve, rollback and re-throw on reject. A nested
     * call JOINS the open transaction rather than opening a second one, leaving
     * the outermost caller the sole owner of commit/rollback (ADR-0067 D2).
     *
     * Declared here under this file's evidence bar — three cross-package
     * consumers already call it through the slot, each having reached around
     * the type system to do so: the metadata protocol's atomic publish
     * (`publishPackageDrafts`) and its `transactionalBatch` discovery probe,
     * and the sys-metadata repository's `withTxn`. REQUIRED per this file's
     * header; callers that tolerate test doubles keep their runtime
     * `typeof === 'function'` probes, which types do not replace.
     *
     * ## The transaction still covers ONE datasource — but no longer silently
     *
     * A transaction is opened on the DEFAULT driver and covers only that
     * driver's connection; cross-driver atomicity is NOT provided (no
     * two-phase commit — deliberately out of scope, #4619). What changes with
     * #5696/#5351 is what happens to a write inside the transaction that
     * routes somewhere else. Until v17 the engine handed the OTHER driver the
     * default driver's transaction handle unconditionally, so the statement
     * executed on the wrong connection — the text here used to say such writes
     * ran "outside" the transaction, which measurement disproved (#5351: on a
     * real SQL driver the write reached a database that has no such table, and
     * the row was lost with only a log line behind it). The engine now compares
     * the resolved driver against the transaction's OWNER (by instance
     * identity) and takes one of two paths:
     *
     * - **Business writes are REFUSED**, loudly and by name, instead of
     *   silently partially committing. The caller chooses explicitly: keep the
     *   objects of one transaction on one datasource, or split the work into
     *   per-datasource units and reconcile them. Refusing is the point — a
     *   caller who asked for atomicity must not be handed best-effort without
     *   being told (the same posture as `batchData`'s atomic gate).
     * - **System writes carved out (#5351)**: objects whose `lifecycle.class`
     *   is `audit` / `telemetry` / `event` — the append-only ledgers ADR-0057
     *   §3.6 routes to a dedicated datasource — are executed OUTSIDE the
     *   ambient transaction, on their own connection, with NO handle from
     *   another driver. They therefore SURVIVE a rollback of the business
     *   transaction ("orphan rows"): an audit row may describe a write that was
     *   rolled back. That is the deliberate direction of error for an
     *   append-only compliance ledger — an extra reconcilable row beats a
     *   missing row for a write that DID commit — and it is what lets a hook
     *   author write an ordinary `afterInsert` audit hook without knowing
     *   datasource routing exists. Recorded in the ADR-0067/ADR-0119 revision.
     *
     * ## The degrade is now a caller's choice, not a fixed caveat
     *
     * When the default driver has no `beginTransaction`, the callback still
     * runs with NO transaction and NO rollback (warning once) — unchanged, and
     * still declared. `opts.require: true` turns that degrade into a THROW for
     * callers who cannot tolerate it; see {@link EngineTransactionOptions}.
     *
     * ## The callback is told whether it owns the transaction
     *
     * The second callback argument carries `owned` — `true` when this call
     * opened the transaction, `false` when it joined an outer one (ADR-0067
     * D2). See {@link EngineTransactionInfo}. Existing one-argument callbacks
     * are unaffected.
     *
     * `trxCtx`/`baseContext` are the engine-local execution-context shape, left
     * loose here per this file's edge-typing rule; consumers narrow at the call
     * site.
     */
    transaction<T>(
        callback: (trxCtx: any, info: EngineTransactionInfo) => Promise<T>,
        baseContext?: any,
        opts?: EngineTransactionOptions,
    ): Promise<T>;
}
