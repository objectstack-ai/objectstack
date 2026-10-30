// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24914 (ruling B′, the maintainer's 「同意」, decision batch #379 item 5) —
 * the refusal a flow's data node meets reaches the RUN'S RESULT structurally.
 *
 * The defect: a record save the platform refuses reaches a record form as a
 * structured envelope (`code`, `message`, the producer-marked `userMessage`);
 * the same refusal met by a flow's data node was flattened into one string —
 * the node's catch kept the message alone, the engine prefixed the node id —
 * and nothing structured survived to the run's caller. The spec declared the
 * carriers in #24996 (`AutomationResult.userMessage` / `.innerRefusal`); this
 * file pins the engine's emission of them, on every exit the ruling names:
 *
 *  1. the four CRUD catch arms carry `{ code, message }` in the WIRE spelling
 *     — `UNIQUE_VIOLATION` for the engine's duplicate (whose in-flow
 *     `$error.code` stays `DUPLICATE_RECORD`), `VALIDATION_FAILED`,
 *     `PERMISSION_DENIED`, and the status-derived member for an app hook's
 *     unregistered spelling;
 *  2. a producer-marked `userMessage` arrives verbatim; an unmarked refusal
 *     carries NONE (absent, not empty), and a fault carries neither member;
 *  3. the terminal exits carry them: `execute()`'s failure exit, the
 *     `resumeInternal` stranded exit (a write behind a screen — the card's
 *     measured case) and the retry exits; a `loop` frame the failure unwinds
 *     through does not lose them; a `fault` edge that handles the failure
 *     leaves the run with none; a `map` item's or a `subflow` child's
 *     refusal crosses that container (nested too), and a child that met no
 *     refusal carries none; (#27743) a `try_catch` with no catch region
 *     carries its last failed attempt's refusal, and a `subflow` child that
 *     paused and fails on resume carries it to a caller holding either the
 *     parent's run id or the child's (the leg a `map` item takes);
 *  4. ⛔ `error` is byte-identical to the composition it always had — the
 *     diagnostic channel does not move.
 *
 * The data layer is a fake `IDataEngine` throwing the REAL error classes the
 * platform throws (`DuplicateRecordError`, `ValidationError` from
 * `@objectstack/objectql`, `PermissionDeniedError` from
 * `@objectstack/plugin-security`), so the classification under test is the
 * one production meets. The wire half (the four doors) is pinned in
 * `@objectstack/runtime` and end to end in `@objectstack/verify`.
 */
import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';
import { registerLoopNode } from './builtin/loop-node.js';
import { registerMapNode } from './builtin/map-node.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerTryCatchNode } from './builtin/try-catch-node.js';
import { DuplicateRecordError, ValidationError } from '@objectstack/objectql';
import { PermissionDeniedError } from '@objectstack/plugin-security';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';

function makeLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}

const ctxWith = (data: any): any => ({
    logger: makeLogger(),
    getService: (n: string) => (n === 'data' ? data : undefined),
});

/**
 * A data engine whose every write and read throws `err` — AFTER accepting the
 * call the way `ObjectQL` does (the shared dispatch predicates), so a refusal
 * here is the one a real engine would have reached, never a call shape the
 * real engine would have rejected first.
 */
function refusingData(err: unknown): any {
    return {
        async insert() { throw err; },
        async update(_object: string, data: any, options: any) {
            assertEngineUpdateDispatch(data, options);
            throw err;
        },
        async delete(_object: string, options: any) {
            assertEngineDeleteDispatch(options);
            throw err;
        },
        async find() { throw err; },
        async findOne(object: string, query: any) {
            assertEngineFindOnePredicate(object, query);
            throw err;
        },
    };
}

const duplicate = () => new DuplicateRecordError('crm_account', new Error('driver: unique violation'), 'name');
const validation = () => new ValidationError([
    { field: 'amount', code: 'rule_violation', message: 'Amount must be positive' } as any,
]);
const permission = () => new PermissionDeniedError(
    "[Security] Access denied: operation 'insert' on object 'crm_account' is not permitted",
);
/** An app hook's refusal: a declared 409 with its OWN (unregistered) code, marked for the end user. */
const HOOK_USER_TEXT = '该客户名称已被另一位销售代表占用，请联系主管。';
const markedHook = () => Object.assign(new Error('crm_account.beforeInsert refused: name is reserved'), {
    status: 409,
    code: 'CRM_ACCOUNT_NAME_RESERVED',
    userMessage: HOOK_USER_TEXT,
});

/** start → mk (create_record) → end. */
function createFlow(name = 'convert'): any {
    return {
        name, label: 'Convert', type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'crm_account', fields: { name: 'Acme' } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'mk' },
            { id: 'e2', source: 'mk', target: 'end' },
        ],
    };
}

function engineOver(err: unknown): AutomationEngine {
    const engine = new AutomationEngine(makeLogger());
    registerCrudNodes(engine, ctxWith(refusingData(err)));
    return engine;
}

describe('#24914 — create_record: the refusal reaches AutomationResult, the text does not move', () => {
    it('a unique refusal carries { code: UNIQUE_VIOLATION, message } — the wire spelling, not DUPLICATE_RECORD', async () => {
        const err = duplicate();
        const engine = engineOver(err);
        engine.registerFlow('convert', createFlow());

        const result = await engine.execute('convert', { userId: 'u1' });

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'UNIQUE_VIOLATION', message: err.message });
        // The diagnostic text is the composition it always was, byte for byte.
        expect(result.error).toBe(`Node 'mk' failed: create_record(crm_account) failed: ${err.message}`);
        // Unmarked: the engine's duplicate carries no producer marking, so NO
        // userMessage — absent, never an empty string a runner would render.
        expect('userMessage' in result).toBe(false);
    });

    it('a validation refusal carries VALIDATION_FAILED and the author\'s rule text', async () => {
        const engine = engineOver(validation());
        engine.registerFlow('convert', createFlow());

        const result = await engine.execute('convert', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: 'Amount must be positive' });
        expect(result.error).toBe("Node 'mk' failed: create_record(crm_account) failed: Amount must be positive");
        expect('userMessage' in result).toBe(false);
    });

    it('a permission refusal carries PERMISSION_DENIED', async () => {
        const err = permission();
        const engine = engineOver(err);
        engine.registerFlow('convert', createFlow());

        const result = await engine.execute('convert', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'PERMISSION_DENIED', message: err.message });
        expect(result.error).toBe(`Node 'mk' failed: create_record(crm_account) failed: ${err.message}`);
        expect('userMessage' in result).toBe(false);
    });

    it('an app hook\'s marked refusal: userMessage arrives VERBATIM, its unregistered code becomes the member its status names', async () => {
        const err = markedHook();
        const engine = engineOver(err);
        engine.registerFlow('convert', createFlow());

        const result = await engine.execute('convert', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.userMessage).toBe(HOOK_USER_TEXT);
        // `innerRefusal.code` is the closed ErrorCode: the hook's own spelling
        // is not a member, so the 409 it declared names it — exactly what a
        // record save of the same write answers in `error.code`.
        expect(result.innerRefusal).toEqual({ code: 'RESOURCE_CONFLICT', message: err.message });
        // The marking never replaces the diagnostic channel.
        expect(result.error).toBe(`Node 'mk' failed: create_record(crm_account) failed: ${err.message}`);
        expect(result.error).not.toContain(HOOK_USER_TEXT);
    });

    it('a FAULT (no declared answer) carries neither member — nothing is synthesised from the text', async () => {
        const engine = engineOver(new Error('ECONNREFUSED: could not reach the store'));
        engine.registerFlow('convert', createFlow());

        const result = await engine.execute('convert', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.error).toBe("Node 'mk' failed: create_record(crm_account) failed: ECONNREFUSED: could not reach the store");
        expect('innerRefusal' in result).toBe(false);
        expect('userMessage' in result).toBe(false);
    });

    it('a declared 5xx (a store reporting itself unavailable) is not a refusal either', async () => {
        const engine = engineOver(Object.assign(new Error('store unavailable'), { status: 503, code: 'SERVICE_UNAVAILABLE' }));
        engine.registerFlow('convert', createFlow());

        const result = await engine.execute('convert', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect('innerRefusal' in result).toBe(false);
    });
});

describe('#24914 — the other three CRUD arms carry the refusal too', () => {
    const cases: Array<{ type: string; config: Record<string, unknown>; err: () => Error; code: string; op: string }> = [
        { type: 'get_record', config: { objectName: 'crm_account', filter: { id: 'a1' } }, err: permission, code: 'PERMISSION_DENIED', op: 'get_record' },
        { type: 'update_record', config: { objectName: 'crm_account', filter: { id: 'a1' }, fields: { amount: -1 } }, err: validation, code: 'VALIDATION_FAILED', op: 'update_record' },
        { type: 'delete_record', config: { objectName: 'crm_account', filter: { id: 'a1' } }, err: permission, code: 'PERMISSION_DENIED', op: 'delete_record' },
    ];
    for (const c of cases) {
        it(`${c.type}: { code: ${c.code}, message } on the result, the text unchanged`, async () => {
            const err = c.err();
            const engine = engineOver(err);
            engine.registerFlow('one', {
                name: 'one', label: 'One', type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    { id: 'n', type: c.type, label: 'N', config: c.config },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'n' },
                    { id: 'e2', source: 'n', target: 'end' },
                ],
            } as any);

            const result = await engine.execute('one', { userId: 'u1' });

            expect(result.status).toBe('failed');
            expect(result.innerRefusal).toEqual({ code: c.code, message: err.message });
            expect(result.error).toBe(`Node 'n' failed: ${c.op}(crm_account) failed: ${err.message}`);
        });
    }
});

describe('#24914 — every terminal exit the ruling names carries the members', () => {
    it('resumeInternal (stranded): a write behind a pause — the screen-flow leg the card measured', async () => {
        const err = markedHook();
        const engine = engineOver(err);
        engine.registerNodeExecutor({
            type: 'hold',
            descriptor: defineActionDescriptor({ type: 'hold', version: '1.0.0', name: 'hold', supportsPause: true, resumeAuthority: 'any' }),
            async execute() { return { success: true, suspend: true }; },
        } as NodeExecutor);
        engine.registerFlow('wizard', {
            name: 'wizard', label: 'Wizard', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'hold', type: 'hold', label: 'Hold' },
                { id: 'create_account', type: 'create_record', label: 'Create', config: { objectName: 'crm_account', fields: { name: 'Acme' } } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'hold' },
                { id: 'e2', source: 'hold', target: 'create_account' },
                { id: 'e3', source: 'create_account', target: 'end' },
            ],
        } as any);

        const paused = await engine.execute('wizard', { userId: 'u1' });
        expect(paused.status).toBe('paused');
        const result = await engine.resume(paused.runId!, {});

        expect(result.success).toBe(false);
        expect(result.status).toBe('stranded');
        expect(result.userMessage).toBe(HOOK_USER_TEXT);
        expect(result.innerRefusal).toEqual({ code: 'RESOURCE_CONFLICT', message: err.message });
        expect(result.error).toBe(`Node 'create_account' failed: create_record(crm_account) failed: ${err.message}`);
    });

    it('the retry exits: an exhausted retry ladder reports the LAST attempt\'s refusal beside its text', async () => {
        const err = duplicate();
        const engine = engineOver(err);
        engine.registerFlow('convert', { ...createFlow(), errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 0 } });

        const result = await engine.execute('convert', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'UNIQUE_VIOLATION', message: err.message });
        expect(result.error).toBe(`Node 'mk' failed: create_record(crm_account) failed: ${err.message}`);
    });

    it('a loop frame the failure unwinds through keeps the members (the brand rides the same error object)', async () => {
        const err = validation();
        const engine = new AutomationEngine(makeLogger());
        const ctx = ctxWith(refusingData(err));
        registerCrudNodes(engine, ctx);
        registerLoopNode(engine, ctx);
        engine.registerNodeExecutor({
            type: 'seed',
            async execute(_node, variables) {
                variables.set('rows', [{ id: 'r1' }]);
                return { success: true };
            },
        } as NodeExecutor);
        engine.registerFlow('sweep', {
            name: 'sweep', label: 'Sweep', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'query', type: 'seed', label: 'Seed' },
                {
                    id: 'each', type: 'loop', label: 'Each',
                    config: {
                        collection: { dialect: 'cel', source: 'rows' },
                        iteratorVariable: 'row',
                        body: {
                            nodes: [
                                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'crm_account', fields: { name: 'Acme' } } },
                            ],
                            edges: [],
                        },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'query' },
                { id: 'e2', source: 'query', target: 'each' },
                { id: 'e3', source: 'each', target: 'end' },
            ],
        } as any);

        const result = await engine.execute('sweep', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: 'Amount must be positive' });
    });

    it('a fault edge that HANDLES the failure leaves the run with neither member', async () => {
        const engine = engineOver(duplicate());
        engine.registerNodeExecutor({
            type: 'handled',
            async execute() { return { success: true }; },
        } as NodeExecutor);
        engine.registerFlow('recovers', {
            name: 'recovers', label: 'Recovers', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'crm_account', fields: { name: 'Acme' } } },
                { id: 'handler', type: 'handled', label: 'Handler' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'mk' },
                { id: 'e2', source: 'mk', target: 'end' },
                { id: 'ef', source: 'mk', target: 'handler', type: 'fault' },
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        } as any);

        const result = await engine.execute('recovers', { userId: 'u1' });

        expect(result.success).toBe(true);
        expect('innerRefusal' in result).toBe(false);
        expect('userMessage' in result).toBe(false);
    });
});

describe('a `map` item and a `subflow` child carry the refusal across the container', () => {
    /** start → mk (create_record) → end — the per-item / called flow that meets the refusal. */
    const WRITER = 'write_one';

    /** start → seed (rows) → each (map over `flowName`) → end. */
    function mapFlow(name: string, flowName: string): any {
        return {
            name, label: name, type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'query', type: 'seed', label: 'Seed' },
                {
                    id: 'each', type: 'map', label: 'Each',
                    config: { collection: { dialect: 'cel', source: 'rows' }, flowName, iteratorVariable: 'row' },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'query' },
                { id: 'e2', source: 'query', target: 'each' },
                { id: 'e3', source: 'each', target: 'end' },
            ],
        };
    }

    /** start → call (subflow `flowName`) → end. */
    function subflowFlow(name: string, flowName: string): any {
        return {
            name, label: name, type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'call', type: 'subflow', label: 'Call', config: { flowName } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        };
    }

    function containerEngine(data: any): AutomationEngine {
        const engine = new AutomationEngine(makeLogger());
        const ctx = ctxWith(data);
        registerCrudNodes(engine, ctx);
        registerMapNode(engine, ctx);
        registerSubflowNode(engine, ctx);
        engine.registerNodeExecutor({
            type: 'seed',
            async execute(_node, variables) {
                variables.set('rows', [{ n: 1 }, { n: 2 }]);
                return { success: true };
            },
        } as NodeExecutor);
        engine.registerFlow(WRITER, createFlow(WRITER));
        return engine;
    }

    const childText = (err: Error) => `Node 'mk' failed: create_record(crm_account) failed: ${err.message}`;

    it('map: the failing item\'s refusal reaches the run — code and userMessage — and the text keeps its chain', async () => {
        const err = markedHook();
        const engine = containerEngine(refusingData(err));
        engine.registerFlow('recalc', mapFlow('recalc', WRITER));

        const result = await engine.execute('recalc', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'RESOURCE_CONFLICT', message: err.message });
        expect(result.userMessage).toBe(HOOK_USER_TEXT);
        expect(result.error).toBe(`Node 'each' failed: map 'each': item 0 (subflow '${WRITER}') failed: ${childText(err)}`);
    });

    it('map: the batch stops at the first failing item, so the run carries THAT item\'s refusal', async () => {
        const first = validation();
        const second = permission();
        let calls = 0;
        const data = refusingData(undefined);
        data.insert = async () => { calls += 1; throw calls === 1 ? first : second; };
        const engine = containerEngine(data);
        engine.registerFlow('recalc', mapFlow('recalc', WRITER));

        const result = await engine.execute('recalc', { userId: 'u1' });

        expect(calls).toBe(1);
        expect(result.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: 'Amount must be positive' });
    });

    it('subflow: the child\'s refusal reaches the parent run — code and userMessage', async () => {
        const err = markedHook();
        const engine = containerEngine(refusingData(err));
        engine.registerFlow('outer', subflowFlow('outer', WRITER));

        const result = await engine.execute('outer', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'RESOURCE_CONFLICT', message: err.message });
        expect(result.userMessage).toBe(HOOK_USER_TEXT);
        expect(result.error).toBe(`Node 'call' failed: subflow '${WRITER}' failed: ${childText(err)}`);
    });

    it('map → subflow nested: the refusal two containers deep reaches the top run', async () => {
        const err = permission();
        const engine = containerEngine(refusingData(err));
        engine.registerFlow('item_flow', subflowFlow('item_flow', WRITER));
        engine.registerFlow('recalc', mapFlow('recalc', 'item_flow'));

        const result = await engine.execute('recalc', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'PERMISSION_DENIED', message: err.message });
        expect(result.error).toBe(
            `Node 'each' failed: map 'each': item 0 (subflow 'item_flow') failed: `
            + `Node 'call' failed: subflow '${WRITER}' failed: ${childText(err)}`,
        );
    });

    it('control: a child that failed with NO refusal (a fault) leaves both containers carrying neither member', async () => {
        const fault = new Error('ECONNREFUSED: could not reach the store');
        const engine = containerEngine(refusingData(fault));
        engine.registerFlow('item_flow', subflowFlow('item_flow', WRITER));
        engine.registerFlow('recalc', mapFlow('recalc', 'item_flow'));
        engine.registerFlow('outer', subflowFlow('outer', WRITER));

        for (const name of ['recalc', 'outer']) {
            const result = await engine.execute(name, { userId: 'u1' });
            expect(result.status).toBe('failed');
            expect('innerRefusal' in result).toBe(false);
            expect('userMessage' in result).toBe(false);
        }
        const outer = await engine.execute('outer', { userId: 'u1' });
        expect(outer.error).toBe(`Node 'call' failed: subflow '${WRITER}' failed: ${childText(fault)}`);
    });
});

describe('#27743 — a `try_catch` with no catch region carries the guarded refusal', () => {
    /** start → guard (try_catch, try = [mk], no catch) → end. */
    function guardedFlow(retry?: Record<string, unknown>): any {
        return {
            name: 'guarded', label: 'Guarded', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'guard', type: 'try_catch', label: 'Guard',
                    config: {
                        try: {
                            nodes: [
                                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'crm_account', fields: { name: 'Acme' } } },
                            ],
                            edges: [],
                        },
                        ...(retry ? { retry } : {}),
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'guard' },
                { id: 'e2', source: 'guard', target: 'end' },
            ],
        };
    }

    function guardedEngine(data: any): AutomationEngine {
        const engine = new AutomationEngine(makeLogger());
        const ctx = ctxWith(data);
        registerCrudNodes(engine, ctx);
        registerTryCatchNode(engine, ctx);
        return engine;
    }

    it('the region\'s refusal reaches the run — code and userMessage — and the text keeps its chain', async () => {
        const err = markedHook();
        const engine = guardedEngine(refusingData(err));
        engine.registerFlow('guarded', guardedFlow());

        const result = await engine.execute('guarded', { userId: 'u1' });

        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'RESOURCE_CONFLICT', message: err.message });
        expect(result.userMessage).toBe(HOOK_USER_TEXT);
        expect(result.error).toBe(
            `Node 'guard' failed: try_catch 'guard': try region failed — `
            + `Node 'mk' failed: create_record(crm_account) failed: ${err.message}`,
        );
    });

    it('a retry ladder carries the LAST attempt\'s refusal, never an earlier one\'s', async () => {
        const first = validation();
        const last = permission();
        let calls = 0;
        const data = refusingData(undefined);
        data.insert = async () => { calls += 1; throw calls === 1 ? first : last; };
        const engine = guardedEngine(data);
        engine.registerFlow('guarded', guardedFlow({ maxRetries: 1, backoffMs: 0 }));

        const result = await engine.execute('guarded', { userId: 'u1' });

        expect(calls).toBe(2);
        expect(result.status).toBe('failed');
        expect(result.innerRefusal).toEqual({ code: 'PERMISSION_DENIED', message: last.message });
    });

    it('control: a retry whose last attempt met a FAULT carries neither member, even after an earlier refusal', async () => {
        let calls = 0;
        const data = refusingData(undefined);
        data.insert = async () => {
            calls += 1;
            throw calls === 1 ? validation() : new Error('ECONNREFUSED: could not reach the store');
        };
        const engine = guardedEngine(data);
        engine.registerFlow('guarded', guardedFlow({ maxRetries: 1, backoffMs: 0 }));

        const result = await engine.execute('guarded', { userId: 'u1' });

        expect(calls).toBe(2);
        expect(result.status).toBe('failed');
        expect('innerRefusal' in result).toBe(false);
        expect('userMessage' in result).toBe(false);
    });
});

describe('#27743 — a `map` item or `subflow` child that pauses and fails on resume', () => {
    /** start → hold (pause) → mk (create_record) → end — the child that fails after its pause. */
    const PAUSING_WRITER = 'hold_then_write';

    function pausingEngine(err: unknown): AutomationEngine {
        const engine = new AutomationEngine(makeLogger());
        const ctx = ctxWith(refusingData(err));
        registerCrudNodes(engine, ctx);
        registerMapNode(engine, ctx);
        registerSubflowNode(engine, ctx);
        engine.registerNodeExecutor({
            type: 'hold',
            descriptor: defineActionDescriptor({ type: 'hold', version: '1.0.0', name: 'hold', supportsPause: true, resumeAuthority: 'any' }),
            async execute() { return { success: true, suspend: true }; },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'seed',
            async execute(_node, variables) {
                variables.set('rows', [{ n: 1 }]);
                return { success: true };
            },
        } as NodeExecutor);
        engine.registerFlow(PAUSING_WRITER, {
            name: PAUSING_WRITER, label: 'Hold then write', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'hold', type: 'hold', label: 'Hold' },
                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'crm_account', fields: { name: 'Acme' } } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'hold' },
                { id: 'e2', source: 'hold', target: 'mk' },
                { id: 'e3', source: 'mk', target: 'end' },
            ],
        } as any);
        return engine;
    }

    function subflowFlow(name: string, flowName: string): any {
        return {
            name, label: name, type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'call', type: 'subflow', label: 'Call', config: { flowName } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        };
    }

    function mapFlow(name: string, flowName: string): any {
        return {
            name, label: name, type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'query', type: 'seed', label: 'Seed' },
                {
                    id: 'each', type: 'map', label: 'Each',
                    config: { collection: { dialect: 'cel', source: 'rows' }, flowName, iteratorVariable: 'row' },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'query' },
                { id: 'e2', source: 'query', target: 'each' },
                { id: 'e3', source: 'each', target: 'end' },
            ],
        };
    }

    const childRunIdOf = (engine: AutomationEngine) =>
        engine.listSuspendedRuns().find(r => r.flowName === PAUSING_WRITER)?.runId;

    it('subflow, resumed at the PARENT\'s run id (the delegated leg): the child\'s refusal reaches the caller', async () => {
        const err = markedHook();
        const engine = pausingEngine(err);
        engine.registerFlow('outer', subflowFlow('outer', PAUSING_WRITER));

        const paused = await engine.execute('outer', { userId: 'u1' });
        expect(paused.status).toBe('paused');
        const childRunId = childRunIdOf(engine)!;
        const result = await engine.resume(paused.runId!, {});

        expect(result.success).toBe(false);
        expect(result.innerRefusal).toEqual({ code: 'RESOURCE_CONFLICT', message: err.message });
        expect(result.userMessage).toBe(HOOK_USER_TEXT);
        expect(result.error).toBe(
            `subflow run '${childRunId}' (${PAUSING_WRITER}) failed: `
            + `Node 'mk' failed: create_record(crm_account) failed: ${err.message}`,
        );
    });

    it('subflow → subflow, resumed at the TOP run id: the refusal crosses both delegated frames', async () => {
        const err = permission();
        const engine = pausingEngine(err);
        engine.registerFlow('middle', subflowFlow('middle', PAUSING_WRITER));
        engine.registerFlow('outer', subflowFlow('outer', 'middle'));

        const paused = await engine.execute('outer', { userId: 'u1' });
        expect(paused.status).toBe('paused');
        const result = await engine.resume(paused.runId!, {});

        expect(result.success).toBe(false);
        expect(result.innerRefusal).toEqual({ code: 'PERMISSION_DENIED', message: err.message });
    });

    it('subflow, resumed at the CHILD\'s run id (the up-bubble leg): the caller already gets the refusal', async () => {
        const err = markedHook();
        const engine = pausingEngine(err);
        engine.registerFlow('outer', subflowFlow('outer', PAUSING_WRITER));

        const paused = await engine.execute('outer', { userId: 'u1' });
        expect(paused.status).toBe('paused');
        const result = await engine.resume(childRunIdOf(engine)!, {});

        expect(result.success).toBe(false);
        expect(result.status).toBe('stranded');
        expect(result.innerRefusal).toEqual({ code: 'RESOURCE_CONFLICT', message: err.message });
        expect(result.userMessage).toBe(HOOK_USER_TEXT);
    });

    it('map, its item resumed at the CHILD\'s run id (the bubble leg a `map` takes): the caller already gets the refusal', async () => {
        const err = validation();
        const engine = pausingEngine(err);
        engine.registerFlow('recalc', mapFlow('recalc', PAUSING_WRITER));

        const paused = await engine.execute('recalc', { userId: 'u1' });
        expect(paused.status).toBe('paused');
        const result = await engine.resume(childRunIdOf(engine)!, {});

        expect(result.success).toBe(false);
        expect(result.status).toBe('stranded');
        expect(result.innerRefusal).toEqual({ code: 'VALIDATION_FAILED', message: 'Amount must be positive' });
    });

    it('control: a child that fails on resume with a FAULT carries neither member on the delegated leg', async () => {
        const engine = pausingEngine(new Error('ECONNREFUSED: could not reach the store'));
        engine.registerFlow('outer', subflowFlow('outer', PAUSING_WRITER));

        const paused = await engine.execute('outer', { userId: 'u1' });
        const result = await engine.resume(paused.runId!, {});

        expect(result.success).toBe(false);
        expect('innerRefusal' in result).toBe(false);
        expect('userMessage' in result).toBe(false);
    });
});
