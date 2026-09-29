// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20590 — every credential position a flow definition can hold is withheld by
 * the registered `flow` redactor, at every depth a node can sit.
 *
 * #20552 withheld one position: the start node's inbound-hook secret. This
 * file is the family's enumeration pin. It does not list the positions by
 * hand. It READS them from the node config contracts the platform declares —
 * every builtin executor's descriptor `configSchema` (the vocabulary
 * `registerFlow` checks a node's `config` against), the schemaless builtins'
 * spec Zod contracts, and the approval node's — and asks the one projection to
 * withhold each credential-named key it finds. So a node kind that declares a
 * new credential key turns this file red until the projection covers it, or
 * until the key is reviewed into {@link NOT_A_CREDENTIAL} with a reason.
 *
 * "Every depth": an ADR-0031 container (`loop`, `parallel`, `try_catch`) holds
 * whole sub-graphs inside its own `config` (`FLOW_REGION_SLOTS`), so an `http`
 * callout inside a loop body is a node whose definition is served with the
 * flow like any other. A projection that walked only the top-level `nodes`
 * would serve every nested one.
 */

import { describe, it, expect } from 'vitest';
import {
    FLOW_REGION_SLOTS_BY_TYPE,
    getApprovalNodeConfigJsonSchema,
    getSchemalessNodeConfigJsonSchemas,
} from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';
import {
    FLOW_CREDENTIAL_CLEARED,
    FLOW_NODE_CREDENTIAL_KEYS,
    redactFlowCredentials,
} from './flow-credential-projection.js';

function silentLogger(): any {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

/** The node config contracts the platform declares, keyed by `node.type`. */
function declaredNodeConfigSchemas(): Map<string, unknown> {
    const engine = new AutomationEngine(silentLogger());
    installBuiltinNodes(engine, { logger: silentLogger(), getService() { throw new Error('none'); } } as any);
    const out = new Map<string, unknown>();
    for (const descriptor of engine.getActionDescriptors()) {
        if (descriptor.configSchema) out.set(descriptor.type, descriptor.configSchema);
    }
    for (const [type, schema] of Object.entries(getSchemalessNodeConfigJsonSchemas())) {
        if (!out.has(type)) out.set(type, schema);
    }
    out.set('approval', getApprovalNodeConfigJsonSchema());
    return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Every declared property path under one node type's `config`, as dotted
 * segments (`*` for an array item or an open map's value). A container's
 * region slots are not descended into: what they hold is nodes, each with its
 * own type and its own contract, which this enumeration already reads.
 */
function declaredConfigPaths(nodeType: string, root: unknown): string[][] {
    const regionKeys = new Set((FLOW_REGION_SLOTS_BY_TYPE.get(nodeType) ?? []).map((slot) => slot.key));
    const defs = isRecord(root) && isRecord(root.$defs) ? root.$defs : {};
    const out: string[][] = [];
    const seen = new Set<unknown>();
    const walk = (schema: unknown, prefix: string[]): void => {
        if (!isRecord(schema)) return;
        if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
            const target = defs[schema.$ref.slice('#/$defs/'.length)];
            if (seen.has(target)) return;
            seen.add(target);
            walk(target, prefix);
            return;
        }
        for (const branch of ['anyOf', 'oneOf', 'allOf'] as const) {
            const list = schema[branch];
            if (Array.isArray(list)) for (const sub of list) walk(sub, prefix);
        }
        if (isRecord(schema.properties)) {
            for (const [key, sub] of Object.entries(schema.properties)) {
                const path = [...prefix, key];
                out.push(path);
                if (prefix.length === 0 && regionKeys.has(key)) continue;
                walk(sub, path);
            }
        }
        if (isRecord(schema.items)) walk(schema.items, [...prefix, '*']);
        if (isRecord(schema.additionalProperties)) walk(schema.additionalProperties, [...prefix, '*']);
    };
    walk(root, []);
    return out;
}

/**
 * The credential-name vocabulary. Deliberately broad: under-redacting is the
 * dangerous direction, so a key this matches must be covered by the
 * projection or reviewed out below — a false positive costs one line with a
 * reason, a false negative serves a secret.
 */
const CREDENTIAL_NAME = /secret|passw(?:or)?d|pwd|token|api[-_]?key|access[-_]?key|private[-_]?key|credential|bearer|signing/i;

/**
 * Declared keys the vocabulary matches that are NOT credentials, each with the
 * reason it was reviewed out. Empty today; an entry needs its reason.
 */
const NOT_A_CREDENTIAL: ReadonlyMap<string, string> = new Map<string, string>([]);

/**
 * The positions no schema declares, with their authority. The start node's
 * `config` is an open record (FlowNodeSchema), so its inbound-hook secret is
 * declared by ADR-0041 and enforced by the engine's `validateApiTriggerSecret`
 * rather than read off a contract.
 */
const SCHEMALESS_POSITIONS: ReadonlyArray<readonly [string, string]> = [['start', 'secret']];

function credentialPositions(): Array<readonly [string, string]> {
    const found: Array<readonly [string, string]> = [...SCHEMALESS_POSITIONS];
    for (const [nodeType, schema] of declaredNodeConfigSchemas()) {
        for (const path of declaredConfigPaths(nodeType, schema)) {
            const key = path[path.length - 1]!;
            if (key === '*' || !CREDENTIAL_NAME.test(key)) continue;
            const id = `${nodeType}.${path.join('.')}`;
            if (NOT_A_CREDENTIAL.has(id)) continue;
            found.push([nodeType, path.join('.')] as const);
        }
    }
    return found;
}

const SENTINEL = 'credential-position-sentinel-20590';

/** A node of `nodeType` carrying the sentinel at `configKey`, with a unique id. */
function nodeWith(id: string, nodeType: string, configKey: string): Record<string, unknown> {
    return { id, type: nodeType, label: id, config: { [configKey]: SENTINEL } };
}

/** The same credential-bearing node, placed at each depth a node can sit. */
function placements(nodeType: string, configKey: string): Array<{ where: string; flow: Record<string, unknown> }> {
    const inner = () => nodeWith('inner', nodeType, configKey);
    const tail = { id: 'tail', type: 'assignment', label: 'Tail', config: {} };
    const shell = (node: Record<string, unknown>) => ({
        name: 'positions_20590',
        label: 'Positions',
        type: 'autolaunched',
        nodes: [{ id: 'begin', type: 'start', label: 'Start', config: {} }, node],
        edges: [],
    });
    return [
        { where: 'top level', flow: shell(inner()) },
        {
            where: 'a loop body',
            flow: shell({ id: 'box', type: 'loop', label: 'Loop', config: { collection: '{items}', body: { nodes: [inner()], edges: [] } } }),
        },
        {
            where: 'a parallel branch',
            flow: shell({
                id: 'box', type: 'parallel', label: 'Parallel',
                config: { branches: [{ name: 'a', nodes: [tail] }, { name: 'b', nodes: [inner()] }] },
            }),
        },
        {
            where: 'a try region',
            flow: shell({ id: 'box', type: 'try_catch', label: 'Try', config: { try: { nodes: [inner()], edges: [] } } }),
        },
        {
            where: 'a catch region',
            flow: shell({
                id: 'box', type: 'try_catch', label: 'Try',
                config: { try: { nodes: [tail], edges: [] }, catch: { nodes: [inner()], edges: [] } },
            }),
        },
    ];
}

describe('#20590 — the enumeration: every declared credential position is withheld', () => {
    const positions = credentialPositions();

    it('reads a real population — the walk is not vacuous', () => {
        // Anti-vacuity: the declared universe is large, and the `http`
        // node's outbound HMAC secret is in it (HttpConfigSchema,
        // `signingSecret`). A walk that stopped reading schemas would find
        // only the hand-listed start position and pass everything below.
        const universe = [...declaredNodeConfigSchemas()].flatMap(([t, s]) => declaredConfigPaths(t, s).map((p) => `${t}.${p.join('.')}`));
        expect(universe.length).toBeGreaterThan(40);
        expect(positions.map(([t, k]) => `${t}.${k}`)).toContain('http.signingSecret');
    });

    it('the projection covers exactly the declared positions — no fewer, and none that is no longer declared', () => {
        const declared = positions.map(([t, k]) => `${t}.${k}`).sort();
        const covered = [...FLOW_NODE_CREDENTIAL_KEYS].flatMap(([t, keys]) => keys.map((k) => `${t}.${k}`)).sort();
        expect(covered).toEqual(declared);
    });

    for (const [nodeType, configKey] of credentialPositions()) {
        for (const { where, flow } of placements(nodeType, configKey)) {
            it(`withholds ${nodeType}.config.${configKey} at ${where}`, () => {
                const before = structuredClone(flow);
                const { item, redactedKeys } = redactFlowCredentials(flow);
                expect(JSON.stringify(item)).not.toContain(SENTINEL);
                expect(redactedKeys.length).toBeGreaterThan(0);
                // Pure: the stored body the engine executes keeps it.
                expect(flow).toEqual(before);
            });
        }
    }
});

describe('#20590 — what the projection answers, position by position', () => {
    it('names each withheld path, through every region kind, by the index in the body it was handed', () => {
        const flow = {
            name: 'nested',
            label: 'Nested',
            nodes: [
                { id: 'begin', type: 'start', label: 'Start', config: { secret: 'hook' } },
                {
                    id: 'each', type: 'loop', label: 'Each',
                    config: {
                        collection: '{rows}',
                        body: { nodes: [{ id: 'call', type: 'http', label: 'Call', config: { url: 'https://x', signingSecret: 'sign-1' } }], edges: [] },
                    },
                },
                {
                    id: 'fan', type: 'parallel', label: 'Fan',
                    config: {
                        branches: [
                            { name: 'a', nodes: [{ id: 'noop', type: 'assignment', label: 'Noop', config: {} }] },
                            { name: 'b', nodes: [{ id: 'push', type: 'http', label: 'Push', config: { url: 'https://y', signingSecret: 'sign-2' } }] },
                        ],
                    },
                },
            ],
            edges: [],
        };
        const { item, redactedKeys } = redactFlowCredentials(flow);
        expect(redactedKeys).toEqual([
            'nodes.0.config.secret',
            'nodes.1.config.body.nodes.0.config.signingSecret',
            'nodes.2.config.branches.1.nodes.0.config.signingSecret',
        ]);
        const text = JSON.stringify(item);
        for (const s of ['hook', 'sign-1', 'sign-2']) expect(text).not.toContain(`"${s}"`);
        // Everything that is not a credential survives, and untouched subtrees are shared.
        const nodes = item.nodes as any[];
        expect(nodes[1].config.body.nodes[0].config).toEqual({ url: 'https://x' });
        expect(nodes[2].config.branches[0]).toBe((flow.nodes[2] as any).config.branches[0]);
    });

    it('serves the cleared form as written — the empty string holds no credential', () => {
        const flow = {
            name: 'cleared',
            label: 'Cleared',
            nodes: [
                { id: 'begin', type: 'start', label: 'Start', config: { secret: FLOW_CREDENTIAL_CLEARED } },
                { id: 'call', type: 'http', label: 'Call', config: { url: 'https://x', signingSecret: FLOW_CREDENTIAL_CLEARED } },
            ],
            edges: [],
        };
        const result = redactFlowCredentials(flow);
        expect(result.redactedKeys).toEqual([]);
        expect(result.item).toBe(flow);
        // A blank that is not empty is still a value somebody typed: withheld.
        const spaced = { ...flow, nodes: [flow.nodes[0], { ...flow.nodes[1], config: { url: 'https://x', signingSecret: ' ' } }] };
        expect(redactFlowCredentials(spaced).redactedKeys).toEqual(['nodes.1.config.signingSecret']);
    });

    it('withholds nothing from a key of the same name on a kind that does not hold that credential', () => {
        const flow = {
            name: 'lookalike',
            label: 'Lookalike',
            nodes: [{ id: 'n', type: 'assignment', label: 'N', config: { signingSecret: 'not-a-position', secret: 'nor-this' } }],
            edges: [],
        };
        const result = redactFlowCredentials(flow);
        expect(result.redactedKeys).toEqual([]);
        expect(result.item).toBe(flow);
    });
});
