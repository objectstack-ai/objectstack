// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `supportsPause` is enforced at the engine boundary (#6667, from #5703).
 *
 * Before this, `supportsPause` was a declaration three authoring-time seams
 * read and no execution path did: the designer palette, the registration
 * warning (`warnIfResumeAuthorityUndeclared`), and the
 * `check:resume-authority-declared` CI gate. A run pauses for one reason only —
 * the executor's `execute()` returned `suspend: true` — so an executor could
 * suspend while its `ActionDescriptor` said it could not, and every one of those
 * three seams stayed silent, by construction: all three key on
 * `supportsPause: true`.
 *
 * ## Why the mismatch is REFUSED rather than honoured-and-logged
 *
 * A type that leaves `supportsPause` false is exactly the type nothing gates for
 * `resumeAuthority` either — the gate and the warning both trigger on
 * `supportsPause: true` — so it almost certainly declares no authority, and
 * since #5561 step two an undeclared authority resolves to `'service'`. The
 * honoured pause is therefore a durable continuation nothing can continue: the
 * generic resume route answers `PERMISSION_DENIED`, and it does so at resume
 * time, possibly a restart later, naming `resumeAuthority` rather than the
 * `supportsPause` that caused it. Refusing fails the run in the process that
 * made the mistake, writes nothing durable, and hands back the one-line fix.
 *
 * That direction is #5561's own: of two possible mistakes, take the one whose
 * victim is the person who made it.
 *
 * ## The three shapes this file separates
 *
 *  - **mismatch** — declares `supportsPause: false` (or omits it, which parses
 *    to the same) and suspends. Refused, guard-class, nothing persisted.
 *  - **the inverse** — declares `supportsPause: true` and never suspends. NOT a
 *    finding: the field is a capability, not an obligation (`wait` legitimately
 *    returns straight through when its condition is already met).
 *  - **silence** — publishes no descriptor at all. Out of scope by design: there
 *    is no declaration to enforce, `NodeExecutor.descriptor` is optional by
 *    contract, and #5561 already fail-closes the consequence at the resume gate
 *    (`resume-authority-gate.test.ts`'s `bare_pause`). Pinned here so narrowing
 *    or widening that boundary is a deliberate edit, not a silent one.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';

function silentLogger(): any {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

/** A descriptor that declares the pause it produces, the way the built-ins do. */
const declaredPauser = (type: string) => defineActionDescriptor({
    type, version: '1.0.0', name: type,
    supportsPause: true, resumeAuthority: 'any',
});

/**
 * The defect this file is about: a descriptor that declares `supportsPause`
 * false — explicitly here, and by omission in the sibling below — on an executor
 * that suspends anyway.
 */
const explicitlyNonPausing = (type: string) => defineActionDescriptor({
    type, version: '1.0.0', name: type,
    supportsPause: false,
});

/** The realistic spelling of the same defect: the key is simply never written. */
const silentlyNonPausing = (type: string) => defineActionDescriptor({
    type, version: '1.0.0', name: type,
});

/** `start → pause → after → end`, so "did the run continue?" is observable. */
function pauseFlow(name: string, pauseType: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'pause', type: pauseType, label: 'Pause' },
            { id: 'after', type: 'after', label: 'After' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'pause' },
            { id: 'e2', source: 'pause', target: 'after' },
            { id: 'e3', source: 'after', target: 'end' },
        ],
    };
}

describe('#6667 — an executor may not suspend a run its descriptor says it cannot pause', () => {
    let engine: AutomationEngine;
    let downstream: string[];
    let store: InMemorySuspendedRunStore;

    beforeEach(() => {
        downstream = [];
        store = new InMemorySuspendedRunStore();
        engine = new AutomationEngine(silentLogger(), store);
        engine.registerNodeExecutor({
            type: 'after',
            async execute(node) { downstream.push(node.id); return { success: true }; },
        });
    });

    /** Registers a suspending executor under `type` with the given descriptor. */
    function registerSuspender(type: string, descriptor?: unknown): void {
        engine.registerNodeExecutor({
            type,
            ...(descriptor ? { descriptor: descriptor as never } : {}),
            async execute() { return { success: true, suspend: true, correlation: 'req_1' }; },
        });
    }

    // ── the mismatch ────────────────────────────────────────────────────

    it('refuses the suspension, fails the run, and names the fix', async () => {
        registerSuspender('bad_pause', explicitlyNonPausing('bad_pause'));
        engine.registerFlow('bad_flow', pauseFlow('bad_flow', 'bad_pause') as never);

        const result = await engine.execute('bad_flow');

        expect(result.success).toBe(false);
        expect(result.status).not.toBe('paused');
        // The refusal names the declaration that is wrong, the consequence it
        // would otherwise have had, and both halves of the one-line fix — a
        // reader who sees only `Node 'pause' failed` learns nothing actionable.
        expect(result.error ?? '').toContain('declares supportsPause: false');
        expect(result.error ?? '').toContain('Declare supportsPause: true');
        expect(result.error ?? '').toContain('resumeAuthority');
        // Refused BEFORE the pause became a fact: nothing downstream ran, and
        // no continuation was written to either the cache or the durable store.
        expect(downstream).toEqual([]);
        expect(engine.listSuspendedRuns()).toHaveLength(0);
        expect(await store.list()).toHaveLength(0);
    });

    it('records the offending node as a FAILED step, not a success followed by a mystery', async () => {
        registerSuspender('bad_pause', explicitlyNonPausing('bad_pause'));
        engine.registerFlow('bad_flow', pauseFlow('bad_flow', 'bad_pause') as never);

        await engine.execute('bad_flow');

        const runs = await engine.listRuns('bad_flow');
        expect(runs).toHaveLength(1);
        expect(runs[0].status).toBe('failed');
        const step = runs[0].steps.find(s => s.nodeId === 'pause');
        expect(step).toBeDefined();
        expect(step!.status).toBe('failure');
        // The engine's node-failure code (`packages/spec` error-code ledger,
        // ADR-0112). A refusal that recorded no code would be indistinguishable
        // from the run simply stopping.
        expect(step!.error?.code).toBe('NODE_FAILURE');
        expect(step!.error?.message ?? '').toContain('declares supportsPause: false');
    });

    it('treats an OMITTED supportsPause exactly like an explicit false', async () => {
        // The realistic spelling: nobody types `supportsPause: false`, they just
        // never think about the key. `ActionDescriptorSchema` defaults it to
        // false, so the two are the same declaration — unlike `resumeAuthority`,
        // whose omission #5561 deliberately kept observable.
        registerSuspender('quiet_pause', silentlyNonPausing('quiet_pause'));
        engine.registerFlow('quiet_flow', pauseFlow('quiet_flow', 'quiet_pause') as never);

        const result = await engine.execute('quiet_flow');

        expect(result.success).toBe(false);
        expect(result.error ?? '').toContain('declares supportsPause: false');
        expect(engine.listSuspendedRuns()).toHaveLength(0);
    });

    it('is a GUARD refusal — a fault edge does not route it (#3863)', async () => {
        // Re-running the flow unchanged can never fix a wrong declaration, so
        // this is the metadata class, not the runtime class. If a fault edge
        // could route it, one edge would turn the check off while the run still
        // reported success — the shape #3863 exists to prevent.
        registerSuspender('bad_pause', explicitlyNonPausing('bad_pause'));
        engine.registerNodeExecutor({
            type: 'handler',
            async execute(node) { downstream.push(node.id); return { success: true }; },
        });
        engine.registerFlow('fault_flow', {
            name: 'fault_flow',
            label: 'fault_flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'pause', type: 'bad_pause', label: 'Pause' },
                { id: 'rescue', type: 'handler', label: 'Rescue' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'pause' },
                { id: 'e2', source: 'pause', target: 'end' },
                { id: 'e_fault', source: 'pause', target: 'rescue', type: 'fault' },
                { id: 'e3', source: 'rescue', target: 'end' },
            ],
        } as never);

        const result = await engine.execute('fault_flow');

        expect(result.success).toBe(false);
        expect(downstream).toEqual([]);
    });

    it('refuses a re-suspension on the RESUME path too — one seam, every entry', async () => {
        // `resume()` re-enters through `executeNode`, so a run that legitimately
        // paused and then reaches a mis-declared node downstream is judged by
        // the same check. Without this, half of every multi-pause flow would be
        // unguarded.
        registerSuspender('good_pause', declaredPauser('good_pause'));
        registerSuspender('bad_pause', explicitlyNonPausing('bad_pause'));
        engine.registerFlow('two_pauses', {
            name: 'two_pauses',
            label: 'two_pauses',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'first', type: 'good_pause', label: 'First' },
                { id: 'second', type: 'bad_pause', label: 'Second' },
                { id: 'after', type: 'after', label: 'After' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'first' },
                { id: 'e2', source: 'first', target: 'second' },
                { id: 'e3', source: 'second', target: 'after' },
                { id: 'e4', source: 'after', target: 'end' },
            ],
        } as never);

        const paused = await engine.execute('two_pauses');
        expect(paused.status).toBe('paused');

        const resumed = await engine.resume(paused.runId!);

        expect(resumed.success).toBe(false);
        expect(resumed.error ?? '').toContain('declares supportsPause: false');
        expect(downstream).toEqual([]);
        // The first suspension was consumed by the resume and the second was
        // never created — the run is terminally failed, not half-parked.
        expect(engine.listSuspendedRuns()).toHaveLength(0);
        expect(await store.list()).toHaveLength(0);
    });

    // ── what still works, unchanged ─────────────────────────────────────

    it('a correctly-declaring executor suspends and resumes exactly as before', async () => {
        registerSuspender('good_pause', declaredPauser('good_pause'));
        engine.registerFlow('good_flow', pauseFlow('good_flow', 'good_pause') as never);

        const paused = await engine.execute('good_flow');
        expect(paused.success).toBe(true);
        expect(paused.status).toBe('paused');
        expect(paused.runId).toBeTruthy();
        expect(engine.listSuspendedRuns()).toHaveLength(1);

        const resumed = await engine.resume(paused.runId!);
        expect(resumed.success).toBe(true);
        expect(downstream).toEqual(['after']);
    });

    it('does NOT police the inverse: supportsPause: true and never suspending is legal', async () => {
        // The declaration is a capability, not an obligation. `wait` returns
        // straight through when its condition is already satisfied, and a
        // symmetric check would make that a failure.
        engine.registerNodeExecutor({
            type: 'may_pause',
            descriptor: declaredPauser('may_pause'),
            async execute() { return { success: true, output: { went: 'straight through' } }; },
        });
        engine.registerFlow('inverse_flow', pauseFlow('inverse_flow', 'may_pause') as never);

        const result = await engine.execute('inverse_flow');

        expect(result.success).toBe(true);
        expect(result.status).not.toBe('paused');
        expect(downstream).toEqual(['after']);
    });

    it('leaves a descriptor-less executor to the #5561 resume gate — silence is not a declaration', async () => {
        // Registering no descriptor declares NOTHING, not `false`. There is no
        // declaration for this check to enforce, and the consequence is already
        // fail-closed at the other end: the pause is created, and the generic
        // resume route refuses it because an absent descriptor carries an absent
        // `resumeAuthority`. `resume-authority-gate.test.ts` owns that half; this
        // pins that #6667 did not quietly take it over.
        registerSuspender('bare_pause');
        engine.registerFlow('bare_flow', pauseFlow('bare_flow', 'bare_pause') as never);

        const paused = await engine.execute('bare_flow');

        expect(paused.status).toBe('paused');
        expect(engine.listSuspendedRuns()).toHaveLength(1);

        const refused = await engine.resume(paused.runId!);
        expect(refused.success).toBe(false);
        expect(refused.code).toBe('PERMISSION_DENIED');
        expect(refused.error ?? '').toMatch(/never declares resumeAuthority/);
    });

    it('reads the CANONICAL descriptor through an ADR-0018 alias, not the synthesized one', async () => {
        // `registerNodeAlias` synthesizes the alias's descriptor and does not
        // copy the canonical's capabilities, so it carries `supportsPause: false`
        // by default. Reading it directly would refuse every pause authored under
        // the old type name — the mirror image of the hole the same alias hop
        // closes for `resumeAuthority`. No alias of a pausing type exists today;
        // this keeps the day one does from being a regression.
        registerSuspender('new_pause', declaredPauser('new_pause'));
        engine.registerNodeAlias('old_pause', 'new_pause');
        engine.registerFlow('alias_flow', pauseFlow('alias_flow', 'old_pause') as never);

        const paused = await engine.execute('alias_flow');

        expect(paused.success).toBe(true);
        expect(paused.status).toBe('paused');
        expect(engine.listSuspendedRuns()).toHaveLength(1);
    });
});
