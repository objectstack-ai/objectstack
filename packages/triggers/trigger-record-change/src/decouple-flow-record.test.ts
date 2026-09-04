// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14744] The flow-facing `record` / `previous` roots share no mutable object
 * with the engine's own state.
 *
 * `before-update-flow-payload-reach.test.ts` is the END-TO-END pin: it boots a
 * real kernel and measures the consequence on persisted rows. This file is the
 * SEAM pin under it, and the two are not redundant — the end-to-end file can
 * only exercise the shapes a flow's own vocabulary can produce, while the
 * decoupling has to hold for whatever a record VALUE happens to be.
 *
 * It covers three things that file cannot:
 *
 *  1. `previous` as well as `record`. `ctx.previous` is the engine's ONE
 *     pre-image object and the SAME `HookContext` reaches every other flow
 *     binding on the write, so writing through it leaks sideways rather than
 *     into the payload. That leak has no persisted-row symptom to measure.
 *  2. The value shapes: nested objects, arrays, `Date`, `Map`, `Set`, cycles —
 *     and the DOCUMENTED RESIDUE, a class instance, which is shared by
 *     reference on purpose. A boundary nobody asserts is a boundary nobody
 *     knows has moved.
 *  3. That the decoupling did not rearrange what a flow sees INWARD: the two
 *     roots still share the substructure they shared with each other, and
 *     `params` is still the same object as `record`.
 */
import { describe, it, expect } from 'vitest';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import { decoupleFromEngineState } from './decouple-flow-record.js';
import { RecordChangeTrigger, type RecordChangeDataEngine, type TriggerLogger } from './record-change-trigger.js';

const silentLogger = (): TriggerLogger => ({ info: () => {}, warn: () => {}, debug: () => {} });

/** Fake ObjectQL engine that just captures the registered hook handler. */
function fakeEngine() {
    const hooks: Array<(ctx: HookContext) => unknown | Promise<unknown>> = [];
    const engine: RecordChangeDataEngine = {
        registerHook(_event, handler) {
            hooks.push(handler);
        },
    };
    return { engine, hooks };
}

/**
 * Drive one `beforeUpdate` dispatch through the real trigger and hand back both
 * the context the flow was given and the engine-side objects it was built from,
 * so every assertion below is about the SAME pair the engine holds.
 */
async function dispatch(
    input: { id?: unknown; data: Record<string, unknown> },
    previous: Record<string, unknown>,
): Promise<{ flow: AutomationContext; payload: Record<string, unknown>; preImage: Record<string, unknown> }> {
    const { engine, hooks } = fakeEngine();
    const trigger = new RecordChangeTrigger(engine, silentLogger());
    let flow: AutomationContext | undefined;
    trigger.start(
        { flowName: 'probe', object: 'thing', event: 'record-before-update' },
        async (ctx) => {
            flow = ctx;
        },
    );
    expect(hooks, 'the trigger must have bound a beforeUpdate hook').toHaveLength(1);
    const hookCtx = {
        object: 'thing',
        event: 'beforeUpdate',
        input,
        previous,
        session: { userId: 'u1' },
        ql: {},
    } as unknown as HookContext;
    await hooks[0](hookCtx);
    if (!flow) throw new Error('the flow callback never ran — the probe measured nothing');
    return { flow, payload: input.data, preImage: previous };
}

describe('[#14744] the record handed to a flow is decoupled from the batch payload', () => {
    it('an in-place mutation of a nested payload value does not reach `ctx.input.data`', async () => {
        const { flow, payload } = await dispatch(
            { id: 't1', data: { status: 'done', tags: ['seed'], meta: { hits: 1 } } },
            { id: 't1', status: 'todo', title: 'alpha' },
        );

        const record = flow.record as Record<string, unknown>;
        // The flow sees the payload's values...
        expect(record.tags).toEqual(['seed']);
        expect(record.meta).toEqual({ hits: 1 });
        // ...through objects that are NOT the engine's.
        expect(record.tags).not.toBe(payload.tags);
        expect(record.meta).not.toBe(payload.meta);

        (record.tags as string[]).push('REACHED');
        (record.meta as { hits: number }).hits = 99;

        expect(payload.tags, 'the batch payload is the SET clause — it must be untouched').toEqual(['seed']);
        expect(payload.meta).toEqual({ hits: 1 });
        // The flow's own view still reflects its own write — a copy, not a
        // silent no-op inside the run.
        expect(record.tags).toEqual(['seed', 'REACHED']);
    });

    it('a mutation through `previous` does not reach the engine\'s shared pre-image', async () => {
        const { flow, preImage } = await dispatch(
            { id: 't1', data: { status: 'done' } },
            { id: 't1', status: 'todo', labels: ['old'], nested: { n: 1 } },
        );

        const previous = flow.previous as Record<string, unknown>;
        expect(previous.labels).toEqual(['old']);
        expect(previous.labels).not.toBe(preImage.labels);
        expect(previous.nested).not.toBe(preImage.nested);

        (previous.labels as string[]).push('REACHED');
        (previous.nested as { n: number }).n = 99;

        // `ctx.previous` is handed to every OTHER binding on this write.
        expect(preImage.labels).toEqual(['old']);
        expect(preImage.nested).toEqual({ n: 1 });
    });

    it('keeps `params` the same object as `record`, and keeps what the two roots shared with each other', async () => {
        const shared = { by: 'u1' };
        const { flow } = await dispatch(
            { id: 't1', data: { status: 'done' } },
            { id: 't1', status: 'todo', audit: shared, also: shared },
        );

        expect(flow.params, '`params` was never a second snapshot').toBe(flow.record);
        const previous = flow.previous as Record<string, unknown>;
        expect(previous.audit, 'one copy, reached twice — not two copies').toBe(previous.also);
        expect(previous.audit).not.toBe(shared);
    });
});

describe('[#14744] decoupleFromEngineState — the value shapes it covers, and the one it does not', () => {
    it('copies arrays, plain objects, Date, RegExp, Map and Set', () => {
        const source = {
            arr: [1, { deep: 'x' }],
            obj: { a: { b: 1 } },
            when: new Date('2026-09-04T00:00:00.000Z'),
            re: /abc/gi,
            map: new Map<string, unknown>([['k', { v: 1 }]]),
            set: new Set<unknown>([{ s: 1 }]),
        };
        const copy = decoupleFromEngineState(source);

        expect(copy).toEqual(source);
        expect(copy.arr).not.toBe(source.arr);
        expect(copy.arr[1]).not.toBe(source.arr[1]);
        expect(copy.obj.a).not.toBe(source.obj.a);
        expect(copy.when).not.toBe(source.when);
        expect(copy.when.getTime()).toBe(source.when.getTime());
        expect(copy.re).not.toBe(source.re);
        expect(copy.re.source).toBe('abc');
        expect(copy.re.flags).toBe('gi');
        expect(copy.map).not.toBe(source.map);
        expect(copy.map.get('k')).not.toBe(source.map.get('k'));
        expect(copy.set).not.toBe(source.set);
        expect([...copy.set][0]).not.toBe([...source.set][0]);

        // Mutating every copied container leaves the source alone.
        (copy.arr[1] as { deep: string }).deep = 'MUTATED';
        copy.when.setUTCFullYear(1999);
        copy.map.set('k2', 1);
        copy.set.add('extra');
        expect((source.arr[1] as { deep: string }).deep).toBe('x');
        expect(source.when.toISOString()).toBe('2026-09-04T00:00:00.000Z');
        expect(source.map.size).toBe(1);
        expect(source.set.size).toBe(1);
    });

    it('passes primitives and functions through, and terminates on a cycle', () => {
        const fn = () => 'kept';
        const cyclic: Record<string, unknown> = { n: 1, s: 'x', nil: null, un: undefined, fn };
        cyclic.self = cyclic;
        cyclic.list = [cyclic];

        const copy = decoupleFromEngineState(cyclic);

        expect(copy.n).toBe(1);
        expect(copy.s).toBe('x');
        expect(copy.nil).toBeNull();
        expect('un' in copy).toBe(true);
        expect(copy.fn, 'a function is shared — there is nothing safe to copy').toBe(fn);
        expect(copy.self, 'the cycle resolves to the COPY, not the source').toBe(copy);
        expect((copy.list as unknown[])[0]).toBe(copy);
        expect(copy).not.toBe(cyclic);
    });

    it('SHARES a class instance by reference — the documented residue, asserted so it cannot move silently', () => {
        class Exotic {
            constructor(public state: number) {}
            bump(): void {
                this.state += 1;
            }
        }
        const instance = new Exotic(1);
        const copy = decoupleFromEngineState({ instance, wrapped: [instance] });

        expect(copy.instance, 'shared, deliberately: copying by property assignment breaks internal state').toBe(
            instance,
        );
        expect((copy.wrapped as Exotic[])[0]).toBe(instance);
        // Still a real instance, which is the whole reason it is not copied.
        copy.instance.bump();
        expect(instance.state).toBe(2);
    });

    it('walks a repeated reference once when one `seen` map spans both roots', () => {
        const shared = { hit: 0 };
        const seen = new WeakMap<object, unknown>();
        const a = decoupleFromEngineState({ shared }, seen);
        const b = decoupleFromEngineState({ shared }, seen);

        expect(a.shared).not.toBe(shared);
        expect(b.shared).toBe(a.shared);
    });
});
