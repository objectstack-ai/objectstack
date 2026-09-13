// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14501 — once-per-(flow, tick-window) delivery for SCHEDULED (cron) flows,
// the behaviour half of the maintainer's A + a2 ruling (decision batch #13).
// The contract half landed in `packages/spec` via #14766 and is the
// specification these pins are written against: `IJobService.replay`'s TSDoc
// decision table (claim absent/failed → re-run; claim succeeded → ADR-0112
// RESOURCE_CONFLICT / 409 naming the window and the claim; `{ force: true }` →
// send anyway).
//
// The pins run against the real `ScheduleTrigger` and the real
// `AutomationEngine` claim ledger. The seam to the job service — the
// `ReplayGuard` this trigger registers — is exercised by CALLING the guard the
// trigger actually installed, and then observing what the next fire does with
// the pass it left behind. ⛔ Not by importing `DbJobAdapter`: this package's
// entry in `scripts/check-test-source-alias.mjs` is shrink-only, its tsconfig
// pins `rootDir: ./src` so the `paths` route reports TS6059 for the
// dependency's whole file graph, and the gate's own instruction for that case
// is to reach the subject through in-package source instead. The other side of
// this seam — the ADR-0112 refusal, the `force` door, and what a guard verdict
// does to `replay()` — is pinned in
// `packages/services/service-job/src/db-job-adapter.replay-guard.test.ts`,
// where `DbJobAdapter` IS in-package source.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine, InMemoryFlowDispatchStore } from '@objectstack/service-automation';
import {
    ScheduleTrigger,
    computeTickWindow,
    scheduleDispatchKey,
    type FlowTriggerBinding,
    type JobServiceSurface,
    type ReplayGuard,
    type ScheduleDispatchLedger,
    type TriggerLogger,
} from './schedule-trigger.js';

// ─── Harness ────────────────────────────────────────────────────────

const FLOW = 'nightly_digest';
const JOB = `flow-schedule:${FLOW}`;
const CRON: FlowTriggerBinding = {
    flowName: FLOW,
    schedule: { type: 'cron', expression: '0 1 * * *', timezone: 'UTC' },
    // [#16659] the acting organization every tick of this flow runs as.
    organization: 'org_2mtx1w9d0k4bqf7v',
};

/** Inside the 2026-09-07T01:00Z window of `0 1 * * *`. */
const IN_WINDOW = new Date('2026-09-07T09:41:30Z');
/** Inside the NEXT window. */
const NEXT_WINDOW = new Date('2026-09-08T02:00:00Z');

function recordingLogger() {
    const warn = vi.fn();
    const logger: TriggerLogger = { info: () => {}, warn, debug: () => {}, error: () => {} };
    return { logger, warn };
}

/**
 * A job service that records what the trigger registers and fires it on
 * demand — the same slice `DbJobAdapter` exposes, with no timers, so every
 * "tick" in these tests is an explicit, deterministic call.
 */
function captureJobService() {
    const jobs = new Map<string, JobHandlerLike>();
    const guards = new Map<string, ReplayGuard | null>();
    const service: JobServiceSurface = {
        async schedule(name, _schedule, handler) { jobs.set(name, handler as JobHandlerLike); },
        async cancel(name) { jobs.delete(name); },
        setReplayGuard(name, guard) { guards.set(name, guard); },
    };
    return {
        service,
        jobs,
        guards,
        guard: () => guards.get(JOB) ?? null,
        fire: (jobId = 'j1') => jobs.get(JOB)!({ jobId }),
        /** What `DbJobAdapter.replay()` does with a guard, in miniature: ask,
         *  refuse on `allow: false`, otherwise run. The envelope itself is
         *  pinned on the adapter, not here. */
        async replay(force = false) {
            const guard = guards.get(JOB);
            if (guard) {
                const decision = await guard({ force });
                if (decision.allow === false) {
                    const err = new Error(`refused: ${decision.window}`) as Error & { window?: string; claimedAt?: string | null };
                    err.window = decision.window;
                    err.claimedAt = decision.claimedAt;
                    throw err;
                }
            }
            await jobs.get(JOB)!({ jobId: 'replay' });
        },
    };
}

type JobHandlerLike = (ctx: { jobId: string }) => Promise<void>;

/** The claim ledger, exactly as the automation service exposes it. */
function realLedger(store = new InMemoryFlowDispatchStore()) {
    const engine = new AutomationEngine({
        info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
        child: () => undefined,
    } as any);
    engine.setFlowDispatchStore(store);
    return { ledger: engine as unknown as ScheduleDispatchLedger, store, engine };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function rig(opts: { now?: Date; store?: InMemoryFlowDispatchStore; throws?: boolean } = {}) {
    let now = opts.now ?? IN_WINDOW;
    const { ledger, store } = realLedger(opts.store);
    const job = captureJobService();
    const { logger, warn } = recordingLogger();
    const runs: string[] = [];

    const trigger = new ScheduleTrigger(() => job.service, logger, () => ledger, () => now);
    trigger.start(CRON, async (ctx) => {
        runs.push(String((ctx.params as Record<string, unknown>)?.jobId ?? 'run'));
        if (opts.throws) throw new Error('digest render blew up');
    });
    await flush();

    return {
        trigger, job, ledger, store, runs, warn,
        setNow: (d: Date) => { now = d; },
        tick: () => job.fire(),
        replayThroughGuard: (force = false) => job.replay(force),
    };
}

// ─── The window key ─────────────────────────────────────────────────

describe('computeTickWindow — one notion of "window", derived from the schedule itself', () => {
    it('cron: every instant inside one occurrence maps to the same window start', () => {
        const schedule = { type: 'cron' as const, expression: '0 1 * * *', timezone: 'UTC' };
        const atFire = computeTickWindow(schedule, new Date('2026-09-07T01:00:00.000Z'));
        const later = computeTickWindow(schedule, new Date('2026-09-07T23:59:59.999Z'));
        expect(atFire?.startedAt).toBe('2026-09-07T01:00:00.000Z');
        expect(later?.startedAt).toBe('2026-09-07T01:00:00.000Z');
        // One millisecond BEFORE the fire is still the previous window.
        expect(computeTickWindow(schedule, new Date('2026-09-07T00:59:59.999Z'))?.startedAt).toBe(
            '2026-09-06T01:00:00.000Z',
        );
    });

    it('cron: the window is computed in the job\'s own timezone, so a DST shift moves fire and window together', () => {
        // 02:30 America/New_York — the US spring-forward morning. The window
        // key is whatever croner says the previous occurrence was, in that
        // zone, which is by construction the same instant the adapter fired.
        const schedule = { type: 'cron' as const, expression: '30 2 * * *', timezone: 'America/New_York' };
        const w = computeTickWindow(schedule, new Date('2026-03-08T12:00:00Z'));
        expect(w?.startedAt).toEqual(expect.any(String));
        // Same reference, same answer — the property that makes tick and
        // replay agree is determinism, not any particular wall-clock hour.
        expect(computeTickWindow(schedule, new Date('2026-03-08T12:00:00Z'))?.startedAt).toBe(w?.startedAt);
    });

    it('interval: epoch-anchored buckets, so a restart does not move the window', () => {
        const schedule = { type: 'interval' as const, intervalMs: 60_000 };
        expect(computeTickWindow(schedule, new Date(180_000))?.startedAt).toBe(
            new Date(180_000).toISOString(),
        );
        expect(computeTickWindow(schedule, new Date(239_999))?.startedAt).toBe(
            new Date(180_000).toISOString(),
        );
        expect(computeTickWindow(schedule, new Date(240_000))?.startedAt).toBe(
            new Date(240_000).toISOString(),
        );
    });

    it('once: a single window, whatever the clock says', () => {
        const schedule = { type: 'once' as const, at: '2026-01-01T00:00:00.000Z' };
        expect(computeTickWindow(schedule, new Date('2025-01-01T00:00:00Z'))?.startedAt).toBe(
            '2026-01-01T00:00:00.000Z',
        );
        expect(computeTickWindow(schedule, new Date('2030-01-01T00:00:00Z'))?.startedAt).toBe(
            '2026-01-01T00:00:00.000Z',
        );
    });

    it('an unusable descriptor yields no window (and therefore no claim)', () => {
        expect(computeTickWindow({ type: 'cron' } as any, IN_WINDOW)).toBeNull();
        expect(computeTickWindow({ type: 'cron', expression: 'not a cron' } as any, IN_WINDOW)).toBeNull();
        expect(computeTickWindow({ type: 'interval', intervalMs: 0 } as any, IN_WINDOW)).toBeNull();
        expect(computeTickWindow({ type: 'once', at: 'nonsense' } as any, IN_WINDOW)).toBeNull();
    });

    it('the key is namespaced so it can never collide with a time-relative key', () => {
        const w = computeTickWindow(CRON.schedule as any, IN_WINDOW)!;
        expect(scheduleDispatchKey(FLOW, w)).toBe(`schedule:${FLOW}:2026-09-07T01:00:00.000Z`);
    });
});

// ─── PIN 1 — a second tick in the same window is a no-op ────────────

describe('PIN: a second tick in the same window is a no-op with a claim hit', () => {
    it('fires once per window, and again in the next one', async () => {
        const r = await rig();
        await r.tick();
        await r.tick();
        await r.tick();
        expect(r.runs).toHaveLength(1);

        r.setNow(NEXT_WINDOW);
        await r.tick();
        expect(r.runs).toHaveLength(2);
    });

    it('a RESTART inside the window is the same case — the key is a pure function of schedule and clock', async () => {
        const store = new InMemoryFlowDispatchStore();
        const first = await rig({ store });
        await first.tick();
        expect(first.runs).toHaveLength(1);

        // A rebuilt kernel: brand-new trigger, engine and job adapter over the
        // one surviving ledger.
        const second = await rig({ store });
        await second.tick();
        expect(second.runs).toHaveLength(0);
    });

    it('the claim it left behind records SUCCESS', async () => {
        const r = await rig();
        await r.tick();
        const key = scheduleDispatchKey(FLOW, computeTickWindow(CRON.schedule as any, IN_WINDOW)!);
        await expect(r.store.read(key)).resolves.toMatchObject({ outcome: 'succeeded' });
    });
});

// ─── PIN 2/3 — replay refuses a delivered window unless forced ──────

describe('PIN: replay() on a succeeded window is REFUSED by the guard the trigger registers', () => {
    it('the guard answers allow:false and names the window and the claim', async () => {
        const r = await rig();
        await r.tick();
        expect(r.runs).toHaveLength(1);

        const decision = await r.job.guard()!({ force: false });
        expect(decision.allow).toBe(false);
        if (decision.allow === false) {
            expect(decision.window).toBe("cron '0 1 * * *' window starting 2026-09-07T01:00:00.000Z");
            expect(decision.claimedAt).toEqual(expect.any(String));
        }
    });

    it('a job service that honours the verdict does not deliver the window again', async () => {
        const r = await rig();
        await r.tick();
        await expect(r.replayThroughGuard()).rejects.toThrow(/refused: cron '0 1 \* \* \*' window/);
        expect(r.runs).toHaveLength(1);
    });
});

describe('PIN: a FORCED replay sends', () => {
    it('the guard allows it, and the fire it authorises actually re-runs the delivered window', async () => {
        const r = await rig();
        await r.tick();
        expect(r.runs).toHaveLength(1);

        await expect(r.replayThroughGuard(true)).resolves.toBeUndefined();
        expect(r.runs).toHaveLength(2);

        // The window is still recorded delivered, so an UNFORCED replay after a
        // forced one is refused exactly as before.
        await expect(r.replayThroughGuard()).rejects.toThrow(/refused:/);
    });

    it('force never consults the ledger at all — a read outage cannot block the operator door', async () => {
        const store = new InMemoryFlowDispatchStore();
        let reads = 0;
        const counting: ScheduleDispatchLedger = {
            claim: (k) => store.claim(k),
            settleDispatch: (k, o) => store.settle(k, o),
            async readDispatch(k) { reads++; return store.read(k); },
        };
        const job = captureJobService();
        const { logger } = recordingLogger();
        const runs: string[] = [];
        const trigger = new ScheduleTrigger(() => job.service, logger, () => counting, () => IN_WINDOW);
        trigger.start(CRON, async () => { runs.push('r'); });
        await flush();

        await job.fire();
        const before = reads;
        await job.guard()!({ force: true });
        expect(reads).toBe(before);
    });
});

// ─── PIN 4/5 — a throwing run, and the ticker that survives it ──────

describe('PIN: a throwing run leaves a FAILED claim that a plain replay() re-runs', () => {
    it('records the throw on the claim instead of leaving the run indistinguishable from a delivered one', async () => {
        const r = await rig({ throws: true });
        await r.tick();

        const key = scheduleDispatchKey(FLOW, computeTickWindow(CRON.schedule as any, IN_WINDOW)!);
        await expect(r.store.read(key)).resolves.toMatchObject({ outcome: 'failed' });
    });

    it('a plain replay() of that window re-runs it — no force needed, no refusal', async () => {
        const r = await rig({ throws: true });
        await r.tick();
        expect(r.runs).toHaveLength(1);

        await expect(r.replayThroughGuard()).resolves.toBeUndefined();
        expect(r.runs).toHaveLength(2);
    });

    it('and the REPAIRED window is then refused: failed -> plain replay() -> succeeded -> next unforced replay refused', async () => {
        // The full repair round-trip the contract review asked to be pinned.
        // Its second half is what makes `failed -> succeeded` a REQUIRED
        // transition rather than a tolerated one.
        const store = new InMemoryFlowDispatchStore();
        const key = scheduleDispatchKey(FLOW, computeTickWindow(CRON.schedule as any, IN_WINDOW)!);

        const bad = await rig({ store, throws: true });
        await bad.tick();
        await expect(store.read(key)).resolves.toMatchObject({ outcome: 'failed' });

        // A fresh binding over the same ledger, this time with a flow that works.
        const good = await rig({ store });
        await expect(good.replayThroughGuard()).resolves.toBeUndefined();
        expect(good.runs).toHaveLength(1);
        await expect(store.read(key)).resolves.toMatchObject({ outcome: 'succeeded' });

        await expect(good.replayThroughGuard()).rejects.toThrow(/refused:/);
        expect(good.runs).toHaveLength(1);
    });

    it('a FORCED replay that throws leaves the window recorded delivered — it must not reopen the unforced door', async () => {
        const store = new InMemoryFlowDispatchStore();
        const key = scheduleDispatchKey(FLOW, computeTickWindow(CRON.schedule as any, IN_WINDOW)!);

        const good = await rig({ store });
        await good.tick();
        await expect(store.read(key)).resolves.toMatchObject({ outcome: 'succeeded' });

        // The operator forces a re-send and the flow blows up this time.
        const bad = await rig({ store, throws: true });
        await expect(bad.replayThroughGuard(true)).resolves.toBeUndefined();
        expect(bad.runs).toHaveLength(1);

        // The claim still says delivered, so an UNFORCED replay is still refused.
        await expect(store.read(key)).resolves.toMatchObject({ outcome: 'succeeded' });
        await expect(bad.replayThroughGuard()).rejects.toThrow(/refused:/);
    });

    it('an UNSETTLED claim — the process died mid-launch — reads as not delivered and replays too', async () => {
        const store = new InMemoryFlowDispatchStore();
        const key = scheduleDispatchKey(FLOW, computeTickWindow(CRON.schedule as any, IN_WINDOW)!);
        // A claim taken by a process that never came back to settle it.
        await store.claim(key);

        const r = await rig({ store });
        await expect(r.replayThroughGuard()).resolves.toBeUndefined();
        expect(r.runs).toHaveLength(1);
    });
});

describe('PIN: the ticker survives the throw — the error isolation must NOT regress', () => {
    // ⚠ These assert on the handler the trigger REGISTERS, not on a fire routed
    // through `DbJobAdapter.trigger()`. Measured on `origin/main`: the adapter
    // chain swallows too — `IntervalJobAdapter.executeJob` catches every handler
    // rejection and records it as a `failed` execution — so a fire driven
    // through the adapter resolves whether or not the trigger's own catch
    // exists, and a pin written that way would be green against a trigger that
    // rethrows. The property the ruling protects is the trigger's, so it is
    // pinned where it lives.
    function bareJobService() {
        const jobs = new Map<string, (c: { jobId: string }) => Promise<void>>();
        const service: JobServiceSurface = {
            async schedule(name, _s, handler) { jobs.set(name, handler as any); },
            async cancel(name) { jobs.delete(name); },
            setReplayGuard() { /* not exercised here */ },
        };
        return { service, fire: (id = 'j1') => jobs.get(JOB)!({ jobId: id }) };
    }

    async function throwingRig(now: Date, store = new InMemoryFlowDispatchStore()) {
        const { ledger } = realLedger(store);
        const { logger, warn } = recordingLogger();
        const bare = bareJobService();
        const runs: string[] = [];
        let clock = now;
        const trigger = new ScheduleTrigger(() => bare.service, logger, () => ledger, () => clock);
        trigger.start(CRON, async () => { runs.push('r'); throw new Error('digest render blew up'); });
        await flush();
        return { fire: bare.fire, runs, warn, setNow: (d: Date) => { clock = d; } };
    }

    it('a throwing flow never rejects out of the handler the trigger registered', async () => {
        const r = await throwingRig(IN_WINDOW);
        await expect(r.fire()).resolves.toBeUndefined();
        expect(r.warn).toHaveBeenCalledWith(expect.stringContaining('execution failed: digest render blew up'));
    });

    it('and the next window still fires — one bad run does not stop the schedule', async () => {
        const r = await throwingRig(IN_WINDOW);
        await expect(r.fire()).resolves.toBeUndefined();
        r.setNow(NEXT_WINDOW);
        await expect(r.fire()).resolves.toBeUndefined();
        expect(r.runs).toHaveLength(2);
    });

    it('a settle that THROWS still does not break the ticker', async () => {
        const store = new InMemoryFlowDispatchStore();
        const hostile: ScheduleDispatchLedger = {
            claim: (k) => store.claim(k),
            async settleDispatch() { throw new Error('ledger unreachable'); },
            async readDispatch() { return null; },
        };
        const { logger, warn } = recordingLogger();
        const job = captureJobService();
        const runs: string[] = [];
        const trigger = new ScheduleTrigger(() => job.service, logger, () => hostile, () => IN_WINDOW);
        trigger.start(CRON, async () => { runs.push('r'); });
        await flush();

        await expect(job.fire()).resolves.toBeUndefined();
        expect(runs).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not record dispatch outcome'));
    });
});

// ─── Declared degradations ──────────────────────────────────────────

describe('declared degradations', () => {
    it('no ledger at all: every tick fires, and the lost guarantee is said exactly once', async () => {
        const job = captureJobService();
        const { logger, warn } = recordingLogger();
        const runs: string[] = [];
        const trigger = new ScheduleTrigger(() => job.service, logger, () => null, () => IN_WINDOW);
        trigger.start(CRON, async () => { runs.push('r'); });
        await flush();

        await job.fire();
        await job.fire();
        expect(runs).toHaveLength(2);
        const said = warn.mock.calls.filter(
            (c) => typeof c[0] === 'string' && c[0].includes('NOT deduplicated'),
        );
        expect(said).toHaveLength(1);
    });

    it('a job service with no setReplayGuard keeps ticking correctly and says the refusal is unavailable', async () => {
        const jobs = new Map<string, { handler: (c: { jobId: string }) => Promise<void> }>();
        const bare: JobServiceSurface = {
            async schedule(name, _s, handler) { jobs.set(name, { handler: handler as any }); },
            async cancel(name) { jobs.delete(name); },
        };
        const { ledger } = realLedger();
        const { logger, warn } = recordingLogger();
        const runs: string[] = [];
        const trigger = new ScheduleTrigger(() => bare, logger, () => ledger, () => IN_WINDOW);
        trigger.start(CRON, async () => { runs.push('r'); });
        await flush();

        await jobs.get(JOB)!.handler({ jobId: 'j1' });
        await jobs.get(JOB)!.handler({ jobId: 'j2' });
        expect(runs).toHaveLength(1); // ticks are unaffected

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('no replay guard registration'),
        );
    });

    it('a claim that THROWS dispatches anyway — availability over strict-once', async () => {
        const hostile: ScheduleDispatchLedger = {
            async claim() { throw new Error('ledger unreachable'); },
        };
        const job = captureJobService();
        const { logger, warn } = recordingLogger();
        const runs: string[] = [];
        const trigger = new ScheduleTrigger(() => job.service, logger, () => hostile, () => IN_WINDOW);
        trigger.start(CRON, async () => { runs.push('r'); });
        await flush();

        await job.fire();
        await job.fire();
        expect(runs).toHaveLength(2);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('dispatching anyway'));
    });

    it('stop() withdraws the replay guard, so a re-registered job is not judged by a dead one', async () => {
        const r = await rig();
        await r.tick();
        expect(await r.job.guard()!({ force: false })).toMatchObject({ allow: false });

        r.trigger.stop(FLOW);
        await flush();
        expect(r.job.guard()).toBeNull();
    });
});
