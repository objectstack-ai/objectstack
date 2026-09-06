// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15230 — the region index keys a step log entry carries, and what each one
 * means. The engine half of #14414; the contract half is `ExecutionStepLogSchema`
 * (`packages/spec/src/automation/execution.zod.ts`), already landed.
 *
 * Maintainer ruling, 2026-09-03 (recorded on #14414):
 *
 *   `iteration` is single-valued: the zero-based iteration of the enclosing
 *   loop, carried through any nesting … The branch index lives on a new
 *   optional `branch` key, present only on steps inside a `parallel` branch.
 *   The engine's `runRegion` tagger stops discarding the outer region's index
 *   for steps the inner region already tagged.
 *
 * The three cases the ruling names are pinned here, plus the two guards that
 * keep them honest:
 *
 *   1. `loop { parallel }` — a branch step carries BOTH the loop's `iteration`
 *      and its own `branch`. This is the shape that was unreadable before: the
 *      branch index won outright and no step of that branch recorded the row,
 *      so a per-row failure inside a branch was attributable to a branch and
 *      never to the row.
 *   2. `loop { try_catch }` — UNCHANGED. A try/catch region has no index of its
 *      own, so its steps carry the enclosing loop's `iteration` and no
 *      `branch`, with `regionKind` still naming the region. Control arm: this
 *      must read the same before and after the tagger change.
 *   3. `parallel` NOT inside a loop — `branch` is written and `iteration` is
 *      ABSENT. `iteration` no longer doubles as the branch index, so there is
 *      nothing for it to say here.
 *
 * Guards:
 *   - every record the engine produced parses under the spec schema at THIS
 *     head, and `branch` refuses negative / fractional values at the `branch`
 *     path (⛔ not a positives-only gate);
 *   - a TYPE-LEVEL pin holding the engine's local `StepLogEntry` region keys
 *     equal to the spec type's. The engine interface is NOT derived from the
 *     spec — the card asks for the two to be kept in step "by a pin, not by
 *     prose", and this is that pin. ⚠️ It is compiled by
 *     `pnpm --filter @objectstack/service-automation typecheck` (both
 *     `tsconfig.json` and `tsconfig.test.json` reach `src/**\/*.test.ts`) and
 *     is INVISIBLE to `vitest`, which strips types — a green `pnpm test` says
 *     nothing about it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionStepLogSchema } from '@objectstack/spec/automation';
import type { ExecutionStepLog } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor, StepLogEntry } from '../engine.js';
import { registerLoopNode } from './loop-node.js';
import { registerParallelNode } from './parallel-node.js';
import { registerTryCatchNode } from './try-catch-node.js';

// ── Type-level pin: engine `StepLogEntry` ↔ spec `ExecutionStepLog` ─────────
//
// Region-grouping keys only. The engine's interface legitimately carries
// engine-local fields the contract does not (`nodeLabel`, `warnings`), and the
// contract carries fields the engine never writes (`input`, `output`), so
// pinning the WHOLE shape would pin noise. What must not drift is the set of
// keys this card is about and the type of each.
type RegionKeys = 'parentNodeId' | 'iteration' | 'branch' | 'regionKind' | 'retryAttempt';

// Both `Pick`s fail to compile if either side is missing a key — that is half
// the pin. `Eq` is the invariant (not merely assignable) comparison, so a
// widening on one side is caught too.
type Eq<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type _RegionKeysInStep = Assert<
    Eq<Pick<StepLogEntry, RegionKeys>, Pick<ExecutionStepLog, RegionKeys>>
>;

function silentLogger(): any {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function ctx(): any {
    return { logger: silentLogger(), getService() { throw new Error('none'); } };
}

/** Assert every step the run produced is a legal `ExecutionStepLog` at this head. */
function expectParsesUnderSpec(steps: StepLogEntry[]): void {
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
        const parsed = ExecutionStepLogSchema.safeParse(step);
        if (!parsed.success) {
            throw new Error(
                `step ${step.nodeId} does not parse under ExecutionStepLogSchema: `
                + JSON.stringify(parsed.error.issues),
            );
        }
    }
}

describe('#15230 — `iteration` is the loop\'s, `branch` is the parallel branch\'s', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        registerLoopNode(engine, ctx());
        registerParallelNode(engine, ctx());
        registerTryCatchNode(engine, ctx());
        engine.registerNodeExecutor({
            type: 'touch',
            async execute() { return { success: true }; },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'boom',
            async execute(node) { throw new Error(`boom from ${node.id}`); },
        } as NodeExecutor);
    });

    // ── Ruling pin 1: `loop { parallel }` ──────────────────────────────────
    it('loop { parallel }: a branch step carries the loop\'s `iteration` AND its own `branch`', async () => {
        engine.registerFlow('lp', {
            name: 'lp', label: 'Loop over parallel', type: 'autolaunched',
            variables: [{ name: 'rows', type: 'list', isInput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'each', type: 'loop', label: 'For each row',
                    config: {
                        collection: '{rows}', iteratorVariable: 'row', indexVariable: 'idx',
                        body: {
                            nodes: [{
                                id: 'fan', type: 'parallel', label: 'Fan out',
                                config: {
                                    branches: [
                                        { name: 'A', nodes: [{ id: 'leafA', type: 'touch', label: 'A' }], edges: [] },
                                        { name: 'B', nodes: [{ id: 'leafB', type: 'touch', label: 'B' }], edges: [] },
                                    ],
                                },
                            }],
                            edges: [],
                        },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'each' },
                { id: 'e2', source: 'each', target: 'end' },
            ],
        } as never);

        const result = await engine.execute('lp', { params: { rows: ['r0', 'r1', 'r2'] } });
        expect(result.success).toBe(true);
        const steps = (await engine.listRuns('lp'))[0].steps as StepLogEntry[];

        const branchSteps = steps.filter(s => s.regionKind === 'parallel-branch');
        // 3 rows x 2 branches.
        expect(branchSteps).toHaveLength(6);

        // Each branch step names BOTH indices: which row, and which branch.
        expect(
            branchSteps.map(s => `${s.nodeId}@iteration=${s.iteration}/branch=${s.branch}`).sort(),
        ).toEqual([
            'leafA@iteration=0/branch=0',
            'leafA@iteration=1/branch=0',
            'leafA@iteration=2/branch=0',
            'leafB@iteration=0/branch=1',
            'leafB@iteration=1/branch=1',
            'leafB@iteration=2/branch=1',
        ]);

        // The innermost container still wins the IDENTITY fields — carrying the
        // outer index through must not relabel which region ran the step.
        for (const s of branchSteps) expect(s.parentNodeId).toBe('fan');

        // The parallel container step itself is a loop-body step: it has the
        // row, and no branch of its own.
        const fanSteps = steps.filter(s => s.nodeId === 'fan');
        expect(fanSteps).toHaveLength(3);
        for (const s of fanSteps) {
            expect(s.regionKind).toBe('loop-body');
            expect(s.parentNodeId).toBe('each');
            expect(s.branch).toBeUndefined();
        }
        expect(fanSteps.map(s => s.iteration)).toEqual([0, 1, 2]);

        expectParsesUnderSpec(steps);
    });

    // ── Ruling pin 2: `loop { try_catch }` — the CONTROL ARM, unchanged ─────
    it('loop { try_catch }: try/catch steps keep the loop\'s `iteration` and gain no `branch`', async () => {
        engine.registerFlow('ltc', {
            name: 'ltc', label: 'Loop over try_catch', type: 'autolaunched',
            variables: [{ name: 'rows', type: 'list', isInput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'each', type: 'loop', label: 'For each row',
                    config: {
                        collection: '{rows}', iteratorVariable: 'row',
                        body: {
                            nodes: [{
                                id: 'guard', type: 'try_catch', label: 'Guard',
                                config: {
                                    try: { nodes: [{ id: 'risky', type: 'boom', label: 'Risky' }], edges: [] },
                                    catch: { nodes: [{ id: 'recover', type: 'touch', label: 'Recover' }], edges: [] },
                                },
                            }],
                            edges: [],
                        },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'each' },
                { id: 'e2', source: 'each', target: 'end' },
            ],
        } as never);

        const result = await engine.execute('ltc', { params: { rows: ['r0', 'r1'] } });
        expect(result.success).toBe(true);
        const steps = (await engine.listRuns('ltc'))[0].steps as StepLogEntry[];

        const trySteps = steps.filter(s => s.regionKind === 'try');
        const catchSteps = steps.filter(s => s.regionKind === 'catch');
        expect(trySteps).toHaveLength(2);
        expect(catchSteps).toHaveLength(2);

        // A try/catch region has no index of its own: the row comes through
        // `iteration`, `regionKind` still names the region, `branch` is absent.
        for (const s of [...trySteps, ...catchSteps]) {
            expect(s.parentNodeId).toBe('guard');
            expect(s.branch).toBeUndefined();
        }
        expect(trySteps.map(s => s.iteration)).toEqual([0, 1]);
        expect(catchSteps.map(s => s.iteration)).toEqual([0, 1]);

        expectParsesUnderSpec(steps);
    });

    // ── Ruling pin 3: `parallel` NOT inside a loop ─────────────────────────
    it('bare parallel: a branch step writes `branch` and NO `iteration`', async () => {
        engine.registerFlow('bare', {
            name: 'bare', label: 'Bare parallel', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'fan', type: 'parallel', label: 'Fan out',
                    config: {
                        branches: [
                            { name: 'A', nodes: [{ id: 'leafA', type: 'touch', label: 'A' }], edges: [] },
                            { name: 'B', nodes: [{ id: 'leafB', type: 'touch', label: 'B' }], edges: [] },
                        ],
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'fan' },
                { id: 'e2', source: 'fan', target: 'end' },
            ],
        } as never);

        const result = await engine.execute('bare');
        expect(result.success).toBe(true);
        const steps = (await engine.listRuns('bare'))[0].steps as StepLogEntry[];

        const leafA = steps.find(s => s.nodeId === 'leafA');
        const leafB = steps.find(s => s.nodeId === 'leafB');
        expect(leafA?.regionKind).toBe('parallel-branch');
        expect(leafB?.regionKind).toBe('parallel-branch');
        expect(leafA?.branch).toBe(0);
        expect(leafB?.branch).toBe(1);
        // No enclosing loop ⇒ nothing for `iteration` to say. Before #15230 it
        // carried the branch index; that overload is what the ruling removed.
        expect(leafA?.iteration).toBeUndefined();
        expect(leafB?.iteration).toBeUndefined();

        expectParsesUnderSpec(steps);
    });

    // ── Guard: the contract refuses illegal `branch` values ─────────────────
    it('the spec refuses a negative or fractional `branch`, at the `branch` path', () => {
        const base = {
            nodeId: 'leafA', nodeType: 'touch', status: 'success' as const,
            startedAt: '2026-09-06T00:00:00.000Z',
            parentNodeId: 'fan', regionKind: 'parallel-branch',
        };

        expect(ExecutionStepLogSchema.safeParse({ ...base, branch: 0 }).success).toBe(true);
        expect(ExecutionStepLogSchema.safeParse({ ...base, branch: 7 }).success).toBe(true);

        for (const bad of [-1, 1.5]) {
            const parsed = ExecutionStepLogSchema.safeParse({ ...base, branch: bad });
            expect(parsed.success).toBe(false);
            // The refusal must land ON `branch` — a schema that rejected the
            // whole record for some other reason would read the same at the
            // `success` boolean.
            expect(parsed.success === false && parsed.error.issues.some(i => i.path[0] === 'branch')).toBe(true);
        }
    });
});
