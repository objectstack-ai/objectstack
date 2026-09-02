// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14333 — two CONCURRENT resumes of one run, on two replicas over one shared
 * store, must advance it exactly once.
 *
 * ## Why this is a sibling file and not more cases in the staleness harness
 *
 * `multi-replica-resume-staleness.test.ts` (#13617) is the two-engines-over-
 * one-shared-store harness of record, and it carries a REVERT-PROOF ledger
 * keyed to its own mutation: restore the cache-first read at the top of
 * `loadSuspendedRunStrict` and that file goes exactly `4 red / 4 green`, case
 * by named case. Adding cases there would silently invalidate those counts —
 * the ledger would describe a file that no longer exists — so the concurrent
 * half lives here, off its own mutation, and that file's ledger stays true.
 *
 * ## The defect this file measures
 *
 * #13617 closed the SEQUENTIAL failure (a replica resuming from a snapshot it
 * had gone stale on). It did not close the CONCURRENT one. `resumeInternal`
 * guards a duplicate resume with `this.resuming`, an in-process `Set`. Two
 * decisions on ONE run arriving in the same instant on TWO replicas each pass
 * their OWN `resuming` check, both read the same fresh row out of the shared
 * store, both consume it, and both traverse forward — so every downstream side
 * effect runs twice.
 *
 * ## What "both advanced" is asserted on
 *
 * OBSERVABLE EFFECTS, never internal bookkeeping. The flow below puts a real
 * side-effect node between the two approval levels:
 *
 *     start -> lv1 (pauses) -> notify (fires) -> lv2 (pauses) -> end
 *
 * so one advance past `lv1` fires `notify` once and opens `lv2` once. The
 * defect's signature is `notify` in the `fired` ledger TWICE and `lv2` in the
 * `opened` ledger twice — an action fired twice and a node executed twice,
 * which is the `sys_approval_request` duplication the family was reported as.
 * "Both callers entered `resumeInternal`" is deliberately NOT the assertion.
 *
 * ## The remedy this file pins
 *
 * A conditional advance on `SuspendedRunStore` — `claimSuspension`, "consume
 * the row only if it is still parked at node N with correlation C" — so the
 * winner advances and the loser is told `RESUME_IN_PROGRESS` and runs nothing.
 * The per-process `this.resuming` stays as the cheap first gate; it is not
 * replaced.
 *
 * ## REVERT-PROOF
 *
 * Replace the `claimAdvance` call in `resumeInternal` with the unconditional
 * `await this.forgetSuspendedRun(run, 'resumed')` it had before this card, and
 * this file goes 4 red / 4 green — measured on the committed tree, not
 * predicted, with the mutation confirmed on disk by anchored counts and the
 * blob hash (recorded in the PR body):
 *
 *  - `SHAPE A` → `[ 'notify', 'notify' ]` where `[ 'notify' ]` is correct: the
 *    action fired twice, which is the doubled side effect this card is about.
 *  - `SHAPE B` → the same, for the automated-approve shape.
 *  - `SIZED` → `{ trials: 25, doubled: 25, extraOpens: 25 }`: every raced run
 *    advanced twice, and opened its next approval level a second time.
 *  - the declared-degradation case → no `warn` at all, because the seam that
 *    emits it is the one the mutation removes.
 *
 * The four that stay green are the ones that must: the sequential single-
 * approver control (the shape the report called not obviously reachable), both
 * single-replica controls (the in-process `resuming` guard is untouched), and
 * the no-store control. A fix that moved the defect instead of removing it
 * would take one of those with it. `multi-replica-resume-staleness.test.ts`
 * stays 8/8 green under the same mutation — it pins the SEQUENTIAL half, and
 * this change does not touch it.
 */

import { describe, it, expect } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { SuspendedRun, SuspendedRunStore } from './engine.js';

function silentLogger(): any {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

/** A logger that keeps every line, so a degradation can be read back. */
function capturingLogger(lines: string[]): any {
    const l: any = {
        info: (m: string) => lines.push(`info ${m}`),
        warn: (m: string) => lines.push(`warn ${m}`),
        error: (m: string) => lines.push(`error ${m}`),
        debug: (m: string) => lines.push(`debug ${m}`),
        child: () => l,
    };
    return l;
}

/**
 * Two approval levels with a real side effect between them, so ONE advance
 * past `lv1` is distinguishable from two by what ran, not by what was called.
 */
const APPROVAL_FLOW = {
    name: 'expense_approval',
    label: 'Expense approval',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'lv1', type: 'approval_level', label: 'Department head' },
        { id: 'notify', type: 'notify_action', label: 'Notify finance' },
        { id: 'lv2', type: 'approval_level', label: 'General manager' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'lv1' },
        { id: 'e2', source: 'lv1', target: 'notify' },
        { id: 'e3', source: 'notify', target: 'lv2' },
        { id: 'e4', source: 'lv2', target: 'end' },
    ],
} as any;

/** The shared ledgers a run writes into, standing in for real side effects. */
interface Ledgers {
    /** Approval levels opened — one `sys_approval_request` row each. */
    opened: string[];
    /** Downstream actions fired — the doubled effect this card is about. */
    fired: string[];
}

/**
 * One replica: a fresh engine over the SHARED store, appending to the SHARED
 * ledgers. Two replicas therefore see one another's effects, exactly as two
 * app instances over one database see one another's rows.
 */
function replica(store: SuspendedRunStore | undefined, led: Ledgers, logger = silentLogger()): AutomationEngine {
    const engine = new AutomationEngine(logger, store);
    engine.registerNodeExecutor({
        type: 'approval_level',
        descriptor: defineActionDescriptor({
            type: 'approval_level',
            version: '1.0.0',
            name: 'Approval level',
            supportsPause: true,
            resumeAuthority: 'service',
        }),
        async execute(node) {
            led.opened.push(node.id);
            return { success: true, suspend: true, correlation: `req_${node.id}` };
        },
    });
    engine.registerNodeExecutor({
        type: 'notify_action',
        descriptor: defineActionDescriptor({
            type: 'notify_action',
            version: '1.0.0',
            name: 'Notify',
        }),
        async execute(node) {
            led.fired.push(node.id);
            return { success: true };
        },
    });
    engine.registerFlow('expense_approval', APPROVAL_FLOW);
    return engine;
}

const ledgers = (): Ledgers => ({ opened: [], fired: [] });

/** The approve an approvals service issues once it has recorded a decision. */
function approve(engine: AutomationEngine, runId: string, signal: Record<string, unknown> = {}) {
    return engine.resume(runId, { ...signal, [RESUME_AUTHORITY_SERVICE]: true } as any);
}

/** Park a fresh run at `lv1` on `submitter`, returning its id. */
async function parkAtLv1(submitter: AutomationEngine): Promise<string> {
    const submitted = await submitter.execute('expense_approval');
    expect(submitted.status).toBe('paused');
    return submitted.runId!;
}

describe('#14333 concurrent resumes of one run on two replicas advance it exactly once', () => {
    // ── SHAPE A: parallel / any-of approvers ────────────────────────────────
    //
    // Two DIFFERENT approvers on the same level, both authorized to advance it
    // (any-of), click approve in the same instant. The load balancer puts one
    // decision on replica A and the other on replica B. Each engine's own
    // `resuming` set is empty, so neither sees the other.

    it('SHAPE A (any-of approvers): the level advances once and fires the action once', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const a = replica(store, led);
        const b = replica(store, led);

        const runId = await parkAtLv1(a);
        expect(led.opened).toEqual(['lv1']);

        const [byAlice, byBob] = await Promise.all([
            approve(a, runId, { approver: 'alice' }),
            approve(b, runId, { approver: 'bob' }),
        ]);

        // THE OBSERVABLE EFFECT. One advance past `lv1`: the action fires once
        // and exactly one `lv2` request is opened. Unguarded, this reads
        // `['notify','notify']` and `['lv1','lv2','lv2']`.
        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);

        // Exactly one winner, and the loser is TOLD — not silently dropped.
        const winners = [byAlice, byBob].filter((r) => r.success);
        const losers = [byAlice, byBob].filter((r) => !r.success);
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(winners[0]!.status).toBe('paused');
        expect(losers[0]!.code).toBe('RESUME_IN_PROGRESS');
        // A refusal carries no run status — nothing was dispatched for it.
        expect(losers[0]!.status).toBeUndefined();

        // And the run is still one run, parked once, as either replica reads it.
        expect(await a.hasSuspendedRun(runId)).toBe(true);
        expect(await b.hasSuspendedRun(runId)).toBe(true);
    });

    // ── SHAPE B: automated approve calls ────────────────────────────────────
    //
    // No human at all: an auto-approve rule (or an at-least-once delivery of
    // one decision) issues the SAME approve twice, microseconds apart, landing
    // on two replicas. Identical signals, so nothing downstream could tell the
    // duplicate from the original after the fact.

    it('SHAPE B (automated approve calls): a duplicated automated approve advances once', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const a = replica(store, led);
        const b = replica(store, led);

        const runId = await parkAtLv1(a);
        const automated = { approver: 'auto_rule_expense_under_1000' };

        const [first, second] = await Promise.all([
            approve(a, runId, automated),
            approve(b, runId, automated),
        ]);

        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);
        expect([first, second].filter((r) => r.success)).toHaveLength(1);
        expect([first, second].filter((r) => r.code === 'RESUME_IN_PROGRESS')).toHaveLength(1);
    });

    // ── The exposure, sized ─────────────────────────────────────────────────
    //
    // How OFTEN, not just whether. Every trial is one run raced by two
    // replicas; `doubled` counts the trials whose action fired more than once.
    // The failure message carries the measurement, so the number is recorded
    // by the run itself rather than by a comment.

    it('SIZED: 25 raced runs produce 25 single advances and zero doubled effects', async () => {
        const TRIALS = 25;
        let doubled = 0;
        let extraOpens = 0;
        for (let i = 0; i < TRIALS; i++) {
            const store = new InMemorySuspendedRunStore();
            const led = ledgers();
            const a = replica(store, led);
            const b = replica(store, led);
            const runId = await parkAtLv1(a);
            await Promise.all([approve(a, runId), approve(b, runId)]);
            if (led.fired.length > 1) doubled++;
            extraOpens += led.opened.filter((id) => id === 'lv2').length - 1;
        }
        expect({ trials: TRIALS, doubled, extraOpens }).toEqual({ trials: TRIALS, doubled: 0, extraOpens: 0 });
    });

    // ── NEGATIVE CONTROL: the shape the card called not obviously reachable ──
    //
    // A single approver per level, deciding one at a time: the second decision
    // is only issued after the first has returned. There is no window in which
    // two resumes overlap, so this cannot race however the replicas are
    // scheduled — and the second call finds the pause already consumed.

    it('NEGATIVE CONTROL: a single approver per level, sequential, cannot race', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const a = replica(store, led);
        const b = replica(store, led);

        const runId = await parkAtLv1(a);

        // Decision 1, fully returned before decision 2 is issued.
        const first = await approve(a, runId);
        expect(first.success).toBe(true);
        expect(first.status).toBe('paused');
        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);

        // Decision 2 for `lv2`, on the other replica — advances, once.
        const second = await approve(b, runId);
        expect(second.success).toBe(true);
        expect(second.status).toBeUndefined();
        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);
    });

    // ── NEGATIVE CONTROL: the single-replica path is untouched ──────────────

    it('NEGATIVE CONTROL: one replica, two concurrent approves — the in-process guard still refuses one', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const only = replica(store, led);

        const runId = await parkAtLv1(only);
        const [first, second] = await Promise.all([approve(only, runId), approve(only, runId)]);

        expect(led.fired).toEqual(['notify']);
        expect(led.opened).toEqual(['lv1', 'lv2']);
        expect([first, second].filter((r) => r.success)).toHaveLength(1);
        const refused = [first, second].find((r) => !r.success)!;
        // `this.resuming` — the cheap first gate, kept, not replaced.
        expect(refused.code).toBe('RESUME_IN_PROGRESS');
        expect(refused.error).toContain('already being resumed');
    });

    it('NEGATIVE CONTROL: one replica, sequential approves walk the flow to completion', async () => {
        const store = new InMemorySuspendedRunStore();
        const led = ledgers();
        const only = replica(store, led);

        const runId = await parkAtLv1(only);
        expect((await approve(only, runId)).status).toBe('paused');
        const final = await approve(only, runId);

        expect(final.success).toBe(true);
        expect(final.status).toBeUndefined();
        expect(led.opened).toEqual(['lv1', 'lv2']);
        expect(led.fired).toEqual(['notify']);
        expect(await only.hasSuspendedRun(runId)).toBe(false);
    });

    it('NEGATIVE CONTROL: with no store at all, behaviour is purely in-memory', async () => {
        // The historical default (LiteKernel, tests, dev): nothing is shared,
        // so there is no second replica to race and the in-process guard is
        // the whole guarantee. No degradation is declared here — there is no
        // cross-replica guarantee to weaken.
        const led = ledgers();
        const lines: string[] = [];
        const solo = replica(undefined, led, capturingLogger(lines));

        const runId = await parkAtLv1(solo);
        expect((await approve(solo, runId)).status).toBe('paused');
        expect(led.opened).toEqual(['lv1', 'lv2']);
        expect(led.fired).toEqual(['notify']);
        expect(lines.filter((l) => l.includes('advance guarantee'))).toEqual([]);
    });

    // ── The seam is LOUD when a store cannot express the guarantee ──────────

    it('a store without claimSuspension gets a ONE-TIME declared degradation, and still resumes', async () => {
        // Third-party stores predating this member cannot express the
        // conditional advance. They must not silently offer no guarantee: the
        // engine says so once per store, at `warn` (a weakened guarantee is a
        // FUNCTIONAL degradation — nothing claimed-persisted fails to land —
        // the same call `claim()`'s missing-ledger branch makes one screen up).
        const led = ledgers();
        const lines: string[] = [];
        const backing = new InMemorySuspendedRunStore();
        // A store predating `claimSuspension`: the four original members and
        // nothing else. Delegated to a real one so the run genuinely resumes —
        // the point is that it resumes UNGUARDED and is told so, not that it
        // breaks.
        const store: SuspendedRunStore = {
            save: (r: SuspendedRun) => backing.save(r),
            load: (id: string) => backing.load(id),
            delete: (id: string) => backing.delete(id),
            list: () => backing.list(),
        };
        const engine = replica(store, led, capturingLogger(lines));

        const runId = await parkAtLv1(engine);
        expect((await approve(engine, runId)).status).toBe('paused');
        expect((await approve(engine, runId)).status).toBeUndefined();

        const declared = lines.filter((l) => l.includes('advance guarantee'));
        expect(declared).toHaveLength(1);
        expect(declared[0]!.startsWith('warn ')).toBe(true);
        expect(declared[0]).toContain('claimSuspension');
    });
});
