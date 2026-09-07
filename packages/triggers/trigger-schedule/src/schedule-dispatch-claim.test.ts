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
// The five pins the ruling names are exercised END TO END — the real
// `ScheduleTrigger`, the real `AutomationEngine` claim ledger, and the real
// `DbJobAdapter.replay` — because each of them is a statement about how those
// three compose, and a fake on either side of the seam would pin the fake.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutomationEngine, InMemoryFlowDispatchStore } from '@objectstack/service-automation';
import { DbJobAdapter } from '@objectstack/service-job';
import {
    ScheduleTrigger,
    computeTickWindow,
    scheduleDispatchKey,
    type FlowTriggerBinding,
    type JobServiceSurface,
    type ScheduleDispatchLedger,
    type TriggerLogger,
} from './schedule-trigger.js';

// ─── Harness ────────────────────────────────────────────────────────

const FLOW = 'nightly_digest';
const JOB = `flow-schedule:${FLOW}`;
const CRON: FlowTriggerBinding = {
    flowName: FLOW,
    schedule: { type: 'cron', expression: '0 1 * * *', timezone: 'UTC' },
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

/** Minimal ObjectQL slice for `DbJobAdapter`'s `sys_job` bookkeeping. */
function fakeJobEngine() {
    const rows = new Map<string, Record<string, unknown>>();
    return {
        async find() { return []; },
        async insert(_t: string, data: any) { rows.set(String(data.id ?? data.name), data); return data; },
        async update(_t: string, _id: any, _data?: any) { return {}; },
    };
}

const adapters: DbJobAdapter[] = [];

/** A real DbJobAdapter with no cron engine: nothing fires on its own, so every
 *  "tick" in these tests is an explicit, deterministic call. */
function realJobService() {
    const adapter = new DbJobAdapter({
        engine: fakeJobEngine() as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        options: { recordRuns: false },
    });
    adapters.push(adapter);
    return adapter;
}

/** The claim ledger, exactly as the automation service exposes it. */
function realLedger(store = new InMemoryFlowDispatchStore()) {
    const engine = new AutomationEngine({
        info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
        child: () => undefined,
    } as any);
    engine.setFlowDispatchStore(store);
    return { ledger: engine as unknown as ScheduleDispatchLedger, store, engine };
}

interface Rig {
    trigger: ScheduleTrigger;
    job: DbJobAdapter;
    ledger: ScheduleDispatchLedger;
    store: InMemoryFlowDispatchStore;
    runs: string[];
    /** Simulate one scheduled fire of the bound job. */
    tick: () => Promise<void>;
    warn: ReturnType<typeof vi.fn>;
    setNow: (d: Date) => void;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function rig(opts: {
    now?: Date;
    store?: InMemoryFlowDispatchStore;
    job?: JobServiceSurface & { trigger(name: string, data?: unknown): Promise<void> };
    throws?: boolean;
} = {}): Promise<Rig> {
    let now = opts.now ?? IN_WINDOW;
    const { ledger, store } = realLedger(opts.store);
    const job = (opts.job ?? realJobService()) as DbJobAdapter;
    const { logger, warn } = recordingLogger();
    const runs: string[] = [];

    const trigger = new ScheduleTrigger(() => job as unknown as JobServiceSurface, logger, () => ledger, () => now);
    trigger.start(CRON, async (ctx) => {
        runs.push(String((ctx.params as Record<string, unknown>)?.jobId ?? 'run'));
        if (opts.throws) throw new Error('digest render blew up');
    });
    await flush();

    return {
        trigger, job, ledger, store, runs, warn,
        setNow: (d: Date) => { now = d; },
        tick: async () => { await job.trigger(JOB); },
    };
}

afterEach(async () => {
    while (adapters.length) await adapters.pop()!.destroy();
});

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

describe('PIN: replay() on a succeeded window refuses with the ADR-0112 envelope', () => {
    it('rejects with RESOURCE_CONFLICT / 409 naming the window and the claim', async () => {
        const r = await rig();
        await r.tick();
        expect(r.runs).toHaveLength(1);

        // The consumer assertion the contract prescribes is on `code` and
        // `status` — never on `toThrow()` alone, which a bare Error passes.
        const err = await r.job.replay(JOB).then(
            () => { throw new Error('replay resolved — the refusal did not fire'); },
            (e: any) => e,
        );
        expect(err.code).toBe('RESOURCE_CONFLICT');
        expect(err.status).toBe(409);
        expect(err.message).toContain("cron '0 1 * * *' window starting 2026-09-07T01:00:00.000Z");
        expect(err.message).toMatch(/claimed at /);

        // Refused means REFUSED: the flow did not run a second time.
        expect(r.runs).toHaveLength(1);
    });

    it('the refusal REJECTS rather than resolving having done nothing', async () => {
        const r = await rig();
        await r.tick();
        await expect(r.job.replay(JOB)).rejects.toThrow(/already delivered/);
    });
});

describe('PIN: replay(name, data, { force: true }) sends', () => {
    it('re-runs the delivered window and the duplicate is the operator\'s', async () => {
        const r = await rig();
        await r.tick();
        expect(r.runs).toHaveLength(1);

        await expect(r.job.replay(JOB, undefined, { force: true })).resolves.toBeUndefined();
        expect(r.runs).toHaveLength(2);

        // The window is still recorded delivered, so an UNFORCED replay after a
        // forced one is refused exactly as before.
        await expect(r.job.replay(JOB)).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
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

        await expect(r.job.replay(JOB)).resolves.toBeUndefined();
        expect(r.runs).toHaveLength(2);
    });

    it('an UNSETTLED claim — the process died mid-launch — reads as not delivered and replays too', async () => {
        const store = new InMemoryFlowDispatchStore();
        const key = scheduleDispatchKey(FLOW, computeTickWindow(CRON.schedule as any, IN_WINDOW)!);
        // A claim taken by a process that never came back to settle it.
        await store.claim(key);

        const r = await rig({ store });
        await expect(r.job.replay(JOB)).resolves.toBeUndefined();
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
        const job = realJobService();
        const runs: string[] = [];
        const trigger = new ScheduleTrigger(
            () => job as unknown as JobServiceSurface, logger, () => hostile, () => IN_WINDOW,
        );
        trigger.start(CRON, async () => { runs.push('r'); });
        await flush();

        await expect(job.trigger(JOB)).resolves.toBeUndefined();
        expect(runs).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not record dispatch outcome'));
    });
});

// ─── Declared degradations ──────────────────────────────────────────

describe('declared degradations', () => {
    it('no ledger at all: every tick fires, and the lost guarantee is said exactly once', async () => {
        const job = realJobService();
        const { logger, warn } = recordingLogger();
        const runs: string[] = [];
        const trigger = new ScheduleTrigger(
            () => job as unknown as JobServiceSurface, logger, () => null, () => IN_WINDOW,
        );
        trigger.start(CRON, async () => { runs.push('r'); });
        await flush();

        await job.trigger(JOB);
        await job.trigger(JOB);
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
        const job = realJobService();
        const { logger, warn } = recordingLogger();
        const runs: string[] = [];
        const trigger = new ScheduleTrigger(
            () => job as unknown as JobServiceSurface, logger, () => hostile, () => IN_WINDOW,
        );
        trigger.start(CRON, async () => { runs.push('r'); });
        await flush();

        await job.trigger(JOB);
        await job.trigger(JOB);
        expect(runs).toHaveLength(2);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('dispatching anyway'));
    });

    it('a job with NO guard registered replays exactly as it always did', async () => {
        const job = realJobService();
        const runs: string[] = [];
        await job.schedule('plain_job', { type: 'interval', intervalMs: 3_600_000 }, async () => {
            runs.push('r');
        });
        await expect(job.replay('plain_job')).resolves.toBeUndefined();
        await expect(job.replay('plain_job')).resolves.toBeUndefined();
        expect(runs).toHaveLength(2);
    });

    it('stop() withdraws the replay guard, so a re-registered job is not judged by a dead one', async () => {
        const r = await rig();
        await r.tick();
        await expect(r.job.replay(JOB)).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });

        r.trigger.stop(FLOW);
        await flush();
        // The job is cancelled too, so replay can no longer find it — the point
        // is that it is NOT the stale conflict.
        await expect(r.job.replay(JOB)).rejects.toThrow(/not found/);
    });
});
