// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7639 — a SUSPENDED run's variable snapshot must be readable on run-detail.
 *
 * `GET /api/v1/automation/:name/runs/:runId` serves an `ExecutionLogEntry`
 * verbatim (`packages/runtime/src/domains/automation.ts` → `deps.success(run)`),
 * and `ExecutionLogSchema` has declared a `variables` key — "Final state of flow
 * variables" — since the schema was written. Nothing in the repo ever wrote it.
 * The two `status: 'paused'` `recordLog` call sites in `engine.ts` passed
 * `id`/`flowName`/`flowVersion`/`startedAt`/`durationMs`/`trigger`/`steps` and
 * stopped there, so a run stopped at an approval or a screen — the state an
 * operator most often needs to inspect — answered with no variable state at all.
 *
 * The information was never lost: a few lines above each of those sites the
 * suspend bookkeeping already computed `Object.fromEntries(variables)` for the
 * continuation. It simply never reached the surface a caller can read.
 *
 * What is pinned here:
 *
 *  1. BOTH paused sites — the initial-execution suspend and the resume-path
 *     re-suspend. A multi-stage approval re-pauses at the second site on every
 *     stage after the first, so covering one site is half a fix.
 *  2. The snapshot is the RUN's, not a fixture's: node outputs written under
 *     `<nodeId>.<key>`, the triggering record, and declared flow variables all
 *     read back.
 *  3. SHAPING PARITY (the redaction question). The run-detail read applies
 *     **no** field-level shaping to anything today — `output` and `steps` go out
 *     byte-for-byte as the engine recorded them, and there is no redaction,
 *     masking or projection anywhere on that path to mirror. So `variables`
 *     must receive exactly that same nil treatment: the test drives one and the
 *     same nested value through `output` (terminal run) and `variables` (paused
 *     run) and asserts the two are deep-equal. This does NOT invent a redaction
 *     policy — it pins that no new one was invented, and it FAILS if a future
 *     change starts shaping one field without the other.
 *  4. Snapshot semantics: point-in-time at the suspend, and the same object the
 *     continuation carries — so the state read is the state the run resumes from.
 *
 * The wire half (the handler passing `variables` through untouched, beside
 * `output`) is pinned one package over, in
 * `packages/runtime/src/domains/automation-run-detail-passthrough.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

/**
 * `resumeAuthority: 'any'` is required of a pausing fixture since #5561 — these
 * tests continue their pause through the public `resume` door. Nothing here is
 * about the resume gate (`resume-authority-gate.test.ts` owns that); the fixture
 * states the posture it relies on, as the pausing built-ins do.
 */
const pauser = (type: string) => defineActionDescriptor({
    type, version: '1.0.0', name: type,
    supportsPause: true, resumeAuthority: 'any',
});

/** start → stage1 (pauses) → stage2 (pauses again) → end. */
function twoStageFlow(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        variables: [
            // `isInput` is what makes `context.params` seed a declared variable
            // (`seedDeclaredVariables`); without it the trigger's value is
            // dropped and the fixture would assert nothing.
            { name: 'ticket', type: 'text', isInput: true, isOutput: true },
            { name: 'internal_note', type: 'text', isInput: true },
        ],
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'stage1', type: 'stage1_pause', label: 'Stage 1' },
            { id: 'stage2', type: 'stage2_pause', label: 'Stage 2' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'stage1' },
            { id: 'e2', source: 'stage1', target: 'stage2' },
            { id: 'e3', source: 'stage2', target: 'end' },
        ],
    };
}

/**
 * A node that resolves a non-trivial value on entry and THEN suspends. The
 * engine writes `result.output` into variables under `<nodeId>.<key>` before it
 * honours `suspend`, so this is exactly the "what did the previous node
 * actually produce?" the card is about.
 */
function registerStage(engine: AutomationEngine, type: string, output: Record<string, unknown>) {
    engine.registerNodeExecutor({
        type,
        descriptor: pauser(type),
        async execute() {
            return { success: true, suspend: true, correlation: `${type}:req`, output };
        },
    } as never);
}

const STAGE1_OUTPUT = {
    // Deliberately non-scalar and nested: the shaping-parity assertion below is
    // worthless against a bare string, which survives any projection.
    pending_approvers: ['user_ops', 'user_finance'],
    decision: { route: 'dual', reason: 'amount over threshold', weights: { ops: 1, finance: 2 } },
};

describe('#7639 — a paused run carries its variable snapshot on run-detail', () => {
    it('writes the snapshot at the INITIAL-EXECUTION suspend site', async () => {
        const engine = new AutomationEngine(silent, new InMemorySuspendedRunStore());
        registerStage(engine, 'stage1_pause', STAGE1_OUTPUT);
        registerStage(engine, 'stage2_pause', { stage: 2 });
        engine.registerFlow('approval_flow', twoStageFlow('approval_flow') as never);

        const res = await engine.execute('approval_flow', {
            event: 'test',
            object: 'crm_order',
            record: { id: 'ord_1', amount: 90_000, owner: 'user_ops' },
            params: { ticket: 'TKT-1', internal_note: 'do not page on-call' },
        } as unknown as AutomationContext);
        expect(res.status).toBe('paused');

        const run = await engine.getRun(res.runId as string);
        expect(run?.status).toBe('paused');

        // The defect: this key was absent entirely, not empty.
        expect(run?.variables).toBeDefined();
        const vars = run!.variables!;

        // The pausing node's own resolved output — the value the QA oracle
        // wanted to read and could not (`approvals.dynamic-approver-routing`).
        expect(vars['stage1.pending_approvers']).toEqual(['user_ops', 'user_finance']);
        expect(vars['stage1.decision']).toEqual(STAGE1_OUTPUT.decision);

        // The triggering record and the declared flow variables the run holds.
        expect(vars.record).toEqual({ id: 'ord_1', amount: 90_000, owner: 'user_ops' });
        expect(vars.ticket).toBe('TKT-1');
        expect(vars.internal_note).toBe('do not page on-call');

        // Run identity, so the snapshot is self-describing.
        expect(vars.$runId).toBe(res.runId);
        expect(vars.$flowName).toBe('approval_flow');
    });

    it('writes the snapshot at the RESUME-PATH re-suspend site too', async () => {
        const engine = new AutomationEngine(silent, new InMemorySuspendedRunStore());
        registerStage(engine, 'stage1_pause', STAGE1_OUTPUT);
        registerStage(engine, 'stage2_pause', { approver_pool: ['user_cfo'] });
        engine.registerFlow('approval_flow', twoStageFlow('approval_flow') as never);

        const first = await engine.execute('approval_flow', {
            event: 'test',
            record: { id: 'ord_2', amount: 10 },
        } as unknown as AutomationContext);
        expect(first.status).toBe('paused');

        // Stage 1 decided; the run continues and re-pauses at stage 2. This is
        // the SECOND `status: 'paused'` recordLog site — reached only here.
        const second = await engine.resume(first.runId as string, {
            output: { verdict: 'approved' },
        } as never);
        expect(second.status).toBe('paused');
        expect(second.runId).toBe(first.runId);

        const run = await engine.getRun(first.runId as string);
        expect(run?.status).toBe('paused');
        expect(run?.variables).toBeDefined();
        const vars = run!.variables!;

        // Everything stage 1 produced survives the resume…
        expect(vars['stage1.pending_approvers']).toEqual(['user_ops', 'user_finance']);
        // …the resume signal's own write is there…
        expect(vars['stage1.verdict']).toBe('approved');
        // …and so is what stage 2 resolved before it paused in turn.
        expect(vars['stage2.approver_pool']).toEqual(['user_cfo']);
    });

    it('is the SAME object the continuation resumes from (snapshot, not a re-read)', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = new AutomationEngine(silent, store);
        registerStage(engine, 'stage1_pause', STAGE1_OUTPUT);
        registerStage(engine, 'stage2_pause', { stage: 2 });
        engine.registerFlow('approval_flow', twoStageFlow('approval_flow') as never);

        const res = await engine.execute('approval_flow', {
            event: 'test',
            record: { id: 'ord_3' },
        } as unknown as AutomationContext);

        const run = await engine.getRun(res.runId as string);
        const suspended = await store.load(res.runId as string);

        // What run-detail shows and what the run will actually resume from are
        // one snapshot expression, so they cannot drift apart.
        expect(run?.variables).toEqual(suspended?.variables);
    });

    it('applies to `variables` exactly the shaping `output` already gets — none', async () => {
        // The parity fixture: ONE value, driven down both paths.
        //
        // Path A — a run that COMPLETES: the value leaves through `output`,
        //   which the completed `recordLog` sites have always carried.
        // Path B — a run that PAUSES holding the identical value: it leaves
        //   through `variables`.
        //
        // Deep-equal is the whole assertion. The run-detail read projects,
        // redacts and masks nothing today (the handler answers `deps.success(run)`
        // with the log entry as recorded), so parity means "unshaped, both". If
        // a future change starts shaping either field, this fails.
        const payload = {
            pending_approvers: ['user_ops', 'user_finance'],
            decision: { route: 'dual', nested: { deeper: [1, 2, { leaf: true }] } },
            blank: null,
        };

        const engine = new AutomationEngine(silent, new InMemorySuspendedRunStore());
        engine.registerNodeExecutor({
            type: 'emit', async execute() { return { success: true, output: { payload } }; },
        } as never);
        registerStage(engine, 'hold', {});
        const nodes = (extra: unknown[]) => [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'emit', type: 'emit', label: 'Emit' },
            ...extra,
            { id: 'end', type: 'end', label: 'End' },
        ];

        // Path A — terminal run, value surfaced through `output`.
        engine.registerFlow('done_flow', {
            name: 'done_flow', label: 'done', type: 'autolaunched',
            variables: [{ name: 'carried', type: 'object', isOutput: true, defaultValue: payload }],
            nodes: nodes([]),
            edges: [
                { id: 'e1', source: 'start', target: 'emit' },
                { id: 'e2', source: 'emit', target: 'end' },
            ],
        } as never);
        const doneRes = await engine.execute('done_flow', { event: 'test' } as AutomationContext);
        const doneRun = await engine.getRun(doneRes.runId as string ?? '');
        const viaOutput = (doneRun?.output as Record<string, unknown> | undefined)?.carried
            ?? (doneRes.output as Record<string, unknown>).carried;

        // Path B — paused run, the same value surfaced through `variables`.
        engine.registerFlow('paused_flow', {
            name: 'paused_flow', label: 'paused', type: 'autolaunched',
            variables: [{ name: 'carried', type: 'object', defaultValue: payload }],
            nodes: nodes([{ id: 'hold', type: 'hold', label: 'Hold' }]),
            edges: [
                { id: 'e1', source: 'start', target: 'emit' },
                { id: 'e2', source: 'emit', target: 'hold' },
                { id: 'e3', source: 'hold', target: 'end' },
            ],
        } as never);
        const pausedRes = await engine.execute('paused_flow', { event: 'test' } as AutomationContext);
        expect(pausedRes.status).toBe('paused');
        const pausedRun = await engine.getRun(pausedRes.runId as string);
        const viaVariables = pausedRun?.variables?.carried;

        expect(viaVariables).toEqual(viaOutput);
        expect(viaVariables).toEqual(payload);

        // Same for a NODE-produced value: `emit.payload` rides the variables
        // snapshot unshaped, exactly as `output` carried it on the other run.
        expect(pausedRun?.variables?.['emit.payload']).toEqual(payload);
    });
});
