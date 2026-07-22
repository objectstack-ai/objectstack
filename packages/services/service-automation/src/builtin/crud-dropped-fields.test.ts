// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3407 — `update_record` used to report an unconditional `success` even when
 * the data layer silently stripped the requested write fields (static
 * `readonly` #2948, conditional `readonlyWhen` #3042): the strip's only trace
 * was a server-side logger warn, invisible in the flow run trace — which is how
 * #3356's approval stage write-backs failed end-to-end behind a clean 3ms
 * `success`.
 *
 * The engine now reports strips via `options.onFieldsDropped`
 * (`WriteObservabilityOptions`, @objectstack/spec/contracts), and the CRUD
 * nodes surface them as step WARNINGS (+ a structured `droppedFields` output)
 * while keeping `success: true` — stripping is legal semantics, not a failure.
 * These tests pin the node-side contract with a stub engine that invokes the
 * listener exactly like ObjectQL does (the engine side is pinned in
 * packages/objectql/src/engine.test.ts "Dropped-field write observability").
 */
import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';

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
 * A data engine stub whose write ops report `droppedEvents` through the
 * caller's `onFieldsDropped` listener — the exact seam ObjectQL fires when its
 * readonly/readonlyWhen strips drop caller-supplied fields.
 */
function fakeDataWithDrops(droppedEvents: Array<{ object: string; fields: string[]; reason: string }>) {
    const writes: Array<{ op: string; obj: string; fields: any }> = [];
    const data: any = {
        async insert(obj: string, fields: any, opts: any) {
            writes.push({ op: 'insert', obj, fields });
            for (const e of droppedEvents) opts?.onFieldsDropped?.(e);
            return { id: `${obj}_1`, ...fields };
        },
        async update(obj: string, fields: any, opts: any) {
            writes.push({ op: 'update', obj, fields });
            for (const e of droppedEvents) opts?.onFieldsDropped?.(e);
            return { ok: true };
        },
    };
    return { data, writes };
}

function updateFlow(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'case_approval', filter: { id: 'x' }, fields: { stage: 'approved', note: 'ok' } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'up' },
            { id: 'e2', source: 'up', target: 'end' },
        ],
    } as any;
}

describe('update_record surfaces silently-stripped write fields (#3407)', () => {
    it('attaches a step warning naming the dropped fields — and the step still SUCCEEDS', async () => {
        const engine = new AutomationEngine(makeLogger());
        const { data } = fakeDataWithDrops([
            { object: 'case_approval', fields: ['stage'], reason: 'readonly' },
        ]);
        registerCrudNodes(engine, ctxWith(data));
        engine.registerFlow('f1', updateFlow('f1'));

        const res = await engine.execute('f1', { userId: 'u1' });
        expect(res.success).toBe(true); // stripping is legal — never a failure

        const runs = await engine.listRuns('f1');
        const step = runs[0].steps.find((s) => s.nodeId === 'up')!;
        expect(step.status).toBe('success');
        expect(step.warnings).toHaveLength(1);
        expect(step.warnings![0]).toContain('update_record(case_approval)');
        expect(step.warnings![0]).toContain('[stage]');
        expect(step.warnings![0]).toContain('read-only');
    });

    it('exposes the dropped field names as structured output ({up.droppedFields})', async () => {
        const engine = new AutomationEngine(makeLogger());
        const { data } = fakeDataWithDrops([
            { object: 'case_approval', fields: ['stage'], reason: 'readonly' },
            { object: 'case_approval', fields: ['locked_note'], reason: 'readonly_when' },
        ]);
        registerCrudNodes(engine, ctxWith(data));

        // Probe node reads the update step's output variable after it ran.
        let seen: unknown;
        engine.registerNodeExecutor({
            type: 'probe',
            async execute(_node, variables) {
                seen = variables.get('up.droppedFields');
                return { success: true };
            },
        });
        const flow = updateFlow('f2');
        flow.nodes.splice(2, 0, { id: 'probe', type: 'probe', label: 'Probe' });
        flow.edges = [
            { id: 'e1', source: 'start', target: 'up' },
            { id: 'e2', source: 'up', target: 'probe' },
            { id: 'e3', source: 'probe', target: 'end' },
        ];
        engine.registerFlow('f2', flow);

        await engine.execute('f2', { userId: 'u1' });
        expect(seen).toEqual(['stage', 'locked_note']);

        // One warning per strip event, each with its own reason wording.
        const runs = await engine.listRuns('f2');
        const step = runs[0].steps.find((s) => s.nodeId === 'up')!;
        expect(step.warnings).toHaveLength(2);
        expect(step.warnings![1]).toContain('readonlyWhen');
    });

    it('emits NO warnings and NO droppedFields output when nothing was stripped', async () => {
        const engine = new AutomationEngine(makeLogger());
        const { data } = fakeDataWithDrops([]);
        registerCrudNodes(engine, ctxWith(data));
        engine.registerFlow('f3', updateFlow('f3'));

        const res = await engine.execute('f3', { userId: 'u1' });
        expect(res.success).toBe(true);

        const runs = await engine.listRuns('f3');
        const step = runs[0].steps.find((s) => s.nodeId === 'up')!;
        expect(step.status).toBe('success');
        expect(step.warnings).toBeUndefined();
    });
});

describe('create_record is wired symmetrically (#3407)', () => {
    // Today ObjectQL's insert path strips nothing (INSERT is readonly-exempt,
    // FLS write denial throws) — but the node listens anyway, so a future
    // insert-side strip surfaces instead of going silent.
    it('surfaces insert-side drop events as step warnings, keeping success', async () => {
        const engine = new AutomationEngine(makeLogger());
        const { data } = fakeDataWithDrops([
            { object: 'thing', fields: ['serial'], reason: 'readonly' },
        ]);
        registerCrudNodes(engine, ctxWith(data));
        engine.registerFlow('c1', {
            name: 'c1', label: 'c1', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'thing', fields: { serial: 'S-1', name: 'a' } } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'mk' },
                { id: 'e2', source: 'mk', target: 'end' },
            ],
        } as any);

        const res = await engine.execute('c1', { userId: 'u1' });
        expect(res.success).toBe(true);

        const runs = await engine.listRuns('c1');
        const step = runs[0].steps.find((s) => s.nodeId === 'mk')!;
        expect(step.status).toBe('success');
        expect(step.warnings).toHaveLength(1);
        expect(step.warnings![0]).toContain('create_record(thing)');
        expect(step.warnings![0]).toContain('[serial]');
    });

    it('stays warning-free on a clean insert', async () => {
        const engine = new AutomationEngine(makeLogger());
        const { data } = fakeDataWithDrops([]);
        registerCrudNodes(engine, ctxWith(data));
        engine.registerFlow('c2', {
            name: 'c2', label: 'c2', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'thing', fields: { name: 'a' } } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'mk' },
                { id: 'e2', source: 'mk', target: 'end' },
            ],
        } as any);

        await engine.execute('c2', { userId: 'u1' });
        const runs = await engine.listRuns('c2');
        const step = runs[0].steps.find((s) => s.nodeId === 'mk')!;
        expect(step.warnings).toBeUndefined();
    });
});
