// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20316 — what a node's executor needs its `config` to carry is refused at
 * `AutomationEngine.registerFlow`, the second of the three doors.
 *
 * Measured before the change, on every contract-parsing builtin: a flow whose
 * node left out a key the node's executor contract requires REGISTERED, and
 * then every run that reached the node failed there — `parseNodeConfig`
 * refusing it as a guard. And a `decision` branch with no `label` registered
 * and ran GREEN, down every out-edge.
 *
 * ## Which gate answers, measured rather than assumed
 *
 * `registerFlow` parses first (`canonicalizeStoredFlow` → `FlowSchema.parse`),
 * and the flow parse refuses these shapes itself, through the spec's one judge
 * `flowNodeConfigRefusals` — so what this door hands back is the PARSE's Zod
 * issue, `custom`, anchored at the key. The census below is the one
 * `FlowSchema.parse` runs in `spec` (`flow-node-config-required.test.ts`), and
 * each executor below is the REAL builtin, so a refused row is also shown to
 * be one the run refused.
 */
import { describe, expect, it, vi } from 'vitest';
import { flowNodeConfigRefusals } from '@objectstack/spec/automation';

import { AutomationEngine } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => silentLogger } as any;
const ctx = { logger: silentLogger, getService: () => { throw new Error('none'); } } as any;

type Node = Record<string, unknown>;
type Config = Record<string, unknown>;

function builtinEngine(visited?: string[]): AutomationEngine {
    const engine = new AutomationEngine(silentLogger);
    installBuiltinNodes(engine, ctx);
    engine.registerNodeExecutor({
        type: 'mark',
        async execute(node) {
            visited?.push(node.id);
            return { success: true };
        },
    });
    engine.sealNodeTypeVocabulary();
    return engine;
}

function flowWith(name: string, ...middle: Node[]) {
    const nodes: Node[] = [{ id: 'start', type: 'start', label: 'Start' }, ...middle];
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: String(nodes[i].id), target: String(n.id) }));
    return { name, label: name, type: 'autolaunched', nodes, edges };
}

/** What `registerFlow` threw, or `undefined` when it registered. */
function refusalOf(engine: AutomationEngine, flow: { name: string }): { issues?: Array<{ code: string; path: unknown[]; message: string }> } | undefined {
    try {
        engine.registerFlow(flow.name, flow as never);
        return undefined;
    } catch (e) {
        return e as never;
    }
}

function segmentsOf(path: string): (string | number)[] {
    return path.split('.').flatMap((part) => {
        const bracket = part.indexOf('[');
        if (bracket === -1) return [part];
        return [part.slice(0, bracket), ...[...part.slice(bracket).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))];
    });
}

function without(config: Config, path: string): Config {
    const copy = JSON.parse(JSON.stringify(config)) as Config;
    const segments = segmentsOf(path);
    let parent: any = copy;
    for (const segment of segments.slice(0, -1)) parent = parent[segment];
    delete parent[segments[segments.length - 1]];
    return copy;
}

const region = (tag: string) => ({ nodes: [{ id: `inner_${tag}`, type: 'mark', label: tag }], edges: [] });
const SCREEN: Config = { fields: [{ name: 'tier', label: 'Tier', type: 'select', options: [{ label: 'Gold', value: 'gold' }] }] };

/** The census — the same rows `FlowSchema.parse` runs in `spec`. */
const CENSUS: Array<{ type: string; config: Config; key: string }> = [
    { type: 'get_record', config: { objectName: 'account', outputVariable: 'rows' }, key: 'objectName' },
    { type: 'create_record', config: { objectName: 'account', fields: { name: 'Acme' } }, key: 'objectName' },
    { type: 'update_record', config: { objectName: 'account', filter: { id: '1' }, fields: { name: 'Acme' } }, key: 'objectName' },
    { type: 'delete_record', config: { objectName: 'account', filter: { id: '1' } }, key: 'objectName' },
    { type: 'notify', config: { recipients: ['u1'], title: 'Hi' }, key: 'recipients' },
    { type: 'http', config: { url: 'https://example.invalid/hook' }, key: 'url' },
    { type: 'screen', config: SCREEN, key: 'fields[0].name' },
    { type: 'screen', config: SCREEN, key: 'fields[0].options[0].value' },
    { type: 'screen', config: SCREEN, key: 'fields[0].options[0].label' },
    { type: 'script', config: { function: 'recalc_totals' }, key: 'function' },
    { type: 'subflow', config: { flowName: 'child_flow' }, key: 'flowName' },
    { type: 'map', config: { collection: [1], flowName: 'child_flow' }, key: 'collection' },
    { type: 'map', config: { collection: [1], flowName: 'child_flow' }, key: 'flowName' },
    { type: 'loop', config: { collection: [1], body: region('loop') }, key: 'collection' },
    { type: 'parallel', config: { branches: [region('p1'), region('p2')] }, key: 'branches' },
    { type: 'try_catch', config: { try: region('try'), catch: region('catch') }, key: 'try' },
];

describe('registerFlow refuses a key the node\'s executor contract requires, left out (#20316)', () => {
    it.each(CENSUS)('$type without `$key` does not register, and the refusal is the one judge\'s', ({ type, config, key }) => {
        const engine = builtinEngine();
        const authored = without(config, key);
        const refusal = refusalOf(engine, flowWith('census_probe', { id: 'n', type, label: 'N', config: authored }));
        expect(refusal).toBeDefined();
        expect(refusal!.issues?.map((i) => [i.code, i.path, i.message])).toEqual([
            ['custom', ['nodes', 1, 'config', ...segmentsOf(key)], flowNodeConfigRefusals(type, authored)[0].message],
        ]);
    });

    it.each(CENSUS)('$type with `$key` registers — the accept control', ({ type, config }) => {
        const engine = builtinEngine();
        expect(refusalOf(engine, flowWith('census_probe', { id: 'n', type, label: 'N', config }))).toBeUndefined();
    });

    it('CONTROL — a legacy flat-graph `loop` (no `body`, no `collection`) still registers and runs', async () => {
        const engine = builtinEngine();
        expect(refusalOf(engine, flowWith('legacy_loop', { id: 'n', type: 'loop', label: 'N', config: {} }))).toBeUndefined();
        expect((await engine.execute('legacy_loop', { params: {} } as never)).success).toBe(true);
    });
});

/**
 * What a refused shape DID at run time — the ground each refusal stands on.
 * It can no longer register, so each run registers the whole config and
 * deletes the key from the stored flow before executing, the way
 * `decision-branch-expression-absent.test.ts` measures the absent predicate.
 */
describe('what the refused shapes did at run time (#20316)', () => {
    async function runWithout(type: string, config: Config, key: string) {
        const engine = builtinEngine();
        engine.registerFlow('child_flow', flowWith('child_flow') as never);
        const parsed = engine.registerFlow('probe', flowWith('probe', { id: 'n', type, label: 'N', config }) as never);
        const stored = parsed.nodes[1].config as Config;
        const segments = segmentsOf(key);
        let parent: any = stored;
        for (const segment of segments.slice(0, -1)) parent = parent[segment];
        delete parent[segments[segments.length - 1]];
        return engine.execute('probe', { params: {} } as never);
    }

    it.each([
        { type: 'loop', config: { collection: [1], body: region('loop') }, key: 'collection' },
        { type: 'map', config: { collection: [1], flowName: 'child_flow' }, key: 'collection' },
        { type: 'subflow', config: { flowName: 'child_flow' }, key: 'flowName' },
        { type: 'parallel', config: { branches: [region('p1'), region('p2')] }, key: 'branches' },
    ])('$type without `$key` failed the run at the node, as a contract refusal', async ({ type, config, key }) => {
        const result = await runWithout(type, config, key);
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain(`config does not satisfy the ${type} contract — config.${key}`);
    });

    async function routeWith(branch: Record<string, unknown>) {
        const visited: string[] = [];
        const engine = builtinEngine(visited);
        const parsed = engine.registerFlow('route', {
            name: 'route', label: 'Route', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'd', type: 'decision', label: 'D', config: { conditions: [{ label: 'yes', expression: 'true' }] } },
                { id: 'y', type: 'mark', label: 'y' },
                { id: 'x', type: 'mark', label: 'x' },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'd' },
                { id: 'e1', source: 'd', target: 'y', label: 'yes' },
                { id: 'e2', source: 'd', target: 'x', isDefault: true },
            ],
        } as never);
        (parsed.nodes[1].config as { conditions: unknown[] }).conditions[0] = branch;
        const result = await engine.execute('route', { params: {} } as never);
        return { success: result.success, visited: visited.sort() };
    }

    it('a matched branch with no `label` ran GREEN down EVERY out-edge — the labelled one and the default', async () => {
        expect(await routeWith({ expression: 'true' })).toEqual({ success: true, visited: ['x', 'y'] });
    });

    it('CONTROL — the same branch carrying its label takes only the out-edge it names', async () => {
        expect(await routeWith({ label: 'yes', expression: 'true' })).toEqual({ success: true, visited: ['y'] });
    });

    it('a branch that is a bare string failed the run at the node', async () => {
        expect((await routeWith('true' as never)).success).toBe(false);
    });
});

describe('registerFlow refuses a decision branch list the executor cannot read (#20316)', () => {
    const decision = (config: Config): Node => ({ id: 'd', type: 'decision', label: 'D', config });

    it.each([
        ['a branch with no `label`', { conditions: [{ expression: 'true' }] }, ['conditions', 0, 'label']],
        ['a branch with a blank `label`', { conditions: [{ label: ' ', expression: 'true' }] }, ['conditions', 0, 'label']],
        ['a branch that is a string', { conditions: ['true'] }, ['conditions', 0]],
        ['`conditions` that is an object', { conditions: {} }, ['conditions']],
    ])('%s does not register', (_name, config, at) => {
        const engine = builtinEngine();
        const refusal = refusalOf(engine, flowWith('decision_probe', decision(config)));
        expect(refusal!.issues?.map((i) => [i.code, i.path, i.message])).toEqual([
            ['custom', ['nodes', 1, 'config', ...at], flowNodeConfigRefusals('decision', config)[0].message],
        ]);
    });

    it('CONTROL — a labelled branch, and a decision with no branch list, register', () => {
        expect(refusalOf(builtinEngine(), flowWith('decision_probe', decision({ conditions: [{ label: 'y', expression: 'true' }] })))).toBeUndefined();
        expect(refusalOf(builtinEngine(), flowWith('decision_probe', decision({})))).toBeUndefined();
    });
});
