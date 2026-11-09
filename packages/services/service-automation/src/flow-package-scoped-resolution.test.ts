// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4, child E1 of epic #31527] The flow index and activation
 * consult on `(package, name)`, through the ONE package-scoped resolver
 * (`resolvePackageScopedName`, `@objectstack/objectql`) — attached the way the
 * automation plugin attaches it (`flowNameResolver`), over a real
 * `SchemaRegistry`: packages installed through `installPackage`, so their
 * declared dependency closure is the save door's, items in each package's
 * composite slot, and an environment item in the package-less bare slot, as
 * `sys_metadata` hydration registers it.
 *
 * The epic's red lines are the `red line` cases. Each refusal pin was ablated
 * once (the engine's gate put back to "no refusal", the pin read red,
 * restored); the readings are in the PR body, not kept as test files.
 *
 * Red line 2's refusal of a name two packages hold is held back for the
 * maintainer's ruling on a deployment sealed with such a clash (#31677; see
 * `FLOW_NAME_REFUSALS_ACTED_ON` in the engine), so its pins land with it —
 * but never its report: the `held back` case pins the warning.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';
import { flowNameResolver } from './plugin.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import { FlowActivationProjection } from './flow-activation-projection.js';

const P = 'com.acme.caller';
const A = 'com.acme.alpha';
const Q = 'com.acme.stranger';

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

/** start → mark → end: the `mark` node records that this flow ran. */
function leaf(name: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'mark', type: 'mark', label: 'Mark', config: {} },
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

let registry: SchemaRegistry;
let engine: AutomationEngine;
/** The engine's own logger, so its warnings are readable. */
let engineLogger: ReturnType<typeof silentLogger>;
/** The loader's set: which package ships each flow name (the engine's `packagedFlowOwner`). */
let loaderSet: Record<string, string>;
/** The flows whose `mark` node ran, in order. */
let ran: string[];

const install = (id: string, deps: string[] = []) => registry.installPackage(manifest(id, deps), 'code');

/** Package `packageId` ships flow `body`: in its registry slot, the loader's set and the engine. */
function ship(packageId: string, body: { name: string }) {
    registry.registerItem('flow', { ...body, _packageId: packageId }, 'name' as never, packageId);
    loaderSet[body.name] = packageId;
    engine.registerFlow(body.name, body);
}

/** The environment authored flow `body`: a package-less row in the bare slot, and the engine. */
function author(body: { name: string }) {
    registry.registerItem('flow', { ...body, _provenance: 'org' }, 'name' as never);
    engine.registerFlow(body.name, body);
}

beforeEach(() => {
    registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    loaderSet = {};
    ran = [];
    engineLogger = silentLogger();
    engine = new AutomationEngine(engineLogger);
    const ctx = {
        logger: silentLogger(),
        getService(name: string) {
            if (name === 'objectql') return { registry };
            throw new Error(`no ${name}`);
        },
    } as any;
    installBuiltinNodes(engine, ctx);
    engine.registerNodeExecutor({
        type: 'mark',
        async execute(_node: unknown, variables: Map<string, unknown>) {
            ran.push(String(variables.get('$flowName')));
            return { success: true };
        },
    } as unknown as NodeExecutor);
    engine.setPackagedFlowSource((name) => loaderSet[name]);
    engine.setFlowNameResolver(flowNameResolver(ctx));
});

describe('ADR-0150 D3 — a subflow named inside a package resolves from that package', () => {
    it("reaches the caller package's own flow", async () => {
        install(P);
        ship(P, leaf('notify'));
        ship(P, caller('process', 'notify'));
        const result = await engine.execute('process');
        expect(result.success).toBe(true);
        expect(ran).toEqual(['notify']);
    });

    it("reaches the one holder in the caller package's declared dependency closure", async () => {
        install(A);
        install(P, [A]);
        ship(A, leaf('notify'));
        ship(P, caller('process', 'notify'));
        const result = await engine.execute('process');
        expect(result.success).toBe(true);
        expect(ran).toEqual(['notify']);
    });

    it('an environment-authored caller reaches the one package holder (a caller with no package)', async () => {
        install(A);
        ship(A, leaf('notify'));
        author(caller('my_process', 'notify'));
        const result = await engine.execute('my_process');
        expect(result.success).toBe(true);
        expect(ran).toEqual(['notify']);
    });

    it('a flow the registry holds nothing under has one holder, the engine, and still resolves', async () => {
        install(P);
        engine.registerFlow('engine_only', leaf('engine_only'));
        ship(P, caller('process', 'engine_only'));
        const result = await engine.execute('process');
        expect(result.success).toBe(true);
        expect(ran).toEqual(['engine_only']);
    });
});

describe('red line 1 — resolution never loosens: a package caller is never served outside its closure', () => {
    it('D3 (a): a name only an environment-authored flow holds is refused for a package caller, naming the environment', async () => {
        install(P);
        author(leaf('welcome'));
        ship(P, caller('process', 'welcome'));
        const result = await engine.execute('process');
        expect(result.success).toBe(false);
        expect(result.error).toContain('held outside the declared dependency closure of package "com.acme.caller"');
        expect(result.error).toContain('the environment (an item authored in this environment, bound to no package)');
        expect(ran).toEqual([]);
    });

    it("D3 step 3: a name only a package outside the caller's closure holds is refused, naming that package", async () => {
        install(Q);
        install(P);
        ship(Q, leaf('notify'));
        ship(P, caller('process', 'notify'));
        const result = await engine.execute('process');
        expect(result.success).toBe(false);
        expect(result.error).toContain('held outside the declared dependency closure of package "com.acme.caller"');
        expect(result.error).toContain('com.acme.stranger');
        expect(ran).toEqual([]);
    });

    it('control: the same child, run by a door (a caller with no package), resolves environment-wide', async () => {
        install(P);
        author(leaf('welcome'));
        const result = await engine.execute('welcome');
        expect(result.success).toBe(true);
        expect(ran).toEqual(['welcome']);
    });
});

describe('red line 2, held back (#31677) — the act waits for the ruling, the report does not', () => {
    it('a name two packages hold is warned once per (name, caller), naming every candidate', async () => {
        install(A);
        install(Q);
        install(P, [A, Q]);
        registry.registerItem('flow', { ...leaf('notify'), _packageId: A }, 'name' as never, A);
        registry.registerItem('flow', { ...leaf('notify'), _packageId: Q }, 'name' as never, Q);
        loaderSet.notify = A;
        engine.registerFlow('notify', leaf('notify'));
        ship(P, caller('process', 'notify'));

        const heldBack = () =>
            engineLogger.warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes('#31677'));
        expect((await engine.execute('notify')).success).toBe(true);
        expect((await engine.execute('notify')).success).toBe(true);
        expect((await engine.execute('process')).success).toBe(true);
        expect((await engine.execute('process')).success).toBe(true);

        const warned = heldBack();
        expect(warned).toHaveLength(2);
        expect(warned.map((call: unknown[]) => (call[1] as { callerPackageId: string | null }).callerPackageId))
            .toEqual([null, P]);
        for (const [message] of warned) {
            expect(message).toContain('the flow precedence\'s pick still runs');
            expect(message).toContain('com.acme.alpha');
            expect(message).toContain('com.acme.stranger');
        }
    });
});

describe('reading (b) — bare-name behaviour is unchanged for a name with one holder', () => {
    it('a door runs a packaged flow by its bare name', async () => {
        install(A);
        ship(A, leaf('notify'));
        const result = await engine.execute('notify');
        expect(result.success).toBe(true);
        expect(ran).toEqual(['notify']);
    });

    it('with no resolver attached, a subflow reaches an environment flow as before', async () => {
        engine.setFlowNameResolver(undefined);
        install(P);
        author(leaf('welcome'));
        ship(P, caller('process', 'welcome'));
        const result = await engine.execute('process');
        expect(result.success).toBe(true);
        expect(ran).toEqual(['welcome']);
    });
});

describe('ADR-0150 D4 — the activation ledger switches off the (package, name) it names', () => {
    const staleWarnings = () =>
        engineLogger.warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes('no longer holds that name'));

    it("a row naming the shipping package switches its flow off; a row of another package that still holds the name does not", async () => {
        install(A);
        install(Q);
        ship(A, leaf('notify'));
        // Q holds a flow of the same name too (a sealed clash); the engine armed A's.
        registry.registerItem('flow', { ...leaf('notify'), _packageId: Q }, 'name' as never, Q);
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'notify', packageId: Q, active: false });
        engine.setFlowActivationStore(store);
        expect(await engine.hydrateFlowActivations()).toEqual([]);
        expect((await engine.execute('notify')).success).toBe(true);
        expect(staleWarnings()).toHaveLength(0);

        await store.setActive({ name: 'notify', packageId: A, active: false });
        expect(await engine.hydrateFlowActivations()).toEqual(['notify']);
        expect(await engine.execute('notify')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
    });

    it('a stale row — its package no longer holds the name — still switches the holder off, warned once naming both and the remedy', async () => {
        install(A);
        install(Q);
        ship(A, leaf('notify'));
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'notify', packageId: Q, active: false });
        engine.setFlowActivationStore(store);
        expect(await engine.hydrateFlowActivations()).toEqual(['notify']);
        expect(await engine.execute('notify')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        expect(await engine.execute('notify')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        const warned = staleWarnings();
        expect(warned).toHaveLength(1);
        expect(warned[0][0]).toContain('package "com.acme.stranger"');
        expect(warned[0][0]).toContain('package "com.acme.alpha" ships it today');
        expect(warned[0][0]).toContain('switch the flow again');

        // The remedy: switching the flow writes the holder's own row.
        await engine.toggleFlow('notify', true);
        expect((await engine.execute('notify')).success).toBe(true);
        expect(await store.list()).toContainEqual({ name: 'notify', packageId: A, active: true });
    });

    it('the toggle door writes and reads the row under the shipping package', async () => {
        install(A);
        ship(A, leaf('notify'));
        const store = new InMemoryFlowActivationStore();
        engine.setFlowActivationStore(store);
        await engine.toggleFlow('notify', false);
        expect(await store.list()).toEqual([{ name: 'notify', packageId: A, active: false }]);
        expect(await engine.execute('notify')).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
        await engine.toggleFlow('notify', true);
        expect((await engine.execute('notify')).success).toBe(true);
    });
});

describe('FlowActivationProjection', () => {
    const readers = (holder: string | undefined, holds: string[] = [], reported: unknown[] = []) => ({
        holderOf: () => holder,
        stillHolds: (_name: string, packageId: string) => holds.includes(packageId),
        reportStale: (stale: unknown) => void reported.push(stale),
    });

    it('a row naming no package binds to the one holder', () => {
        const projection = new FlowActivationProjection(readers(A));
        projection.add('notify');
        expect(projection.has('notify')).toBe(true);
        projection.delete('notify');
        expect(projection.has('notify')).toBe(false);
    });

    it("a row of another package that still holds the name keys only that package", () => {
        const projection = new FlowActivationProjection(readers(A, [Q]));
        projection.add('notify', Q);
        expect(projection.has('notify')).toBe(false);
        projection.add('notify', A);
        expect(projection.has('notify')).toBe(true);
    });

    it('a stale row switches the holder off and is reported once', () => {
        const reported: unknown[] = [];
        const projection = new FlowActivationProjection(readers(A, [], reported));
        projection.add('notify', Q);
        expect(projection.has('notify')).toBe(true);
        expect(projection.has('notify')).toBe(true);
        expect(reported).toEqual([{ name: 'notify', rowPackageId: Q, holderPackageId: A }]);
    });

    it('with no reader to say who ships the name, every row of it still switches it off', () => {
        const projection = new FlowActivationProjection(readers(undefined));
        projection.add('notify', Q);
        expect(projection.has('notify')).toBe(true);
    });
});
