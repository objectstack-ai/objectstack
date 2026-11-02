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

/**
 * A computed filter operand is a VALUE, never filter structure.
 *
 * The filter's structure (its fields, operators and conditions) is what the
 * author wrote; an operand envelope supplies only what a condition compares
 * against. So an envelope must evaluate to a value: a string, number, boolean
 * or date, and at the comparand of a list operator (`$in`, `$nin`,
 * `$between`) a list of them. Anything else refuses the node, as a guard,
 * before the data engine is asked, at every operand position and whatever the
 * key. An operand the author wrote as a literal is not judged here.
 *
 * Directions decided before running: every refused case leaves the engine
 * uncalled (`seen[verb]` undefined); every passing case hands the engine the
 * filter with only the operand's value substituted.
 */
describe('a computed filter operand is a value, never filter structure', () => {
    let engine: AutomationEngine;
    let data: ReturnType<typeof fakeData>;

    /** A record whose fields are values of each kind an expression may hand a filter. */
    const RECORD = {
        id: 'r1',
        owner: 'usr_7',
        amount: 50,
        active: true,
        due: new Date('2026-03-14T00:00:00.000Z'),
        ref: { id: 'r1' },
        ids: ['r1', 'r2'],
        stages: ['lost', 'won'],
        range: [10, 90],
        mixed: ['r1', { id: 'r2' }],
        holes: ['r1', null],
        conds: [{ status: 'open' }],
    };

    /** The bulk declaration a predicate write needs, so each fixture is one the real engine accepts. */
    const bulk = (nodeType: string) => (nodeType === 'get_record' ? {} : { multi: true });

    beforeEach(() => {
        data = fakeData();
        engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(data.service));
    });

    async function run(nodeType: string, config: Record<string, unknown>) {
        engine.registerFlow('crud_flow', crudFlow(nodeType, config));
        const result = await engine.execute('crud_flow', { record: RECORD } as any);
        const runs = await engine.listRuns('crud_flow');
        const step = runs[0]?.steps.find((s) => s.nodeId === 'op');
        return { result, step };
    }

    it.each(NODES)('%s: an evaluated non-scalar operand is refused before the query, naming the node and the operand', async (nodeType, verb, extra) => {
        const { result, step } = await run(nodeType, { objectName: 'deal', filter: { id: CEL('record.ref') }, ...extra });

        expect(result.success).toBe(false);
        expect(step?.error?.code).toBe('NODE_FAILURE');
        expect(result.error).toContain(`${nodeType}: refusing to run — 1 filter operand(s) evaluated to something other than a value`);
        expect(result.error).toContain('`record.ref` (at filter.id) evaluated to an object');
        expect(data.seen[verb], 'the data engine was asked').toBeUndefined();
    });

    it.each([
        ['a field\'s value under any key', { owner: CEL('record.ref') }, 'filter.owner', 'an object'],
        ['an operator\'s comparand', { owner: { $ne: CEL('record.ref') } }, 'filter.owner.$ne', 'an object'],
        ['a list operator\'s single element', { id: { $in: ['r0', CEL('record.ref')] } }, 'filter.id.$in[1]', 'an object'],
        ['a nested relation\'s value', { account: { region: CEL('record.ref') } }, 'filter.account.region', 'an object'],
        ['a combinator member\'s value', { $or: [{ status: 'open' }, { owner: CEL('record.ref') }] }, 'filter.$or[1].owner', 'an object'],
        ['a combinator member', { $or: [{ status: 'open' }, CEL('record.ref')] }, 'filter.$or[1]', 'an object'],
        ['a combinator\'s list', { $and: CEL('record.conds') }, 'filter.$and', 'a list'],
        ['a negated condition', { $not: CEL('record.ref') }, 'filter.$not', 'an object'],
        ['a list where one value belongs', { id: CEL('record.ids') }, 'filter.id', 'a list'],
        ['a list at a list operator\'s element', { id: { $in: [CEL('record.ids')] } }, 'filter.id.$in[0]', 'a list'],
        ['a list operator\'s list holding a non-value', { id: { $in: CEL('record.mixed') } }, 'filter.id.$in', 'a list whose entry [1] is an object'],
        ['a list operator\'s list holding an empty entry', { id: { $nin: CEL('record.holes') } }, 'filter.id.$nin', 'a list whose entry [1] is nothing'],
    ])('delete_record: an evaluated non-scalar at %s is refused, located at the operand', async (_label, filter, at, kind) => {
        const { result } = await run('delete_record', { objectName: 'deal', filter, multi: true });

        expect(result.success).toBe(false);
        expect(result.error).toContain(`(at ${at}) evaluated to ${kind}`);
        expect(data.seen.delete, 'the data engine was asked').toBeUndefined();
    });

    it('every refused operand is named in the one refusal', async () => {
        const { result } = await run('get_record', {
            objectName: 'deal',
            filter: { owner: CEL('record.ref'), status: 'open', id: { $in: CEL('record.mixed') } },
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('2 filter operand(s) evaluated to something other than a value');
        expect(result.error).toContain('`record.ref` (at filter.owner) evaluated to an object');
        expect(result.error).toContain('`record.mixed` (at filter.id.$in) evaluated to a list whose entry [1] is an object');
        expect(data.seen.find).toBeUndefined();
    });

    it.each(NODES)('%s: an evaluated list at a list operator\'s comparand passes, each member a value', async (nodeType, verb, extra) => {
        const { result } = await run(nodeType, {
            objectName: 'deal',
            filter: { id: { $in: CEL('record.ids') }, stage: { $nin: CEL('record.stages') }, amount: { $between: CEL('record.range') } },
            ...extra,
            ...bulk(nodeType),
        });

        expect(result.success, `run failed: ${JSON.stringify(result.error)}`).toBe(true);
        expect(data.seen[verb]).toEqual({ id: { $in: ['r1', 'r2'] }, stage: { $nin: ['lost', 'won'] }, amount: { $between: [10, 90] } });
    });

    it.each(NODES)('%s: an evaluated scalar passes — a string, a number, a boolean and a date', async (nodeType, verb, extra) => {
        const { result } = await run(nodeType, {
            objectName: 'deal',
            filter: {
                owner: CEL('record.owner'),
                amount: { $gt: CEL('record.amount') },
                active: CEL('record.active'),
                due: { $lt: CEL('record.due') },
            },
            ...extra,
            ...bulk(nodeType),
        });

        expect(result.success, `run failed: ${JSON.stringify(result.error)}`).toBe(true);
        expect(data.seen[verb]).toEqual({ owner: 'usr_7', amount: { $gt: 50 }, active: true, due: { $lt: RECORD.due } });
    });

    it.each(NODES)('%s: the structure the author wrote is unchanged — only the evaluated operand is judged', async (nodeType, verb, extra) => {
        const { result } = await run(nodeType, {
            objectName: 'deal',
            filter: {
                owner: { $ne: CEL('record.owner') },
                status: { $in: ['open', 'won'] },
                closed_at: { $null: true },
                account: { region: 'emea' },
                $or: [{ stage: 'legal' }, { stage: { $nin: ['lost'] } }],
            },
            ...extra,
            ...bulk(nodeType),
        });

        expect(result.success, `run failed: ${JSON.stringify(result.error)}`).toBe(true);
        expect(data.seen[verb]).toEqual({
            owner: { $ne: 'usr_7' },
            status: { $in: ['open', 'won'] },
            closed_at: { $null: true },
            account: { region: 'emea' },
            $or: [{ stage: 'legal' }, { stage: { $nin: ['lost'] } }],
        });
    });

    it.each(NODES)('%s: the executor\'s refusal of a non-scalar operand is a guard, and nothing is queried', async (nodeType, verb, extra) => {
        const executors = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
        const recorder = new Proxy(new AutomationEngine(createTestLogger()), {
            get(target, key, receiver) {
                if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
                return Reflect.get(target, key, receiver);
            },
        });
        registerCrudNodes(recorder as AutomationEngine, ctxWith(data.service));

        const result = await executors.get(nodeType)!.execute(
            { id: 'op', type: nodeType, label: 'Op', config: { objectName: 'deal', filter: { id: CEL('record.ref') }, ...extra } },
            new Map<string, unknown>([['record', RECORD]]),
            {},
        );
        expect(result.success).toBe(false);
        expect(result.errorClass).toBe('guard');
        expect(result.error).toContain('evaluated to something other than a value');
        expect(data.seen[verb]).toBeUndefined();
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
