// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #32861 — a write step whose caller-supplied values the data engine legally
 * stripped (a `readonly` field) succeeds and records the strip on its step
 * (#3407), but the run's ANSWER carried nothing of it: a record button whose
 * flow wrote a read-only `status` answered a plain success and the person who
 * clicked it was told nothing. `AutomationResult.droppedFields` carries the
 * engine's own drop events on the terminal answer.
 *
 * These pins drive the real engine with a stub data engine that fires
 * `onFieldsDropped` exactly as ObjectQL does (the engine side is pinned in
 * `packages/objectql`, the door side in `@objectstack/verify`'s
 * `action-flow-dropped-fields.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor, StepLogEntry } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerMapNode } from './builtin/map-node.js';
import { dropEventsOf, foldDropEvents } from './run-dropped-fields.js';

type Drop = { object: string; fields: string[]; reason: 'readonly' | 'readonly_when' | 'primary_key' | 'computed' | 'stored_expression' };

function makeLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}

/** A data engine whose writes report `drops(fields)` through the caller's `onFieldsDropped`. */
function fakeData(drops: (object: string, fields: Record<string, unknown>) => Drop[]) {
    return {
        async insert(object: string, fields: any, opts: any) {
            for (const e of drops(object, fields)) opts?.onFieldsDropped?.(e);
            return { id: `${object}_1`, ...fields };
        },
        async update(object: string, fields: any, opts: any) {
            for (const e of drops(object, fields)) opts?.onFieldsDropped?.(e);
            return { id: 'r1', ...fields };
        },
    };
}

/** `status` is `readonly: true` on `expense_report`; every other field lands. */
const READONLY_STATUS = (object: string, fields: Record<string, unknown>): Drop[] =>
    object === 'expense_report' && 'status' in fields ? [{ object, fields: ['status'], reason: 'readonly' }] : [];

function makeEngine() {
    const logger = makeLogger();
    const data = fakeData(READONLY_STATUS);
    const ctx: any = { logger, getService: (n: string) => (n === 'data' ? data : undefined) };
    const engine = new AutomationEngine(logger, new InMemorySuspendedRunStore());
    registerCrudNodes(engine, ctx);
    registerSubflowNode(engine, ctx);
    registerMapNode(engine, ctx);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: defineActionDescriptor({ type: 'hold', version: '1.0.0', name: 'Hold', supportsPause: true, resumeAuthority: 'any' }),
        async execute() { return { success: true, suspend: true, correlation: 'held' }; },
    } as NodeExecutor);
    return engine;
}

/** `start → NODES… → end`, edges in order. */
function chain(name: string, nodes: Array<Record<string, unknown>>) {
    const all = [{ id: 'start', type: 'start', label: 'Start' }, ...nodes, { id: 'end', type: 'end', label: 'End' }];
    return {
        name, label: name, type: 'autolaunched', runAs: 'user',
        nodes: all,
        edges: all.slice(1).map((n, i) => ({ id: `e${i}`, source: all[i].id, target: n.id })),
    } as never;
}

/** A child that pauses FIRST and writes the read-only `status` only once resumed. */
const PAUSE_THEN_SUBMIT = chain('pause_then_submit', [
    { id: 'hold', type: 'hold', label: 'Hold' },
    { id: 'submit', type: 'update_record', label: 'Submit', config: { objectName: 'expense_report', filter: { id: 'r1' }, fields: { status: 'submitted' } } },
]);

const STATUS_DROP = [{ object: 'expense_report', fields: ['status'], reason: 'readonly' }];

/** The child run a parent parked on its `subflow` / `map` node waits for. */
async function childRunOf(engine: AutomationEngine, parentRunId: string, prefix: 'subflow:' | 'map:'): Promise<string> {
    const parked = await engine.suspensionOf(parentRunId);
    expect(parked?.correlation?.startsWith(prefix)).toBe(true);
    return parked!.correlation!.slice(prefix.length);
}

/** start → update_record(expense_report, `fields`) → end: the #32666 shape. */
function submitFlow(name: string, fields: Record<string, unknown>) {
    return {
        name, label: name, type: 'autolaunched', runAs: 'user',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'submit', type: 'update_record', label: 'Submit', config: { objectName: 'expense_report', filter: { id: 'r1' }, fields } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'submit' },
            { id: 'e2', source: 'submit', target: 'end' },
        ],
    } as never;
}

const CALLER = { userId: 'u1' } as AutomationContext;

describe('AutomationResult.droppedFields (#32861)', () => {
    it('the #32666 shape: the answer names the read-only field the step dropped, and the run still succeeds', async () => {
        const engine = makeEngine();
        engine.registerFlow('submit_for_approval', submitFlow('submit_for_approval', { status: 'submitted', note: 'please' }));

        const res = await engine.execute('submit_for_approval', CALLER);

        expect(res.success).toBe(true);
        expect(res.status).toBeUndefined();
        expect(res.droppedFields).toEqual([{ object: 'expense_report', fields: ['status'], reason: 'readonly' }]);
        // The outcome semantics are unchanged: the summary reads as before.
        expect(res.summary?.failed).toBe(0);
        expect(res.summary?.acted).toBe(1);
    });

    it('a write that drops nothing answers without the member at all (omitted, never [])', async () => {
        const engine = makeEngine();
        engine.registerFlow('add_note', submitFlow('add_note', { note: 'please' }));

        const res = await engine.execute('add_note', CALLER);

        expect(res.success).toBe(true);
        expect('droppedFields' in res).toBe(false);
    });

    it('create_record drops ride the answer too', async () => {
        const engine = makeEngine();
        engine.registerFlow('file_report', {
            name: 'file_report', label: 'file_report', type: 'autolaunched', runAs: 'user',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'make', type: 'create_record', label: 'Make', config: { objectName: 'expense_report', fields: { name: 'Q4', status: 'approved' } } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'make' },
                { id: 'e2', source: 'make', target: 'end' },
            ],
        } as never);

        const res = await engine.execute('file_report', CALLER);

        expect(res.droppedFields).toEqual([{ object: 'expense_report', fields: ['status'], reason: 'readonly' }]);
    });

    it('a drop before a pause reaches the answer the resumed run finally gives', async () => {
        const engine = makeEngine();
        engine.registerFlow('submit_then_confirm', {
            name: 'submit_then_confirm', label: 'submit_then_confirm', type: 'autolaunched', runAs: 'user',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'submit', type: 'update_record', label: 'Submit', config: { objectName: 'expense_report', filter: { id: 'r1' }, fields: { status: 'submitted' } } },
                { id: 'hold', type: 'hold', label: 'Hold' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'submit' },
                { id: 'e2', source: 'submit', target: 'hold' },
                { id: 'e3', source: 'hold', target: 'end' },
            ],
        } as never);

        const paused = await engine.execute('submit_then_confirm', CALLER);
        expect(paused.status).toBe('paused');
        // A paused run has not finished: nothing is said yet.
        expect('droppedFields' in paused).toBe(false);

        const done = await engine.resume(paused.runId!);
        expect(done.success).toBe(true);
        expect(done.droppedFields).toEqual([{ object: 'expense_report', fields: ['status'], reason: 'readonly' }]);
    });

    it('a run under errorHandling.strategy \'retry\' answers the drop from the attempt that completed', async () => {
        // The third terminal-success exit: `retryExecution` hands every attempt
        // to `executeWithoutRetry`, whose completion is the run's answer.
        const engine = makeEngine();
        let attempts = 0;
        engine.registerNodeExecutor({
            type: 'flaky',
            async execute() {
                attempts++;
                return attempts === 1 ? { success: false, error: 'transient 503' } : { success: true };
            },
        } as never);
        engine.registerFlow('submit_with_retry', {
            name: 'submit_with_retry', label: 'submit_with_retry', type: 'autolaunched', runAs: 'user',
            errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 0 },
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'submit', type: 'update_record', label: 'Submit', config: { objectName: 'expense_report', filter: { id: 'r1' }, fields: { status: 'submitted' } } },
                { id: 'notify', type: 'flaky', label: 'Notify' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'submit' },
                { id: 'e2', source: 'submit', target: 'notify' },
                { id: 'e3', source: 'notify', target: 'end' },
            ],
        } as never);

        const res = await engine.execute('submit_with_retry', CALLER);

        expect(attempts).toBe(2); // the ladder really ran: attempt 1 failed, attempt 2 completed
        expect(res.success).toBe(true);
        expect(res.droppedFields).toEqual([{ object: 'expense_report', fields: ['status'], reason: 'readonly' }]);
    });

    it('a subflow child\'s drop rides up onto the parent\'s answer', async () => {
        const engine = makeEngine();
        engine.registerFlow('child_submit', submitFlow('child_submit', { status: 'submitted' }));
        engine.registerFlow('parent_button', {
            name: 'parent_button', label: 'parent_button', type: 'autolaunched', runAs: 'user',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: 'child_submit' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'sub' },
                { id: 'e2', source: 'sub', target: 'end' },
            ],
        } as never);

        const res = await engine.execute('parent_button', CALLER);

        expect(res.success).toBe(true);
        expect(res.droppedFields).toEqual([{ object: 'expense_report', fields: ['status'], reason: 'readonly' }]);
    });
});

describe('delegated writes roll their drops up onto the parent\'s answer (#33019)', () => {
    it('map: items that each drop `status` answer one event on the parent, beside the items\' credited writes', async () => {
        const engine = makeEngine();
        engine.registerFlow('child_submit', submitFlow('child_submit', { status: 'submitted', note: 'n' }));
        engine.registerFlow('submit_each', chain('submit_each', [
            { id: 'each', type: 'map', label: 'Each', config: { flowName: 'child_submit', collection: ['a', 'b', 'c'] } },
        ]));

        const res = await engine.execute('submit_each', CALLER);

        expect(res.success).toBe(true);
        expect(res.summary?.acted).toBe(3); // what `summary` already credited
        expect(res.droppedFields).toEqual(STATUS_DROP);
    });

    it('map: an item that paused and was resumed through its own run id rolls its drop up', async () => {
        const engine = makeEngine();
        engine.registerFlow('pause_then_submit', PAUSE_THEN_SUBMIT);
        // `confirm` parks the parent once more after the map completes, so the
        // parent's own answer — given on its resume — is observable.
        engine.registerFlow('approve_each', chain('approve_each', [
            { id: 'each', type: 'map', label: 'Each', config: { flowName: 'pause_then_submit', collection: ['a'] } },
            { id: 'confirm', type: 'hold', label: 'Confirm' },
        ]));

        const parked = await engine.execute('approve_each', CALLER);
        expect(parked.status).toBe('paused');
        const item = await childRunOf(engine, parked.runId!, 'map:');

        const itemDone = await engine.resume(item);
        expect(itemDone.droppedFields).toEqual(STATUS_DROP); // the item's own answer

        const done = await engine.resume(parked.runId!);
        expect(done.success).toBe(true);
        expect(done.summary?.acted).toBe(1);
        expect(done.droppedFields).toEqual(STATUS_DROP);
    });

    it('subflow: a child that paused, resumed through the PARENT\'s run id (the delegated leg), rolls its drop up', async () => {
        const engine = makeEngine();
        engine.registerFlow('pause_then_submit', PAUSE_THEN_SUBMIT);
        engine.registerFlow('wizard', chain('wizard', [
            { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: 'pause_then_submit' } },
        ]));

        const parked = await engine.execute('wizard', CALLER);
        expect(parked.status).toBe('paused');
        await childRunOf(engine, parked.runId!, 'subflow:');

        const done = await engine.resume(parked.runId!);

        expect(done.success).toBe(true);
        expect(done.status).toBeUndefined();
        expect(done.summary?.acted).toBe(1);
        expect(done.droppedFields).toEqual(STATUS_DROP);
    });

    it('subflow: a child that paused, resumed through its OWN run id (the up-bubble), rolls its drop up', async () => {
        const engine = makeEngine();
        engine.registerFlow('pause_then_submit', PAUSE_THEN_SUBMIT);
        engine.registerFlow('wizard_then_confirm', chain('wizard_then_confirm', [
            { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: 'pause_then_submit' } },
            { id: 'confirm', type: 'hold', label: 'Confirm' },
        ]));

        const parked = await engine.execute('wizard_then_confirm', CALLER);
        expect(parked.status).toBe('paused');
        const child = await childRunOf(engine, parked.runId!, 'subflow:');

        const childDone = await engine.resume(child);
        expect(childDone.droppedFields).toEqual(STATUS_DROP);
        // The bubble moved the parent on to `confirm`.
        expect((await engine.suspensionOf(parked.runId!))?.nodeId).toBe('confirm');

        const done = await engine.resume(parked.runId!);
        expect(done.success).toBe(true);
        expect(done.summary?.acted).toBe(1);
        expect(done.droppedFields).toEqual(STATUS_DROP);
    });

    it('a host-registered executor\'s malformed `droppedFields` is skipped — the run still completes, the well-typed event still answers', async () => {
        const engine = makeEngine();
        engine.registerNodeExecutor({
            type: 'sloppy_write',
            async execute() {
                return {
                    success: true,
                    droppedFields: [
                        null,
                        'status',
                        { object: 'expense_report', fields: 'status', reason: 'readonly' },
                        { object: 'expense_report', fields: ['status'], reason: 'no_such_reason' },
                        { object: 'expense_line', fields: ['amount'], reason: 'readonly' },
                    ],
                };
            },
        } as never);
        engine.registerFlow('sloppy', chain('sloppy', [{ id: 'w', type: 'sloppy_write', label: 'W' }]));

        const res = await engine.execute('sloppy', CALLER);

        expect(res.success).toBe(true);
        expect(res.status).toBeUndefined();
        expect(res.droppedFields).toEqual([{ object: 'expense_line', fields: ['amount'], reason: 'readonly' }]);
    });

    it('a malformed `droppedFields` that is not even a list leaves the run completed with no member', async () => {
        const engine = makeEngine();
        engine.registerNodeExecutor({
            type: 'sloppy_write',
            // Array-LIKE, not an array: it has a `length`, so it reaches the
            // step, and it is not iterable, so an unguarded fold would throw.
            async execute() {
                return { success: true, droppedFields: { length: 1, 0: { object: 'expense_report', fields: ['status'], reason: 'readonly' } } };
            },
        } as never);
        engine.registerFlow('sloppy', chain('sloppy', [{ id: 'w', type: 'sloppy_write', label: 'W' }]));

        const res = await engine.execute('sloppy', CALLER);

        expect(res.success).toBe(true);
        expect(res.status).toBeUndefined();
        expect('droppedFields' in res).toBe(false);
    });
});

describe('dropEventsOf — the fold over the step log', () => {
    const AT = '2026-11-13T00:00:00.000Z';
    const step = (nodeId: string, droppedFields?: Drop[]): StepLogEntry => ({
        nodeId, nodeType: 'update_record', status: 'success', startedAt: AT, ...(droppedFields ? { droppedFields } : {}),
    });

    it('coalesces one event per (object, reason), fields in first-seen order — a loop of thirty is one fact', () => {
        const steps = [
            ...Array.from({ length: 30 }, (_, i) => step(`w${i}`, [{ object: 'expense_report', fields: ['status'], reason: 'readonly' }])),
            step('w30', [{ object: 'expense_report', fields: ['approved_at', 'status'], reason: 'readonly' }]),
            step('w31', [{ object: 'expense_report', fields: ['amount'], reason: 'readonly_when' }]),
            step('w32', [{ object: 'expense_line', fields: ['status'], reason: 'readonly' }]),
        ];
        expect(dropEventsOf(steps)).toEqual([
            { object: 'expense_report', fields: ['status', 'approved_at'], reason: 'readonly' },
            { object: 'expense_report', fields: ['amount'], reason: 'readonly_when' },
            { object: 'expense_line', fields: ['status'], reason: 'readonly' },
        ]);
    });

    it('answers undefined, not [], for a log with no drop', () => {
        expect(dropEventsOf([step('a'), step('b', [])])).toBeUndefined();
    });

    it('foldDropEvents is total: what is not well-typed is skipped, never thrown over, and no input is mutated', () => {
        const held: Drop[] = [{ object: 'expense_report', fields: ['status'], reason: 'readonly' }];
        const lists: unknown[] = [
            undefined, null, 42, 'status', { object: 'x' },
            [undefined, { object: 'expense_report' }, { object: 'expense_report', fields: [1], reason: 'readonly' }],
            held,
            [{ object: 'expense_report', fields: ['approved_at'], reason: 'readonly' }],
        ];
        expect(foldDropEvents(lists)).toEqual([{ object: 'expense_report', fields: ['status', 'approved_at'], reason: 'readonly' }]);
        expect(held[0].fields).toEqual(['status']);
        expect(foldDropEvents([null, 'x', [{}]])).toBeUndefined();
    });
});
