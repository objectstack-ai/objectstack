// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4, #32073] A flow `script` node's function is resolved in the
 * package of the calling flow, through the ONE package-scoped resolver for
 * functions (`resolvePackageScopedFunction`, `@objectstack/objectql`) —
 * attached the way the automation plugin attaches it (`functionResolverOf`
 * over the `objectql` service), over a real `ObjectQL`: functions registered
 * per package exactly as `AppPlugin` registers them (owner `app:<id>`),
 * packages installed through `installPackage`, so each caller's declared
 * dependency closure is the save door's.
 *
 * The caller is the package whose OWN body is armed under the flow's name
 * (`AutomationEngine#flowCallerPackage`); an environment-authored flow and an
 * environment override of a packaged flow are callers with no package.
 *
 * Each refusal pin asserts the in-flow failure (the step's text names every
 * candidate, `innerRefusal.code` is `RESOURCE_CONFLICT`) and that NO candidate
 * ran. The one-holder CONTROLs (own, closure, environment-wide, platform) are
 * answered exactly as the bare map answers them on main. The pins were ablated
 * once (the bridge put back to the bare map's last registration, the pins read
 * red, restored); the readings are in the PR body, not kept as test files.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL, PackageScopedNameRefusedError, type SchemaRegistry } from '@objectstack/objectql';
import { LiteKernel } from '@objectstack/core';
import { bindStoredRow } from '@objectstack/metadata-protocol';
import { installedManifestsOf } from '@objectstack/metadata-core';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';
import { AutomationServicePlugin, flowNameResolver } from './plugin.js';
import { functionResolverOf, isPackageScopedRefusal, packageScopedFunctionEngineOf } from './function-package-scope.js';
import { resolveFlowPrecedence } from './flow-precedence.js';

const P = 'com.acme.caller';
const A = 'com.acme.alpha';
const Q = 'com.acme.stranger';
const FN = 'shared_fn';

function silentLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
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

/** start → script(function) → end; the function's return lands in `out`. */
function scripted(name: string, fn = FN) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'run', type: 'script', label: 'Run', config: { function: fn, outputVariable: 'out' } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'run' },
            { id: 'e2', source: 'run', target: 'end' },
        ],
    };
}

let ql: ObjectQL;
let registry: SchemaRegistry;
let engine: AutomationEngine;
/** The loader's set: which package ships each flow name (the engine's `packagedFlowOwner`). */
let loaderSet: Record<string, string>;
/** Which holder's function ran, in order. */
let ran: string[];

const install = (id: string, deps: string[] = []) => registry.installPackage(manifest(id, deps), 'code');

/** `holder`'s function `name`, registered as `AppPlugin` registers a package's `functions` (owner `app:<id>`), or owner-less (the platform). */
function holds(holder: string | null, name = FN, effect?: 'writes') {
    // A flow function returns its result; the registry's handler type is the hook one.
    const fn = (async () => { ran.push(holder ?? 'platform'); return holder ?? 'platform'; }) as never;
    if (holder === null) ql.registerFunction(name, fn, effect ? { effect } : undefined);
    else ql.registerFunction(name, fn, { packageId: `app:${holder}`, ...(effect ? { effect } : {}) });
}

/** Package `packageId` ships flow `body`: in its registry slot, the loader's set and the engine — armed from its own body. */
function ship(packageId: string, body: { name: string }) {
    registry.registerItem('flow', { ...body, _packageId: packageId }, 'name' as never, packageId);
    loaderSet[body.name] = packageId;
    engine.registerFlow(body.name, body, { source: 'package', packageId });
}

/** The environment authored flow `body`: a package-less row in the bare slot, and the engine. */
function author(body: { name: string }) {
    registry.registerItem('flow', { ...body, _provenance: 'org' }, 'name' as never);
    engine.registerFlow(body.name, body);
}

function serviceCtx() {
    return {
        logger: silentLogger(),
        getService(name: string) {
            if (name === 'objectql') return ql;
            throw new Error(`no ${name}`);
        },
    } as any;
}

beforeEach(() => {
    ql = new ObjectQL({ logger: silentLogger() } as never);
    registry = ql.registry;
    registry.logLevel = 'silent';
    loaderSet = {};
    ran = [];
    engine = new AutomationEngine(silentLogger());
    const ctx = serviceCtx();
    installBuiltinNodes(engine, ctx);
    engine.setPackagedFlowSource((name) => loaderSet[name]);
    engine.setFlowNameResolver(flowNameResolver(ctx));
    engine.setFunctionResolver(functionResolverOf(packageScopedFunctionEngineOf(ql)!));
});

function expectRefusedRun(result: Awaited<ReturnType<AutomationEngine['execute']>>, ...named: string[]) {
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("script node 'run'");
    for (const n of named) expect(String(result.error)).toContain(n);
    expect(result.innerRefusal?.code).toBe('RESOURCE_CONFLICT');
    expect(ran, 'a candidate ran on a refused name').toEqual([]);
}

describe('#32073 — two packages hold one function name: each packaged flow runs its own', () => {
    for (const order of [[A, Q], [Q, A]] as const) {
        it(`registered ${order.join(' then ')}: A's flow runs A's, Q's flow runs Q's — never the last registration`, async () => {
            install(A);
            install(Q);
            holds(order[0]);
            holds(order[1]);
            // [#31700, epic seat ruling R2-C] The bare read of a name two packages
            // hold picks neither (it answered the last registration before).
            expect(() => ql.resolveFunctionEntry(FN), 'the bare read is refused, naming both').toThrow(PackageScopedNameRefusedError);
            ship(A, scripted('a_flow'));
            ship(Q, scripted('q_flow'));

            const a = await engine.execute('a_flow');
            expect(a.success, String(a.error)).toBe(true);
            expect(ran).toEqual([A]);
            ran = [];
            const q = await engine.execute('q_flow');
            expect(q.success, String(q.error)).toBe(true);
            expect(ran).toEqual([Q]);
        });
    }

    it('its own function wins over a holder in its declared closure', async () => {
        install(A);
        install(P, [A]);
        holds(A);
        holds(P);
        holds(A, 'unrelated');
        ship(P, scripted('p_flow'));
        const result = await engine.execute('p_flow');
        expect(result.success, String(result.error)).toBe(true);
        expect(ran).toEqual([P]);
    });
});

describe('#32073 — a name that means no single function is refused (409 RESOURCE_CONFLICT), never guessed', () => {
    it('a caller with no package (an environment flow) and two package holders: the step fails naming both', async () => {
        install(A);
        install(Q);
        holds(A);
        holds(Q);
        author(scripted('env_flow'));
        const result = await engine.execute('env_flow');
        expectRefusedRun(result, A, Q, 'in this environment and the caller names no package');
    });

    it('the published in-process read answers the same refusal: AutomationEngine#resolveFunction throws it, code and status declared', () => {
        install(A);
        install(Q);
        holds(A);
        holds(Q);
        let thrown: unknown;
        try {
            engine.resolveFunction(FN);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(PackageScopedNameRefusedError);
        expect(isPackageScopedRefusal(thrown)).toBe(true);
        expect(thrown).toMatchObject({
            code: 'RESOURCE_CONFLICT',
            status: 409,
            refusal: {
                status: 'refused',
                reason: 'ambiguous-in-environment',
                callerPackageId: null,
                candidates: [{ kind: 'package', packageId: A }, { kind: 'package', packageId: Q }],
            },
        });
    });

    it('D3 (c) — a packaged flow naming a function only a package OUTSIDE its declared closure holds: refused naming the holder', async () => {
        install(Q);
        install(P);
        holds(Q);
        ship(P, scripted('p_flow'));
        const result = await engine.execute('p_flow');
        expectRefusedRun(result, `held outside the declared dependency closure of package "${P}"`, Q);
    });

    it('two holders in its declared closure and none of its own: refused naming both', async () => {
        install(A);
        install(Q);
        install(P, [A, Q]);
        holds(A);
        holds(Q);
        ship(P, scripted('p_flow'));
        const result = await engine.execute('p_flow');
        expectRefusedRun(result, `in the declared dependency closure of package "${P}"`, A, Q);
    });

    it('the platform\'s owner-less function beside a package holder: refused naming both, for a caller with no package', async () => {
        install(A);
        holds(null);
        holds(A);
        author(scripted('env_flow'));
        const result = await engine.execute('env_flow');
        expectRefusedRun(result, A, 'the platform');
    });

    it('the platform\'s owner-less function beside a holder in the caller\'s closure: refused naming both', async () => {
        install(A);
        install(P, [A]);
        holds(A);
        holds(null);
        ship(P, scripted('p_flow'));
        const result = await engine.execute('p_flow');
        expectRefusedRun(result, A, 'the platform');
    });

    it('the failed step hands the flow `$error.code` RESOURCE_CONFLICT: a try_catch catch region reads it', async () => {
        install(A);
        install(Q);
        holds(A);
        holds(Q);
        const seen: unknown[] = [];
        engine.registerNodeExecutor({
            type: 'read_error',
            async execute(_node: unknown, variables: Map<string, unknown>) {
                seen.push(variables.get('$error'));
                return { success: true };
            },
        } as unknown as NodeExecutor);
        author({
            name: 'env_flow',
            label: 'env_flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: {} },
                {
                    id: 'guard', type: 'try_catch', label: 'Guard',
                    config: {
                        try: { nodes: [{ id: 'run', type: 'script', label: 'Run', config: { function: FN, outputVariable: 'out' } }], edges: [] },
                        catch: { nodes: [{ id: 'read', type: 'read_error', label: 'Read' }], edges: [] },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'guard' },
                { id: 'e2', source: 'guard', target: 'end' },
            ],
        } as never);
        await engine.execute('env_flow');
        expect(seen, 'the catch region ran once').toHaveLength(1);
        // The try_catch container stamps its own id on the `$error` its region
        // reads; the code is the script node's, carried through.
        expect((seen[0] as { code?: unknown }).code).toBe('RESOURCE_CONFLICT');
        expect(String((seen[0] as { message?: unknown }).message)).toContain(A);
        expect(ran, 'a candidate ran on a refused name').toEqual([]);
    });

    it('a refusal is a guard: a fault edge does not route the run past it', async () => {
        install(A);
        install(Q);
        holds(A);
        holds(Q);
        holds(null, 'fallback');
        const flow = scripted('env_flow');
        flow.nodes.push({ id: 'handler', type: 'script', label: 'Handler', config: { function: 'fallback', outputVariable: 'h' } });
        flow.edges.push({ id: 'f1', source: 'run', target: 'handler', type: 'fault' } as never);
        author(flow);
        const result = await engine.execute('env_flow');
        expectRefusedRun(result, A, Q);
    });
});

describe('#32073 CONTROL — a name with one holder in reach is served exactly as the bare map serves it', () => {
    it('own: a packaged flow runs its package\'s function, with what it declared (#4396 effect)', async () => {
        install(P);
        holds(P, FN, 'writes');
        ship(P, scripted('p_flow'));
        expect(engine.resolveFunction(FN, { flowName: 'p_flow' } as never)?.effect).toBe(ql.resolveFunctionEntry(FN)?.effect);
        const result = await engine.execute('p_flow');
        expect(result.success, String(result.error)).toBe(true);
        expect(ran).toEqual([P]);
    });

    it('closure: a packaged flow runs the one holder in its declared closure', async () => {
        install(A);
        install(P, [A]);
        holds(A);
        ship(P, scripted('p_flow'));
        const result = await engine.execute('p_flow');
        expect(result.success, String(result.error)).toBe(true);
        expect(ran).toEqual([A]);
    });

    it('environment-wide: a flow with no package runs the one package holder', async () => {
        install(Q);
        holds(Q);
        author(scripted('env_flow'));
        const result = await engine.execute('env_flow');
        expect(result.success, String(result.error)).toBe(true);
        expect(ran).toEqual([Q]);
    });

    it('platform: the owner-less function alone is in every caller\'s reach', async () => {
        install(P);
        holds(null);
        ship(P, scripted('p_flow'));
        author(scripted('env_flow'));
        expect((await engine.execute('p_flow')).success).toBe(true);
        expect((await engine.execute('env_flow')).success).toBe(true);
        expect(ran).toEqual(['platform', 'platform']);
    });

    it('an unregistered name still fails with "no function named … is registered" (no refusal)', async () => {
        install(P);
        ship(P, scripted('p_flow', 'never_registered'));
        const result = await engine.execute('p_flow');
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain("no function named 'never_registered' is registered");
        expect(result.innerRefusal).toBeUndefined();
    });
});

describe('#32073 — an environment override of a packaged flow names its function with no package (ADR-0150 D3, the paragraph after (a)–(d))', () => {
    /** P ships `body`'s name; the engine arms `armed` for it the way the plugin does. */
    function armOverName(body: { name: string }, armed: unknown) {
        install(P);
        registry.registerItem('flow', { ...body, _packageId: P }, 'name' as never, P);
        loaderSet[body.name] = P;
        const [winner] = resolveFlowPrecedence([armed], undefined, (name) => engine.packagedFlowOwner(name), installedManifestsOf(registry));
        engine.registerFlow(winner.name, winner.definition as never, winner.contender);
    }

    it('a function only a package outside P\'s closure holds is reached by the override, as a caller with no package', async () => {
        install(Q);
        holds(Q);
        armOverName(scripted('p_flow'), bindStoredRow({ ...scripted('p_flow'), _provenance: 'org' }, null));
        expect(engine.armedFlowPackage('p_flow')).toBeUndefined();
        const result = await engine.execute('p_flow');
        expect(result.success, String(result.error)).toBe(true);
        expect(ran).toEqual([Q]);
    });

    it('two holders, one of them P: the override is refused naming both — never P\'s own on its behalf', async () => {
        install(Q);
        holds(Q);
        armOverName(scripted('p_flow'), bindStoredRow({ ...scripted('p_flow'), _provenance: 'org' }, null));
        holds(P);
        const result = await engine.execute('p_flow');
        expectRefusedRun(result, P, Q);
    });
});

describe('#32073 — the automation plugin attaches the package-scoped function resolver at start', () => {
    it('a booted engine resolves a script node\'s function by the flow\'s package', async () => {
        install(A);
        install(Q);
        holds(A);
        holds(Q);
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin());
        kernel.use({
            name: 'test.harness',
            type: 'standard' as const,
            version: '1.0.0',
            dependencies: ['com.objectstack.service-automation'],
            async init(ctx: any) {
                ctx.registerService('objectql', ql);
                ctx.registerService('protocol', {
                    packagedArtifactOwner: ({ type, name }: { type: string; name: string }) =>
                        type === 'flow' && name === 'a_flow' ? A : undefined,
                });
            },
            async start() {},
        } as never);
        await kernel.bootstrap();
        try {
            const booted = kernel.getService('automation') as AutomationEngine;
            booted.registerFlow('a_flow', scripted('a_flow'), { source: 'package', packageId: A });
            const own = booted.resolveFunction(FN, { flowName: 'a_flow' } as never);
            expect(typeof own?.handler).toBe('function');
            await own!.handler({} as never);
            expect(ran).toEqual([A]);
            expect(() => booted.resolveFunction(FN, { flowName: 'my_flow' } as never)).toThrow(PackageScopedNameRefusedError);
        } finally {
            await kernel.shutdown();
        }
    });

    it('an objectql service with no function holder set is left unbridged', () => {
        expect(packageScopedFunctionEngineOf({ resolveFunction: () => undefined })).toBeUndefined();
        expect(packageScopedFunctionEngineOf(undefined)).toBeUndefined();
        expect(packageScopedFunctionEngineOf(ql)).toBe(ql);
    });
});
