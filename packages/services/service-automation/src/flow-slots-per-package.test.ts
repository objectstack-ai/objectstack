// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, epic #31527 child B (flow), #31696 PR-1] The engine holds
 * flows by `(package, name)`: two packages' flows of one name are two slots,
 * both armed, each dispatched as its own — and a bare name two slots hold is
 * refused at every bare entry point, naming both, never picked.
 *
 * Over a real `SchemaRegistry` and the one package-scoped resolver, attached
 * as the automation plugin attaches it (`flowNameResolver`), like
 * ./flow-package-scoped-resolution.test.ts. Each negative pin was ablated
 * once; the readings are in the PR body.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { AutomationEngine, InMemorySuspendedRunStore } from './index.js';
import type { FlowTrigger, NodeExecutor, RunRecord, SuspendedRun } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';
import { flowNameResolver } from './plugin.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import { FlowSlotTable, qualifiedFlowKey } from './flow-slots.js';
import { flowSlotRunStore } from './flow-slot-run-store.js';
import { FlowCredentialChannel } from './flow-credential-channel.js';
import { resolveFlowPrecedence } from './flow-precedence.js';

const P1 = 'com.acme.alpha';
const P2 = 'com.acme.beta';

function silentLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

const manifest = (id: string, deps: string[] = []) => ({
    id,
    name: id,
    version: '1.0.0',
    type: 'app',
    namespace: id.split('.').pop()!,
    ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
}) as never;

/** start → mark(tag) → end: the `mark` node records `tag`, so a run says whose body ran. */
function leaf(name: string, tag: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'mark', type: 'mark', label: 'Mark', config: { tag } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'mark' },
            { id: 'e2', source: 'mark', target: 'end' },
        ],
    };
}

/** start → subflow(child) → end. */
function caller(name: string, child: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'call', type: 'subflow', label: 'Call', config: { flowName: child } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    };
}

/** start → hold (pauses) → mark(tag) → end. */
function pausing(name: string, tag: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'hold', type: 'hold', label: 'Hold', config: {} },
            { id: 'mark', type: 'mark', label: 'Mark', config: { tag } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'hold' },
            { id: 'e2', source: 'hold', target: 'mark' },
            { id: 'e3', source: 'mark', target: 'end' },
        ],
    };
}

/** A record-change trigger body: start declares `record-after-insert` on `task`. */
function triggered(name: string, tag: string) {
    const body = leaf(name, tag);
    body.nodes[0] = {
        id: 'start',
        type: 'start',
        label: 'Start',
        config: { triggerType: 'record-after-insert', objectName: 'task' } as never,
    };
    return body;
}

let registry: SchemaRegistry;
let engine: AutomationEngine;
let engineLogger: ReturnType<typeof silentLogger>;
/** Which packages' loader sets hold each flow name. */
let loaderSets: Record<string, string[]>;
/** The `tag` of every `mark` node that ran, in order. */
let ran: string[];
let ctx: any;

const install = (id: string, deps: string[] = []) => registry.installPackage(manifest(id, deps), 'code');

function newEngine(store?: InMemorySuspendedRunStore): AutomationEngine {
    const logger = silentLogger();
    const e = new AutomationEngine(logger, store);
    installBuiltinNodes(e, ctx);
    e.registerNodeExecutor({
        type: 'mark',
        async execute(node: { config?: { tag?: string } }) {
            ran.push(String(node.config?.tag));
            return { success: true };
        },
    } as unknown as NodeExecutor);
    e.registerNodeExecutor({
        type: 'hold',
        async execute() {
            return { success: true, suspend: true, correlation: 'held' };
        },
    } as unknown as NodeExecutor);
    // The loader's set, as the plugin's reader answers it: by name, the one
    // owner; for a package, that package's own question.
    e.setPackagedFlowSource((name, packageId) => {
        const holders = loaderSets[name] ?? [];
        if (packageId !== undefined) return holders.includes(packageId) ? packageId : undefined;
        return holders.length === 1 ? holders[0] : undefined;
    });
    e.setFlowNameResolver(flowNameResolver(ctx));
    return e;
}

/**
 * Package `packageId` ships `body`: in its registry slot, its loader set, and
 * `target`'s slot of it — armed as precedence arms a name two packages hold
 * (`holder`), or as it arms a name one package holds.
 */
function ship(packageId: string, body: { name: string }, target: AutomationEngine = engine) {
    registry.registerItem('flow', { ...body, _packageId: packageId }, 'name' as never, packageId);
    loaderSets[body.name] = [...new Set([...(loaderSets[body.name] ?? []), packageId])];
    target.registerFlow(body.name, body, { source: 'package', packageId, holder: packageId });
}

beforeEach(() => {
    registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    loaderSets = {};
    ran = [];
    ctx = {
        logger: silentLogger(),
        getService(name: string) {
            if (name === 'objectql') return { registry };
            throw new Error(`no ${name}`);
        },
    };
    engine = newEngine();
    engineLogger = (engine as unknown as { logger: ReturnType<typeof silentLogger> }).logger;
    install(P1);
    install(P2);
});

describe('FlowSlotTable — keys and moves', () => {
    it('files one slot under the bare name, two under PACKAGE/NAME, and moves keys both ways', () => {
        const slots = new FlowSlotTable();
        expect(slots.add({ packageId: P1, name: 'f' })).toEqual({ key: 'f', moved: [] });
        expect(slots.add({ packageId: P2, name: 'f' })).toEqual({
            key: qualifiedFlowKey(P2, 'f'),
            moved: [{ from: 'f', to: qualifiedFlowKey(P1, 'f') }],
        });
        expect(slots.isShared('f')).toBe(true);
        expect(slots.keyOf('f', P1)).toBe(`${P1}/f`);
        expect(slots.remove(`${P2}/f`)).toEqual([{ from: `${P1}/f`, to: 'f' }]);
        expect(slots.slot('f')).toEqual({ packageId: P1, name: 'f' });
        expect(slots.isShared('f')).toBe(false);
    });

    it('a package arriving for a name only a package-less flow holds takes that slot over, under the same key', () => {
        const slots = new FlowSlotTable();
        slots.add({ packageId: null, name: 'f' });
        slots.adopt('f', P1);
        expect(slots.slot('f')).toEqual({ packageId: P1, name: 'f' });
        expect(slots.keyOf('f', null)).toBeUndefined();
        expect(slots.keyOf('f', P1)).toBe('f');
    });
});

describe('#31696 two packages\' flows of one name — both armed, each its own', () => {
    it('a name one package holds keeps the bare key and every line it had', async () => {
        ship(P1, leaf('f', 'p1'));
        expect(await engine.listFlows()).toEqual(['f']);
        expect(engine.flowSlotKey(P1, 'f')).toBe('f');
        expect(engineLogger.info).toHaveBeenCalledWith('Flow registered: f (version 1)');
        expect((await engine.execute('f')).success).toBe(true);
        expect(ran).toEqual(['p1']);
    });

    it('both packages\' flows are held and armed; each runs through the qualified entry', async () => {
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        expect(engine.getFlowSlots('f')).toEqual([{ packageId: P1, name: 'f' }, { packageId: P2, name: 'f' }]);
        // One row per slot, under the flow's own name.
        expect(await engine.listFlows()).toEqual(['f', 'f']);
        expect(engine.getFlowRuntimeStates().map((row) => row.name)).toEqual(['f', 'f']);

        expect((await engine.executeSlot(P2, 'f')).success).toBe(true);
        expect((await engine.executeSlot(P1, 'f')).success).toBe(true);
        expect(ran).toEqual(['p2', 'p1']);
    });

    it('red line: a bare name two packages hold is refused at every bare entry point, naming both — nothing runs', async () => {
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));

        const result = await engine.execute('f');
        expect(result.success).toBe(false);
        expect(result.error).toContain(P1);
        expect(result.error).toContain(P2);
        expect(ran).toEqual([]);

        for (const door of [
            () => engine.getFlow('f'),
            () => engine.toggleFlow('f', false),
        ]) {
            await expect(door()).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
        }
        for (const door of [
            () => engine.unregisterFlow('f'),
            () => engine.getFlowVersionHistory('f'),
            () => engine.rollbackFlow('f', 1),
            () => engine.withdrawFlow('f'),
        ]) {
            expect(door).toThrow(/held by 2 packages/);
        }
        // Still both held: nothing was withdrawn by a bare name.
        expect(engine.getFlowSlots('f')).toHaveLength(2);
    });

    it('red line: with no resolver attached, a bare name two slots hold is still refused, never picked', async () => {
        engine.setFlowNameResolver(undefined);
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        const result = await engine.execute('f');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/held by 2 packages in this environment/);
        expect(ran).toEqual([]);
    });

    it('a package\'s own run reaches its own flow of the name (ADR-0150 D3): a subflow call resolves from its package', async () => {
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        ship(P2, caller('go', 'f'));
        expect((await engine.execute('go')).success).toBe(true);
        expect(ran).toEqual(['p2']);
    });

    it('the second holder moves the incumbent\'s records to its qualified key, and its removal moves them back', async () => {
        engine.setFlowNameResolver(undefined);
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        expect(engine.flowSlotKey(P1, 'f')).toBe(`${P1}/f`);
        expect(engine.getFlowRuntimeStates().map((row) => row.name)).toEqual(['f', 'f']);

        engine.withdrawFlowSlot(P2, 'f');
        expect(engine.flowSlotKey(P1, 'f')).toBe('f');
        expect(engine.flowSlotKey(P2, 'f')).toBeUndefined();
        expect(engine.getFlowVersionHistory('f')).toHaveLength(1);
        expect((await engine.execute('f')).success).toBe(true);
        expect(ran).toEqual(['p1']);
    });

    it('an environment-authored body of a name two packages hold is refused, naming both — it customizes neither', () => {
        engine.setFlowNameResolver(undefined);
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        expect(() => engine.registerFlow('f', leaf('f', 'env'))).toThrow(/held by 2 packages/);
        // N1: an override arm that names no slot is no package's either, even
        // where the loader's by-name reader answers one owner.
        engine.setPackagedFlowSource((_name, packageId) => (packageId === undefined ? P1 : packageId));
        expect(() => engine.registerFlow('f', leaf('f', 'ovr'), { source: 'override', packageId: `${P1}.custom` })).toThrow(/held by 2 packages/);
        expect(engine.getFlowSlots('f')).toHaveLength(2);
    });

    it('an arm that names no slot keeps E1: a name the resolver refuses is not armed by package id', () => {
        registry.registerItem('flow', { ...leaf('f', 'p1'), _packageId: P1 }, 'name' as never, P1);
        registry.registerItem('flow', { ...leaf('f', 'p2'), _packageId: P2 }, 'name' as never, P2);
        expect(() => engine.registerFlow('f', leaf('f', 'p1'), { source: 'package', packageId: P1 })).toThrow(/held by 2 packages/);
        expect(engine.getFlowSlots('f')).toEqual([]);
    });

    it('a trigger is not handed a slot of a shared name (it binds by name alone), with one warning', () => {
        const started: string[] = [];
        const trigger: FlowTrigger = {
            type: 'record_change',
            start: (binding: { flowName: string }) => { started.push(binding.flowName); },
            stop: () => undefined,
        } as unknown as FlowTrigger;
        engine.registerTrigger(trigger);
        ship(P1, triggered('t', 'p1'));
        expect(started).toEqual(['t']);
        ship(P2, triggered('t', 'p2'));
        expect(started).toEqual(['t']);
        expect(engine.getActiveTriggerBindings()).toEqual([]);
        const warned = engineLogger.warn.mock.calls.filter(([message]: [string]) => /NOT armed on trigger/.test(message));
        expect(warned).toHaveLength(2);
        expect(warned[0][0]).toContain(`another package holds a flow named 't'`);
    });

    it('[M1] two registry holders, one slot (the other body refused): no P1 caller, bare door or trigger reaches P2\'s flow', async () => {
        const started: string[] = [];
        engine.registerTrigger({ type: 'record_change', start: (b: { flowName: string }) => { started.push(b.flowName); }, stop: () => undefined } as unknown as FlowTrigger);
        ship(P2, triggered('f', 'p2'));
        expect(started).toEqual(['f']);
        // P1 ships `f` too, and its body is refused at registration: one engine slot, two registry holders.
        registry.registerItem('flow', { ...leaf('f', 'p1'), _packageId: P1 }, 'name' as never, P1);
        loaderSets.f = [P2, P1];
        engine.recordFlowRefusal('f', new Error('refused: p1 body'));
        ship(P1, caller('c', 'f'));
        expect((await engine.execute('c')).success).toBe(false);
        const bare = await engine.execute('f');
        expect([bare.success, bare.error]).toEqual([false, expect.stringContaining(P1)]);
        await expect(engine.getFlow('f')).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect(() => engine.withdrawFlow('f')).toThrow(/held by 2 packages/);
        expect(ran).toEqual([]);
        expect(engine.getActiveTriggerBindings()).toEqual([]);
        expect(engine.getFlowRegistration('f')).toMatchObject({ state: 'refused' });
        // [S2] The guards never read P1's call as P2's flow; a stored run naming no package is not P2's.
        expect((engine as unknown as { flowCallKey(c: string, n: string): string }).flowCallKey('c', 'f')).not.toBe('f');
        const legacy = new InMemorySuspendedRunStore();
        await legacy.save({ runId: 'legacy', flowName: 'f', nodeId: 'hold', steps: [] } as unknown as SuspendedRun);
        engine.setSuspendedRunStore(legacy);
        expect((await (engine as unknown as { store: InMemorySuspendedRunStore }).store.load('legacy'))?.flowName).not.toBe('f');
        await engine.cancelRun('legacy');
        // [N8] Written back under its name and no package: the lone slot's package is not stamped on it.
        expect((await legacy.listHistory('f', 10)).map((r) => [r.flowName, r.flowPackage])).toEqual([['f', undefined]]);
        engine.setFlowCredentialSource({ holds: () => true, held: () => [], resolve: async () => 'p1-secret' });
        await expect(engine.resolveFlowCredential('f', 'start', 'secret')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
        expect((await engine.executeSlot(P2, 'f')).success).toBe(true);
        expect(ran).toEqual(['p2']);
    });
});

describe('#31696 the activation ledger per slot (epic red line 1)', () => {
    it('red line: a package-less disable row on P1:F still holds after P2:F is installed — P1:F does not run', async () => {
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'f', active: false });
        engine.setFlowActivationStore(store);
        ship(P1, leaf('f', 'p1'));
        await engine.hydrateFlowActivations();
        expect((await engine.execute('f')).code).toBe('FLOW_DISABLED');

        // P2:F is a genuine install, after the boot's holders sealed (PR-3's door).
        engine.sealFlowHolders();
        ship(P2, leaf('f', 'p2'));
        await engine.flowActivationBinds();
        const p1 = await engine.executeSlot(P1, 'f');
        expect(p1).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect((await engine.executeSlot(P2, 'f')).success).toBe(true);
        expect(ran).toEqual(['p2']);

        // …and bound durably: the row naming no package is now P1's own row.
        expect(await store.list()).toEqual([{ name: 'f', packageId: P1, active: false }]);
        // Switching P2's flow writes P2's own row beside it, never over it.
        await engine.toggleFlowSlot(P2, 'f', false);
        await engine.toggleFlowSlot(P2, 'f', true);
        expect(await store.list()).toEqual([
            { name: 'f', packageId: P1, active: false },
            { name: 'f', packageId: P2, active: true },
        ]);
        const restarted = newEngine();
        restarted.setFlowActivationStore(store);
        ship(P1, leaf('f', 'p1'), restarted);
        ship(P2, leaf('f', 'p2'), restarted);
        await restarted.hydrateFlowActivations();
        expect(await restarted.executeSlot(P1, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect((await restarted.executeSlot(P2, 'f')).success).toBe(true);
    });

    it('red line: a package-less disable row first read under two holders fails closed: neither runs, one warning', async () => {
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'f', active: false });
        engine.setFlowActivationStore(store);
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        await engine.hydrateFlowActivations();
        expect(await engine.executeSlot(P1, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect(await engine.executeSlot(P2, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect(ran).toEqual([]);
        const warned = engineLogger.warn.mock.calls.filter(([message]: [string]) => /names no package/.test(message));
        expect(warned).toHaveLength(1);
        expect(warned[0][1]).toMatchObject({ flow: 'f', holders: [P1, P2] });
        // Nothing was bound: the row still names no package.
        await engine.flowActivationBinds();
        expect(await store.list()).toEqual([{ name: 'f', active: false }]);

        // An operator switching one package's flow on writes that package's own row; the other stays off.
        await engine.toggleFlowSlot(P2, 'f', true);
        expect((await engine.executeSlot(P2, 'f')).success).toBe(true);
        expect(await engine.executeSlot(P1, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect(await store.list()).toEqual([{ name: 'f', active: false }, { name: 'f', packageId: P2, active: true }]);
    });

    it('a package-less row read under two holders is never bound later, when the name drops to one holder and comes back', async () => {
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'f', active: false });
        engine.setFlowActivationStore(store);
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        await engine.hydrateFlowActivations();
        engine.sealFlowHolders();
        engine.withdrawFlowSlot(P2, 'f');
        // One holder again: the row is its switch, as before slots.
        expect(engine.flowSlotKey(P1, 'f')).toBe('f');
        expect(await engine.executeSlot(P1, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        ship(P2, leaf('f', 'p2'));
        await engine.flowActivationBinds();
        expect(await store.list()).toEqual([{ name: 'f', active: false }]);
        expect(await engine.executeSlot(P2, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect(await engine.executeSlot(P1, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
    });

    // [M2] Before the seal the "one holder" is whichever registered first: never bound, it fails closed.
    for (const [first, second] of [[P1, P2], [P2, P1]] as const) {
        it(`boot convergence, two installed packages (${first === P1 ? 'alpha' : 'beta'} first): a package-less disable row is bound to neither — both off, one warning, never bound after the seal`, async () => {
            const store = new InMemoryFlowActivationStore();
            await store.setActive({ name: 'f', active: false });
            engine.setFlowActivationStore(store);
            // `start()`: the ledger is read before the installed packages register.
            await engine.hydrateFlowActivations();
            // `kernel:ready`: the rehydrate registers both.
            ship(first, leaf('f', first === P1 ? 'p1' : 'p2'));
            ship(second, leaf('f', second === P1 ? 'p1' : 'p2'));
            await engine.flowActivationBinds();
            expect(await engine.executeSlot(P1, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
            expect(await engine.executeSlot(P2, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
            expect(ran).toEqual([]);
            expect(await store.list()).toEqual([{ name: 'f', active: false }]);
            const warned = engineLogger.warn.mock.calls.filter(([message]: [string]) => /names no package/.test(message));
            expect(warned).toHaveLength(1);
            expect(warned[0][1]).toMatchObject({ flow: 'f', holders: expect.arrayContaining([P1, P2]) });

            // `kernel:bootstrapped`: sealed. A later re-arrival of the second holder still binds nothing.
            engine.sealFlowHolders();
            engine.withdrawFlowSlot(second, 'f');
            ship(second, leaf('f', second === P1 ? 'p1' : 'p2'));
            await engine.flowActivationBinds();
            expect(await store.list()).toEqual([{ name: 'f', active: false }]);
            expect(await engine.executeSlot(P1, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
            expect(await engine.executeSlot(P2, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        });
    }

    it('the second holder is off until the bind lands; a bind that fails keeps both off, says so, and binds nothing', async () => {
        const rows = new InMemoryFlowActivationStore();
        await rows.setActive({ name: 'f', active: false });
        let release!: (fail: boolean) => void;
        const store = {
            list: () => rows.list(),
            setActive: (row: never, options?: never) => new Promise<void>((resolve, reject) => {
                release = (fail) => (fail ? reject(new Error('ledger unreachable')) : resolve(rows.setActive(row, options)));
            }),
        };
        engine.setFlowActivationStore(store);
        ship(P1, leaf('f', 'p1'));
        await engine.hydrateFlowActivations();
        engine.sealFlowHolders();
        ship(P2, leaf('f', 'p2'));
        await Promise.resolve();
        // In flight: the row still names no package, so it keeps both off.
        expect(await engine.executeSlot(P2, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        release(true);
        await engine.flowActivationBinds();
        expect(await rows.list()).toEqual([{ name: 'f', active: false }]);
        expect(await engine.executeSlot(P2, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect(await engine.executeSlot(P1, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect(ran).toEqual([]);
        const warned = engineLogger.warn.mock.calls.filter(([message]: [string]) => /failed, so the row still names no package/.test(message));
        expect(warned).toHaveLength(1);
        // …and after a restart the ledger reads the same: both off.
        const restarted = newEngine();
        restarted.setFlowActivationStore(rows);
        ship(P1, leaf('f', 'p1'), restarted);
        ship(P2, leaf('f', 'p2'), restarted);
        await restarted.hydrateFlowActivations();
        expect(await restarted.executeSlot(P2, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
    });

    it('the bind lands: the second holder\'s flow runs once its write has', async () => {
        const rows = new InMemoryFlowActivationStore();
        await rows.setActive({ name: 'f', active: false });
        let release!: () => void;
        const store = {
            list: () => rows.list(),
            setActive: (row: never, options?: never) => new Promise<void>((resolve) => {
                release = () => resolve(rows.setActive(row, options));
            }),
        };
        engine.setFlowActivationStore(store);
        ship(P1, leaf('f', 'p1'));
        await engine.hydrateFlowActivations();
        engine.sealFlowHolders();
        ship(P2, leaf('f', 'p2'));
        await Promise.resolve();
        expect(await engine.executeSlot(P2, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        release();
        await engine.flowActivationBinds();
        expect((await engine.executeSlot(P2, 'f')).success).toBe(true);
        expect(await engine.executeSlot(P1, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect(await rows.list()).toEqual([{ name: 'f', packageId: P1, active: false }]);
    });

    it('switching one package\'s flow writes that package\'s row and switches no other', async () => {
        const store = new InMemoryFlowActivationStore();
        engine.setFlowActivationStore(store);
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        await engine.toggleFlowSlot(P2, 'f', false);
        expect(await store.list()).toEqual([expect.objectContaining({ name: 'f', packageId: P2, active: false })]);
        expect((await engine.executeSlot(P1, 'f')).success).toBe(true);
        expect(await engine.executeSlot(P2, 'f')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
    });
});

describe('#31696 R8 — a stored run names its flow\'s package and resumes on it', () => {
    const resume = (e: AutomationEngine, runId: string) =>
        e.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as never);

    it('a paused run of P2:F is stored as (f, P2) and resumes on P2\'s flow on another replica', async () => {
        const store = new InMemorySuspendedRunStore();
        const a = newEngine(store);
        ship(P1, pausing('f', 'p1'), a);
        ship(P2, pausing('f', 'p2'), a);
        const paused = await a.executeSlot(P2, 'f');
        const runId = (paused as { runId?: string }).runId!;
        expect(runId).toBeTruthy();
        const stored = (await store.load(runId)) as SuspendedRun;
        expect(stored).toMatchObject({ flowName: 'f', flowPackage: P2 });

        // A replica that holds the two slots in the other order.
        const b = newEngine(store);
        ship(P2, pausing('f', 'p2'), b);
        ship(P1, pausing('f', 'p1'), b);
        expect((await resume(b, runId)).success).toBe(true);
        expect(ran).toEqual(['p2']);
    });

    it('red line: a stored run of P2:F never continues on P1\'s flow of the name', async () => {
        const store = new InMemorySuspendedRunStore();
        const a = newEngine(store);
        ship(P1, pausing('f', 'p1'), a);
        ship(P2, pausing('f', 'p2'), a);
        const runId = ((await a.executeSlot(P2, 'f')) as { runId?: string }).runId!;

        // A replica whose only flow of the name is P1's: the bare key 'f'.
        const b = newEngine(store);
        loaderSets.f = [P1];
        b.registerFlow('f', pausing('f', 'p1'), { source: 'package', packageId: P1, holder: P1 });
        const result = await resume(b, runId);
        expect(result.success).toBe(false);
        expect(ran).toEqual([]);
    });

    it('a run in flight when its slot\'s key moves is stored as its own package\'s run, never under a key', async () => {
        const store = new InMemorySuspendedRunStore();
        const a = newEngine(store);
        let proceed!: () => void;
        const gate = new Promise<void>((resolve) => { proceed = resolve; });
        a.registerNodeExecutor({
            type: 'hold',
            async execute() {
                await gate;
                return { success: true, suspend: true, correlation: 'held' };
            },
        } as unknown as NodeExecutor);
        // A run of P1's flow under its qualified key; P2 leaves while it is in flight.
        ship(P1, pausing('f', 'p1'), a);
        ship(P2, pausing('f', 'p2'), a);
        const first = a.executeSlot(P1, 'f');
        await Promise.resolve();
        a.withdrawFlowSlot(P2, 'f');
        proceed();
        const one = ((await first) as { runId?: string }).runId!;
        expect(await store.load(one)).toMatchObject({ flowName: 'f', flowPackage: P1 });

        // A run of P1's flow under the bare key; P2 arrives while it is in flight.
        let proceed2!: () => void;
        const gate2 = new Promise<void>((resolve) => { proceed2 = resolve; });
        a.registerNodeExecutor({
            type: 'hold',
            async execute() {
                await gate2;
                return { success: true, suspend: true, correlation: 'held' };
            },
        } as unknown as NodeExecutor);
        expect(a.flowSlotKey(P1, 'f')).toBe('f');
        const second = a.executeSlot(P1, 'f');
        await Promise.resolve();
        ship(P2, pausing('f', 'p2'), a);
        proceed2();
        const two = ((await second) as { runId?: string }).runId!;
        expect(await store.load(two)).toMatchObject({ flowName: 'f', flowPackage: P1 });

        // Each resumes on P1's flow, on a replica that holds both.
        const b = newEngine(store);
        ship(P2, pausing('f', 'p2'), b);
        ship(P1, pausing('f', 'p1'), b);
        expect((await resume(b, one)).success).toBe(true);
        expect((await resume(b, two)).success).toBe(true);
        expect(ran).toEqual(['p1', 'p1']);
    });

    it('the run-store view maps key ↔ (name, package), and passes a package-less record through', async () => {
        const inner = new InMemorySuspendedRunStore();
        const view = flowSlotRunStore(inner, {
            stored: (key) => (key.includes('/') ? { flowName: key.split('/')[1], flowPackage: key.split('/')[0] } : { flowName: key }),
            key: (name, pkg) => (pkg ? `${pkg}/${name}` : name),
        });
        const run = { runId: 'r1', flowName: `${P2}/f`, nodeId: 'hold' } as SuspendedRun;
        await view.save(run);
        expect(await inner.load('r1')).toMatchObject({ flowName: 'f', flowPackage: P2 });
        expect(await view.load('r1')).toMatchObject({ flowName: `${P2}/f` });
        const plain = { runId: 'r2', flowName: 'g', nodeId: 'hold' } as SuspendedRun;
        await view.save(plain);
        expect(await inner.load('r2')).toEqual(plain);
        expect(await inner.load('r2')).not.toHaveProperty('flowPackage');
        await view.recordTerminal!({ runId: 'r3', flowName: `${P2}/f`, status: 'completed' } as RunRecord);
        expect(await view.listHistory!(`${P2}/f`, 10)).toEqual([expect.objectContaining({ runId: 'r3', flowName: `${P2}/f` })]);
        expect(await view.listHistory!('f', 10)).toEqual([]);
    });

    it('[N2] a slot\'s history window is not filled by another slot\'s newer rows of the name', async () => {
        const inner = new InMemorySuspendedRunStore();
        const view = flowSlotRunStore(inner, {
            stored: (key) => ({ flowName: 'f', flowPackage: key.split('/')[0] }),
            key: (name, pkg) => `${pkg}/${name}`,
        });
        const at = (n: number) => `2026-01-0${n}T00:00:00.000Z`;
        await view.recordTerminal!({ runId: 'old', flowName: `${P2}/f`, status: 'completed', startedAt: at(1) } as RunRecord);
        for (const n of [2, 3, 4]) await view.recordTerminal!({ runId: `p1-${n}`, flowName: `${P1}/f`, status: 'completed', startedAt: at(n) } as RunRecord);
        expect((await view.listHistory!(`${P2}/f`, 1)).map((r) => r.runId)).toEqual(['old']);
        expect((await view.listHistory!(`${P1}/f`, 2)).map((r) => r.runId)).toEqual(['p1-4', 'p1-3']);
    });
});

describe('#31696 R9 — the engine asks a credential source by package only for a slot of a shared name', () => {
    it('the channel reads by package when asked by package, every row of the name when not', async () => {
        const rows = [
            { id: '1', flow_name: 'f', flow_package: P1, node_id: 'start', credential_key: 'secret', state: 'active' },
            { id: '2', flow_name: 'f', flow_package: '', node_id: 'call', credential_key: 'signingSecret', state: 'active' },
        ];
        const channel = new FlowCredentialChannel(() => ({ find: async () => rows, resolveSecretField: async (_o: string, id: string) => `plain-${id}` }) as never);
        await channel.loadIndex();
        expect([channel.holds('f', 'start', 'secret'), channel.holds('f', 'start', 'secret', P1)]).toEqual([true, true]);
        expect(channel.holds('f', 'start', 'secret', P2)).toBe(false);
        expect(channel.held('f')).toHaveLength(2);
        expect(await channel.resolve('f', 'start', 'secret', P2)).toBeUndefined();
        expect(await channel.resolve('f', 'start', 'secret', P1)).toBe('plain-1');
        // [R1] The row naming no package is any holder's: held for every slot, and its reads refused.
        expect([channel.holds('f', 'call', 'signingSecret', P1), channel.holds('f', 'call', 'signingSecret', P2)]).toEqual([true, true]);
        expect(() => channel.held('f', P2)).toThrow(/names no package/);
        await expect(channel.resolve('f', 'call', 'signingSecret', P1)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });

    it('the engine asks the channel by package only for a slot of a name two packages hold', async () => {
        const asked: unknown[][] = [];
        engine.setFlowCredentialSource({
            readsByPackage: true,
            holds: (...a: unknown[]) => { asked.push(a); return false; },
            held: () => [],
            resolve: async () => undefined,
        });
        ship(P1, leaf('f', 'p1'));
        engine.holdsFlowCredential('f', 'start', 'secret');
        ship(P2, leaf('f', 'p2'));
        engine.holdsFlowCredential(`${P2}/f`, 'start', 'secret');
        expect(asked).toEqual([['f', 'start', 'secret'], ['f', 'start', 'secret', P2]]);
        // A bare name two packages hold names neither flow's credentials: refused, naming both, never asked.
        expect(() => engine.holdsFlowCredential('f', 'start', 'secret')).toThrow(/held by 2 packages/);
        await expect(engine.resolveFlowCredential('f', 'start', 'secret')).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
        expect(asked).toHaveLength(2);
    });
    it('S3: a source that reads by name alone is never read for a slot of a shared name: its reads are refused, naming the slot', async () => {
        const asked: unknown[][] = [];
        engine.setFlowCredentialSource({
            holds: (...a: unknown[]) => { asked.push(a); return true; },
            held: (...a: unknown[]) => { asked.push(a); return [{ nodeId: 'start', key: 'secret' }]; },
            resolve: async (...a: unknown[]) => { asked.push(a); return 'another-package-secret'; },
        });
        ship(P1, leaf('f', 'p1'));
        // One holder: asked by name, as before.
        expect(engine.holdsFlowCredential('f', 'start', 'secret')).toBe(true);
        expect(await engine.resolveFlowCredential('f', 'start', 'secret')).toBe('another-package-secret');
        expect(asked).toHaveLength(2);

        ship(P2, leaf('f', 'p2'));
        const key = `${P2}/f`;
        // [S1] `holds` asks by name: a "yes" may be another package's, so the read is asked — and refuses.
        expect(engine.holdsFlowCredential(key, 'start', 'secret')).toBe(true);
        const refused = await engine.resolveFlowCredential(key, 'start', 'secret').catch((e: unknown) => e);
        expect(refused).toMatchObject({ name: 'FlowCredentialUnresolvableError', code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect((refused as Error).message).toContain(`Flow 'f' of package "${P2}"`);
        expect((refused as Error).message).toContain(`Package "${P1}" also holds`);
        // Only that by-name `holds` was asked for the shared slot.
        expect(asked.slice(2)).toEqual([['f', 'start', 'secret']]);

        // [R9] The plugin's channel reads by package: P2's slot is asked for P2's rows, and P1's row answers it nothing.
        const p1Row = [{ id: '1', flow_name: 'f', flow_package: P1, node_id: 'start', credential_key: 'secret', state: 'active' }];
        const channel = new FlowCredentialChannel(() => ({ find: async () => p1Row, resolveSecretField: async () => 'p1-secret' }) as never);
        await channel.loadIndex();
        engine.setFlowCredentialSource(channel);
        expect(engine.holdsFlowCredential(key, 'start', 'secret')).toBe(false);
        expect(await engine.resolveFlowCredential(key, 'start', 'secret')).toBeUndefined();
        expect(await engine.resolveFlowCredential(`${P1}/f`, 'start', 'secret')).toBe('p1-secret');
    });
});

describe('#31696 precedence — one winner per package that holds the name', () => {
    const installed = (() => undefined) as never;
    const code = (packageId: string, tag: string) => ({ ...leaf('f', tag), _packageId: packageId, _provenance: 'code' });

    it('two packages\' loader sets hold the name: a winner each, naming its slot', () => {
        const reader = (name: string, packageId?: string) =>
            packageId === undefined ? undefined : [P1, P2].includes(packageId) && name === 'f' ? packageId : undefined;
        const winners = resolveFlowPrecedence([code(P2, 'p2'), code(P1, 'p1')], silentLogger(), reader, installed);
        expect(winners.map((w) => [w.holder, w.contender.source, w.contender.packageId])).toEqual([
            [P1, 'package', P1],
            [P2, 'package', P2],
        ]);
    });

    it('a stored row naming no package overlays neither holder: not armed, one warning', () => {
        const reader = (name: string, packageId?: string) =>
            packageId === undefined ? undefined : [P1, P2].includes(packageId) && name === 'f' ? packageId : undefined;
        const logger = silentLogger();
        const stored = { ...leaf('f', 'env'), _provenance: 'org' };
        const winners = resolveFlowPrecedence([code(P1, 'p1'), stored, code(P2, 'p2')], logger, reader, installed);
        expect(winners).toHaveLength(2);
        expect(winners.every((w) => w.definition !== stored)).toBe(true);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toContain('customizes neither');
    });

    it('a reader that answers by name alone keeps the one-owner precedence: no slot named', () => {
        const reader = (name: string) => (name === 'f' ? P1 : undefined);
        const winners = resolveFlowPrecedence([code(P1, 'p1'), code(P2, 'p2')], silentLogger(), reader, installed);
        expect(winners).toHaveLength(1);
        expect(winners[0].holder).toBeUndefined();
    });
});

describe('#31696 a slot key is no flow\'s name at a bare door', () => {
    it('every bare door answers a PACKAGE/NAME spelling as a flow it does not hold, and nothing runs or changes', async () => {
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        const key = `${P2}/f`;
        expect(engine.flowSlotKey(P2, 'f')).toBe(key);

        expect(await engine.execute(key)).toMatchObject({ success: false, error: `Flow '${key}' not found` });
        expect(await engine.getFlow(key)).toBeNull();
        await expect(engine.toggleFlow(key, false)).rejects.toThrow(`Flow '${key}' not found`);
        expect(engine.getFlowVersionHistory(key)).toEqual([]);
        expect(() => engine.rollbackFlow(key, 1)).toThrow(`Flow '${key}' has no version history`);
        expect(engine.getFlowRegistration(key)).toEqual({ state: 'unregistered' });
        engine.unregisterFlow(key);
        engine.withdrawFlow(key);
        expect(ran).toEqual([]);
        expect(engine.getFlowSlots('f')).toHaveLength(2);
        expect(engine.getFlowRuntimeStates().map((row) => row.enabled)).toEqual([true, true]);
    });

    it('a subflow node naming a slot key calls no flow', async () => {
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        ship(P2, caller('go', `${P2}/f`));
        expect((await engine.execute('go')).success).toBe(false);
        expect(ran).toEqual([]);
    });
});

describe('#31696 a run of a flow whose name two packages hold reads its own flow', () => {
    /** start → ask (a screen that pauses) → end. */
    function screened(name: string, title: string) {
        return {
            name,
            label: name,
            type: 'screen',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'ask', type: 'screen', label: 'Ask', config: { waitForInput: true, title, fields: [{ name: 'ok', label: 'OK', type: 'checkbox' }] } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'ask' },
                { id: 'e2', source: 'ask', target: 'end' },
            ],
        };
    }

    it('a screen pauses in each package\'s flow, with its own progress', async () => {
        ship(P1, screened('f', 'one'));
        ship(P2, screened('f', 'two'));
        for (const packageId of [P1, P2]) {
            const paused = await engine.executeSlot(packageId, 'f');
            expect(paused).toMatchObject({ success: true, status: 'paused' });
            expect((paused as { screen?: { progress?: unknown } }).screen?.progress).toBeDefined();
        }
    });

    it('getRunFlow reads the flow of the run\'s own slot; getFlow refuses the bare name', async () => {
        ship(P1, leaf('f', 'p1'));
        ship(P2, leaf('f', 'p2'));
        const run = { flowName: 'f', [Symbol.for('objectstack.automation.flowRunSlotKey')]: `${P2}/f` };
        expect(engine.getRunFlow(run as never)).toBe(engine.getFlowSlot(P2, 'f'));
        expect(engine.getRunFlow(undefined)).toBeNull();
        await expect(engine.getFlow('f')).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
    });
});

describe('#31696 the trigger decline is said again for a name shared again', () => {
    it('a pair that drops to one holder and shares again warns again', () => {
        engine.registerTrigger({
            type: 'record_change',
            start: () => undefined,
            stop: () => undefined,
        } as unknown as FlowTrigger);
        ship(P1, triggered('t', 'p1'));
        ship(P2, triggered('t', 'p2'));
        registry.unregisterItemsByPackage(P2);
        engine.withdrawFlowSlot(P2, 't');
        ship(P2, triggered('t', 'p2'));
        const warned = engineLogger.warn.mock.calls.filter(([message]: [string]) => /NOT armed on trigger/.test(message));
        expect(warned).toHaveLength(4);
    });
});
