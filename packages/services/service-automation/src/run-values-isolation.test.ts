// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One run's writes never change a flow's definition, another run's values, or
 * a value the run was handed.
 *
 *  - **Defaults.** A declared variable's object or list default is the
 *    registered flow's; each run starts from its own copy, so a dotted write
 *    under that variable, or a node that changes the value in place, leaves
 *    the next run reading the original.
 *  - **The trigger record.** `record` and `$record` start as the same record;
 *    a `record.x` write is the run's own value, so `$record.x` and the
 *    trigger's object keep what they were handed.
 *  - **A paused run.** With no durable store, the paused run is held in
 *    memory; its resume works on its own copy, as a stored run's does, so
 *    nothing it writes reaches a value the run was handed.
 *
 * In-run reads are unchanged: a dotted write is read back by the same run.
 */

import { describe, expect, it } from 'vitest';

import { defineActionDescriptor } from '@objectstack/spec/automation';

import { AutomationEngine } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { SuspendedRunStore } from './engine.js';
import { HeldValueCycleError, copyHeldValue } from './scope-key-segments.js';

function silentLogger(): any {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

const cel = (source: string) => ({ dialect: 'cel', source });

function makeEngine(store?: SuspendedRunStore): AutomationEngine {
    const engine = new AutomationEngine(silentLogger(), store);
    installBuiltinNodes(engine, { logger: silentLogger(), getService() { return undefined; } } as any);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: defineActionDescriptor({ type: 'hold', version: '1.0.0', name: 'hold', supportsPause: true, resumeAuthority: 'any' }),
        async execute() { return { success: true, suspend: true, correlation: 'approval:req_1' }; },
    } as never);
    // A plugin node that changes a held value in place — the executor API
    // hands it the run's variable map, so nothing stops it.
    engine.registerNodeExecutor({
        type: 'touch',
        descriptor: defineActionDescriptor({ type: 'touch', version: '1.0.0', name: 'touch' }),
        async execute(node: any, variables: Map<string, unknown>) {
            const target = variables.get(node.config?.target as string) as Record<string, unknown> | unknown[];
            if (Array.isArray(target)) target.push('touched');
            else if (target && typeof target === 'object') (target as Record<string, unknown>).mode = 'touched';
            return { success: true };
        },
    } as never);
    // A plugin node that binds a value containing itself.
    engine.registerNodeExecutor({
        type: 'loopback',
        descriptor: defineActionDescriptor({ type: 'loopback', version: '1.0.0', name: 'loopback' }),
        async execute(_node: any, variables: Map<string, unknown>) {
            const ring: Record<string, unknown> = { label: 'ring' };
            ring.self = ring;
            variables.set('ring', ring);
            return { success: true };
        },
    } as never);
    return engine;
}

/** start → each step in order → end. */
function chain(name: string, steps: Array<Record<string, unknown>>, variables: unknown[]) {
    const nodes = [
        { id: 'start', type: 'start', label: 'Start' },
        ...steps.map((s, i) => ({ id: `n${i + 1}`, label: `N${i + 1}`, ...s })),
        { id: 'end', type: 'end', label: 'End' },
    ];
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i + 1}`, source: nodes[i]!.id, target: n.id }));
    return { name, label: name, type: 'autolaunched', variables, nodes, edges } as any;
}

const assign = (assignments: Record<string, unknown>) => ({ type: 'assignment', config: { assignments } });

/** Each case: the declared default, the dotted write under it, the read, what run 1 reads after the write, what run 2 reads first. */
const DEFAULT_CASES: ReadonlyArray<[string, unknown, string, unknown, string, unknown]> = [
    ['case 1 (object default)', { mode: 'a', n: 1 }, 'cfg.mode', 'b', 'cfg.mode', 'a'],
    ['case 2 (object default, nested)', { inner: { mode: 'a' } }, 'cfg.inner.mode', 'b', 'cfg.inner.mode', 'a'],
    ['case 3 (list default, index)', ['a', 'b'], 'cfg.0', 'z', 'cfg[0]', 'a'],
    ['case 4 (list default, length)', ['a', 'b'], 'cfg.length', 0, 'size(cfg)', 2],
];

describe('one run never changes the flow\'s defaults', () => {
    it.each(DEFAULT_CASES)('%s: a dotted write is read back in its run, and the next run reads the default', async (_t, def, key, value, read, original) => {
        const engine = makeEngine();
        const flow = chain('iso_defaults', [
            assign({ first: cel(read) }),
            assign({ [key]: value }),
            assign({ after: cel(read) }),
        ], [
            { name: 'cfg', type: Array.isArray(def) ? 'list' : 'object', defaultValue: def },
            { name: 'first', type: 'text', isOutput: true },
            { name: 'after', type: 'text', isOutput: true },
        ]);
        engine.registerFlow('iso_defaults', flow);

        const run1 = await engine.execute('iso_defaults');
        expect(run1.success, JSON.stringify(run1)).toBe(true);
        expect((run1.output as any).first).toEqual(original);
        expect((run1.output as any).after).toEqual(value);

        const run2 = await engine.execute('iso_defaults');
        expect(run2.success, JSON.stringify(run2)).toBe(true);
        expect((run2.output as any).first).toEqual(original);
        expect((await engine.getFlow('iso_defaults'))!.variables![0]!.defaultValue).toEqual(def);
    });

    it('a dotted write is still read back by the run that wrote it', async () => {
        const engine = makeEngine();
        engine.registerFlow('iso_readback', chain('iso_readback', [
            assign({ 'cfg.mode': 'b' }),
            assign({ after: cel('cfg.mode'), kept: cel('cfg.n') }),
        ], [
            { name: 'cfg', type: 'object', defaultValue: { mode: 'a', n: 1 } },
            { name: 'after', type: 'text', isOutput: true },
            { name: 'kept', type: 'number', isOutput: true },
        ]));
        const run = await engine.execute('iso_readback');
        expect(run.success, JSON.stringify(run)).toBe(true);
        expect(run.output).toMatchObject({ after: 'b', kept: 1 });
    });

    it.each([
        ['case 1 (object default)', { mode: 'a' }, 'cfg.mode', 'a'],
        ['case 2 (list default)', ['a'], 'size(cfg)', 1],
    ] as const)('%s: a node that changes the value in place leaves the next run reading the default', async (_t, def, read, original) => {
        const engine = makeEngine();
        engine.registerFlow('iso_inplace', chain('iso_inplace', [
            assign({ first: cel(read) }),
            { type: 'touch', config: { target: 'cfg' } },
        ], [
            { name: 'cfg', type: Array.isArray(def) ? 'list' : 'object', defaultValue: def },
            { name: 'first', type: 'text', isOutput: true },
        ]));
        await engine.execute('iso_inplace');
        const run2 = await engine.execute('iso_inplace');
        expect(run2.success, JSON.stringify(run2)).toBe(true);
        expect((run2.output as any).first).toEqual(original);
        expect((await engine.getFlow('iso_inplace'))!.variables![0]!.defaultValue).toEqual(def);
    });
});

describe('a record write is the run\'s own value', () => {
    it('a record.x write does not change $record.x or the trigger\'s object', async () => {
        const engine = makeEngine();
        engine.registerFlow('iso_record', chain('iso_record', [
            assign({ 'record.x': 2 }),
            assign({ seen_record: cel('record.x'), seen_trigger: cel("vars['$record'].x"), seen_other: cel('record.y') }),
        ], [
            { name: 'seen_record', type: 'number', isOutput: true },
            { name: 'seen_trigger', type: 'number', isOutput: true },
            { name: 'seen_other', type: 'number', isOutput: true },
        ]));
        const trigger = { x: 1, y: 7 };
        const run = await engine.execute('iso_record', { record: trigger } as any);
        expect(run.success, JSON.stringify(run)).toBe(true);
        expect(run.output).toMatchObject({ seen_record: 2, seen_trigger: 1, seen_other: 7 });
        expect(trigger).toEqual({ x: 1, y: 7 });
    });
});

describe('a paused run\'s resume works on its own values', () => {
    it.each([
        ['case 1 (no store)', undefined],
        ['case 2 (a store)', () => new InMemorySuspendedRunStore()],
    ] as const)('%s: a node after the pause that changes a value in place leaves the trigger\'s object as handed', async (_t, makeStore) => {
        const engine = makeEngine(makeStore?.());
        engine.registerFlow('iso_pause', chain('iso_pause', [
            { type: 'hold' },
            { type: 'touch', config: { target: 'record' } },
            assign({ seen: cel('record.mode') }),
        ], [{ name: 'seen', type: 'text', isOutput: true }]));
        const trigger = { mode: 'a' };
        const paused = await engine.execute('iso_pause', { record: trigger } as any);
        expect(paused.status).toBe('paused');
        const done = await engine.resume(paused.runId!, { output: { decision: 'approved' } });
        expect(done.success, JSON.stringify(done)).toBe(true);
        expect((done.output as any).seen).toBe('touched');
        expect(trigger).toEqual({ mode: 'a' });
    });
});

describe('the trigger record is the run\'s own copy', () => {
    it('a node before any pause that changes the record in place leaves the trigger\'s object as handed', async () => {
        const engine = makeEngine();
        engine.registerFlow('iso_prepause', chain('iso_prepause', [
            { type: 'touch', config: { target: 'record' } },
            assign({ seen: cel('record.mode'), seen_trigger: cel("vars['$record'].mode") }),
        ], [{ name: 'seen', type: 'text', isOutput: true }, { name: 'seen_trigger', type: 'text', isOutput: true }]));
        const trigger = { mode: 'a', nested: { n: 1 } };
        const run = await engine.execute('iso_prepause', { record: trigger } as any);
        expect(run.success, JSON.stringify(run)).toBe(true);
        expect(run.output).toMatchObject({ seen: 'touched', seen_trigger: 'touched' });
        expect(trigger).toEqual({ mode: 'a', nested: { n: 1 } });
    });
});

describe('a value that contains itself', () => {
    it('is refused by the copy with a named error', () => {
        const ring: Record<string, unknown> = { label: 'ring' };
        ring.self = ring;
        let thrown: unknown;
        try { copyHeldValue({ wrap: [ring] }); } catch (err) { thrown = err; }
        expect(thrown).toBeInstanceOf(HeldValueCycleError);
        expect((thrown as Error).name).toBe('HeldValueCycleError');
        // A value reached twice without containing itself is copied, not refused.
        const shared = { n: 1 };
        const copy = copyHeldValue({ a: shared, b: shared }) as any;
        expect(copy).toEqual({ a: { n: 1 }, b: { n: 1 } });
        expect(copy.a).not.toBe(shared);
    });

    it('held by a paused run with no store: the resume still completes, never answered as an unreachable store', async () => {
        const engine = makeEngine();
        engine.registerFlow('iso_ring', chain('iso_ring', [
            { type: 'loopback' },
            { type: 'hold' },
            assign({ seen: cel('ring.label') }),
        ], [{ name: 'seen', type: 'text', isOutput: true }]));
        const paused = await engine.execute('iso_ring');
        expect(paused.status).toBe('paused');
        const done = await engine.resume(paused.runId!, { output: { decision: 'approved' } });
        expect(done.code).not.toBe('STORE_UNAVAILABLE');
        expect(done.success, JSON.stringify({ code: done.code, error: done.error })).toBe(true);
        expect((done.output as any).seen).toBe('ring');
    });
});
