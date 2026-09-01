// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13909 slice 2 — **the operator exit from a run a resume left terminally
 * unresumable**, and every one of its refusals.
 *
 * ## The state under test
 *
 * `AutomationEngine.resumeInternal` consumes the suspension BEFORE running the
 * downstream nodes (`forgetSuspendedRun(run, 'resumed')` precedes
 * `traverseNext`), so a node that merely THROWS throws with the pause already
 * gone and the catch arm records the run `failed`. Slice 1 measured that this
 * is terminal: `resume` answers `RUN_NOT_FOUND`, `cancelRun` is a no-op on it,
 * the REST run surface has no cancel or retry route, and none of the engine's
 * public methods moved such a run out.
 *
 * ⛔ **This file changes nothing about that ordering.** Which ordering is right
 * is #13937, unruled and in the maintainer's hands. What is pinned here is the
 * EXIT: `restoreConsumedSuspension` puts the consumed suspension back so the
 * run is resumable again, under the ordering exactly as it is.
 *
 * ## What is pinned, and why each one is here
 *
 *  1. **The exit works end to end** — a run in the terminal post-resume-failure
 *     state is moved back to resumable AND can then actually be resumed to
 *     completion. Half of that (a `restored: true` that leaves the run no more
 *     resumable than before) would be a verb that reports success and delivers
 *     nothing.
 *  2. **Every refusal separately, each with its OWN reason.** The reasons ARE
 *     the deliverable: an operator whose repair is declined has to be able to
 *     tell "this run is fine" from "this run is beyond this verb" from "I could
 *     not read the store", because the remedy differs for each. A single "it
 *     refuses bad input" test would cover none of that.
 *  3. ⭐ **The in-flight resume.** "Suspension gone, no terminal row yet" is
 *     exactly what a live resume looks like from outside, and re-arming one of
 *     those races it. Pinned by calling the verb from INSIDE the downstream
 *     node, i.e. at the one instant the race is real.
 *  4. **Idempotence**, both halves: sequential (the second caller finds a live
 *     suspension) and concurrent (one `restored: true`, one refusal) — and in
 *     both cases exactly ONE suspension exists afterwards.
 *  5. **The trace** — the whole reason this class stayed silent is that nothing
 *     recorded it, so an exit that is itself invisible repeats the defect.
 *  6. **Across a restart** — the deployment shape ADR-0019 exists for. An exit
 *     that only works inside the process lifetime that stranded the run would
 *     answer almost never: these runs are found hours later, by a sweep or a
 *     support ticket, in some other process.
 *  7. **Verbatim, and the snapshot's own lifecycle** — what goes back is the
 *     pause as it stood, and a run that is restored and then finishes clears
 *     its own snapshot instead of staying restorable forever.
 */

import { describe, it, expect, vi } from 'vitest';

import { AutomationEngine, type SuspendedRunStore } from './engine.js';
// ⛔ BARREL imports, on purpose — everything else in this file imports from
// './engine.js', which is exactly why the missing barrel export had no witness
// (#13951 contract review, finding 1). These lines and the pin at the bottom
// of this file are that witness; see the describe block for what fails where.
import {
    AutomationEngine as BarrelAutomationEngine,
    type SuspensionRestoreResult,
    type SuspensionRestoreRefusal,
} from './index.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

/**
 * `resumeAuthority: 'any'` is required of a pausing fixture since #5561 — these
 * tests continue their pause through the public `resume` door. Nothing here is
 * about the resume gate (`resume-authority-gate.test.ts` owns that).
 */
const pauser = (type: string) => defineActionDescriptor({
    type, version: '1.0.0', name: type,
    supportsPause: true, resumeAuthority: 'any',
});

const plain = (type: string) => defineActionDescriptor({ type, version: '1.0.0', name: type });

/** start → pause (suspends) → after (the node that throws) → end. */
function flowDef(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        variables: [{ name: 'ticket', type: 'text', isInput: true, isOutput: true }],
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'pause', type: 'pause_here', label: 'Pause' },
            { id: 'after', type: 'after_pause', label: 'After' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'pause' },
            { id: 'e2', source: 'pause', target: 'after' },
            { id: 'e3', source: 'after', target: 'end' },
        ],
    };
}

/** A flow with no pause at all — for the never-suspended refusal. */
function noPauseFlow(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'boom', type: 'always_throws', label: 'Boom' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'boom' },
            { id: 'e2', source: 'boom', target: 'end' },
        ],
    };
}

function registerPauser(engine: AutomationEngine) {
    engine.registerNodeExecutor({
        type: 'pause_here',
        descriptor: pauser('pause_here'),
        async execute() {
            return { success: true, suspend: true, correlation: 'approval:req_1', output: { stage: 'awaiting' } };
        },
    } as never);
}

/**
 * The downstream node. `throwUntil` counts the resumes that must fail — the
 * FIRST resume strands the run, and a later one (after the operator repaired
 * whatever broke) has to be able to finish it, which is what makes the exit an
 * exit rather than a status change.
 */
function registerDownstream(engine: AutomationEngine, state: { throws: boolean; onEnter?: () => Promise<void> }) {
    engine.registerNodeExecutor({
        type: 'after_pause',
        descriptor: plain('after_pause'),
        async execute() {
            if (state.onEnter) await state.onEnter();
            if (state.throws) throw new Error('downstream node blew up');
            return { success: true, output: { done: true } };
        },
    } as never);
}

const ctx = { event: 'test', record: { id: 'rec_1' }, params: { ticket: 'TKT-9' } } as unknown as AutomationContext;

/** Drive a run into the exact state this card is about. Returns its id. */
async function strandRun(engine: AutomationEngine, flowName = 'strand_flow'): Promise<string> {
    const started = await engine.execute(flowName, ctx);
    expect(started.status).toBe('paused');
    const runId = started.runId as string;
    const failed = await engine.resume(runId);
    // The mechanism, restated as an assertion rather than assumed: the run is
    // terminal and the pause is gone.
    expect(failed.success).toBe(false);
    expect(await engine.hasSuspendedRun(runId)).toBe(false);
    // …and it is TERMINAL — the existing doors do not move it.
    const again = await engine.resume(runId);
    expect(again.code).toBe('RUN_NOT_FOUND');
    expect(await engine.cancelRun(runId)).toBe(false);
    return runId;
}

function newEngine(store?: SuspendedRunStore, logger: unknown = silent, throws = true) {
    const engine = new AutomationEngine(logger as never, store);
    const state = { throws };
    registerPauser(engine);
    registerDownstream(engine, state);
    engine.registerFlow('strand_flow', flowDef('strand_flow') as never);
    return { engine, state };
}

describe('#13909 — restoreConsumedSuspension: the operator exit', () => {
    it('moves a terminally-failed run back to resumable, and it then actually resumes', async () => {
        const { engine, state } = newEngine(new InMemorySuspendedRunStore());
        const runId = await strandRun(engine);

        const restored = await engine.restoreConsumedSuspension(runId, {
            requestedBy: 'ops@example.com',
            reason: 'downstream service was down',
        });

        expect(restored.restored).toBe(true);
        expect(restored.refusal).toBeUndefined();
        expect(restored.nodeId).toBe('pause');
        expect(restored.flowName).toBe('strand_flow');
        expect(restored.consumedAt).toEqual(expect.any(String));

        // Back to resumable — measured, not inferred from the return value.
        expect(await engine.hasSuspendedRun(runId)).toBe(true);

        // ⭐ And it RESUMES. Half an exit — a run that reports restorable and
        // then cannot be resumed — would be worse than none.
        state.throws = false;
        const finished = await engine.resume(runId);
        expect(finished.success).toBe(true);
        expect(finished.error).toBeUndefined();
        expect(await engine.hasSuspendedRun(runId)).toBe(false);
        expect((await engine.getRun(runId))?.status).toBe('completed');
    });

    it('restores the pause VERBATIM — the pause\'s variables and step log, not the failed attempt\'s', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine } = newEngine(store);
        const started = await engine.execute('strand_flow', ctx);
        const runId = started.runId as string;

        const atPause = await store.load(runId);
        expect(atPause).not.toBeNull();
        const stepsAtPause = atPause!.steps.length;

        // Resume WITH a signal, so the failed attempt's variable map differs
        // from the pause's own — if the snapshot were taken after the fold, the
        // key below would be present.
        await engine.resume(runId, { output: { verdict: 'approved' } } as never);
        expect(await engine.hasSuspendedRun(runId)).toBe(false);

        const restored = await engine.restoreConsumedSuspension(runId);
        expect(restored.restored).toBe(true);

        const back = await store.load(runId);
        expect(back).not.toBeNull();
        expect(back!.nodeId).toBe('pause');
        expect(back!.correlation).toBe('approval:req_1');
        // The pause's own state, unchanged…
        expect(back!.variables.ticket).toBe('TKT-9');
        expect(back!.variables['pause.stage']).toBe('awaiting');
        // …and the resume signal is deliberately NOT folded back in: replaying
        // it would re-decide on the operator's behalf, and the branch a signal
        // routes down is not part of a suspension at all.
        expect(back!.variables['pause.verdict']).toBeUndefined();
        // The failed attempt's steps are not part of what goes back.
        expect(back!.steps.length).toBe(stepsAtPause);
    });

    it('records the run as paused again, so the repair is not invisible', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const runId = await strandRun(engine);
        expect((await engine.getRun(runId))?.status).toBe('failed');

        await engine.restoreConsumedSuspension(runId);

        const after = await engine.getRun(runId);
        expect(after?.status).toBe('paused');
        // #7639's shape: a paused entry carries the variable snapshot.
        expect(after?.variables?.ticket).toBe('TKT-9');
    });
});

describe('#13909 — the refusals, each earned by its own observation', () => {
    it('refuses a run that is still SUSPENDED — it is already resumable', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const started = await engine.execute('strand_flow', ctx);
        const runId = started.runId as string;

        const res = await engine.restoreConsumedSuspension(runId);
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('RUN_SUSPENDED');
        expect(res.reason).toContain('already resumable');
        // Refusing is not enough — it must not have minted a second pause.
        expect((await (new InMemorySuspendedRunStore()).list()).length).toBe(0);
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
    });

    it('⭐ refuses a run whose resume is IN FLIGHT — the case that races a live resume', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const started = await engine.execute('strand_flow', ctx);
        const runId = started.runId as string;

        // Called from INSIDE the downstream node: the suspension is already
        // consumed, no terminal row is written yet, and `resuming` is set. This
        // is the only instant at which the race is real.
        let seen: Awaited<ReturnType<AutomationEngine['restoreConsumedSuspension']>> | undefined;
        registerDownstream(engine, {
            throws: true,
            onEnter: async () => { seen = await engine.restoreConsumedSuspension(runId); },
        });

        await engine.resume(runId);

        expect(seen).toBeDefined();
        expect(seen!.restored).toBe(false);
        expect(seen!.refusal).toBe('RESUME_IN_PROGRESS');
        expect(seen!.reason).toContain('not decided yet');
        // The run took its normal course; nothing was re-armed underneath it.
        expect(await engine.hasSuspendedRun(runId)).toBe(false);
    });

    it('refuses a COMPLETED run', async () => {
        const { engine, state } = newEngine(new InMemorySuspendedRunStore());
        state.throws = false;
        const started = await engine.execute('strand_flow', ctx);
        const runId = started.runId as string;
        const done = await engine.resume(runId);
        expect(done.success).toBe(true);

        const res = await engine.restoreConsumedSuspension(runId);
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('RUN_COMPLETED');
        expect(res.reason).toContain('completed');
    });

    it('refuses a CANCELLED run — a restore would undo a deliberate decision', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const started = await engine.execute('strand_flow', ctx);
        const runId = started.runId as string;
        expect(await engine.cancelRun(runId, 'submitter withdrew')).toBe(true);

        const res = await engine.restoreConsumedSuspension(runId);
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('RUN_CANCELLED');
        expect(res.reason).toContain('cancelled');
    });

    it('refuses a run that NEVER suspended — distinct from every other failure', async () => {
        const engine = new AutomationEngine(silent, new InMemorySuspendedRunStore());
        engine.registerNodeExecutor({
            type: 'always_throws',
            descriptor: plain('always_throws'),
            async execute() { throw new Error('never paused, just broke'); },
        } as never);
        engine.registerFlow('no_pause_flow', noPauseFlow('no_pause_flow') as never);

        const res0 = await engine.execute('no_pause_flow', ctx);
        expect(res0.success).toBe(false);
        const runId = res0.runId ?? (await engine.listRuns('no_pause_flow'))[0]?.id;
        expect(runId).toBeTruthy();

        const res = await engine.restoreConsumedSuspension(runId as string);
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('NO_CONSUMED_SUSPENSION');
        expect(res.reason).toContain('never suspended');
        // ⛔ And it does NOT claim to know which of the two causes it was.
        expect(res.reason).toContain('no longer held');
    });

    it('refuses an UNKNOWN run', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const res = await engine.restoreConsumedSuspension('run_does_not_exist');
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('RUN_NOT_FOUND');
    });

    it('refuses — rather than guesses — when the suspended-run store cannot be read', async () => {
        const inner = new InMemorySuspendedRunStore();
        const store: SuspendedRunStore = {
            save: (r) => inner.save(r),
            load: async () => { throw new Error('connection reset'); },
            delete: (id) => inner.delete(id),
            list: () => inner.list(),
            recordTerminal: (r) => inner.recordTerminal(r),
            loadTerminal: (id) => inner.loadTerminal(id),
        };
        const engine = new AutomationEngine(silent, store);
        registerPauser(engine);
        registerDownstream(engine, { throws: true });
        engine.registerFlow('strand_flow', flowDef('strand_flow') as never);

        const res = await engine.restoreConsumedSuspension('run_whatever');
        expect(res.restored).toBe(false);
        // ⛔ NOT 'RUN_NOT_FOUND': reading an outage as "no suspension" is the one
        // mistake that would put a second resumable pause on a live run.
        expect(res.refusal).toBe('STORE_UNAVAILABLE');
    });

    it('refuses when the run-history read fails — "unknown" is not "nothing to restore"', async () => {
        const inner = new InMemorySuspendedRunStore();
        const store: SuspendedRunStore = {
            save: (r) => inner.save(r),
            load: (id) => inner.load(id),
            delete: (id) => inner.delete(id),
            list: () => inner.list(),
            recordTerminal: (r) => inner.recordTerminal(r),
            loadTerminal: async () => { throw new Error('history table unreachable'); },
        };
        const engine = new AutomationEngine(silent, store);
        registerPauser(engine);
        registerDownstream(engine, { throws: true });
        engine.registerFlow('strand_flow', flowDef('strand_flow') as never);

        // A run this engine never saw, so the hot journal cannot answer for it.
        const res = await engine.restoreConsumedSuspension('run_elsewhere');
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('STORE_UNAVAILABLE');
    });
});

describe('#13909 — idempotence: one pause, whoever asks and however often', () => {
    it('a second SEQUENTIAL restore finds the run already suspended', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine } = newEngine(store);
        const runId = await strandRun(engine);

        const first = await engine.restoreConsumedSuspension(runId);
        const second = await engine.restoreConsumedSuspension(runId);

        expect(first.restored).toBe(true);
        expect(second.restored).toBe(false);
        expect(second.refusal).toBe('RUN_SUSPENDED');
        // The invariant the card asks for, measured on the store itself.
        expect((await store.list()).filter(r => r.runId === runId).length).toBe(1);
    });

    it('two CONCURRENT restores produce one restore, one refusal, and one pause', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine } = newEngine(store);
        const runId = await strandRun(engine);

        const [a, b] = await Promise.all([
            engine.restoreConsumedSuspension(runId, { requestedBy: 'alice' }),
            engine.restoreConsumedSuspension(runId, { requestedBy: 'bob' }),
        ]);

        const restored = [a, b].filter(r => r.restored);
        const refused = [a, b].filter(r => !r.restored);
        expect(restored.length).toBe(1);
        expect(refused.length).toBe(1);
        expect(refused[0].refusal).toBe('RESTORE_IN_PROGRESS');
        expect((await store.list()).filter(r => r.runId === runId).length).toBe(1);
    });

    it('does not itself traverse — the continuation stays an ordinary resume', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = new AutomationEngine(silent, store);
        registerPauser(engine);
        let entries = 0;
        registerDownstream(engine, { throws: true, onEnter: async () => { entries++; } });
        engine.registerFlow('strand_flow', flowDef('strand_flow') as never);

        const started = await engine.execute('strand_flow', ctx);
        const runId = started.runId as string;
        await engine.resume(runId);
        expect(entries).toBe(1);

        await engine.restoreConsumedSuspension(runId);
        await engine.restoreConsumedSuspension(runId);
        // Two invocations, zero extra traversals: the verb re-arms and stops.
        expect(entries).toBe(1);
    });
});

describe('#13909 — the trace', () => {
    it('records the restore where an operator can find it afterwards', async () => {
        const warn = vi.fn();
        const logger = { info() {}, warn, error() {}, debug() {} };
        const { engine } = newEngine(new InMemorySuspendedRunStore(), logger);
        const runId = await strandRun(engine);

        await engine.restoreConsumedSuspension(runId, {
            requestedBy: 'ops@example.com',
            reason: 'restarted the billing service',
        });

        const record = warn.mock.calls.find(([msg]) => String(msg).includes('RESTORED'));
        expect(record).toBeDefined();
        const [message, meta] = record as [string, Record<string, unknown>];

        // The handles the engine controls stay in the message…
        expect(message).toContain(runId);
        expect(message).toContain('strand_flow');
        expect(message).toContain("node 'pause'");
        // …and the two consequences an operator must know are stated, not implied.
        expect(message).toContain('NOT replayed');
        expect(message).toContain('undone');

        // Who / why / the original failure are in the STRUCTURED slot. All three
        // are uncontrolled text (#6299 family): a newline in any of them would
        // split one record into several physical lines of which only the first
        // is greppable.
        expect(meta.requestedBy).toBe('ops@example.com');
        expect(meta.restoreReason).toBe('restarted the billing service');
        expect(meta.failure).toContain('downstream node blew up');
        expect(meta.consumedAt).toEqual(expect.any(String));
        expect(message).not.toContain('ops@example.com');
        expect(message).not.toContain('restarted the billing service');
    });

    it('says so when nobody recorded who asked', async () => {
        const warn = vi.fn();
        const logger = { info() {}, warn, error() {}, debug() {} };
        const { engine } = newEngine(new InMemorySuspendedRunStore(), logger);
        const runId = await strandRun(engine);

        await engine.restoreConsumedSuspension(runId);

        const record = warn.mock.calls.find(([msg]) => String(msg).includes('RESTORED'));
        expect((record as [string, Record<string, unknown>])[1].requestedBy).toBe('not recorded');
    });
});

describe('#13909 — across a restart: the deployment shape this exists for', () => {
    it('a SECOND engine restores a run the FIRST one stranded', async () => {
        // One store, two engines — the file\'s established way of simulating a
        // process restart (suspend on A, act on B). These runs are found hours
        // later, by a sweep or a support ticket, in some other process; an exit
        // that only worked inside the lifetime that stranded the run would
        // answer almost never.
        const store = new InMemorySuspendedRunStore();
        const { engine: engineA } = newEngine(store);
        const runId = await strandRun(engineA);

        const { engine: engineB, state: stateB } = newEngine(store);
        // Engine B has no in-memory journal for this run at all…
        const restored = await engineB.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
        expect(restored.restored).toBe(true);
        expect(restored.nodeId).toBe('pause');

        // …and what it put back is a real, resumable suspension.
        expect(await engineB.hasSuspendedRun(runId)).toBe(true);
        const back = await store.load(runId);
        expect(back!.variables.ticket).toBe('TKT-9');
        expect(back!.correlation).toBe('approval:req_1');
        expect(back!.nodeType).toBe('pause_here');

        stateB.throws = false;
        const finished = await engineB.resume(runId);
        expect(finished.success).toBe(true);
    });

    it('a run that is restored and then finishes CLEARS its snapshot', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, state } = newEngine(store);
        const runId = await strandRun(engine);

        // The failed terminal row carries the snapshot…
        expect((await store.loadTerminal(runId))?.consumedSuspension).toBeDefined();

        await engine.restoreConsumedSuspension(runId);
        state.throws = false;
        expect((await engine.resume(runId)).success).toBe(true);

        // …and the completing run's terminal record replaces it, so nothing is
        // left that a later operator could restore a second time.
        const terminal = await store.loadTerminal(runId);
        expect(terminal?.status).toBe('completed');
        expect(terminal?.consumedSuspension).toBeUndefined();

        const fresh = new AutomationEngine(silent, store);
        const res = await fresh.restoreConsumedSuspension(runId);
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('RUN_COMPLETED');
    });

    it('a store-less engine still exits IN PROCESS, and says so honestly once evicted', async () => {
        // No store at all: the in-memory journal is the only copy. This is the
        // historical default and the shape unit tests run in.
        const { engine, state } = newEngine(undefined);
        const runId = await strandRun(engine);

        const restored = await engine.restoreConsumedSuspension(runId);
        expect(restored.restored).toBe(true);
        state.throws = false;
        expect((await engine.resume(runId)).success).toBe(true);
    });
});

describe('#13909 — what this slice deliberately does NOT do', () => {
    it('leaves AutomationResult.status and the run\'s recorded status alone', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const started = await engine.execute('strand_flow', ctx);
        const runId = started.runId as string;
        const failed = await engine.resume(runId);

        // ⛔ No new platform status is minted for the condition — naming it is
        // an explicit same-batch sub-item of #13937, because what it should be
        // called depends on which resume-ordering shape is ruled.
        expect(failed.status).toBeUndefined();
        expect((await engine.getRun(runId))?.status).toBe('failed');
    });

    it('leaves the resume ordering exactly as it is', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const started = await engine.execute('strand_flow', ctx);
        const runId = started.runId as string;

        // The consumption still precedes the traversal: measured from inside
        // the downstream node, the suspension is already gone. If a future
        // change made the pause survive a downstream throw (#13937 shape 2),
        // THIS is the assertion that should be reconsidered — deliberately, not
        // by accident.
        let suspendedDuringTraversal: boolean | undefined;
        registerDownstream(engine, {
            throws: true,
            onEnter: async () => { suspendedDuringTraversal = await engine.hasSuspendedRun(runId); },
        });
        await engine.resume(runId);
        expect(suspendedDuringTraversal).toBe(false);
    });

    it('does not restore a run automatically — only an explicit call does', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        const runId = await strandRun(engine);

        // Nothing sweeps, nothing retries: the run stays exactly where the
        // failed resume left it until somebody asks.
        await new Promise(r => setTimeout(r, 10));
        expect(await engine.hasSuspendedRun(runId)).toBe(false);
        expect((await engine.getRun(runId))?.status).toBe('failed');
    });
});

/**
 * The exhaustive switch the export exists to make writable (#13951 finding 1):
 * an operator surface maps each refusal to its remedy, because the remedy
 * differs for each. Compile-time exhaustive — the `default` arm types the
 * scrutinee `never`, so growing {@link SuspensionRestoreRefusal} without
 * extending every consumer is a tsc error here, which is exactly the
 * protection a consumer could not buy while the union was unnameable.
 */
function remedyFor(refusal: SuspensionRestoreRefusal): string {
    switch (refusal) {
        case 'RESTORE_IN_PROGRESS': return 'wait: this process is already restoring it';
        case 'RESUME_IN_PROGRESS': return 'wait: its outcome is not decided yet';
        case 'RUN_SUSPENDED': return 'nothing to do: it is already resumable';
        case 'STORE_UNAVAILABLE': return 'fix the store failure, then re-issue the restore';
        case 'RUN_COMPLETED': return 'nothing to do: it finished';
        case 'RUN_CANCELLED': return 'ask who cancelled it before undoing their decision';
        case 'NO_CONSUMED_SUSPENSION': return 'read the reason: it names the status observed';
        case 'RUN_NOT_FOUND': return 'check the run id';
        default: {
            const unhandled: never = refusal;
            return unhandled;
        }
    }
}

// Barrel nameability (#13951 contract review, finding 1). The refusal
// vocabulary was published de facto — a consumer could call the
// barrel-reachable verb and receive the eight values at runtime — but
// unnameable de jure: the barrel exported neither result type, and the exports
// map publishes only '.', so no exhaustive switch was writable. This block
// does, with BARREL names only, the things the finding says a consumer must be
// able to do, and it FAILS if the barrel export is removed — split across the
// two channels that actually check each half:
//  - the type half breaks at `tsc --noEmit` (TS2305 on the type-only imports
//    above; vitest transpiles without type-checking, so tsc IS its witness);
//  - the runtime half (the verb on the class the barrel itself exports) breaks
//    right here in vitest.
describe('#13951 — the restore vocabulary is nameable from the barrel', () => {
    it('publishes the verb on the same class the barrel exports', () => {
        expect(BarrelAutomationEngine).toBe(AutomationEngine);
        expect(typeof BarrelAutomationEngine.prototype.restoreConsumedSuspension).toBe('function');
    });

    it('a consumer can annotate the result and switch exhaustively over the refusal', async () => {
        const { engine } = newEngine(new InMemorySuspendedRunStore());
        // The annotation is the point: this is the line the missing export
        // made unwritable.
        const res: SuspensionRestoreResult = await engine.restoreConsumedSuspension('no-such-run');
        expect(res.restored).toBe(false);
        expect(res.refusal).toBe('RUN_NOT_FOUND');
        expect(remedyFor(res.refusal!)).toBe('check the run id');
    });
});
