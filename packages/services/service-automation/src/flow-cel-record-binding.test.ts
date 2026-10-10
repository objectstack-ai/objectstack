// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22642] Flow CEL `record` is the record the run was handed, or unbound —
 * never the run's variables map.
 *
 * `AutomationEngine.celScope` used to hand the formula engine `record: vars`,
 * and `extra` overrides that slot only when a `record` variable exists. So a
 * run with no record in hand bound `record` to its own variables, and
 * `record.assignee` silently read a variable named `assignee` instead of
 * failing as an unbound root.
 *
 * Triage's direction, pinned here through the public doors (`registerFlow` +
 * `execute`) and the two engine primitives the executors call:
 *
 *  - bare variable names resolve through the spread (`extra`) only;
 *  - `record` is bound only when an entrance handed the run a record
 *    (`seedRunVariables` binds `context.record` as `record`), or the flow binds
 *    a `record` variable itself;
 *  - with neither, `record.X` faults `Unknown variable: record`, as every other
 *    unbound root does.
 *
 * Each entrance's context is spelled the way its door builds it: the
 * record-change trigger, the time-relative sweep (`trigger-schedule`), the
 * inbound hook (`trigger-api`), a `type: 'flow'` action (`dispatchFlowAction`
 * in `@objectstack/runtime`, which always hands a record — the loaded row, or
 * an empty one carrying at most the id it was given), a `subflow` parent and a
 * `map` item.
 */

import { describe, expect, it } from 'vitest';

import { AutomationEngine } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';

function silentLogger(): any {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

function makeEngine(): AutomationEngine {
    const engine = new AutomationEngine(silentLogger());
    installBuiltinNodes(engine, { logger: silentLogger(), getService() { return undefined; } } as any);
    return engine;
}

/**
 * start → assignment (`v` = the CEL `source`) → end. `assignee` and `title` are
 * input variables, so a run can bind a variable of the same name as a record
 * field and the pin can tell which one `record.X` read.
 */
function readerFlow(name: string, source: string, variables: unknown[] = []) {
    return {
        name, label: name, type: 'autolaunched',
        variables: [
            { name: 'assignee', type: 'text', isInput: true },
            { name: 'title', type: 'text', isInput: true },
            { name: 'v', type: 'text', isOutput: true },
            ...variables,
        ],
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'set', type: 'assignment', label: 'Set', config: { assignments: { v: { dialect: 'cel', source } } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'set' },
            { id: 'e2', source: 'set', target: 'end' },
        ],
    } as any;
}

async function run(source: string, context: Record<string, unknown>, variables: unknown[] = []) {
    const engine = makeEngine();
    engine.registerFlow('reader', readerFlow('reader', source, variables));
    return engine.execute('reader', context as any);
}

const outputOf = (result: { output?: unknown }) => (result.output as { v?: unknown } | undefined)?.v;

/** A run with an `assignee` variable and no record in hand: the REST trigger route's shape. */
const NO_RECORD = { params: { assignee: 'u9' } };

describe('no record in hand: `record` is unbound, never the variables map', () => {
    it.each([
        ['record.assignee'],
        // The card's own shape: the guard reads the alias as present and answers the variable.
        ['has(record.assignee) ? record.assignee : null'],
    ])('`%s` fails the run on `record` and never answers the `assignee` variable', async (source) => {
        const result = await run(source, NO_RECORD);
        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toMatch(/Unknown variable: record\b/);
        expect(result.error).toContain(source);
        expect(outputOf(result)).not.toBe('u9');
    });

    it('a predicate site reads the same scope: an edge condition on `record.assignee` fails the run', async () => {
        const engine = makeEngine();
        engine.registerFlow('gate', {
            name: 'gate', label: 'Gate', type: 'autolaunched',
            variables: [{ name: 'assignee', type: 'text', isInput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'hit', type: 'end', label: 'Hit' },
                { id: 'miss', type: 'end', label: 'Miss' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'hit', condition: 'record.assignee == "u9"' },
                { id: 'e2', source: 'start', target: 'miss', condition: 'record.assignee != "u9"' },
            ],
        } as any);
        const result = await engine.execute('gate', NO_RECORD as any);
        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toMatch(/Unknown variable: record\b/);
    });

    it('the engine primitives the executors call refuse it too, naming `record`', () => {
        const engine = makeEngine();
        const variables = new Map<string, unknown>([['assignee', 'u9']]);
        expect(() => engine.evaluateValueEnvelope(
            { dialect: 'cel', source: 'has(record.assignee) ? record.assignee : null' }, variables, 'where',
        )).toThrow(/Unknown variable: record\b/);
        expect(() => engine.evaluateCondition('record.assignee == "u9"', variables)).toThrow(/Unknown variable: record\b/);
    });
});

describe('controls: what stays as it was', () => {
    it('a record-triggered run reads `record.X` from its record, over a variable of the same name', async () => {
        const result = await run('record.assignee', {
            record: { id: 'r1', assignee: 'rec_owner' },
            object: 'task',
            event: 'record-after-update',
            params: { assignee: 'u9' },
        });
        expect(result.success, result.error).toBe(true);
        expect(outputOf(result)).toBe('rec_owner');
    });

    it.each([['assignee'], ['vars.assignee']])('`%s` still reads the variable, with no record in hand', async (source) => {
        const result = await run(source, NO_RECORD);
        expect(result.success, result.error).toBe(true);
        expect(outputOf(result)).toBe('u9');
    });

    it('a flow that declares a `record` variable reads it, with no entrance record', async () => {
        const result = await run('record.assignee', NO_RECORD, [
            { name: 'record', type: 'object', defaultValue: { assignee: 'declared' } },
        ]);
        expect(result.success, result.error).toBe(true);
        expect(outputOf(result)).toBe('declared');
    });
});

describe('each entrance hands its record: `record` is that record, never the variables', () => {
    const ROW = { id: 'r1', title: 'From the record' };
    const VARIABLE = { title: 'From a variable' };

    it.each([
        ['a record-change trigger', { record: ROW, object: 'task', event: 'record-after-update', previous: { id: 'r1' } }],
        ['a time-relative sweep', { record: ROW, object: 'task', event: 'time_relative' }],
        ['the inbound hook (the request body is the record)', { record: ROW, params: { ...ROW }, event: 'api' }],
        ['a `type: \'flow\'` action on a row', { record: ROW, object: 'task', params: { recordId: 'r1' } }],
    ])('%s', async (_entrance, context) => {
        const result = await run('record.title', {
            ...context,
            params: { ...VARIABLE, ...((context as { params?: object }).params ?? {}) },
        });
        expect(result.success, result.error).toBe(true);
        expect(outputOf(result)).toBe('From the record');
    });

    it('an object-less action hands an empty record: `record.X` fails on the key and never reads the variable', async () => {
        const result = await run('record.assignee', { record: {}, params: { assignee: 'u9' } });
        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toMatch(/\bassignee\b/);
        expect(result.error).not.toMatch(/Unknown variable: record\b/);
        expect(outputOf(result)).not.toBe('u9');
    });

    /** parent: start → subflow (`child`, input `title` = 'From a variable') → end, child output under `sub`. */
    function withSubflow(engine: AutomationEngine) {
        engine.registerFlow('child', readerFlow('child', 'record.title'));
        engine.registerFlow('parent', {
            name: 'parent', label: 'Parent', type: 'autolaunched',
            variables: [{ name: 'sub', type: 'object', isOutput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call', type: 'subflow', label: 'Call',
                    config: { flowName: 'child', input: { title: 'From a variable' }, outputVariable: 'sub' },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        } as any);
    }

    it('a `subflow` child reads its parent\'s record', async () => {
        const engine = makeEngine();
        withSubflow(engine);
        const result = await engine.execute('parent', { record: ROW, object: 'task', event: 'record-after-update' } as any);
        expect(result.success, result.error).toBe(true);
        expect((result.output as { sub?: { v?: unknown } }).sub?.v).toBe('From the record');
    });

    it('a parent with no record hands none: the child\'s `record.X` fails, though the child has the variable', async () => {
        const engine = makeEngine();
        withSubflow(engine);
        const result = await engine.execute('parent', {} as any);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unknown variable: record\b/);
    });

    /** parent: start → map over `items` (child per item) → end, results under `mapped`. */
    function withMap(engine: AutomationEngine) {
        engine.registerFlow('child', readerFlow('child', 'record.title'));
        engine.registerFlow('parent', {
            name: 'parent', label: 'Parent', type: 'autolaunched',
            variables: [
                { name: 'items', type: 'list', isInput: true },
                { name: 'mapped', type: 'list', isOutput: true },
            ],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'each', type: 'map', label: 'Each',
                    config: {
                        flowName: 'child', collection: '{items}', iteratorVariable: 'item',
                        input: { title: 'From a variable' }, outputVariable: 'mapped',
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'each' },
                { id: 'e2', source: 'each', target: 'end' },
            ],
        } as any);
    }

    it('a `map` item that carries an id is the child\'s record', async () => {
        const engine = makeEngine();
        withMap(engine);
        const result = await engine.execute('parent', {
            params: { items: [{ id: 'i1', title: 'One' }, { id: 'i2', title: 'Two' }] },
        } as any);
        expect(result.success, result.error).toBe(true);
        expect((result.output as { mapped?: unknown }).mapped).toEqual([{ v: 'One' }, { v: 'Two' }]);
    });

    it('a `map` item with no id is not a record: the child reads the parent\'s record', async () => {
        const engine = makeEngine();
        withMap(engine);
        const result = await engine.execute('parent', {
            record: ROW, object: 'task', event: 'record-after-update', params: { items: ['a'] },
        } as any);
        expect(result.success, result.error).toBe(true);
        expect((result.output as { mapped?: unknown }).mapped).toEqual([{ v: 'From the record' }]);
    });
});
