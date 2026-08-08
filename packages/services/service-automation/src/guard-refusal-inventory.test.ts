// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';
import { registerHttpNodes } from './builtin/http-nodes.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerMapNode } from './builtin/map-node.js';
import { registerConnectorNodes } from './builtin/connector-nodes.js';
import { refuseNode } from './guard-refusal.js';

/**
 * #3863 follow-up — the INVENTORY of refuse-to-execute guards, pinned by
 * behaviour rather than by reading the source.
 *
 * `errorClass` defaults to `'runtime'`, which was the right call for
 * compatibility (every executor written before the split keeps its routing) but
 * leaves the footgun pointing the other way: a guard that forgets to classify
 * itself is silently routable, and a `fault` edge then swallows it. Nothing in
 * the type system catches that.
 *
 * So each known guard is driven through the engine WITH a fault edge attached
 * and asserted still fatal. Unmarking any of them — or writing the next one
 * without {@link refuseNode} and adding it here — fails loudly instead of
 * quietly re-opening the hole.
 *
 * The negative half matters just as much: `runtime` failures listed at the
 * bottom MUST stay routable. Over-marking is not the safe direction — it turns
 * a condition the author can legitimately handle into a dead run.
 */

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

const dataStub = {
    find: async () => [],
    findOne: async () => null,
    create: async () => ({ id: 'x' }),
    update: async () => ({ modified: 0 }),
    delete: async () => ({ deleted: 0 }),
    getObject: () => ({ name: 'deal', fields: {} }),
};

function ctxWith(data: unknown): any {
    return {
        logger: createTestLogger(),
        getService(name: string) {
            return name === 'data' ? data : undefined;
        },
    };
}

/** A flow whose single operative node has BOTH a normal and a fault out-edge. */
function flowWithHandler(name: string, node: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'autolaunched' as const,
        runAs: 'system' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'op', label: 'Op', ...node },
            { id: 'handler', type: 'script' as any, label: 'Handler' },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'op' },
            { id: 'e2', source: 'op', target: 'end' },
            { id: 'e_fault', source: 'op', target: 'handler', type: 'fault' as const },
            { id: 'e3', source: 'handler', target: 'end' },
        ],
    };
}

/**
 * Every guard that must survive a declared fault edge. `node` is the operative
 * node; `expect` is a fragment of the refusal the run must fail with, so a guard
 * that starts failing for a DIFFERENT reason does not pass vacuously.
 */
const GUARDS: Array<{ name: string; why: string; node: Record<string, unknown>; expect: string }> = [
    // Since #4277 a missing REQUIRED key is refused by the executor's contract
    // parse (parse-config.ts) before the hand-written guard runs, so those
    // entries pin the parse refusal's fragment. The classification is the
    // point of this inventory and is unchanged: a contract violation is wrong
    // metadata, so it must stay a guard — un-routable.
    {
        name: 'get_record without objectName',
        why: 'a required config key — no run can supply it',
        node: { type: 'get_record', config: { filter: { id: 'x' } } },
        expect: 'does not satisfy the get_record contract',
    },
    {
        name: 'create_record without objectName',
        why: 'a required config key',
        node: { type: 'create_record', config: { fields: { a: 1 } } },
        expect: 'does not satisfy the create_record contract',
    },
    {
        name: 'update_record without objectName',
        why: 'a required config key',
        node: { type: 'update_record', config: { fields: { a: 1 } } },
        expect: 'does not satisfy the update_record contract',
    },
    {
        name: 'delete_record without objectName',
        why: 'a required config key',
        node: { type: 'delete_record', config: { filter: { id: 'x' } } },
        expect: 'does not satisfy the delete_record contract',
    },
    {
        name: 'get_record whose filter lost a condition (#3810)',
        why: 'an erased condition WIDENS the query — the reason #3810 exists',
        node: { type: 'get_record', config: { objectName: 'deal', filter: { owner: '{record.ownr}' } } },
        expect: 'refusing to run',
    },
    {
        name: 'update_record whose filter lost a condition (#3810)',
        why: 'the widened query would overwrite rows the author excluded',
        node: {
            type: 'update_record',
            config: { objectName: 'deal', filter: { owner: '{record.ownr}' }, fields: { stage: 'x' } },
        },
        expect: 'refusing to run',
    },
    {
        name: 'delete_record whose filter lost a condition (#3810)',
        why: 'the highest-stakes case — a collapsed filter empties the object',
        node: { type: 'delete_record', config: { objectName: 'deal', filter: { owner: '{record.ownr}' } } },
        expect: 'refusing to run',
    },
    {
        name: 'http without url',
        why: 'a required config key',
        node: { type: 'http', config: { method: 'GET' } },
        expect: 'does not satisfy the http contract',
    },
    {
        name: 'subflow without flowName',
        why: 'a required config key',
        node: { type: 'subflow', config: {} },
        // #4343 moved this from a hand-written `refuseNode` to the contract
        // parse, like the CRUD entries above. Same classification, same node —
        // only the message is now derived from `SubflowConfigSchema`.
        expect: 'does not satisfy the subflow contract',
    },
    {
        name: 'map without flowName',
        why: 'a required config key — the per-item subflow',
        node: { type: 'map', config: { collection: [] } },
        expect: 'flowName',
    },
    {
        name: 'connector_action without connectorId/actionId',
        why: 'required config keys',
        node: { type: 'connector_action', config: {} },
        expect: 'are required',
    },
    {
        name: 'a node that suspends while its descriptor declares supportsPause: false (#6667)',
        why: 'a wrong capability declaration — re-running cannot fix it, and the pause asked for would be unresumable',
        node: { type: 'mis_declared_pause' },
        expect: 'declares supportsPause: false',
    },
];

describe('#3863 — the guard inventory stays un-routable', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        const ctx = ctxWith(dataStub);
        registerCrudNodes(engine, ctx);
        registerHttpNodes(engine, ctx);
        registerSubflowNode(engine, ctx);
        registerMapNode(engine, ctx);
        registerConnectorNodes(engine, ctx);
        // #6667 — the newest member of the inventory, and the only one that
        // needs a fixture: it refuses a DECLARATION mismatch (an executor that
        // suspends while its descriptor says it cannot pause), and no shipped
        // executor is in that state — all six pausing built-ins declare
        // `supportsPause: true`, measured on the #6667 branch. `supports-pause-
        // runtime-enforcement.test.ts` owns the behaviour; this row owns its
        // classification, which is the one fact this file is about.
        engine.registerNodeExecutor({
            type: 'mis_declared_pause',
            descriptor: defineActionDescriptor({
                type: 'mis_declared_pause', version: '1.0.0', name: 'Mis-declared Pause',
            }),
            async execute() { return { success: true, suspend: true }; },
        });
    });

    it.each(GUARDS.map((g, i) => ({ ...g, i })))(
        '$name stays fatal with a fault edge ($why)',
        async ({ node, expect: fragment, i }) => {
        let handlerRan = false;
        engine.registerNodeExecutor({
            type: 'script',
            async execute() {
                handlerRan = true;
                return { success: true };
            },
        });
        const flowName = `guard_case_${i}`;
        engine.registerFlow(flowName, flowWithHandler(flowName, node) as any);

        const result = await engine.execute(flowName, { record: { id: 'r1', owner: 'usr_7' } } as any);

        expect(result.success).toBe(false);
        expect(result.error ?? '').toContain(fragment);
        expect(handlerRan).toBe(false);
        },
    );
});

describe('#3863 — runtime failures stay routable', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    /**
     * The negative half of the contract. These are conditions the world caused,
     * and an author must be able to handle them — marking one `guard` would turn
     * a recoverable integration into a dead run.
     */
    it('a plain node failure still routes to the handler', async () => {
        let handlerRan = false;
        engine.registerNodeExecutor({
            type: 'script',
            async execute(node) {
                if (node.id === 'op') return { success: false, error: 'upstream 503' };
                handlerRan = true;
                return { success: true };
            },
        });
        engine.registerFlow('runtime_ok', flowWithHandler('runtime_ok', { type: 'script' }) as any);

        const result = await engine.execute('runtime_ok');
        expect(result.success).toBe(true);
        expect(handlerRan).toBe(true);
    });

    it('a thrown node error still routes to the handler', async () => {
        let handlerRan = false;
        engine.registerNodeExecutor({
            type: 'script',
            async execute(node) {
                if (node.id === 'op') throw new Error('socket hang up');
                handlerRan = true;
                return { success: true };
            },
        });
        engine.registerFlow('throw_ok', flowWithHandler('throw_ok', { type: 'script' }) as any);

        const result = await engine.execute('throw_ok');
        expect(result.success).toBe(true);
        expect(handlerRan).toBe(true);
    });
});

describe('refuseNode', () => {
    it('produces a guard-class failure so writing one and marking it are one act', () => {
        expect(refuseNode('nope')).toEqual({ success: false, error: 'nope', errorClass: 'guard' });
    });
});
