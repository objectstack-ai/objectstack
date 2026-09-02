// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14256 — a DECLARATIVE job's `JobRunOutcome` must reach the adapter that
 * records it.
 *
 * ## What was measured before the fix
 *
 * `AppPlugin`'s declarative-job registration block handed `IJobService.schedule`
 * a block-bodied arrow that *awaited* the bundle handler and returned nothing,
 * so the wrapper was a `Promise<void>` whatever the handler resolved. The
 * reporter's probe, driven through an `IJobService` typed only at the contract:
 *
 * ```
 * HANDLER RESOLVED: {"outcome":"degraded","reason":"STORE_UNAVAILABLE"}
 * WRAPPER RESOLVED: undefined
 * ```
 *
 * #6617's third outcome was therefore unreachable from `defineJob`: a job that
 * ran to completion while its work did not happen (store unavailable, zero rows
 * matched) was recorded as `success`, with `reason` dropped. The imperative
 * route — a handler registered straight on `IJobService.schedule` — was
 * unaffected the whole time, which is exactly what localises the defect to this
 * wrapper.
 *
 * ## What these cases assert, and why it is not the wrapper's return value
 *
 * The deliverable named on the card is **the value that lands in the row**:
 * `sys_job_run.status` distinct from `success`, driven through `DbJobAdapter`,
 * the adapter that records it. A case asserting only that the wrapper returns
 * what the handler returned re-states the one-expression repair; the
 * consequence — what gets RECORDED — is what
 * `content/docs/automation/jobs.mdx`'s three-outcome table promises a
 * declarative author and what the declarative door did not deliver. So the
 * primary assertions read the persisted cell, and the wrapper's own resolved
 * value is pinned only as the corroborating middle term.
 *
 * ## The rig: a real engine, real `sys_job*` declarations, the real adapter
 *
 * `DbJobAdapter` writes `sys_job` / `sys_job_run` through ObjectQL, and
 * `sys_job_run.status` is an *enforced* `Field.select` whose vocabulary carries
 * `degraded` (#7072). Driving the real engine over the migrated sqlite
 * `:memory:` backend (#5704) therefore proves two things a recording double
 * cannot: the status the adapter writes is a value the record validator
 * accepts, and it is the value a reader of the row gets back. Nothing here is
 * about any one driver's behaviour, and this file is not on
 * `scripts/driver-memory-census.ledger.json` — ⛔ do not "simplify" it onto
 * `@objectstack/driver-memory` (#6664).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { IJobService, JobHandler, JobRunOutcome, JobSchedule } from '@objectstack/spec/contracts';
import { defineJob } from '@objectstack/spec/system';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DbJobAdapter } from '@objectstack/service-job';
import { SysJob, SysJobRun } from '@objectstack/platform-objects/audit';
import { AppPlugin } from './app-plugin.js';
import type { JobHandlerContext } from './job-handler-context.js';
import {
    captureExpectedReadRefusals,
    type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';

/** The reason a #5529-shaped handler reports when its store is unreachable. */
const REASON = 'STORE_UNAVAILABLE';

/**
 * [#10629] This fixture provisions the two job tables and nothing else, so the
 * engine's own single-tenant probe (`ObjectQL.probeInstallOrganizations`) reads
 * a `sys_organization` that was never created. The probe is fail-soft by
 * construction, but the driver and the engine each log the fault on the way
 * out. Withheld and ASSERTED rather than muted.
 */
const ABSENT_TENANCY_TABLE = 'sys_organization';

interface Harness {
    engine: ObjectQL;
    adapter: DbJobAdapter;
    ctx: PluginContext;
    fireReady: () => Promise<void>;
    errorLogs: () => string[];
    warnLogs: () => string[];
    runRows: () => Promise<Array<Record<string, unknown>>>;
    jobRow: (name: string) => Promise<Record<string, unknown> | undefined>;
}

const live: Array<{
    engine?: ObjectQL;
    adapter?: DbJobAdapter;
    driver?: SqlDriver;
    noise?: ExpectedReadRefusalCapture;
    /** The channels this test's path MUST have provoked — see `harness()`. */
    requiredChannels?: readonly string[];
}> = [];

afterEach(async () => {
    for (const entry of live.splice(0)) {
        try { await entry.adapter?.destroy(); } catch { /* noop */ }
        try { await entry.engine?.destroy(); } catch { /* noop */ }
        try { await entry.driver?.disconnect(); } catch { /* noop */ }
        // A capture nobody asserts is a mute. The probe is memoised behind the
        // FIRST data operation, so only the paths that actually touch the store
        // provoke it — `silentChannels(required)` is the API's own answer to a
        // table read on some of a file's paths and not others. The withholding
        // is unconditional either way; only the must-have-fired set narrows.
        if (entry.noise) {
            expect(entry.noise.silentChannels(entry.requiredChannels ?? [ABSENT_TENANCY_TABLE])).toEqual([]);
        }
    }
});

/** A real engine over the migrated test backend, carrying the REAL `sys_job*`. */
async function bootEngine(): Promise<{ engine: ObjectQL; driver: SqlDriver; noise: ExpectedReadRefusalCapture }> {
    const driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
    const noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([SysJob as never, SysJobRun as never]);
    const engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject(SysJob as never);
    engine.registry.registerObject(SysJobRun as never);
    return { engine, driver, noise };
}

/**
 * @param opts.touchesStore whether this test's path performs a data operation.
 *   `true` (the default) requires the tenancy probe to have fired and been
 *   withheld; the one case that swaps `DbJobAdapter` out for a recording
 *   `IJobService` never reads or writes and passes `false`, which keeps the
 *   withholding and drops only the must-have-fired requirement.
 */
async function harness(opts: { touchesStore?: boolean } = {}): Promise<Harness> {
    const { engine, driver, noise } = await bootEngine();
    // The adapter that RECORDS the outcome — the coordinate the card names.
    const adapter = new DbJobAdapter({ engine: engine as never });
    live.push({
        engine, adapter, driver, noise,
        requiredChannels: opts.touchesStore === false ? [] : [ABSENT_TENANCY_TABLE],
    });

    const readyHooks: Array<() => Promise<void>> = [];
    const ctx = {
        logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn((name: string) => {
            if (name === 'job') return adapter;
            if (name === 'objectql') return engine;
            return undefined;
        }),
        getServices: vi.fn(() => []),
        hook: vi.fn((event: string, cb: () => Promise<void>) => {
            if (event === 'kernel:ready') readyHooks.push(cb);
        }),
        trigger: vi.fn(),
    } as unknown as PluginContext;

    const rows = async (table: string, where?: Record<string, unknown>) => {
        const found = await engine.find(table, {
            ...(where ? { where } : {}),
            context: { isSystem: true, positions: [], permissions: [] },
        } as never);
        return Array.isArray(found) ? found as Array<Record<string, unknown>> : [];
    };

    return {
        engine,
        adapter,
        ctx,
        fireReady: async () => { for (const cb of readyHooks) await cb(); },
        errorLogs: () => vi.mocked(ctx.logger.error).mock.calls.map(c => String(c[0])),
        warnLogs: () => vi.mocked(ctx.logger.warn).mock.calls.map(c => String(c[0])),
        runRows: () => rows('sys_job_run'),
        jobRow: async (name: string) => (await rows('sys_job', { name }))[0],
    };
}

/**
 * The #5529 specimen as a DECLARATIVE job handler: it fires its shot at an
 * unreachable store, completes normally — a throw is the retry signal, which is
 * the wrong report — and says so by resolving the third outcome.
 */
async function degradingHandler(_jobCtx: JobHandlerContext): Promise<JobRunOutcome> {
    return { outcome: 'degraded', reason: REASON };
}

/** A pre-#6617 handler: resolves nothing, means `success`. */
async function silentHandler(_jobCtx: JobHandlerContext): Promise<void> {
    /* did its work, reports nothing */
}

function stackWith(jobName: string, handlerKey: string, fn: unknown) {
    return {
        id: 'com.test.job-degraded-outcome',
        jobs: [defineJob({
            name: jobName,
            schedule: { type: 'cron', expression: '0 1 * * *' },
            handler: handlerKey,
        })],
        functions: { [handlerKey]: fn },
    };
}

describe('#14256 — a declarative job\'s degraded outcome reaches `sys_job_run`', () => {
    it('lands `sys_job_run.status` distinct from `success`, with the reason in `error`', async () => {
        const h = await harness();
        const plugin = new AppPlugin(stackWith('wake_sweep', 'wake', degradingHandler));

        await plugin.start!(h.ctx);
        await h.fireReady();
        expect(await h.adapter.listJobs()).toContain('wake_sweep');

        // Run it the way the scheduler runs it — through the adapter, never by
        // calling the handler directly.
        await h.adapter.trigger('wake_sweep');

        const runs = await h.runRows();
        expect(runs).toHaveLength(1);
        // The card's assertion, in its own words: a status DISTINCT from
        // `success`. Spelled as the inequality first, because that is the
        // contract (`spec/contracts/job-service.ts`), then as the value the
        // shipped adapters agree on.
        expect(runs[0].status).not.toBe('success');
        expect(runs[0].status).toBe('degraded');
        expect(runs[0].error).toBe(REASON);
        expect(runs[0].job_name).toBe('wake_sweep');
        expect(h.errorLogs()).toEqual([]);
    });

    it('mirrors onto `sys_job.last_status` and leaves `failure_count` flat — degraded is not a failure', async () => {
        const h = await harness();
        const plugin = new AppPlugin(stackWith('wake_sweep', 'wake', degradingHandler));
        await plugin.start!(h.ctx);
        await h.fireReady();
        await h.adapter.trigger('wake_sweep');

        const job = await h.jobRow('wake_sweep');
        expect(job?.last_status).toBe('degraded');
        expect(job?.last_error).toBe(REASON);
        // `degraded` never retries and never alerts (#5548 / #7072).
        expect(job?.failure_count).toBe(0);
        expect(job?.run_count).toBe(1);
    });

    it('carries the outcome for the `{ handler, effect }` function form too', async () => {
        // The shape a declared-effect entry takes (#4396) — the same route, one
        // more indirection through `collectBundleFunctions`.
        const h = await harness();
        const plugin = new AppPlugin(
            stackWith('wake_sweep', 'wake', { handler: degradingHandler, effect: 'writes' }),
        );
        await plugin.start!(h.ctx);
        await h.fireReady();
        await h.adapter.trigger('wake_sweep');

        const runs = await h.runRows();
        expect(runs[0].status).toBe('degraded');
        expect(runs[0].error).toBe(REASON);
    });
});

describe('#14256 — the controls that keep the assertion honest', () => {
    it('CONTROL: the IMPERATIVE route already recorded it — the defect was the wrapper, not the adapter', async () => {
        // Registered straight on `IJobService.schedule`, with no AppPlugin in
        // the path. This case passed before the fix and passes after it, so a
        // red on the declarative cases above localises to the wrapper rather
        // than to `DbJobAdapter` or the `sys_job_run` write.
        const h = await harness();
        await h.adapter.schedule(
            'imperative_wake',
            { type: 'cron', expression: '0 1 * * *' },
            async (): Promise<JobRunOutcome> => ({ outcome: 'degraded', reason: REASON }),
        );
        await h.adapter.trigger('imperative_wake');

        const runs = await h.runRows();
        expect(runs[0].status).toBe('degraded');
        expect(runs[0].error).toBe(REASON);
    });

    it('CONTROL: a job whose handler reports nothing still lands `success` — the additivity clause', async () => {
        // The compatibility promise #6617 owes, on the exact shape every handler
        // written before it has. It also proves the degraded assertion above is
        // not passing because the rig writes `degraded` unconditionally.
        const h = await harness();
        const plugin = new AppPlugin(stackWith('quiet_sweep', 'quiet', silentHandler));
        await plugin.start!(h.ctx);
        await h.fireReady();
        await h.adapter.trigger('quiet_sweep');

        const runs = await h.runRows();
        expect(runs).toHaveLength(1);
        expect(runs[0].status).toBe('success');
        expect(runs[0].error).toBeNull();
        expect((await h.jobRow('quiet_sweep'))?.last_status).toBe('success');
    });

    it('the middle term: the wrapper AppPlugin hands `schedule` resolves the handler\'s outcome', async () => {
        // The reporter's probe, kept as corroboration and NOT as the deliverable:
        // it re-states the repair, while the cases above pin its consequence.
        // Typed only at the contract, exactly as a third-party `IJobService` is.
        const h = await harness({ touchesStore: false });
        const scheduled: Array<{ name: string; handler: JobHandler }> = [];
        const recording: IJobService = {
            async schedule(name: string, _schedule: JobSchedule, handler: JobHandler) {
                scheduled.push({ name, handler });
            },
            async cancel() { /* noop */ },
            async trigger() { /* noop */ },
        };
        vi.mocked(h.ctx.getService).mockImplementation((name: string) => {
            if (name === 'job') return recording as never;
            if (name === 'objectql') return h.engine as never;
            return undefined as never;
        });

        const plugin = new AppPlugin(stackWith('probe_wake', 'wake', degradingHandler));
        await plugin.start!(h.ctx);
        await h.fireReady();

        expect(scheduled.map(s => s.name)).toEqual(['probe_wake']);
        // `WRAPPER RESOLVED: undefined` was the measurement on the card.
        const resolved = await scheduled[0].handler({ jobId: 'probe_wake' });
        expect(resolved).toEqual({ outcome: 'degraded', reason: REASON });
    });
});
