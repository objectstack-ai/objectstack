// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * A CRUD node's `filter` — its operands are value slots, and it never widens
 * silently (#19939 stage S6, Fork R17 → A; framework#3810).
 *
 * Each OPERAND of a `get_record` / `update_record` / `delete_record` filter —
 * a field's value, an operator's comparand, each element of a list comparand —
 * is a CEL value envelope the executor evaluates in the run's scope BEFORE the
 * query, or a literal handed to the query as written. A query placeholder
 * (`{current_user_id}`, `{current_year_start}`) is a literal of the query
 * engine's own vocabulary, handed on untouched for it to resolve. A flow
 * `{…}` token is refused at every door.
 *
 * The #3810 guard holds for an envelope that evaluates to nothing: a condition
 * whose comparand is `null` or nothing is not a narrower query, it is a wider
 * one — `{ owner: <nothing> }` handed to `deleteMany` was every row in the
 * table. So an operand envelope that evaluates to `null` REFUSES the node, as a
 * guard (a `fault` edge may not swallow it), before any query.
 *
 * Before S6, the executor interpolated the filter with the single-brace
 * dialect (`interpolateFilter`): a flow token resolved against the run's
 * variables, an unresolved one was erased and refused here, and a placeholder
 * no flow variable shadowed was handed on.
 *
 * #15953 row 11 (the service-automation half): a flow filter's date value
 * reaches the data engine resolved and the retired `{TODAY()}` macro is
 * refused before any query (the last describe), while the query engine's
 * `{today}` is handed on for it to resolve (the first describe's placeholder
 * case). It lets objectstack-ai/hotcrm retire
 * `test/flow-filter-today-token.test.ts` (objectstack-ai/hotcrm#1583), whose
 * `interpolateFilter` no longer exists. The objectql half (`resolveFilterTokens`
 * resolves `{today}` and refuses `{TODAY()}`) is the engine's.
 */

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

const CEL = (source: string) => ({ dialect: 'cel', source });

/** A data engine stub that records the `where` each verb actually received. */
function fakeData() {
    const seen: { find?: any; update?: any; delete?: any } = {};
    const service = {
        find: async (_o: string, q: any) => { seen.find = q.where; return []; },
        findOne: async (_o: string, q: any) => {
                                                 assertEngineFindOnePredicate(_o, q); seen.find = q.where; return null; },
        update: async (_o: string, _d: any, o: any) => { seen.update = o?.where; return { modified: 1 }; },
        delete: async (_o: string, o: any) => { seen.delete = o?.where; return { deleted: 1 }; },
        getObject: () => ({ name: 'deal', fields: {} }),
    };
    return { service, seen };
}

function ctxWith(data: any): any {
    return {
        logger: createTestLogger(),
        getService(name: string) {
            if (name === 'data') return data;
            return undefined;
        },
    };
}

function crudFlow(nodeType: string, config: Record<string, unknown>) {
    return {
        name: 'crud_flow',
        label: 'CRUD Flow',
        type: 'autolaunched' as const,
        // Explicit so the ADR-0049 runAs gate (#3760) does not reject the data
        // op first — these tests are about the filter, and a refusal for the
        // wrong reason would make the negative cases pass vacuously.
        runAs: 'system' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'op', type: nodeType as any, label: 'Op', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'op' },
            { id: 'e2', source: 'op', target: 'end' },
        ],
    };
}

/** Each node type, with the verb its data call is recorded under and the `fields` an update needs. */
const NODES = [
    ['get_record', 'find', {}],
    ['update_record', 'update', { fields: { title: 'x' } }],
    ['delete_record', 'delete', {}],
] as const;

describe('a filter operand envelope is evaluated before the query; a query placeholder is handed on (#19939)', () => {
    let engine: AutomationEngine;
    let data: ReturnType<typeof fakeData>;

    beforeEach(() => {
        data = fakeData();
        engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(data.service));
    });

    it.each(NODES)('%s: every operand position evaluates — a field\'s value, a comparand, a list element, a combinator member, a nested relation', async (nodeType, verb, extra) => {
        engine.registerFlow('crud_flow', crudFlow(nodeType, {
            objectName: 'deal',
            filter: {
                owner: CEL('record.owner'),
                amount: { $gt: CEL('record.amount * 2'), $lte: 1000 },
                id: { $in: ['d0', CEL('record.id')] },
                $or: [{ stage: CEL("record.stage + '_review'") }, { stage: 'won' }],
                account: { region: CEL('record.region') },
            },
            ...extra,
        }));
        const record = { id: 'd1', owner: 'usr_7', amount: 50, stage: 'legal', region: 'emea' };
        const result = await engine.execute('crud_flow', { record } as any);

        expect(result.success).toBe(true);
        expect(data.seen[verb]).toEqual({
            owner: 'usr_7',
            amount: { $gt: 100, $lte: 1000 },
            id: { $in: ['d0', 'd1'] },
            $or: [{ stage: 'legal_review' }, { stage: 'won' }],
            account: { region: 'emea' },
        });
    });

    it.each(NODES)('%s: a query placeholder reaches the engine untouched, beside a literal', async (nodeType, verb, extra) => {
        engine.registerFlow('crud_flow', crudFlow(nodeType, {
            objectName: 'deal',
            filter: { close_date: { $lt: '{current_year_start}' }, a: '{30_days_ago}', b: '{current_user_id}', due: { $lte: '{today}' }, status: 'open' },
            ...extra,
        }));
        const result = await engine.execute('crud_flow', { record: { id: 'r1' } } as any);

        expect(result.success).toBe(true);
        // `{today}` included (#15953 row 11): the query engine's word, never the executor's to resolve.
        expect(data.seen[verb]).toEqual({
            close_date: { $lt: '{current_year_start}' }, a: '{30_days_ago}', b: '{current_user_id}', due: { $lte: '{today}' }, status: 'open',
        });
    });

    it('a flow variable named like a placeholder no longer shadows it — the variable is read through an envelope', async () => {
        // Before S6 a flow variable named `current_user_id` won over the
        // placeholder at `{current_user_id}`. No flow token is read at a filter
        // operand now: the placeholder is the query engine's, and the variable
        // is `{ dialect: 'cel', source: 'current_user_id' }`.
        engine.registerFlow('crud_flow', {
            ...crudFlow('delete_record', { objectName: 'deal', filter: { a: '{current_user_id}', b: CEL('current_user_id') } }),
            variables: [{ name: 'current_user_id', type: 'text', isInput: true }],
        });
        const result = await engine.execute('crud_flow', { params: { current_user_id: 'from_flow_var' } } as any);

        expect(result.success).toBe(true);
        expect(data.seen.delete).toEqual({ a: '{current_user_id}', b: 'from_flow_var' });
    });

    it('the node\'s config is never written into — the resolved filter is a copy', async () => {
        const filter = { owner: CEL('record.owner') };
        engine.registerFlow('crud_flow', crudFlow('delete_record', { objectName: 'deal', filter }));
        await engine.execute('crud_flow', { record: { owner: 'usr_7' } } as any);

        expect(data.seen.delete).toEqual({ owner: 'usr_7' });
        expect(filter).toEqual({ owner: CEL('record.owner') });
    });

    it('an intentionally empty filter is still allowed (nothing was erased)', async () => {
        // "Delete everything" must stay expressible — the guard fires on an
        // operand that is nothing, not on emptiness, so an author who wrote no
        // filter is unaffected.
        engine.registerFlow('crud_flow', crudFlow('delete_record', { objectName: 'deal', filter: {} }));

        const result = await engine.execute('crud_flow');

        expect(result.success).toBe(true);
        expect(data.seen.delete).toEqual({});
    });

    it('a literal `null` operand is an authored IS NULL condition, handed on — only a COMPUTED nothing is refused', async () => {
        engine.registerFlow('crud_flow', crudFlow('delete_record', { objectName: 'deal', filter: { owner: null } }));
        const result = await engine.execute('crud_flow');

        expect(result.success).toBe(true);
        expect(data.seen.delete).toEqual({ owner: null });
    });
});

describe('crud nodes — refuse a filter whose operand evaluated to nothing (#3810)', () => {
    let engine: AutomationEngine;
    let data: ReturnType<typeof fakeData>;

    beforeEach(() => {
        data = fakeData();
        engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(data.service));
    });

    async function runRefused(nodeType: string, config: Record<string, unknown>, record: Record<string, unknown>) {
        engine.registerFlow('crud_flow', crudFlow(nodeType, config));
        const result = await engine.execute('crud_flow', { record } as any);
        const runs = await engine.listRuns('crud_flow');
        const step = runs[0]?.steps.find((s) => s.nodeId === 'op');
        return { result, step };
    }

    it('delete_record: an envelope that evaluates to null refuses the node instead of emptying the object', async () => {
        const { result, step } = await runRefused('delete_record', {
            objectName: 'deal',
            filter: { owner: CEL('record.owner') },
        }, { id: 'r1', owner: null });

        expect(result.success).toBe(false);
        expect(step?.error?.code).toBe('NODE_FAILURE');
        expect(result.error).toContain('delete_record: refusing to run — 1 filter operand(s) evaluated to nothing');
        expect(result.error).toContain('`record.owner` (at filter.owner)');
        expect(result.error).toContain('would have matched every remaining row and deleted it');
        expect(data.seen.delete).toBeUndefined();
    });

    it('update_record: an envelope that evaluates to null refuses the node instead of overwriting the rows', async () => {
        const { result, step } = await runRefused('update_record', {
            objectName: 'deal',
            filter: { owner: CEL('record.owner') },
            fields: { title: 'x' },
        }, { id: 'r1', owner: null });

        expect(result.success).toBe(false);
        expect(step?.error?.code).toBe('NODE_FAILURE');
        expect(result.error).toContain('update_record: refusing to run');
        expect(result.error).toContain('`record.owner` (at filter.owner)');
        expect(data.seen.update).toBeUndefined();
    });

    it('get_record: an envelope that evaluates to null refuses the read', async () => {
        const { result, step } = await runRefused('get_record', {
            objectName: 'deal',
            filter: { owner: CEL('record.owner') },
        }, { owner: null });

        expect(result.success).toBe(false);
        expect(step?.error?.code).toBe('NODE_FAILURE');
        expect(result.error).toContain('get_record: refusing to run');
        expect(data.seen.find).toBeUndefined();
    });

    it.each([
        ['a guarded form answering null', { owner: CEL('has(record.owner) ? record.owner : null') }, 'filter.owner'],
        ['an operator\'s comparand', { amount: { $gt: CEL('record.cap') } }, 'filter.amount.$gt'],
        ['an `$in` element', { id: { $in: ['r1', CEL('record.cap')] } }, 'filter.id.$in[1]'],
        ['a `$or` member\'s value', { $or: [{ status: 'open' }, { owner: CEL('record.cap') }] }, 'filter.$or[1].owner'],
    ])('delete_record: %s that evaluates to nothing refuses the node — located at the operand', async (_label, filter, at) => {
        const { result } = await runRefused('delete_record', { objectName: 'deal', filter }, { id: 'r1', cap: null });

        expect(result.success).toBe(false);
        expect(result.error).toContain(`(at ${at})`);
        expect(data.seen.delete).toBeUndefined();
    });

    it('refuses when only SOME operands are nothing — a partial filter still widens', async () => {
        const { result } = await runRefused('delete_record', {
            objectName: 'deal',
            filter: { status: 'open', owner: CEL('record.owner') },
        }, { id: 'r1', owner: null });

        expect(result.success).toBe(false);
        expect(data.seen.delete).toBeUndefined();
    });

    it('an absent variable or key fails the run with an evaluation fault naming it — no query runs', async () => {
        const { result, step } = await runRefused('delete_record', {
            objectName: 'deal',
            filter: { owner: CEL('record.ownr') },
        }, { id: 'r1', owner: 'usr_7' });

        expect(result.success).toBe(false);
        expect(step?.error?.code).toBe('EXECUTION_ERROR');
        expect(step?.error?.message).toContain('filter.owner: value expression failed to evaluate as CEL');
        expect(data.seen.delete).toBeUndefined();
    });
});

describe('a flow `{…}` token at a filter operand is refused at every door (#19939)', () => {
    /** The builtin CRUD executor itself — the run-time door, reached without `registerFlow`. */
    function executorOf(nodeType: string, data: ReturnType<typeof fakeData>) {
        const executors = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
        const engine = new AutomationEngine(createTestLogger());
        const recorder = new Proxy(engine, {
            get(target, key, receiver) {
                if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
                return Reflect.get(target, key, receiver);
            },
        });
        registerCrudNodes(recorder as AutomationEngine, ctxWith(data.service));
        return executors.get(nodeType)!;
    }

    it.each(NODES)('%s: `registerFlow` refuses a token, located at the operand, naming its envelope', (nodeType, _verb, extra) => {
        const engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(fakeData().service));
        expect(() => engine.registerFlow('crud_flow', crudFlow(nodeType, {
            objectName: 'deal', filter: { owner: '{record.owner}', due: { $lt: '{today}' } }, ...extra,
        }))).toThrow(`${nodeType} filter operand at config.filter.owner: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
    });

    it.each(NODES)('%s: the executor\'s contract parse refuses it as a guard, and nothing is queried', async (nodeType, verb, extra) => {
        const data = fakeData();
        const result = await executorOf(nodeType, data).execute(
            { id: 'op', type: nodeType, label: 'Op', config: { objectName: 'deal', filter: { owner: '{record.owner}' }, ...extra } },
            new Map<string, unknown>([['record', { owner: 'usr_7' }]]),
            {},
        );
        expect(result.success).toBe(false);
        expect(result.errorClass).toBe('guard');
        expect(result.error).toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
        expect(result.error).toContain("{ dialect: 'cel', source: 'record.owner' }");
        expect(data.seen[verb]).toBeUndefined();
    });

    it.each(NODES)('%s: the executor\'s guard refusal for an operand that evaluated to nothing is a guard too', async (nodeType, verb, extra) => {
        const data = fakeData();
        const result = await executorOf(nodeType, data).execute(
            { id: 'op', type: nodeType, label: 'Op', config: { objectName: 'deal', filter: { owner: CEL('record.owner') }, ...extra } },
            new Map<string, unknown>([['record', { owner: null }]]),
            {},
        );
        expect(result.success).toBe(false);
        expect(result.errorClass).toBe('guard');
        expect(result.error).toContain('filter operand(s) evaluated to nothing');
        expect(data.seen[verb]).toBeUndefined();
    });
});

/**
 * #15953 row 11 — a filter's DATE value, in the dialect a filter reads today.
 *
 * The 17.x executor resolved a `{TODAY()}` macro against the clock before the
 * query. The macro is retired with the rest of the template dialect (#19939):
 * its spelling is the CEL envelope `isoDate(today())`, which the executor
 * evaluates, so the `where` the data engine receives holds the date itself.
 * `{today}` is a different word: a query placeholder, the query engine's to
 * resolve, so the executor hands it on as written — carried by the first
 * describe's placeholder case, which lists it beside the other placeholders.
 * The clock is pinned, so each case asserts the exact value the engine received.
 *
 * Directions decided before running: the envelope reaches the engine as
 * `YYYY-MM-DD` text, and `{TODAY()}` reaches nothing — refused at
 * `registerFlow` and by the executor's contract parse, naming `isoDate(today())`.
 */
describe("a filter's date value reaches the data engine resolved (#15953 row 11)", () => {
    // Midday UTC, so the reference-timezone day is this one wherever the run's
    // clock is read; only `Date` is faked, the engine's own timers stay real.
    const NOW = new Date('2026-03-14T12:00:00.000Z');

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it.each(NODES)('%s: a CEL date envelope is evaluated before the query — the engine receives the date', async (nodeType, verb, extra) => {
        const data = fakeData();
        const engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(data.service));
        engine.registerFlow('crud_flow', crudFlow(nodeType, {
            objectName: 'deal',
            filter: {
                close_date: { $lt: CEL('isoDate(today())') },
                created: { $gte: CEL('isoDate(daysAgo(30))') },
            },
            ...extra,
        }));
        const result = await engine.execute('crud_flow', { record: { id: 'r1' } } as any);

        expect(result.success, `run failed: ${JSON.stringify(result)}`).toBe(true);
        expect(data.seen[verb]).toEqual({
            close_date: { $lt: '2026-03-14' },
            created: { $gte: '2026-02-12' },
        });
    });

    it.each(NODES)('%s: `registerFlow` refuses the retired `{TODAY()}` macro, located at the operand, naming its CEL spelling', async (nodeType, _verb, extra) => {
        const engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(fakeData().service));
        let thrown: unknown;
        try {
            engine.registerFlow('crud_flow', crudFlow(nodeType, {
                objectName: 'deal', filter: { close_date: { $lt: '{TODAY()}' } }, ...extra,
            }));
        } catch (err) {
            thrown = err;
        }
        expect(thrown, 'a flow carrying `{TODAY()}` at a filter operand registered').toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain(`${nodeType} filter operand at config.filter.close_date.$lt: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
        expect((thrown as Error).message).toContain('isoDate(today())');
        expect(await engine.getFlow('crud_flow'), 'the refused flow must not be held').toBeNull();
    });

    it.each(NODES)('%s: the executor\'s contract parse refuses `{TODAY()}` as a guard, and nothing is queried', async (nodeType, verb, extra) => {
        const data = fakeData();
        const executors = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
        const recorder = new Proxy(new AutomationEngine(createTestLogger()), {
            get(target, key, receiver) {
                if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
                return Reflect.get(target, key, receiver);
            },
        });
        registerCrudNodes(recorder as AutomationEngine, ctxWith(data.service));

        const result = await executors.get(nodeType)!.execute(
            { id: 'op', type: nodeType, label: 'Op', config: { objectName: 'deal', filter: { close_date: { $lt: '{TODAY()}' } }, ...extra } },
            new Map<string, unknown>(),
            {},
        );
        expect(result.success).toBe(false);
        expect(result.errorClass).toBe('guard');
        expect(result.error).toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
        expect(result.error).toContain('isoDate(today())');
        expect(data.seen[verb], 'a refused filter must not reach the data engine').toBeUndefined();
    });
});
