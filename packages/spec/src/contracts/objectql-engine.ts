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
 * The engine's schema-registry view — the eight members reached through the
 * `objectql` slot from outside the engine package.
 *
 * ObjectQL exposes the registry as a public `registry` getter over a private
 * `_registry` field. Every consumer belongs on the GETTER: the `/me/apps`
 * handler reaching `_registry` through `as any` while its sibling handler read
 * the public getter (B2), and plugin-security's declared-metadata readers doing
 * the same, are the reaches this view retires.
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
    registerHook(
        event: string,
        handler: (context: any) => Promise<void> | void,
        options?: { object?: string | string[]; priority?: number; packageId?: string },
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

    // ── Transactions (ADR-0118 D1) ───────────────────────────────────────
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
     * TWO CAVEATS ARE PART OF THE DECLARED MEANING (ADR-0118 D1), not
     * behaviour to be discovered: this covers the DEFAULT driver only — objects
     * routed elsewhere by `setDatasourceMapping` are written outside it — and
     * when that driver has no `beginTransaction` the callback runs with NO
     * transaction and NO rollback. A caller that cannot tolerate silently
     * losing atomicity must fail closed itself rather than assume it held; see
     * `batchData`'s atomic gate (ADR-0118 D4). Tightening both is tracked by
     * the ADR's follow-up.
     *
     * `trxCtx`/`baseContext` are the engine-local execution-context shape, left
     * loose here per this file's edge-typing rule; consumers narrow at the call
     * site.
     */
    transaction<T>(callback: (trxCtx: any) => Promise<T>, baseContext?: any): Promise<T>;
}
