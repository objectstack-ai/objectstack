// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A paused screen says where it sits among its run's screens (#26657).
 *
 * A screen-flow wizard's button read 「提交」 on every step, so a requester
 * believed the contract was submitted on step 1, and no step counter could be
 * drawn: the paused `ScreenSpec` carried nothing about the screens after it,
 * and a flow can branch after any screen, so only the engine — which holds
 * the graph — can answer. It now serves `ScreenSpec.progress`: `nextScreen`
 * (`none` / `possible` / `certain`), and `step` / `stepCount` only where the
 * graph makes them exact.
 *
 * Two layers: the engine end to end (a run pauses, resumes and pauses again,
 * reading what each served screen carries), and `readScreenProgress` over
 * graph shapes the engine cannot cheaply reach (fan-out, fault paths, a
 * caller-answered screen).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine, type NodeExecutor } from '../engine.js';
import { installBuiltinNodes } from './index.js';
import { readScreenProgress, type ScreenProgressRole } from './screen-nodes.js';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
    return { logger: silentLogger(), getService() { return undefined; } } as any;
}

/** A screen that pauses: it declares a field. */
const screen = (id: string, field = `${id}_answer`) => ({
    id, type: 'screen', label: id.toUpperCase(),
    config: { fields: [{ name: field, label: field, type: 'text' }] },
});
const edge = (source: string, target: string, extra: Record<string, unknown> = {}) =>
    ({ id: `${source}->${target}`, source, target, ...extra });
const flowOf = (name: string, nodes: unknown[], edges: unknown[]) =>
    ({ name, label: name, type: 'screen', status: 'active', version: 1, nodes, edges }) as any;

describe('ScreenSpec.progress — the engine reads the flow graph (#26657)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        // A pause that serves no screen (an approval / a wait stands for it).
        engine.registerNodeExecutor({
            type: 'hold',
            descriptor: defineActionDescriptor({ type: 'hold', version: '1.0.0', name: 'hold', supportsPause: true, resumeAuthority: 'any' }),
            async execute() { return { success: true, suspend: true }; },
        } as NodeExecutor);
    });

    it('a linear wizard counts its steps exactly and says Next until the last', async () => {
        engine.registerFlow('linear', flowOf('linear', [
            { id: 'start', type: 'start', label: 'Start' },
            screen('s1'), screen('s2'), screen('s3'),
            { id: 'end', type: 'end', label: 'End' },
        ], [edge('start', 's1'), edge('s1', 's2'), edge('s2', 's3'), edge('s3', 'end')]));

        const first = await engine.execute('linear', {} as any);
        expect(first.screen?.progress).toEqual({ nextScreen: 'certain', step: 1, stepCount: 3 });
        const second = await engine.resume(first.runId!, { variables: { s1_answer: 'a' } });
        expect(second.screen?.progress).toEqual({ nextScreen: 'certain', step: 2, stepCount: 3 });
        const third = await engine.resume(second.runId!, { variables: { s2_answer: 'b' } });
        expect(third.screen?.progress).toEqual({ nextScreen: 'none', step: 3, stepCount: 3 });
        const done = await engine.resume(third.runId!, { variables: { s3_answer: 'c' } });
        expect(done.status).not.toBe('paused');
        expect(done.success).toBe(true);
    });

    it('an object-form step carries it too, and a one-screen flow is step 1 of 1, Submit', async () => {
        engine.registerFlow('single', flowOf('single', [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'form', type: 'screen', label: 'Form', config: { objectName: 'account' } },
            { id: 'end', type: 'end', label: 'End' },
        ], [edge('start', 'form'), edge('form', 'end')]));

        const paused = await engine.execute('single', {} as any);
        expect(paused.screen?.kind).toBe('object-form');
        expect(paused.screen?.progress).toEqual({ nextScreen: 'none', step: 1, stepCount: 1 });
    });

    it('a branch after a screen answers "possible" and drops the total, never a guess', async () => {
        engine.registerFlow('branched', flowOf('branched', [
            { id: 'start', type: 'start', label: 'Start' },
            screen('s1', 'more'),
            { id: 'd', type: 'decision', label: 'More?', config: {} },
            screen('s2'),
            { id: 'end', type: 'end', label: 'End' },
        ], [
            edge('start', 's1'), edge('s1', 'd'),
            edge('d', 's2', { condition: "more == 'yes'" }),
            edge('d', 'end', { isDefault: true }),
            edge('s2', 'end'),
        ]));

        const first = await engine.execute('branched', {} as any);
        // One way pauses on s2, the other ends: "possible", and the position is
        // exact (no path reaches s1 any other way) while the total is not.
        expect(first.screen?.progress).toEqual({ nextScreen: 'possible', step: 1 });
        const second = await engine.resume(first.runId!, { variables: { more: 'yes' } });
        // Past the branch every path agrees again: step 2 of 2, the last.
        expect(second.screen?.nodeId).toBe('s2');
        expect(second.screen?.progress).toEqual({ nextScreen: 'none', step: 2, stepCount: 2 });
    });

    it('a loop back through the screens keeps "Next" and draws no counter', async () => {
        engine.registerFlow('looped', flowOf('looped', [
            { id: 'start', type: 'start', label: 'Start' },
            screen('s1'), screen('s2', 'again'),
            { id: 'd', type: 'decision', label: 'Again?', config: {} },
            { id: 'end', type: 'end', label: 'End' },
        ], [
            edge('start', 's1'), edge('s1', 's2'), edge('s2', 'd'),
            edge('d', 's1', { condition: "again == 'yes'", type: 'back' }),
            edge('d', 'end', { isDefault: true }),
        ]));

        const first = await engine.execute('looped', {} as any);
        // s2 surely follows s1, but how many times the loop runs is the user's.
        expect(first.screen?.progress).toEqual({ nextScreen: 'certain' });
        const second = await engine.resume(first.runId!, { variables: { s1_answer: 'a' } });
        expect(second.screen?.progress).toEqual({ nextScreen: 'possible' });
        const again = await engine.resume(second.runId!, { variables: { again: 'yes' } });
        expect(again.screen?.nodeId).toBe('s1');
        expect(again.screen?.progress).toEqual({ nextScreen: 'certain' });
    });

    it('a pause that serves no screen ends the stretch: "none" before an end, "possible" before a screen', async () => {
        engine.registerFlow('handoff', flowOf('handoff', [
            { id: 'start', type: 'start', label: 'Start' },
            screen('s1'),
            { id: 'hold', type: 'hold', label: 'Hold' },
            { id: 'end', type: 'end', label: 'End' },
        ], [edge('start', 's1'), edge('s1', 'hold'), edge('hold', 'end')]));
        engine.registerFlow('handoff_then_screen', flowOf('handoff_then_screen', [
            { id: 'start', type: 'start', label: 'Start' },
            screen('s1'),
            { id: 'hold', type: 'hold', label: 'Hold' },
            screen('s2'),
            { id: 'end', type: 'end', label: 'End' },
        ], [edge('start', 's1'), edge('s1', 'hold'), edge('hold', 's2'), edge('s2', 'end')]));

        expect((await engine.execute('handoff', {} as any)).screen?.progress)
            .toEqual({ nextScreen: 'none', step: 1, stepCount: 1 });
        expect((await engine.execute('handoff_then_screen', {} as any)).screen?.progress)
            .toEqual({ nextScreen: 'possible', step: 1 });
    });

    it('a screen that never pauses is not counted', async () => {
        engine.registerFlow('passthrough', flowOf('passthrough', [
            { id: 'start', type: 'start', label: 'Start' },
            screen('s1'),
            { id: 'note', type: 'screen', label: 'Note', config: {} },
            { id: 'end', type: 'end', label: 'End' },
        ], [edge('start', 's1'), edge('s1', 'note'), edge('note', 'end')]));

        expect((await engine.execute('passthrough', {} as any)).screen?.progress)
            .toEqual({ nextScreen: 'none', step: 1, stepCount: 1 });
    });

    describe('a subflow', () => {
        beforeEach(() => {
            engine.registerFlow('child', flowOf('child', [
                { id: 'cs', type: 'start', label: 'Start' },
                screen('c1'), screen('c2'),
                { id: 'ce', type: 'end', label: 'End' },
            ], [edge('cs', 'c1'), edge('c1', 'c2'), edge('c2', 'ce')]));
            engine.registerFlow('parent', flowOf('parent', [
                { id: 'ps', type: 'start', label: 'Start' },
                screen('p1'),
                { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'child' } },
                { id: 'pe', type: 'end', label: 'End' },
            ], [edge('ps', 'p1'), edge('p1', 'call'), edge('call', 'pe')]));
        });

        it('may serve screens of its own, so the screen before it answers "possible"', async () => {
            const first = await engine.execute('parent', {} as any);
            expect(first.screen?.nodeId).toBe('p1');
            expect(first.screen?.progress).toEqual({ nextScreen: 'possible', step: 1 });
        });

        it('serves its child screens with only what the child graph proves', async () => {
            const first = await engine.execute('parent', {} as any);
            const c1 = await engine.resume(first.runId!, { variables: { p1_answer: 'a' } });
            expect(c1.screen?.nodeId).toBe('c1');
            // Another child screen surely follows; the position is the parent's
            // to know, so no count rides.
            expect(c1.screen?.progress).toEqual({ nextScreen: 'certain' });
            const c2 = await engine.resume(c1.runId!, { variables: { c1_answer: 'b' } });
            expect(c2.screen?.nodeId).toBe('c2');
            // The child graph ends here, but the parent may go on: no answer.
            expect(c2.screen && 'progress' in c2.screen).toBe(false);
        });
    });
});

describe('readScreenProgress — graph shapes (#26657)', () => {
    const roleByType = (n: { type: string }): ScreenProgressRole =>
        n.type === 'screen' ? 'screen'
            : n.type === 'maybe' ? 'maybe-screen'
                : n.type === 'subflow' ? 'subflow'
                    : n.type === 'hold' ? 'pause' : 'plain';
    const node = (id: string, type = 'screen') => ({ id, type, label: id });
    const read = (nodes: unknown[], edges: unknown[], at: string) =>
        readScreenProgress({ nodes, edges } as any, at, roleByType as any);

    it('a parallel fan-out makes every count inexact, and "certain" still holds where every branch has a screen', () => {
        const nodes = [node('start', 'start'), node('s1'), node('fork', 'plain'), node('a'), node('b'), node('end', 'end')];
        const edges = [edge('start', 's1'), edge('s1', 'fork'), edge('fork', 'a'), edge('fork', 'b'), edge('a', 'end'), edge('b', 'end')];
        expect(read(nodes, edges, 's1')).toEqual({ nextScreen: 'certain' });
    });

    it('a fault path is a way the run may go', () => {
        const nodes = [node('start', 'start'), node('s1'), node('write', 'plain'), node('s2'), node('oops'), node('end', 'end')];
        const edges = [
            edge('start', 's1'), edge('s1', 'write'), edge('write', 's2'), edge('s2', 'end'),
            edge('write', 'oops', { type: 'fault' }), edge('oops', 'end'),
        ];
        // Both ways pause on exactly one more screen.
        expect(read(nodes, edges, 's1')).toEqual({ nextScreen: 'certain', step: 1, stepCount: 2 });
        // A fault path that ends with no screen makes the next one only possible.
        const bare = edges.filter((e) => e.target !== 'oops' && e.source !== 'oops').concat(edge('write', 'end', { type: 'fault' }));
        expect(read(nodes, bare, 's1')).toEqual({ nextScreen: 'possible', step: 1 });
    });

    it('a screen the caller may already have answered counts as maybe — never as a sure step', () => {
        const nodes = [node('start', 'start'), node('s1'), node('m', 'maybe'), node('end', 'end')];
        const edges = [edge('start', 's1'), edge('s1', 'm'), edge('m', 'end')];
        expect(read(nodes, edges, 's1')).toEqual({ nextScreen: 'possible', step: 1 });
    });

    it('an inclusive decision may take several branches at once: no counts', () => {
        const nodes = [
            node('start', 'start'), node('s1'),
            { id: 'd', type: 'decision', label: 'd', config: { mode: 'inclusive' } },
            node('a'), node('b'), node('end', 'end'),
        ];
        const edges = [
            edge('start', 's1'), edge('s1', 'd'),
            edge('d', 'a', { condition: 'x' }), edge('d', 'b', { condition: 'y' }),
            edge('a', 'end'), edge('b', 'end'),
        ];
        expect(read(nodes, edges, 's1')).toEqual({ nextScreen: 'possible' });
    });

    it('with no start node the position is unknowable, and a node the graph lacks gets no answer', () => {
        const nodes = [node('s1'), node('s2'), node('end', 'end')];
        expect(read(nodes, [edge('s1', 's2'), edge('s2', 'end')], 's1')).toEqual({ nextScreen: 'certain' });
        expect(read(nodes, [], 'missing')).toBeUndefined();
    });
});
