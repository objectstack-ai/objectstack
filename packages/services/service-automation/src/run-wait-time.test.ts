// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #32284 — a run record says how much of its `durationMs` was WAITING.
 *
 * On the QA run a resumed screen flow reported `durationMs: 18691`, almost all
 * of it the user's wait, and nothing on the record told an admin that. The
 * maintainer's ruling (option A, comment 6879411530) adds one optional member,
 * `ExecutionLog.waitMs`, and keeps `durationMs` the total wall time, so the
 * time a run spent executing is `durationMs - waitMs`.
 *
 * What is pinned here, with the clock driven by hand (`vi.setSystemTime`,
 * Date only — the engine's own `setTimeout`s keep running): every "work" node
 * moves the clock by its own cost, and the test moves it between a pause and
 * its resume, so each expected number is exact rather than a tolerance.
 *
 *  1. A run that never paused carries `waitMs: 0` — measured, not absent.
 *  2. One pause: the record's `waitMs` is the time between the pause and the
 *     resume, and `durationMs - waitMs` is the time the nodes took.
 *  3. Two pauses SUM, across two simulated restarts (three engines over one
 *     store), and each `paused` entry carries the wait up to its own moment.
 *  4. A paused run cancelled where it waits: everything since the pause is
 *     wait.
 *  5. The restore path: a resume that consumed the pause and then failed, an
 *     operator restore, and a later resume — the run's active time is the
 *     work its record shows, and the failed attempt plus the stranded time
 *     are wait, like the rest of the pause the restore re-armed.
 *  6. A suspension that carries no clock (one parked before this release)
 *     resumes with `waitMs` NOT RECORDED — absent, never a guessed `0`.
 *
 * Every record is parsed through `ExecutionLogSchema`, so a member the spec
 * did not declare would be stripped and the assertion would go red.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineActionDescriptor, ExecutionLogSchema } from '@objectstack/spec/automation';
import { AutomationEngine, type NodeExecutor } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';

const silent = {
    info() {}, warn() {}, error() {}, debug() {},
    child() { return silent; },
} as never;

const T0 = Date.parse('2026-11-14T09:00:00.000Z');

/** Move the (Date-only) fake clock forward by `ms`. */
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

const pauser: NodeExecutor = {
    type: 'wait_for_user',
    descriptor: defineActionDescriptor({
        type: 'wait_for_user', version: '1.0.0', name: 'wait_for_user',
        supportsPause: true, resumeAuthority: 'any',
    }),
    async execute(node) {
        return { success: true, suspend: true, correlation: `screen:${node.id}` };
    },
};

/** A node whose execution costs `config.costMs` of wall time. */
const work: NodeExecutor = {
    type: 'work',
    async execute(node) {
        advance(Number((node.config as { costMs?: number } | undefined)?.costMs ?? 0));
        return { success: true };
    },
};

/** Fails on its first execution and succeeds after — the strand-then-restore shape. */
function flaky(): NodeExecutor {
    let calls = 0;
    return {
        type: 'flaky_work',
        async execute() {
            advance(20);
            calls += 1;
            if (calls === 1) return { success: false, error: 'downstream row was locked' };
            return { success: true };
        },
    };
}

type Step = { id: string; type: string; costMs?: number };

/** A straight line start → …steps → end. */
function line(name: string, steps: Step[]) {
    const nodes = [
        { id: 'start', type: 'start', label: 'Start' },
        ...steps.map((s) => ({
            id: s.id, type: s.type, label: s.id,
            ...(s.costMs === undefined ? {} : { config: { costMs: s.costMs } }),
        })),
        { id: 'end', type: 'end', label: 'End' },
    ];
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id }));
    return { name, label: name, type: 'autolaunched', nodes, edges };
}

/** start → work(100) → ask (pause) → work(40) → confirm (pause) → work(7) → end */
const TWO_SCREENS = line('two_screens', [
    { id: 'prepare', type: 'work', costMs: 100 },
    { id: 'ask', type: 'wait_for_user' },
    { id: 'apply', type: 'work', costMs: 40 },
    { id: 'confirm', type: 'wait_for_user' },
    { id: 'finish', type: 'work', costMs: 7 },
]);

function engineOver(store?: InMemorySuspendedRunStore, ...extra: NodeExecutor[]): AutomationEngine {
    const engine = new AutomationEngine(silent, store);
    for (const executor of [pauser, work, ...extra]) engine.registerNodeExecutor(executor);
    engine.registerFlow('two_screens', TWO_SCREENS as never);
    engine.registerFlow('one_screen', line('one_screen', [
        { id: 'prepare', type: 'work', costMs: 100 },
        { id: 'ask', type: 'wait_for_user' },
        { id: 'apply', type: 'work', costMs: 40 },
    ]) as never);
    engine.registerFlow('no_screen', line('no_screen', [{ id: 'prepare', type: 'work', costMs: 100 }]) as never);
    engine.registerFlow('screen_then_flaky', line('screen_then_flaky', [
        { id: 'prepare', type: 'work', costMs: 100 },
        { id: 'ask', type: 'wait_for_user' },
        { id: 'write_back', type: 'flaky_work' },
    ]) as never);
    return engine;
}

/** The run as `GET …/runs/:runId` serves it, through the published schema. */
async function record(engine: AutomationEngine, runId: string) {
    const run = await engine.getRun(runId);
    expect(run, `run '${runId}' is recorded`).not.toBeNull();
    return ExecutionLogSchema.parse(run);
}

describe('#32284 — ExecutionLog.waitMs: the part of durationMs a run spent suspended', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(T0);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('a run that never paused carries waitMs: 0 — a measured zero, not an absent field', async () => {
        const engine = engineOver();
        const res = await engine.execute('no_screen');
        expect(res.success).toBe(true);

        const run = await record(engine, (await engine.listRuns('no_screen'))[0].id);
        expect(run.status).toBe('completed');
        expect(run.durationMs).toBe(100);
        expect(run.waitMs).toBe(0);
    });

    it('one pause: waitMs is the time between the pause and its resume, and durationMs - waitMs is the work', async () => {
        const engine = engineOver();
        const paused = await engine.execute('one_screen');
        expect(paused.status).toBe('paused');
        const runId = paused.runId!;

        // The paused entry: the run's first pause, so nothing has waited yet.
        const atPause = await record(engine, runId);
        expect(atPause.status).toBe('paused');
        expect(atPause.durationMs).toBe(100);
        expect(atPause.waitMs).toBe(0);

        advance(18_500); // the user fills the screen in
        const done = await engine.resume(runId);
        expect(done.success).toBe(true);

        const run = await record(engine, runId);
        expect(run.status).toBe('completed');
        expect(run.durationMs).toBe(18_640);
        expect(run.waitMs).toBe(18_500);
        expect(run.durationMs! - run.waitMs!).toBe(140); // prepare 100 + apply 40
    });

    it('two pauses SUM, across two restarts, and each paused entry carries the wait up to its own moment', async () => {
        const store = new InMemorySuspendedRunStore();

        const first = await engineOver(store).execute('two_screens');
        expect(first.status).toBe('paused');
        const runId = first.runId!;

        advance(5_000);
        // A fresh engine over the same store — the process restarted while the
        // run waited, so the clock must come back from the store, not memory.
        const second = engineOver(store);
        const repaused = await second.resume(runId);
        expect(repaused.status).toBe('paused');
        const atSecondPause = await record(second, runId);
        expect(atSecondPause.durationMs).toBe(5_140);
        expect(atSecondPause.waitMs).toBe(5_000);

        advance(30_000);
        const third = engineOver(store);
        const done = await third.resume(runId);
        expect(done.success).toBe(true);

        const run = await record(third, runId);
        expect(run.status).toBe('completed');
        expect(run.waitMs).toBe(35_000); // 5 s + 30 s, not the last pause alone
        expect(run.durationMs).toBe(35_147);
        expect(run.durationMs! - run.waitMs!).toBe(147); // 100 + 40 + 7
        // The durable terminal record says the same, for a reader after a restart.
        expect((await store.loadTerminal(runId))?.waitMs).toBe(35_000);
    });

    it('a paused run cancelled where it waits: everything since the pause is wait', async () => {
        const engine = engineOver();
        const paused = await engine.execute('one_screen');
        advance(2_000);
        expect(await engine.cancelRun(paused.runId!, 'nobody answered')).toBe(true);

        const run = await record(engine, paused.runId!);
        expect(run.status).toBe('cancelled');
        expect(run.durationMs).toBe(2_100);
        expect(run.waitMs).toBe(2_000);
    });

    it('the restore path: the re-armed pause keeps its clock, so the run\'s active time is the work its record shows', async () => {
        const engine = engineOver(undefined, flaky());
        const paused = await engine.execute('screen_then_flaky');
        const runId = paused.runId!;

        advance(1_000);
        const stranded = await engine.resume(runId);
        expect(stranded.status).toBe('stranded');
        const failed = await record(engine, runId);
        expect(failed.status).toBe('failed');
        expect(failed.durationMs).toBe(1_120);
        expect(failed.waitMs).toBe(1_000); // the pause it consumed; the failed write is work

        advance(500);
        const restored = await engine.restoreConsumedSuspension(runId, { requestedBy: 'ops', reason: 'row unlocked' });
        expect(restored.restored).toBe(true);
        const reArmed = await record(engine, runId);
        expect(reArmed.status).toBe('paused');
        expect(reArmed.durationMs).toBe(1_620);
        expect(reArmed.waitMs).toBe(1_520); // all but the 100 ms it executed before the pause

        advance(2_000);
        const done = await engine.resume(runId);
        expect(done.success).toBe(true);
        const run = await record(engine, runId);
        expect(run.status).toBe('completed');
        expect(run.durationMs).toBe(3_640);
        expect(run.waitMs).toBe(3_520);
        expect(run.durationMs! - run.waitMs!).toBe(120); // prepare 100 + the write that landed 20
    });

    it('a suspension that carries no clock resumes with waitMs NOT RECORDED — absent, never a guessed 0', async () => {
        const store = new InMemorySuspendedRunStore();
        const paused = await engineOver(store).execute('one_screen');
        const runId = paused.runId!;
        // A pause parked before this release: the same row, without the clock.
        const parked = await store.load(runId);
        expect(parked?.activeMs).toBe(100); // control: a pause recorded today HAS one
        const { activeMs: _dropped, ...legacy } = parked!;
        await store.save(legacy);

        advance(4_000);
        const resumer = engineOver(store);
        expect((await resumer.resume(runId)).success).toBe(true);
        const run = await record(resumer, runId);
        expect(run.status).toBe('completed');
        expect(run.durationMs).toBe(4_140);
        expect(run.waitMs).toBeUndefined();
    });
});
