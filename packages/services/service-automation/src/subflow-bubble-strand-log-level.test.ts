// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15556 — `bubbleToParent`'s #4632 verdict, graded per outcome.
 *
 * ## What was measured
 *
 * A parent flow parked at a `subflow` node whose child hosts an approval. The
 * child's resume completes, `bubbleToParent` resumes the parent, and the
 * parent's own continuation throws downstream. `resumeInternal` answers that
 * exit with `{ success: false, status: 'stranded' }` and **no `code`** — the
 * #13937 discriminator, stamped on the one exit that journals a repair
 * snapshot. `bubbleToParent` received it and logged it at `warn`.
 *
 * The old verdict's enumeration was "the parent either failed terminally
 * (recorded in run history) or stays visibly parked and resumable". A stranded
 * parent is neither: nothing in the engine moves it again and only
 * `restoreConsumedSuspension` can re-arm it, while the approval row is durably
 * terminal and the child's resumer was told the resume succeeded. That is
 * AGENTS.md's DURABILITY class — persisted state and runtime state disagree,
 * nothing looks broken from the outside — and the rule's third legal answer
 * (a failure handed to the CALLER) does not apply, because measurably no
 * caller is told.
 *
 * ## What these pins hold
 *
 * The grading, in BOTH directions, in one run:
 *
 *  - a stranded parent → `error`, naming the run and the repair verb;
 *  - a parent failure the engine does NOT call stranded → `warn`, unchanged —
 *    `RESUME_IN_PROGRESS` / `STORE_UNAVAILABLE` are the functional cases the
 *    old verdict was right about, and escalating them is how `error` becomes
 *    unreadable;
 *  - a THROWN parent resume → `warn`, unchanged.
 *
 * The last two are the reverse controls: without them a pin that only watched
 * the stranded case would stay green if the whole arm were escalated. The
 * sibling pins for the same two seams live in `engine-residual-log-cause.test.ts`
 * (sites 12 and 13), which is where the #6499 message-shape half is held.
 *
 * ⚠️ This is the LOG half only. What the child's resumer is TOLD is unchanged
 * and still reads as full success; see `#15556` for that open decision.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';

/** Every argument of every call, so the `error(message, error?, meta?)` slot layout is itself under test (#5575). */
type Line = { level: string; args: unknown[] };
function recordingLogger() {
    const lines: Line[] = [];
    const mk = (level: string) => (...args: unknown[]) => { lines.push({ level, args }); };
    const self: any = {
        lines,
        info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('debug'),
        child() { return self; },
    };
    return self as { lines: Line[] } & Record<string, any>;
}

const CHILD = {
    name: 'child_flow',
    label: 'Child',
    type: 'autolaunched',
    nodes: [
        { id: 'cstart', type: 'start', label: 'Start' },
        { id: 'park', type: 'pauser', label: 'Park' },
        { id: 'cend', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'c1', source: 'cstart', target: 'park' },
        { id: 'c2', source: 'park', target: 'cend' },
    ],
};

const PARENT = {
    name: 'parent_flow',
    label: 'Parent',
    type: 'autolaunched',
    nodes: [
        { id: 'pstart', type: 'start', label: 'Start' },
        { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: 'child_flow' } },
        { id: 'after', type: 'mark', label: 'After' },
        { id: 'pend', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'p1', source: 'pstart', target: 'sub' },
        { id: 'p2', source: 'sub', target: 'after' },
        { id: 'p3', source: 'after', target: 'pend' },
    ],
};

const DOWNSTREAM_FAILURE = 'update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found';

describe('#15556 — bubbleToParent grades its #4632 verdict by the engine\'s own discriminator', () => {
    let logger: ReturnType<typeof recordingLogger>;
    let engine: AutomationEngine;
    let afterThrows: string | undefined;

    const bubbleLines = () => logger.lines.filter(
        l => typeof l.args[0] === 'string' && (l.args[0] as string).includes("subflow run"),
    );

    beforeEach(() => {
        afterThrows = undefined;
        logger = recordingLogger();
        engine = new AutomationEngine(logger as never, new InMemorySuspendedRunStore());
        registerSubflowNode(engine, { logger, getService() { throw new Error('none'); } } as never);
        engine.registerNodeExecutor({
            type: 'pauser',
            descriptor: defineActionDescriptor({
                type: 'pauser', version: '1.0.0', name: 'pauser',
                supportsPause: true, resumeAuthority: 'any',
            }),
            async execute() { return { success: true, suspend: true }; },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'mark',
            async execute() {
                if (afterThrows) throw new Error(afterThrows);
                return { success: true };
            },
        } as NodeExecutor);
        engine.registerFlow('child_flow', CHILD as never);
        engine.registerFlow('parent_flow', PARENT as never);
    });

    /** Park the parent at its `subflow` node and hand back both run ids. */
    async function park() {
        const started = await engine.execute('parent_flow', {} as AutomationContext);
        expect(started.status).toBe('paused');
        const parentRunId = started.runId!;
        const parked = engine.listSuspendedRuns();
        const parent = parked.find(r => r.runId === parentRunId);
        const child = parked.find(r => r.flowName === 'child_flow');
        expect(parent?.correlation, 'the parent parks correlated to its child')
            .toBe(`subflow:${child?.runId}`);
        return { parentRunId, childRunId: child!.runId };
    }

    it('a STRANDED parent is reported at `error`, naming the run and its repair verb', async () => {
        afterThrows = DOWNSTREAM_FAILURE;
        const { parentRunId, childRunId } = await park();

        const childRes = await engine.resume(childRunId);

        // The condition being graded, established rather than assumed: the
        // child genuinely completed and the parent is genuinely unreachable.
        expect(childRes.success, "the child's own completion is genuine").toBe(true);
        expect(await engine.hasSuspendedRun(parentRunId)).toBe(false);
        expect((await engine.resume(parentRunId)).code).toBe('RUN_NOT_FOUND');
        expect((await engine.getRun(parentRunId))?.status).toBe('failed');
        // …and it IS repairable, which is what makes the repair verb in the
        // message a promise the platform keeps.
        expect((await engine.restoreConsumedSuspension(parentRunId)).restored).toBe(true);

        const lines = bubbleLines();
        expect(lines.length, 'exactly one record for this bubble').toBe(1);
        expect(lines[0].level, 'durability, not functional').toBe('error');
        const [message, errorSlot, meta] = lines[0].args as [string, unknown, Record<string, unknown>];
        expect(message).toContain('STRANDED');
        expect(message).toContain(`'${parentRunId}'`);
        expect(message, 'the FIX the durability rule owes').toContain(
            `restoreConsumedSuspension('${parentRunId}')`,
        );
        expect(message, 'the CONSEQUENCE the durability rule owes')
            .toContain('was told the resume SUCCEEDED');
        expect(message, "#6499 — the failing node's text never reaches the message").not.toContain(DOWNSTREAM_FAILURE);
        expect(message, 'one physical line').not.toContain('\n');
        // #5575 — the `Error` slot stays empty and the diagnostics ride the
        // THIRD argument; a meta passed second would still render, so pinning
        // the position is the only thing that keeps the contract shape.
        expect(errorSlot).toBeUndefined();
        expect(meta).toMatchObject({ error: DOWNSTREAM_FAILURE, parentRunId, status: 'stranded' });
    });

    it('REVERSE CONTROL — a healthy parent continuation logs nothing at all', async () => {
        const { parentRunId, childRunId } = await park();

        expect((await engine.resume(childRunId)).success).toBe(true);

        expect(bubbleLines(), 'nothing failed — nothing to report').toEqual([]);
        expect((await engine.getRun(parentRunId))?.status).toBe('completed');
    });

    it('REVERSE CONTROL — a parent failure the engine does NOT call stranded stays `warn`', async () => {
        // The `engine-residual-log-cause.test.ts` site-12 shape: a reported
        // failure with an envelope and NO `status`. The parent's suspension was
        // never consumed on such an exit, so it stays parked and resumable —
        // functional, and escalating it is exactly the over-application
        // AGENTS.md warns trains everyone to skim `error`.
        const { parentRunId, childRunId } = await park();
        const eng = engine as unknown as { resumeInternal: (runId: string, ...rest: unknown[]) => Promise<unknown> };
        const real = eng.resumeInternal.bind(engine);
        eng.resumeInternal = async (runId: string, ...rest: unknown[]) =>
            runId === parentRunId
                ? { success: false, code: 'RESUME_IN_PROGRESS', error: 'another replica is resuming it' }
                : real(runId, ...rest);

        expect((await engine.resume(childRunId)).success).toBe(true);

        const lines = bubbleLines();
        expect(lines.length).toBe(1);
        expect(lines[0].level, 'functional — unchanged').toBe('warn');
        expect(lines[0].args[0]).toContain('failed — the parent');
    });

    it('REVERSE CONTROL — a THROWN parent resume stays `warn`', async () => {
        // Site 13's shape. A throw never carries the discriminator, so this arm
        // has no measured stranding behind it and its verdict is untouched.
        const { parentRunId, childRunId } = await park();
        const eng = engine as unknown as { resumeInternal: (runId: string, ...rest: unknown[]) => Promise<unknown> };
        const real = eng.resumeInternal.bind(engine);
        eng.resumeInternal = async (runId: string, ...rest: unknown[]) => {
            if (runId === parentRunId) throw new Error('the parent resume blew up');
            return real(runId, ...rest);
        };

        expect((await engine.resume(childRunId)).success).toBe(true);

        const lines = bubbleLines();
        expect(lines.length).toBe(1);
        expect(lines[0].level, 'functional — unchanged').toBe('warn');
        expect(lines[0].args[0]).toContain('threw — the thrown failure');
    });
});
