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

 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';
import { flowNameResolver } from './plugin.js';
import { connectorNameResolver } from './connector-package-scope.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import { FlowActivationProjection } from './flow-activation-projection.js';
import { resolveFlowPrecedence } from './flow-precedence.js';
import { bindStoredRow } from '@objectstack/metadata-protocol';
import { installedManifestsOf } from '@objectstack/metadata-core';

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

describe('red line 2 — ambiguity is reported, never guessed', () => {
    it('a name two packages hold is refused at registration, naming both, and nothing is armed', async () => {
        install(A);
        install(Q);
        registry.registerItem('flow', { ...leaf('notify'), _packageId: A }, 'name' as never, A);
        registry.registerItem('flow', { ...leaf('notify'), _packageId: Q }, 'name' as never, Q);
        expect(() => engine.registerFlow('notify', leaf('notify'))).toThrow(
            /held by 2 packages in this environment[\s\S]*com\.acme\.alpha[\s\S]*com\.acme\.stranger/,
        );
        expect(await engine.getFlow('notify')).toBeNull();
    });

    it('a door run of a name armed before a second package took it (a sealed clash) is refused, naming both', async () => {
        install(A);
        install(Q);
        ship(A, leaf('notify'));
        registry.registerItem('flow', { ...leaf('notify'), _packageId: Q }, 'name' as never, Q);
        const result = await engine.execute('notify');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/held by 2 packages in this environment[\s\S]*com\.acme\.alpha[\s\S]*com\.acme\.stranger/);
        expect(ran).toEqual([]);
    });

    it("a package caller whose declared closure holds the name twice is refused, naming both", async () => {
        install(A);
        install(Q);
        install(P, [A, Q]);
        ship(A, leaf('notify'));
        registry.registerItem('flow', { ...leaf('notify'), _packageId: Q }, 'name' as never, Q);
        ship(P, caller('process', 'notify'));
        const result = await engine.execute('process');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/held by 2 packages in the declared dependency closure of package "com\.acme\.caller"/);
        expect(ran).toEqual([]);
    });

    it('control: a name one package holds arms as before', async () => {
        install(A);
        ship(A, leaf('notify'));
        expect(await engine.getFlow('notify')).not.toBeNull();
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
        ship(A, caller('process', 'notify'));
        // Q holds a flow of the same name too (a sealed clash); the engine armed A's,
        // which A's own flow still reaches (its own item, D3 step 1).
        registry.registerItem('flow', { ...leaf('notify'), _packageId: Q }, 'name' as never, Q);
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'notify', packageId: Q, active: false });
        engine.setFlowActivationStore(store);
        expect(await engine.hydrateFlowActivations()).toEqual([]);
        expect((await engine.execute('process')).success).toBe(true);
        expect(ran).toEqual(['notify']);
        expect(staleWarnings()).toHaveLength(0);

        await store.setActive({ name: 'notify', packageId: A, active: false });
        expect(await engine.hydrateFlowActivations()).toEqual(['notify']);
        expect((await engine.execute('process')).success).toBe(false);
        expect(ran).toEqual(['notify']);
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

/**
 * [#31754, ADR-0150 D3] The boot pull's flow name collision line asks the
 * resolver the engine asks (`refusalOf`, built here as the plugin builds it,
 * from `flowNameResolver`). For a name two packages hold, precedence still
 * hands the lexicographically first body on and `registerFlow` refuses it
 * (red line 2 above), so the line says NEITHER is armed and points at that
 * refusal. The three shapes on a real cold boot are pinned in
 * `flow-declared-override-first-boot-pull.integration.test.ts`. CONTROL: with
 * no resolver handed in, every arm's line is byte for byte main's.
 */
describe('[#31754] the collision line for a name two packages hold says neither is armed', () => {
    const NOTHING_INSTALLED = installedManifestsOf(undefined);
    /** The boot pull's two steps over the registry: precedence (its one warning), then registration. */
    function pull(): { line: string; refusal: unknown } {
        const warn = vi.fn();
        const resolver = flowNameResolver({ getService: () => ({ registry }) } as never);
        const [winner] = resolveFlowPrecedence(
            registry.listItems('flow') as unknown[],
            { warn },
            (name) => engine.packagedFlowOwner(name),
            NOTHING_INSTALLED,
            (name) => {
                const resolution = resolver(name, null);
                return resolution?.status === 'refused' ? resolution.message : undefined;
            },
        );
        expect(warn).toHaveBeenCalledTimes(1);
        let refusal: unknown;
        try {
            engine.registerFlow(winner.name, winner.definition as never);
        } catch (e) {
            refusal = e;
        }
        return { line: String(warn.mock.calls[0][0]), refusal };
    }
    /** One collision line from precedence alone. */
    function lineOf(listed: unknown[], owner: Record<string, string>): string {
        const warn = vi.fn();
        resolveFlowPrecedence(listed, { warn }, (name) => owner[name], NOTHING_INSTALLED);
        expect(warn).toHaveBeenCalledTimes(1);
        return String(warn.mock.calls[0][0]);
    }

    for (const order of [[A, Q], [Q, A]] as const) {
        it(`two packages, registered ${order[0] === A ? 'alpha' : 'stranger'} first: the line arms neither, and the engine refuses`, async () => {
            install(A);
            install(Q);
            for (const id of order) registry.registerItem('flow', { ...leaf('notify'), _packageId: id }, 'name' as never, id);
            loaderSet.notify = A;

            const { line, refusal } = pull();
            expect(line).toBe(
                "[Automation] Flow name collision: 'notify' is claimed by 2 definitions (package 'com.acme.alpha', " +
                    "package 'com.acme.stranger'); arming neither: the engine refuses this bare name for a caller with " +
                    "no package (ADR-0150 D3), so no definition dispatches; the 'failed to register flow' warning for " +
                    "'notify' names every holder. Rename one of them.",
            );
            expect(line).not.toContain('arming package');
            expect(line).not.toContain('by package id');
            expect(line).not.toContain('Only the armed definition dispatches');
            expect(line).not.toContain('\n');
            // What the line points at: the refusal, naming both, and nothing armed.
            const refused = String((refusal as Error)?.message);
            expect(refused).toContain('held by 2 packages in this environment');
            expect(refused).toContain('package "com.acme.alpha"');
            expect(refused).toContain('package "com.acme.stranger"');
            expect(await engine.getFlow('notify')).toBeNull();
        });
    }

    it('CONTROL: with no resolver, two packages keep main\'s line byte for byte (by package id)', () => {
        const line = lineOf(
            [{ ...leaf('notify'), _packageId: Q, _provenance: 'package' }, { ...leaf('notify'), _packageId: A, _provenance: 'package' }],
            { notify: A },
        );
        expect(line).toBe(
            "[Automation] Flow name collision: 'notify' is claimed by 2 definitions (package 'com.acme.alpha', " +
                "package 'com.acme.stranger'); arming package 'com.acme.alpha' by package id, and shadowing 1 other " +
                'definition(s). Only the armed definition dispatches. Rename one of them.',
        );
    });

    it('CONTROL: a package beside an environment row keeps its line byte for byte (ADR-0126 §2)', () => {
        const line = lineOf(
            [{ ...leaf('notify'), _packageId: A, _provenance: 'package' }, { ...leaf('notify'), _provenance: 'org' }],
            { notify: A },
        );
        expect(line).toBe(
            "[Automation] Flow name collision: 'notify' is claimed by 2 definitions (package 'com.acme.alpha', " +
                "a runtime-authored row (sys_metadata)); arming package 'com.acme.alpha' because a managed package's " +
                'flow is sealed (ADR-0126 §2), and shadowing 1 other definition(s). Only the armed definition ' +
                "dispatches. To change what runs, declare it as an override in 'com.acme.alpha.custom' (overrides: " +
                "{ package: 'com.acme.alpha', basedOn }), or save it under a new name.",
        );
    });

    it('CONTROL: the declared override beside a stored row keeps its line byte for byte (ADR-0146 D9)', () => {
        const pair = `${A}.custom`;
        const declared = { overrides: { package: A, basedOn: '1.0.0' }, _provenance: 'org' };
        const line = lineOf(
            [
                bindStoredRow({ ...leaf('notify'), _provenance: 'org' }, null),
                { ...leaf('notify'), _packageId: A, _provenance: 'package' },
                bindStoredRow({ ...leaf('notify'), ...declared }, pair),
            ],
            { notify: A },
        );
        expect(line).toBe(
            "[Automation] Flow name collision: 'notify' is claimed by 3 definitions (the declared override in " +
                "'com.acme.alpha.custom' (sys_metadata), package 'com.acme.alpha', a runtime-authored row " +
                "(sys_metadata)); arming the declared override in 'com.acme.alpha.custom' (sys_metadata) because it " +
                "is the declared override of 'com.acme.alpha' (ADR-0146 D9), and shadowing 2 other definition(s). " +
                "Only the armed definition dispatches. To change what runs, declare it as an override in " +
                "'com.acme.alpha.custom' (overrides: { package: 'com.acme.alpha', basedOn }), or save it under a new name.",
        );
    });

    it('CONTROL: two environment rows of a name no package ships keep their line byte for byte (arrival order)', () => {
        const line = lineOf([{ ...leaf('notify'), _provenance: 'org' }, { ...leaf('notify'), _provenance: 'org' }], {});
        expect(line).toBe(
            "[Automation] Flow name collision: 'notify' is claimed by 2 definitions (a runtime-authored row " +
                '(sys_metadata), a runtime-authored row (sys_metadata)); arming a runtime-authored row (sys_metadata) ' +
                'by arrival order, and shadowing 1 other definition(s). Only the armed definition dispatches. ' +
                'Rename one of them.',
        );
    });
});

// ── [epic #31527 child E5] connector_action names its connector from the flow's package ──

/** A declared connector instance `name` in the registry: package `packageId`'s, or the environment's. */
function declareConnector(name: string, packageId?: string) {
    const item = { name, label: name, type: 'api', authentication: { type: 'none' }, actions: [{ key: 'ping', label: 'Ping' }] };
    if (packageId) registry.registerItem('connector', { ...item, _packageId: packageId }, 'name' as never, packageId);
    else registry.registerItem('connector', { ...item, _provenance: 'org' }, 'name' as never);
}

/** The engine's one live instance under `name`; `pings` records each dispatch to it. */
let pings: string[];
function liveConnector(name: string) {
    engine.registerConnector(
        { name, label: name, type: 'api', authentication: { type: 'none' }, actions: [{ key: 'ping', label: 'Ping' }] } as never,
        { ping: async () => { pings.push(name); return { ok: true }; } },
    );
}

/** start → connector_action(connectorId.ping) → end. */
function dispatcher(name: string, connectorId: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'call', type: 'connector_action', label: 'Ping', connectorConfig: { connectorId, actionId: 'ping', input: {} } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    };
}

describe('ADR-0150 D3 — a connector_action names its connector from the calling flow\'s package (epic #31527 child E5)', () => {
    beforeEach(() => {
        pings = [];
        const ctx = { getService(name: string) { if (name === 'objectql') return { registry }; throw new Error(`no ${name}`); } };
        engine.setConnectorNameResolver(connectorNameResolver(ctx as never));
    });

    it("dispatches to the caller package's own instance, as before", async () => {
        install(P);
        declareConnector('billing', P);
        liveConnector('billing');
        ship(P, dispatcher('charge', 'billing'));
        const result = await engine.execute('charge');
        expect(result.success, String(result.error)).toBe(true);
        expect(pings).toEqual(['billing']);
    });

    it('dispatches to the one holder in its declared dependency closure', async () => {
        install(A);
        install(P, [A]);
        declareConnector('billing', A);
        liveConnector('billing');
        ship(P, dispatcher('charge', 'billing'));
        const result = await engine.execute('charge');
        expect(result.success, String(result.error)).toBe(true);
        expect(pings).toEqual(['billing']);
    });

    it('an environment-authored flow dispatches to the one package holder (a caller with no package)', async () => {
        install(A);
        declareConnector('billing', A);
        liveConnector('billing');
        author(dispatcher('my_charge', 'billing'));
        const result = await engine.execute('my_charge');
        expect(result.success, String(result.error)).toBe(true);
        expect(pings).toEqual(['billing']);
    });

    it('a connector a plugin registers in code is no registry item, and still dispatches', async () => {
        install(P);
        liveConnector('slack');
        ship(P, dispatcher('notify', 'slack'));
        const result = await engine.execute('notify');
        expect(result.success, String(result.error)).toBe(true);
        expect(pings).toEqual(['slack']);
    });

    it('red line 1 — a packaged flow is never served an instance held only outside its closure: refused naming the holder, nothing dispatched', async () => {
        install(Q);
        install(P);
        declareConnector('billing', Q);
        liveConnector('billing');
        ship(P, dispatcher('charge', 'billing'));
        const result = await engine.execute('charge');
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain("connector_action 'call'");
        expect(String(result.error)).toContain(Q);
        expect(pings).toEqual([]);
    });

    it('ADR-0150 D3 (a) — a packaged flow never resolves to an environment-only instance: refused, nothing dispatched', async () => {
        install(P);
        declareConnector('billing');
        liveConnector('billing');
        ship(P, dispatcher('charge', 'billing'));
        const result = await engine.execute('charge');
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain("connector_action 'call'");
        expect(String(result.error)).toContain('environment');
        expect(pings).toEqual([]);
    });

    it('red line 2 — two holders in its closure: refused naming both, never the first listed', async () => {
        install(A);
        install(Q);
        install(P, [A, Q]);
        declareConnector('billing', A);
        declareConnector('billing', Q);
        liveConnector('billing');
        ship(P, dispatcher('charge', 'billing'));
        const result = await engine.execute('charge');
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain(A);
        expect(String(result.error)).toContain(Q);
        expect(pings).toEqual([]);
    });
});
