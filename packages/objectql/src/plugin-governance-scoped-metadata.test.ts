// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15252] The boot-time action-governance audit reaches a SCOPED metadata
 * service — the C4 cell #14423's ruling left open.
 *
 * ## What was broken
 *
 * `ObjectQLPlugin.runGovernanceInventory` acquired its metadata plane with
 * `ctx.getService('metadata')`. That accessor reads only the two SYNCHRONOUS
 * service maps — the kernel's own `services` and
 * `PluginLoader.getServiceInstance` over `serviceInstances` — while a
 * `ServiceLifecycle.SCOPED` registration mints its instances into
 * `scopedServices`, keyed by scope id. So against a scoped `metadata` the call
 * threw `Service 'metadata' is async - use await` BEFORE `loadMany`,
 * `loadManyKeyed`, `loadDiagnosed` or `load` could run, the plugin swallowed
 * the throw into "no metadata plane at all", and the audit reported that
 * scope's declarations as absent. Silently: an empty declaration set is
 * byte-identical to a plane that holds nothing.
 *
 * The router had no such gap — `HttpDispatcher.resolveService` asks
 * `defaultKernel.getServiceAsync(name, scopeId)` first — so the two sides
 * disagreed about what exists, which is the one thing this audit is for.
 *
 * ## Why every assertion here is about what the audit SAYS
 *
 * The pre-fix failure is silent, so "the audit did not throw" is exactly the
 * state that already existed and pins nothing. Each case below reads the
 * audit's OUTPUT: the scoped declaration named in a warning, the scoped
 * declaration clearing a handler that would otherwise be accused, and the
 * factory log proving which scope was resolved.
 *
 * ## Real vs. doubled
 *
 * Real: `ObjectKernel` + `PluginLoader` scoping and the `PluginContext` it
 * hands plugins (`@objectstack/core`), `ObjectQL` and `ObjectQLPlugin` (this
 * package), `MetadataManager` + `DatabaseLoader` (`@objectstack/metadata`).
 * The audit's service acquisition is therefore the real accessor, not a
 * transcription of it — which is the whole subject.
 *
 * Doubled: the row store under `DatabaseLoader` (a `sys_metadata`-shaped
 * read-only engine, the same double shape
 * `packages/runtime/src/action-governance-scope-divergence.test.ts` uses).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, ServiceLifecycle } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { MetadataManager, DatabaseLoader } from '@objectstack/metadata';
import type { MetadataLoader } from '@objectstack/metadata';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

/** The declaration under test, and the handler key it addresses. */
const ACTION = 'promote_lead';
/** `GLOBAL_ACTION_OBJECT_KEY` — the object-less action's owning key. */
const OBJECT_KEY = 'global';
/** The environment this kernel declares it serves. */
const ENV = 'env_a';

/**
 * A `sys_metadata`-shaped READ-ONLY engine over a fixed row array.
 *
 * Read-only on purpose: `DatabaseLoader`'s read paths call `find` / `findOne`
 * / `count` and nothing else, so a double that also declared `update` /
 * `delete` would be declaring dispatch surface this fixture never exercises.
 *
 * The WHERE matcher REFUSES what it does not implement rather than reading a
 * combinator as a field name (`check:where-matcher`'s conforming shape), and
 * `find` applies the caller's `limit` by PRESENCE
 * (`check:objectql-double-limit`) — a double that ignores it answers more rows
 * than the real engine would.
 */
function readEngine(rows: Array<Record<string, unknown>>) {
    const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`readEngine: unsupported WHERE combinator '${k}'`);
            if (v !== null && typeof v === 'object') throw new Error(`readEngine: unsupported WHERE operator on '${k}'`);
            return r[k] === v;
        });
    return {
        async find(table: string, q: any) {
            void table;
            const hits = rows.filter((r) => matches(r, q?.where ?? {}));
            return typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        async findOne(table: string, q: any) {
            // `check:engine-double-contract`: a fake whose findOne is looser
            // than `ObjectQL.findOne` is how a dead route ships with a green
            // suite. Route the predicate through the shared assertion.
            assertEngineFindOnePredicate(table, q);
            return rows.find((r) => matches(r, q?.where ?? {})) ?? null;
        },
        async count(_table: string, q: any) {
            return rows.filter((r) => matches(r, q?.where ?? {})).length;
        },
    };
}

/** A `sys_metadata` row: identity in the `name` COLUMN, body in `metadata`. */
function row(name: string, body: Record<string, unknown>) {
    return {
        id: `md_${name}`,
        name,
        type: 'action',
        namespace: 'default',
        scope: 'platform',
        state: 'active',
        version: 1,
        metadata: JSON.stringify(body),
    };
}

/** A real `MetadataManager` over a real `DatabaseLoader` over `rows`. */
function planeOver(rows: Array<Record<string, unknown>>): MetadataManager {
    const mgr = new MetadataManager({});
    mgr.registerLoader(new DatabaseLoader({
        engine: readEngine(rows) as any,
        trackHistory: false,
        cache: { enabled: false },
    } as any) as unknown as MetadataLoader);
    return mgr;
}

/** The declaration body: a `script` action with no `body` and no `target`. */
const declaration = () => ({ name: ACTION, type: 'script', label: 'Promote lead' });

interface Recorded {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    args: unknown[];
}

/** The four levels the audit and the engine write through, and nothing else. */
type RecordingLogger = Record<Recorded['level'], (message: string, ...args: unknown[]) => void>;

function recordingLogger() {
    const records: Recorded[] = [];
    const push = (level: Recorded['level']) => (message: string, ...args: unknown[]) =>
        void records.push({ level, message: String(message), args });
    return {
        records,
        logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
        at(level: Recorded['level']) {
            return records.filter((r) => r.level === level);
        },
    };
}

const UNDECLARED = /registered handlers with NO declaration/;
const UNBOUND = /declared script actions with NO handler/;

/** Did the audit accuse `OBJECT_KEY:ACTION` of being a handler with no declaration? */
function accused(rec: ReturnType<typeof recordingLogger>): boolean {
    return rec.at('warn').some((r) =>
        UNDECLARED.test(r.message) &&
        ((r.args[0] as { handlers?: string[] } | undefined)?.handlers ?? []).includes(`${OBJECT_KEY}:${ACTION}`));
}

/** Did the audit REPORT `OBJECT_KEY:ACTION` as a declaration nothing binds? */
function reportedUnbound(rec: ReturnType<typeof recordingLogger>): boolean {
    return rec.at('warn').some((r) =>
        UNBOUND.test(r.message) &&
        ((r.args[0] as { actions?: string[] } | undefined)?.actions ?? []).includes(`${OBJECT_KEY}:${ACTION}`));
}

/**
 * Captures the REAL `PluginContext` the kernel hands its plugins.
 *
 * The audit's service acquisition is the subject here, so the context it runs
 * on has to be the kernel's own — `context.getService` and
 * `context.getServiceScoped` as `ObjectKernel` builds them, over the same
 * `PluginLoader` the dispatcher's `getServiceAsync` reads. Nothing about them
 * is re-spelled in this file.
 */
class ContextProbe implements Plugin {
    name = 'test.governance-scoped-metadata.context-probe';
    version = '1.0.0';
    captured: PluginContext | undefined;
    init = async (ctx: PluginContext): Promise<void> => {
        this.captured = ctx;
    };
}

/**
 * The kernel's real context with ONLY the logger swapped, so the audit's
 * warnings can be read back. `Object.create` rather than a rebuild: every
 * accessor still resolves to the kernel's own through the prototype chain, so
 * this substitutes nothing the test is measuring.
 */
function auditContext(real: PluginContext, logger: RecordingLogger): PluginContext {
    return Object.assign(Object.create(real as object) as PluginContext, { logger });
}

/**
 * Compose the kernel, the plane and the plugin, and hand back everything the
 * cases read.
 *
 * ⚠️ `registerMetadata` runs BEFORE `bootstrap()`, and it has to: the kernel
 * pre-injects `createMemoryMetadata` for any `metadata` slot still empty at
 * Phase 2 (`preInjectCoreFallbacks`, `metadata: 'core'`), so a plane registered
 * afterwards would be auditing beside a fallback rather than instead of one —
 * and a real composition registers its plane in a plugin's `init()`, which is
 * Phase 1. `data` is the kernel's one `required` slot and the engine is what
 * fills it in every real composition (`ctx.registerService('data', this.ql)`),
 * so it is filled with the engine itself rather than a stand-in.
 */
async function compose(opts: {
    handler: boolean;
    environmentId?: string;
    registerMetadata: (kernel: ObjectKernel) => void;
}): Promise<{
    kernel: ObjectKernel;
    rec: ReturnType<typeof recordingLogger>;
    plugin: ObjectQLPlugin;
    ctx: PluginContext;
}> {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    if (opts.handler) engine.registerAction(OBJECT_KEY, ACTION, async () => 1);

    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernel.registerService('data', engine);
    opts.registerMetadata(kernel);

    const probe = new ContextProbe();
    await kernel.use(probe);
    await kernel.bootstrap();
    if (!probe.captured) throw new Error('the kernel handed the probe no PluginContext');

    const plugin = new ObjectQLPlugin({ ql: engine, environmentId: opts.environmentId });
    return { kernel, rec, plugin, ctx: auditContext(probe.captured, rec.logger) };
}

/** Run the audit exactly as `kernel:ready` runs it. */
async function runAudit(plugin: ObjectQLPlugin, ctx: PluginContext): Promise<void> {
    await (plugin as unknown as { runGovernanceInventory(c: PluginContext): Promise<void> })
        .runGovernanceInventory(ctx);
}

describe('#15252 — the boot-time governance audit reads the SCOPED metadata plane', () => {
    let live: ObjectKernel | undefined;

    afterEach(async () => {
        if (live && live.getState() === 'running') await live.shutdown();
        live = undefined;
    });

    /**
     * A scoped factory that mints ONE `MetadataManager` per scope id and
     * records every scope it was asked for. Only `ENV` carries the
     * declaration; every other scope is empty — so an audit that resolves the
     * wrong scope, or none, cannot pass by accident.
     */
    function scopedMetadata() {
        const asked: string[] = [];
        const minted = new Map<string, MetadataManager>();
        const register = (kernel: ObjectKernel) => {
            kernel.registerServiceFactory(
                'metadata',
                (_ctx: unknown, scopeId?: string) => {
                    const key = scopeId ?? '<unscoped>';
                    asked.push(key);
                    if (!minted.has(key)) {
                        minted.set(key, planeOver(key === ENV ? [row(ACTION, declaration())] : []));
                    }
                    return minted.get(key)!;
                },
                ServiceLifecycle.SCOPED,
            );
        };
        return { asked, minted, register };
    }

    /**
     * THE CARD'S ACCEPTANCE BAR: "a fixture that composes a scoped metadata
     * service and asserts the audit REPORTS its declarations".
     *
     * The scoped plane holds one `script` declaration with no `body` and no
     * handler anywhere — a button wired to nothing, which ADR-0110 D5's
     * `unboundDeclarations` finding exists to name. So the audit must print
     * that name. Before the fix the plane was unreachable, the declaration set
     * was empty, and the audit printed NOTHING — which is why "no error was
     * thrown" is not the assertion here.
     */
    it('REPORTS a declaration that exists only in the scoped plane, by name', async () => {
        const scoped = scopedMetadata();
        const { kernel, rec, plugin, ctx } = await compose({
            handler: false, environmentId: ENV, registerMetadata: scoped.register,
        });
        live = kernel;

        await runAudit(plugin, ctx);

        expect(reportedUnbound(rec)).toBe(true);
        // …and it reached that answer through the scope this kernel declares.
        expect(scoped.asked).toEqual([ENV]);
    });

    /**
     * The C4 symptom, from the other side: a handler the router dispatches
     * (its declaration is in the scoped plane) was reported as "registered
     * handler with NO declaration … REFUSED at dispatch" — an accusation
     * against a healthy deployment. The scoped read clears it.
     */
    it('does NOT accuse a handler whose only declaration lives in the scoped plane', async () => {
        const scoped = scopedMetadata();
        const { kernel, rec, plugin, ctx } = await compose({
            handler: true, environmentId: ENV, registerMetadata: scoped.register,
        });
        live = kernel;

        await runAudit(plugin, ctx);

        expect(accused(rec)).toBe(false);
        // The declaration IS bound now, so neither finding fires at all.
        expect(reportedUnbound(rec)).toBe(false);
    });

    /**
     * IDENTITY — the deciding property, and the reason the awaited resolution
     * was taken over an injected reader. `ctx.getServiceScoped(name, scopeId)`
     * and the dispatcher's `defaultKernel.getServiceAsync(name, scopeId)` both
     * land on `PluginLoader.getService`, which caches per scope. So the object
     * the audit read IS the object the router resolves through — not an equal
     * one, and not a second instance minted beside it.
     */
    it('reads the SAME instance the router resolves through, and mints no second one', async () => {
        const scoped = scopedMetadata();
        const { kernel, plugin, ctx } = await compose({
            handler: true, environmentId: ENV, registerMetadata: scoped.register,
        });
        live = kernel;

        await runAudit(plugin, ctx);

        // The audit is what caused the mint — before the fix this array is empty.
        expect(scoped.asked).toEqual([ENV]);
        const auditPlane = scoped.minted.get(ENV);
        expect(auditPlane).toBeInstanceOf(MetadataManager);

        // The router's own resolution, unchanged: the dispatcher's scoped branch.
        const routerPlane = await kernel.getServiceAsync<MetadataManager>('metadata', ENV);
        expect(routerPlane).toBe(auditPlane);
        expect(scoped.asked).toEqual([ENV]); // still one mint — nothing was duplicated
        // And that shared instance really does serve the declaration.
        expect((await routerPlane.loadManyKeyed<unknown>('action')).map((e) => e.name)).toEqual([ACTION]);
    });

    /**
     * REGRESSION GUARD for every shipped composition. `metadata` is a STATIC
     * instance today (`packages/metadata/src/plugin.ts`), and a kernel can
     * declare an `environmentId` beside it — `os dev` boots as `'env_local'`.
     * The scoped attempt must not shadow that plane: `registerService` writes
     * `PluginLoader.serviceInstances` as well as the kernel map, so the scoped
     * lookup answers with the very same object rather than missing it.
     */
    it('still reads a STATICALLY registered plane on a kernel that declares an environmentId', async () => {
        const plane = planeOver([row(ACTION, declaration())]);
        const { kernel, rec, plugin, ctx } = await compose({
            handler: false,
            environmentId: ENV,
            registerMetadata: (k) => k.registerService('metadata', plane),
        });
        live = kernel;

        await runAudit(plugin, ctx);

        expect(reportedUnbound(rec)).toBe(true);
        expect(await kernel.getServiceAsync<MetadataManager>('metadata', ENV)).toBe(plane);
    });

    /**
     * THE BOUNDARY THAT REMAINS, pinned so it is not re-filed as this defect.
     * A kernel serving several environments declares no single `environmentId`,
     * so a boot-time audit has no scope to name and the synchronous lookup
     * stands — it reports the handler as undeclared, and that is the honest
     * answer for an audit that cannot know which scope it is auditing.
     * Auditing per environment is a different inventory with a different
     * lifecycle. Warn-only and exception-proof throughout.
     */
    it('BOUNDARY — with no declared environmentId there is no scope to ask for, and the audit says so', async () => {
        const scoped = scopedMetadata();
        const { kernel, rec, plugin, ctx } = await compose({
            handler: true, registerMetadata: scoped.register,
        });
        live = kernel;

        await expect(runAudit(plugin, ctx)).resolves.toBeUndefined();

        expect(scoped.asked).toEqual([]);  // nothing was minted — no scope was named
        expect(accused(rec)).toBe(true);   // …and the audit reports what it could not clear
    });
});
