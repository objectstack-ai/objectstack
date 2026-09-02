// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A subflow parent's resume must answer a delegated child's RETRYABLE REFUSAL
 * as a refusal — not as a terminal child failure (#14379).
 *
 * The screen-flow path gives the caller ONE stable run id: the parent's. Every
 * wizard step is posted to it, and `resumeInternal`'s subflow delegation block
 * forwards the bag down to the child the parent is parked on. When the child
 * REFUSES that bag — `INVALID_SCREEN_INPUT` for a missing `required` field,
 * `INVALID_SIGNAL` for a reserved variable name — nothing ran and the child's
 * pause is deliberately still live (#4477: "a rejected bag leaves the pause
 * live and the legitimate submission still lands").
 *
 * The delegation block used to read every `!childRes.success` as a child that
 * RAN and DIED: it called `failSuspendedRun` on the parent and answered a
 * CODE-LESS `{ success: false, error }`. One mistyped form field therefore
 * destroyed the run — the parent's suspension consumed and a failure recorded,
 * the still-paused child orphaned with nothing to bubble into, the caller told
 * `400 FLOW_FAILED` ("it ran and was rejected") for something that never ran,
 * and their corrected retry on the same run id answered `RUN_NOT_FOUND`.
 *
 * The discriminator is PRODUCER-FIRST (triage ruling, 2026-09-02): the child's
 * own `code` being one of the refusal codes the engine itself answers — ⛔ not
 * "is the child's suspension still live", which is a second store read whose
 * answer can race and which infers intent from state. `failSuspendedRun` is
 * reserved for a child that genuinely ran and failed, which the last test here
 * is the negative control for.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { installBuiltinNodes } from './index.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
    return { logger: silentLogger(), getService() { return undefined; } } as any;
}

/**
 * `resumeAuthority: 'any'` on the fixture pausers: the resume gate (#5561)
 * follows the linked-run chain to the CHILD's node, so the type the child
 * parks on is what a resume of the parent is judged against. These tests are
 * about delegation mechanics, not the gate (`resume-authority-gate.test.ts`
 * owns that), so the fixtures state the posture they rely on.
 */
const openPauser = (type: string) => defineActionDescriptor({
    type, version: '1.0.0', name: type,
    supportsPause: true, resumeAuthority: 'any',
});

/** The child's screen declares exactly one unconditional required field. */
const REQUIRED_KIND = [{ name: 'kind', label: 'Kind', type: 'text', required: true }];

/** A child flow that parks on a real `screen` node and exports what it collected. */
const screenChild = (name: string, tail: Array<Record<string, unknown>> = []) => ({
    name,
    label: name,
    type: 'screen',
    status: 'active',
    version: 1,
    variables: [{ name: 'kind', type: 'text', isOutput: true }],
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'ask', type: 'screen', label: 'Ask', config: { fields: REQUIRED_KIND } },
        ...tail,
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'ask', type: 'default' },
        ...tail.map((n, i) => ({
            id: `t${i}`,
            source: i === 0 ? 'ask' : (tail[i - 1] as { id: string }).id,
            target: (n as { id: string }).id,
            type: 'default',
        })),
        {
            id: 'e2',
            source: tail.length ? (tail[tail.length - 1] as { id: string }).id : 'ask',
            target: 'end',
            type: 'default',
        },
    ],
});

/** A child flow that parks on a pause declaring NO screen contract. */
const openChild = (name: string) => ({
    name,
    label: name,
    type: 'autolaunched',
    status: 'active',
    version: 1,
    variables: [{ name: 'kind', type: 'text', isOutput: true }],
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'openpauser', label: 'Hold' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'hold', type: 'default' },
        { id: 'e2', source: 'hold', target: 'end', type: 'default' },
    ],
});

/** The parent: start → subflow(child) → recorder → end. */
const parentFlow = (childName: string) => ({
    name: 'parent_flow',
    label: 'Parent Flow',
    type: 'autolaunched',
    status: 'active',
    version: 1,
    nodes: [
        { id: 'ps', type: 'start', label: 'Start' },
        { id: 'call', type: 'subflow', label: 'Call Child', config: { flowName: childName, outputVariable: 'childOut' } },
        { id: 'rec', type: 'recorder', label: 'Record' },
        { id: 'pe', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'p1', source: 'ps', target: 'call', type: 'default' },
        { id: 'p2', source: 'call', target: 'rec', type: 'default' },
        { id: 'p3', source: 'rec', target: 'pe', type: 'default' },
    ],
});

describe('subflow delegation: a child REFUSAL is answered as a refusal (#14379)', () => {
    let engine: AutomationEngine;
    let captured: unknown[];

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        captured = [];
        // Downstream of the parent's subflow node: proves the parent really
        // continued and what the child's output mapped to.
        engine.registerNodeExecutor({
            type: 'recorder',
            async execute(_node, variables) {
                captured.push(variables.get('childOut'));
                return { success: true };
            },
        } as NodeExecutor);
        // A pause that declares no screen contract (for the INVALID_SIGNAL arm).
        engine.registerNodeExecutor({
            type: 'openpauser',
            descriptor: openPauser('openpauser'),
            async execute() { return { success: true, suspend: true }; },
        } as NodeExecutor);
        // Terminal child failure, downstream of the child's screen.
        engine.registerNodeExecutor({
            type: 'boomer',
            async execute() { throw new Error('boom in the child'); },
        } as NodeExecutor);
    });

    /** Start the parent and return `[parentRunId, childRunId]`. */
    async function startPair(): Promise<[string, string]> {
        const started = await engine.execute('parent_flow', {} as any);
        expect(started.status).toBe('paused');
        const parentRunId = started.runId!;
        const child = engine.listSuspendedRuns().find((r) => r.runId !== parentRunId)!;
        expect(child).toBeDefined();
        return [parentRunId, child.runId];
    }

    describe('INVALID_SCREEN_INPUT — the child screen refuses the bag', () => {
        beforeEach(() => {
            engine.registerFlow('child_flow', screenChild('child_flow') as any);
            engine.registerFlow('parent_flow', parentFlow('child_flow') as any);
        });

        it('answers the child refusal with its code and leaves BOTH pauses intact', async () => {
            const [parentRunId, childRunId] = await startPair();

            const res = await engine.resume(parentRunId, { variables: {} });

            // ADR-0112 envelope: the code the child produced, propagated intact.
            // A code-less envelope is what made the transport answer
            // `400 FLOW_FAILED` for something that never ran.
            expect(res.success).toBe(false);
            expect(res.code).toBe('INVALID_SCREEN_INPUT');
            // The child's own actionable text, not "subflow run '…' failed:".
            expect(res.error).toMatch(/^Invalid screen input: /);
            expect(res.error).toContain('"kind"');
            expect(res.error).toMatch(/required/i);
            // Nothing was consumed on either level.
            expect(await engine.hasSuspendedRun(parentRunId)).toBe(true);
            expect(await engine.hasSuspendedRun(childRunId)).toBe(true);
            // The parent still surfaces the child's screen, unchanged.
            expect((await engine.getSuspendedScreen(parentRunId))?.nodeId).toBe('ask');
            expect(captured).toEqual([]); // the parent did NOT continue
        });

        it('completes the corrected retry on the SAME parent run id', async () => {
            const [parentRunId, childRunId] = await startPair();
            expect((await engine.resume(parentRunId, { variables: {} })).code).toBe('INVALID_SCREEN_INPUT');

            const good = await engine.resume(parentRunId, { variables: { kind: 'normal' } });

            expect(good.success).toBe(true);
            expect(good.code).toBeUndefined();
            expect(good.status).toBeUndefined(); // ran to completion
            expect(captured).toEqual([{ kind: 'normal' }]); // child output mapped into the parent
            expect(await engine.hasSuspendedRun(parentRunId)).toBe(false);
            expect(await engine.hasSuspendedRun(childRunId)).toBe(false);
        });

        it('refuses the signal-less gesture the same way, both pauses intact', async () => {
            // #13648 normalises an absent signal to `{}` at the public door, so
            // `resume(parentRunId)` lands on this same delegation path.
            const [parentRunId, childRunId] = await startPair();

            const bare = await engine.resume(parentRunId);

            expect(bare.success).toBe(false);
            expect(bare.code).toBe('INVALID_SCREEN_INPUT');
            expect(await engine.hasSuspendedRun(parentRunId)).toBe(true);
            expect(await engine.hasSuspendedRun(childRunId)).toBe(true);
            // And the corrected retry still lands.
            const good = await engine.resume(parentRunId, { variables: { kind: 'late' } });
            expect(good.success).toBe(true);
            expect(captured).toEqual([{ kind: 'late' }]);
        });
    });

    describe('INVALID_SIGNAL — a second refusal code on the same path', () => {
        beforeEach(() => {
            engine.registerFlow('child_flow', openChild('child_flow') as any);
            engine.registerFlow('parent_flow', parentFlow('child_flow') as any);
        });

        it('answers the child refusal with its code and leaves BOTH pauses intact', async () => {
            const [parentRunId, childRunId] = await startPair();

            const res = await engine.resume(parentRunId, { variables: { $sneaky: 1 } });

            expect(res.success).toBe(false);
            expect(res.code).toBe('INVALID_SIGNAL');
            expect(res.error).toMatch(/engine-internal variables/);
            expect(await engine.hasSuspendedRun(parentRunId)).toBe(true);
            expect(await engine.hasSuspendedRun(childRunId)).toBe(true);
            expect(captured).toEqual([]);

            // The legitimate submission still lands on the same parent run id.
            const good = await engine.resume(parentRunId, { variables: { kind: 'ok' } });
            expect(good.success).toBe(true);
            expect(captured).toEqual([{ kind: 'ok' }]);
        });
    });

    describe('negative control — a child that genuinely RAN and FAILED', () => {
        beforeEach(() => {
            engine.registerFlow('child_flow', screenChild('child_flow', [{ id: 'boom', type: 'boomer', label: 'Boom' }]) as any);
            engine.registerFlow('parent_flow', parentFlow('child_flow') as any);
        });

        it('still fails the parent terminally, with the envelope shape unchanged', async () => {
            const [parentRunId, childRunId] = await startPair();

            // The screen ACCEPTS this bag; the node after it throws.
            const res = await engine.resume(parentRunId, { variables: { kind: 'normal' } });

            expect(res.success).toBe(false);
            expect(res.code).toBeUndefined(); // a terminal child failure carries none — unchanged
            expect(res.error).toMatch(/^subflow run '.*' \(child_flow\) failed: /);
            expect(res.error).toContain('boom in the child');
            // Both suspensions are consumed: the parent was failed, the child ran.
            expect(await engine.hasSuspendedRun(parentRunId)).toBe(false);
            expect(await engine.hasSuspendedRun(childRunId)).toBe(false);
            expect(captured).toEqual([]);
        });
    });
});
