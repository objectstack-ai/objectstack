// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Durable suspended-run wiring (#4420).
 *
 * The persistence itself (#1518) was never the missing piece — the store, the
 * `sys_automation_run` object and the cold-boot rehydrate all shipped. What
 * failed was the WIRING, because the two halves resolve different services in
 * different phases: `init()` registers the object with `manifest`, `start()`
 * attaches the store on the strength of `objectql`. Composed ahead of
 * ObjectQL, the first half silently lost (warn, continue) while the second
 * still succeeded — a durable store writing to a table nobody had created.
 * Every pause then failed into a log line nobody read, and every in-flight
 * approval died at the next restart while reporting perfect health.
 *
 * These pin the contract that closes it: the object reaches `manifest`, and a
 * store is NEVER attached when it did not.
 */

import { describe, it, expect } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import type { SuspendedRunStoreEngine } from './suspended-run-store.js';

/** Rows keyed by id — stands in for the `sys_automation_run` table. */
function fakeDataEngine(opts: { failReads?: string } = {}) {
    const rows = new Map<string, any>();
    const engine: SuspendedRunStoreEngine & { rows: Map<string, any> } = {
        rows,
        async find(_object, options) {
            if (opts.failReads) throw new Error(opts.failReads);
            const where = options?.where ?? {};
            return [...rows.values()].filter(r =>
                Object.entries(where).every(([k, v]) => r[k] === v));
        },
        async insert(_object, data) { rows.set(String(data.id), { ...data }); return data; },
        async update(_object, data, options) {
            const id = options?.where?.id ?? data.id;
            rows.set(String(id), { ...(rows.get(String(id)) ?? { id }), ...data });
            return rows.get(String(id));
        },
        async delete(_object, options) { rows.delete(String(options?.where?.id)); return true; },
    };
    return engine;
}

/** Captures what a plugin hands the `manifest` service. */
function recordingManifest() {
    const registered: any[] = [];
    return { registered, register(m: any) { registered.push(m); } };
}

type LogLine = { level: string; msg: string; meta?: Record<string, any> };

/**
 * #5661 — the sink now keeps `meta` as well as the message.
 *
 * It used to record `String(msg)` only, which was enough while every cause was
 * interpolated INTO the message. Once the probe seam moved its cause to the
 * logger's structured argument, a message-only sink could no longer tell "the
 * cause was reported in meta" from "the cause was lost" — both read as an
 * absent match. The two levels take it in different slots, per the `Logger`
 * contract: `warn(message, meta?)` and `error(message, error?, meta?)`.
 */
function capturingLogger(sink: LogLine[]): any {
    const metaLevel = (level: string) => (msg: any, meta?: Record<string, any>) =>
        sink.push({ level, msg: String(msg), meta });
    const errorLike = (level: string) =>
        (msg: any, errorOrMeta?: unknown, meta?: Record<string, any>) =>
            sink.push({
                level,
                msg: String(msg),
                meta: meta ?? (errorOrMeta instanceof Error ? undefined : (errorOrMeta as any)),
            });
    return {
        info: metaLevel('info'), warn: metaLevel('warn'),
        error: errorLike('error'), debug: metaLevel('debug'),
        child() { return capturingLogger(sink); },
    };
}

/**
 * The slice of `PluginContext` this plugin touches. `services` is mutable so a
 * test can add one BETWEEN init() and start() — which is precisely the
 * composition shape at issue: ObjectQL initializing after automation.
 */
function pluginCtx(services: Map<string, unknown>, logs: LogLine[]): any {
    return {
        logger: capturingLogger(logs),
        getService(name: string) {
            if (services.has(name)) return services.get(name);
            throw new Error(`Service '${name}' not registered`);
        },
        registerService(name: string, svc: unknown) { services.set(name, svc); },
        hook() {},
        async trigger() {},
    };
}

/** A flow that parks at a pausing node, so a suspend is observable end to end. */
const PAUSE_FLOW = {
    name: 'needs_approval',
    label: 'needs_approval',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'pause', type: 'test_pause', label: 'Pause' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'pause' },
        { id: 'e2', source: 'pause', target: 'end' },
    ],
};

/** Park a run at a pausing node and report where its state went. */
async function pauseARun(engine: AutomationEngine) {
    engine.registerNodeExecutor({
        type: 'test_pause',
        descriptor: defineActionDescriptor({
            type: 'test_pause', version: '1.0.0', name: 'Test Pause',
            supportsPause: true,
        }),
        async execute() { return { success: true, suspend: true, correlation: 'areq_1' }; },
    });
    engine.registerFlow('needs_approval', PAUSE_FLOW as never);
    const paused = await engine.execute('needs_approval');
    expect(paused.status).toBe('paused');
    return paused.runId!;
}

/**
 * Run the plugin's lifecycle over a context whose services appear in a chosen
 * phase.
 *
 * @param manifestPhase - `'init'`: a well-ordered composition. `'start'`:
 *   ObjectQL initializing AFTER automation, so `manifest` is absent during
 *   init() but present by start() — the #4420 hole. `'never'`: a host with no
 *   manifest service at all.
 */
async function runLifecycle(opts: {
    manifestPhase: 'init' | 'start' | 'never';
    data?: SuspendedRunStoreEngine | null;
    suspendedRunStore?: 'auto' | 'memory';
}) {
    const logs: LogLine[] = [];
    const services = new Map<string, unknown>();
    const manifest = recordingManifest();
    const ctx = pluginCtx(services, logs);

    // The data engine tracks the same phase as `manifest` (they come from the
    // same plugin), except under `'never'` — a host that has an engine but no
    // manifest service is exactly the composition that used to end up with a
    // store over an unregistered object.
    const dataPhase = opts.manifestPhase === 'start' ? 'start' : 'init';
    if (opts.manifestPhase === 'init') services.set('manifest', manifest);
    if (opts.data && dataPhase === 'init') services.set('objectql', opts.data);

    const plugin = new AutomationServicePlugin(
        opts.suspendedRunStore ? { suspendedRunStore: opts.suspendedRunStore } : {},
    );
    await plugin.init(ctx);

    if (opts.manifestPhase === 'start') services.set('manifest', manifest);
    if (opts.data && dataPhase === 'start') services.set('objectql', opts.data);
    await plugin.start(ctx);

    return {
        manifest, logs,
        engine: services.get('automation') as AutomationEngine,
        errors: () => logs.filter(l => l.level === 'error').map(l => l.msg).join('\n'),
        /**
         * One `error` record, picked by a prefix of its message (#5661).
         *
         * Needed because an unreadable table trips TWO seams — this plugin's
         * boot probe and, further down, `wait-node.ts`'s own `[wait] … re-arm
         * ABORTED` record, which still interpolates its cause. Asserting over
         * the joined text cannot tell which seam a match came from.
         */
        errorRecord: (prefix: string) =>
            logs.find(l => l.level === 'error' && l.msg.startsWith(prefix)),
        registeredObjects: () =>
            manifest.registered.flatMap(m => m.objects ?? []).map((o: any) => o.name),
    };
}

describe('durable suspended-run wiring (#4420)', () => {
    it('registers sys_automation_run and persists a pause in a normal composition', async () => {
        const data = fakeDataEngine();
        const h = await runLifecycle({ manifestPhase: 'init', data });

        expect(h.registeredObjects()).toContain('sys_automation_run');

        // The proof that matters is not "a store was attached" but "the pause
        // reached the table" — the exact step that failed silently in rc.1.
        const runId = await pauseARun(h.engine);
        expect(data.rows.get(runId)).toMatchObject({ status: 'paused', flow_name: 'needs_approval' });
        expect(h.errors()).toBe('');
    });

    it('refuses the durable store, loudly, when the object was never registered', async () => {
        // A data engine but no manifest, ever: the table can never exist, so a
        // store here could only fail every write.
        const data = fakeDataEngine();
        const h = await runLifecycle({ manifestPhase: 'never', data });

        const runId = await pauseARun(h.engine);
        expect(data.rows.size, 'no store attached ⇒ nothing written').toBe(0);
        expect(runId, 'the run still pauses — in memory, as before').toBeTruthy();
        expect(h.errors()).toMatch(/sys_automation_run was never registered/);
        // The degradation is stated in the terms an operator acts on.
        expect(h.errors()).toMatch(/will NOT survive a restart/);
    });

    it('recovers registration at start() when manifest arrives late', async () => {
        // ObjectQL initializing after automation. ObjectQL syncs schemas in its
        // own start(), so an object registered here is still created normally —
        // the run is durable rather than sacrificed to plugin order.
        const data = fakeDataEngine();
        const h = await runLifecycle({ manifestPhase: 'start', data });

        expect(h.registeredObjects()).toContain('sys_automation_run');
        const runId = await pauseARun(h.engine);
        expect(data.rows.get(runId)).toBeTruthy();
        expect(h.errors()).toBe('');
    });

    it('reports an unreadable table at boot but still attaches the store', async () => {
        // The reporter's `no such table: sys_automation_run`, surfaced ONCE at
        // boot instead of once per suspend. It does not gate the store: a probe
        // this early also fails for conditions that clear before the first
        // pause (a driver registered after bootstrap), and disabling
        // persistence over that would cause the very loss this guards against.
        const data = fakeDataEngine({ failReads: 'no such table: sys_automation_run' });
        const h = await runLifecycle({ manifestPhase: 'init', data });

        expect(h.errors()).toMatch(/could not be read at startup/);
        // #5661 — the driver's text is still reported, but through the logger's
        // structured slot rather than spliced into the message. Asserted in BOTH
        // directions on the probe's OWN record: a message-only assertion would
        // keep passing if the cause were dropped entirely.
        const probe = h.errorRecord('[Automation] sys_automation_run could not be read at startup');
        expect(probe, 'the probe reported').toBeDefined();
        expect(probe!.msg).not.toContain('\n');
        expect(probe!.msg).not.toMatch(/no such table: sys_automation_run/);
        expect(probe!.meta?.error).toBe('no such table: sys_automation_run');
        expect((h.engine as any).store, 'store still attached').toBeTruthy();
    });

    it('registers nothing and attaches nothing in memory mode', async () => {
        const data = fakeDataEngine();
        const h = await runLifecycle({ manifestPhase: 'init', data, suspendedRunStore: 'memory' });

        // An explicitly ephemeral engine is a legitimate mode, not a
        // degradation — it must not register the object nor complain.
        expect(h.manifest.registered).toEqual([]);
        expect((h.engine as any).store).toBeUndefined();
        expect(h.errors()).toBe('');
    });

    it('keeps working with no data engine at all', async () => {
        const h = await runLifecycle({ manifestPhase: 'init', data: null });

        // No ObjectQL is an ordinary deployment shape, not a fault: in-memory
        // pauses, no error.
        expect((h.engine as any).store).toBeUndefined();
        expect(h.errors()).toBe('');
        expect(await pauseARun(h.engine)).toBeTruthy();
    });

    it('declares ObjectQL as an optional dependency so it is ordered first', () => {
        // The composition-level fix (ADR-0116): registration order is not a
        // contract, so the plugin states the edge rather than hoping for it.
        // Optional, not hard — an engine-less kernel must still boot.
        const plugin = new AutomationServicePlugin();
        expect(plugin.optionalDependencies).toContain('com.objectstack.engine.objectql');
        expect(plugin.dependencies).toEqual([]);
    });
});
