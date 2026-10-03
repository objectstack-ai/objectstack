// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21489 — the binder's job half: `scheduleAppArtifactJobs`, the ONE place a
 * declared job becomes a scheduled one, and `collectJobsWithoutBody`, the
 * judgement the install-local door refuses on.
 *
 * Its callers are pinned where they live (`AppPlugin` below and in
 * `app-plugin.jobs.test.ts`; the install-local plugin in
 * `@objectstack/cloud-connection`; the public door in
 * `packages/cli/test/package-install-local-jobs.integration.test.ts`). This file
 * pins the contract they share, against the REAL QuickJS sandbox:
 *
 *   - a job `body` is scheduled, and a run executes the body — its `ctx.api`
 *     write reaches the engine, as system;
 *   - with both keys present the `body` wins, and a body that cannot be bound
 *     schedules NOTHING (never the handler beside it);
 *   - a `handler` job still runs its `functions` entry, and one with no entry is
 *     not scheduled, with the remedy said;
 *   - the job's `timeoutMs` is the body's one limit; with none, the runner's
 *     JOB default applies — not the hook's, not the action's;
 *   - the body's return is read as a `JobRunOutcome`, in that shape only;
 *   - a body's `ctx` carries no job name and no trigger data.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { scheduleAppArtifactJobs, collectJobsWithoutBody, PACKAGE_JOBS_UNINSTALL_CLEANUP } from './app-artifact-handlers.js';
import { jobBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';
import { AppPlugin } from './app-plugin.js';
import { withScheduledWorkOn } from './scheduled-work.test-support.js';

// [#17396] Package-authored jobs are scheduled only where the deployment runs
// package scheduled work, OFF by default; these suites measure the binder.
withScheduledWorkOn();

const APP_ID = 'com.example.jobsapp';
const TICK = 'jobs_app_tick';
const INTERVAL = { type: 'interval', intervalMs: 1000 };

/** A body that writes one row per run. */
const WRITE_BODY = {
    language: 'js',
    capabilities: ['api.write'],
    source: `await ctx.api.object('${TICK}').insert({ name: 'tick' });`,
};

/** The engine surface a job body's `ctx.api` reaches, as state: every write and the envelope it ran under. */
function recordingEngine() {
    const writes: Array<{ object: string; data: unknown; context: unknown }> = [];
    return {
        writes,
        ql: {
            createContext: (context: unknown) => ({
                object: (object: string) => ({
                    insert: async (data: Record<string, unknown>) => {
                        writes.push({ object, data, context });
                        return { id: `r${writes.length}`, ...data };
                    },
                }),
            }),
        },
    };
}

/**
 * `IJobService` as state: what is scheduled right now, by job name — `schedule`
 * replaces by name and `cancel` removes, the adapters' own semantics — plus
 * every cancel in order. `failCancel` names a job whose cancel throws.
 */
function recordingJobService(opts: { failCancel?: string } = {}) {
    const scheduled = new Map<string, { schedule: unknown; run: (c: any) => Promise<unknown>; options: unknown }>();
    const cancels: string[] = [];
    return {
        scheduled,
        cancels,
        svc: {
            schedule: async (name: string, schedule: unknown, run: (c: any) => Promise<unknown>, options?: unknown) => {
                scheduled.set(name, { schedule, run, options });
            },
            cancel: async (name: string) => {
                if (name === opts.failCancel) throw new Error(`cannot cancel ${name}`);
                cancels.push(name);
                scheduled.delete(name);
            },
            trigger: async () => undefined,
        },
    };
}

/** The protocol's uninstall-cleanup registry as state — the two verbs the binder and the doors use. */
function recordingProtocol() {
    const cleanups = new Map<string, (args: { packageId: string }) => Promise<{ success: boolean; removed: number; error?: string }>>();
    const registrations: string[] = [];
    return {
        cleanups,
        registrations,
        protocol: {
            registerUninstallCleanup: (name: string, cleanup: any) => { registrations.push(name); cleanups.set(name, cleanup); },
        },
    };
}

function harness(opts: { failCancel?: string; withProtocol?: boolean } = {}) {
    const engine = recordingEngine();
    const jobs = recordingJobService({ failCancel: opts.failCancel });
    const reg = recordingProtocol();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = {
        logger,
        getService: (name: string) => {
            if (name === 'job') return jobs.svc;
            if (name === 'protocol' && opts.withProtocol) return reg.protocol;
            throw new Error(`no ${name}`);
        },
    } as unknown as PluginContext;
    const schedule = (bundle: unknown, appId: string = APP_ID) =>
        scheduleAppArtifactJobs(ctx, bundle, { appId, ql: engine.ql as any, source: 'Test' });
    const warned = () => logger.warn.mock.calls.map((c) => String(c[0]));
    const errored = () => logger.error.mock.calls.map((c) => String(c[0]));
    return { engine, jobs, reg, logger, ctx, schedule, warned, errored };
}

/** A flattened JSON package, as install-local holds it: no `functions`. */
const pkg = (jobs: unknown[], extra: Record<string, unknown> = {}) => ({
    id: APP_ID, version: '0.1.0', type: 'app', jobs, ...extra,
});

describe('#21489: scheduleAppArtifactJobs — job bodies', () => {
    it('schedules a body job, and a run executes the body — its ctx.api write reaches the engine as system', async () => {
        const h = harness();

        const out = await h.schedule(pkg([{ name: 'tick_job', schedule: INTERVAL, body: WRITE_BODY }]));

        expect(out.bodies).toEqual(['tick_job']);
        expect(out.notScheduled).toEqual([]);
        expect([...h.jobs.scheduled.keys()]).toEqual(['tick_job']);
        // The authored schedule, lowered to the boundary tier.
        expect(h.jobs.scheduled.get('tick_job')!.schedule).toEqual({ type: 'interval', intervalMs: 1000 });

        await h.jobs.scheduled.get('tick_job')!.run({ jobId: 'tick_job' });

        expect(h.engine.writes).toEqual([{ object: TICK, data: { name: 'tick' }, context: { isSystem: true } }]);
    });

    it('with both keys present the body WINS — the handler beside it is never called', async () => {
        const h = harness();
        const tick = vi.fn(async () => undefined);

        const out = await h.schedule(pkg(
            [{ name: 'both_job', schedule: INTERVAL, body: WRITE_BODY, handler: 'tick' }],
            { functions: { tick } },
        ));
        await h.jobs.scheduled.get('both_job')!.run({ jobId: 'both_job' });

        expect(out.bodies).toEqual(['both_job']);
        expect(out.handlers).toEqual([]);
        expect(tick).not.toHaveBeenCalled();
        expect(h.engine.writes).toHaveLength(1);
    });

    it('an expression (L1) body is NOT scheduled — and the handler beside it is not run instead', async () => {
        const h = harness();
        const tick = vi.fn(async () => undefined);

        const out = await h.schedule(pkg(
            [{ name: 'l1_job', schedule: INTERVAL, body: { language: 'expression', source: '1 + 1' }, handler: 'tick' }],
            { functions: { tick } },
        ));

        expect(out.notScheduled).toEqual(['l1_job']);
        expect(h.jobs.scheduled.size).toBe(0);
        expect(h.warned().some((m) => m.includes('invalid job.body shape'))).toBe(true);
    });

    it('a body.timeoutMs (refused on a job by the spec) is NOT run under a second limit — the job is not scheduled', async () => {
        const h = harness();

        const out = await h.schedule(pkg([{ name: 'two_limits', schedule: INTERVAL, body: { ...WRITE_BODY, timeoutMs: 100 } }]));

        expect(out.notScheduled).toEqual(['two_limits']);
        expect(h.jobs.scheduled.size).toBe(0);
        expect(h.warned().some((m) => m.includes('`body.timeoutMs`') && m.includes("job's own `timeoutMs`"))).toBe(true);
    });

    it("the job's timeoutMs is threaded to the adapter AND bounds the sandbox run (the one limit)", async () => {
        const h = harness();

        await h.schedule(pkg([{
            name: 'spin_job',
            schedule: INTERVAL,
            timeoutMs: 40,
            body: { language: 'js', source: 'while (true) {}' },
        }]));
        const entry = h.jobs.scheduled.get('spin_job')!;

        expect(entry.options).toEqual({ retryPolicy: undefined, timeoutMs: 40 });
        await expect(entry.run({ jobId: 'spin_job' })).rejects.toThrow(/job 'spin_job' exceeded CPU budget of 40ms/);
    });

    it('a body returns its JobRunOutcome — copied in the declared shape only', async () => {
        const h = harness();
        await h.schedule(pkg([
            { name: 'degraded_job', schedule: INTERVAL, body: { language: 'js', source: "return { outcome: 'degraded', reason: 'nothing to sweep', extra: 1 };" } },
            { name: 'number_job', schedule: INTERVAL, body: { language: 'js', source: 'return 5;' } },
        ]));

        await expect(h.jobs.scheduled.get('degraded_job')!.run({ jobId: 'degraded_job' }))
            .resolves.toEqual({ outcome: 'degraded', reason: 'nothing to sweep' });
        await expect(h.jobs.scheduled.get('number_job')!.run({ jobId: 'number_job' })).resolves.toBeUndefined();
    });

    it("a body's ctx carries no job name and no trigger data — api / log / crypto is its surface", async () => {
        const h = harness();
        await h.schedule(pkg([{
            name: 'probe_job',
            schedule: INTERVAL,
            body: {
                language: 'js',
                capabilities: ['api.read', 'log', 'crypto.uuid'],
                source: "return { outcome: 'completed', reason: JSON.stringify({ jobId: typeof ctx.jobId, data: typeof ctx.data, "
                    + "api: typeof ctx.api.object, log: typeof ctx.log.info, uuid: typeof ctx.crypto.randomUUID }) };",
            },
        }]));

        // A manual trigger hands `data`; the body still does not receive it.
        const out = await h.jobs.scheduled.get('probe_job')!.run({ jobId: 'probe_job', data: { a: 1 } }) as { reason: string };

        expect(JSON.parse(out.reason)).toEqual({
            jobId: 'undefined', data: 'undefined', api: 'function', log: 'function', uuid: 'function',
        });
    });
});

describe('#21489: scheduleAppArtifactJobs — handler jobs and the door-wide gates', () => {
    it('a handler job still runs its functions entry, with the in-process JobHandlerContext (control)', async () => {
        const h = harness();
        let seen: any;
        const tick = vi.fn(async (c: any) => { seen = c; });

        const out = await h.schedule(pkg([{ name: 'handler_job', schedule: INTERVAL, handler: 'tick' }], { functions: { tick } }));
        await h.jobs.scheduled.get('handler_job')!.run({ jobId: 'handler_job' });

        expect(out.handlers).toEqual(['handler_job']);
        expect(tick).toHaveBeenCalledTimes(1);
        expect(seen.jobId).toBe('handler_job');
        expect(seen.ql).toBe(h.engine.ql);
    });

    it('a handler job with no functions entry (a JSON package) is NOT scheduled, and the warn names the body remedy', async () => {
        const h = harness();

        const out = await h.schedule(pkg([{ name: 'handler_job', schedule: INTERVAL, handler: 'tick' }]));

        expect(out.notScheduled).toEqual(['handler_job']);
        expect(h.jobs.scheduled.size).toBe(0);
        expect(h.warned().some((m) => m.includes('job handler not found') && m.includes('give the job a `body`'))).toBe(true);
    });

    it('a disabled job is skipped on every form', async () => {
        const h = harness();

        const out = await h.schedule(pkg([
            { name: 'off_body', schedule: INTERVAL, body: WRITE_BODY, enabled: false },
            { name: 'off_handler', schedule: INTERVAL, handler: 'tick', enabled: false },
        ]));

        expect(out).toEqual({ bodies: [], handlers: [], notScheduled: [], failed: [], cancelled: [] });
        expect(h.jobs.scheduled.size).toBe(0);
    });

    it('the deployment switch OFF withholds every job, said once', async () => {
        const h = harness();
        const prior = process.env.OS_AUTOMATION_SCHEDULED_WORK_ENABLED;
        delete process.env.OS_AUTOMATION_SCHEDULED_WORK_ENABLED;
        try {
            const out = await h.schedule(pkg([{ name: 'tick_job', schedule: INTERVAL, body: WRITE_BODY }]));
            expect(out.withheld).toBe('scheduled-work-disabled');
        } finally {
            process.env.OS_AUTOMATION_SCHEDULED_WORK_ENABLED = prior;
        }
        expect(h.jobs.scheduled.size).toBe(0);
    });
});

describe('#21489: re-scheduling replaces — a job the new version does not schedule is CANCELLED', () => {
    const job = (name: string) => ({ name, schedule: INTERVAL, body: WRITE_BODY });

    it('a reinstall that DROPS a job cancels it, and keeps the one it still declares', async () => {
        const h = harness();
        await h.schedule(pkg([job('kept_job'), job('gone_job')]));

        const out = await h.schedule(pkg([job('kept_job')]));

        expect(out.cancelled).toEqual(['gone_job']);
        expect(h.jobs.cancels).toEqual(['gone_job']);
        expect([...h.jobs.scheduled.keys()]).toEqual(['kept_job']);
    });

    it('a version that disables a job, or declares no jobs at all, cancels what it no longer runs', async () => {
        const h = harness();
        await h.schedule(pkg([job('a_job'), job('b_job')]));

        const disabled = await h.schedule(pkg([job('a_job'), { ...job('b_job'), enabled: false }]));
        expect(disabled.cancelled).toEqual(['b_job']);

        const none = await h.schedule(pkg([]));
        expect(none.cancelled).toEqual(['a_job']);
        expect(h.jobs.scheduled.size).toBe(0);
    });

    it("another app's jobs are never cancelled — not even one that took over a name this app once scheduled", async () => {
        const h = harness();
        await h.schedule(pkg([job('shared_name'), job('mine_only')]), APP_ID);
        await h.schedule(pkg([job('shared_name'), job('theirs_only')]), 'com.example.other');

        // This app's next version drops both: only its own remaining job stops.
        const out = await h.schedule(pkg([]), APP_ID);

        expect(out.cancelled).toEqual(['mine_only']);
        expect([...h.jobs.scheduled.keys()].sort()).toEqual(['shared_name', 'theirs_only']);
    });

    it('a cancel that throws is said at error, and the job stays on the record for the next attempt', async () => {
        const h = harness({ failCancel: 'stuck_job' });
        await h.schedule(pkg([job('stuck_job')]));

        const first = await h.schedule(pkg([]));
        expect(first.cancelled).toEqual([]);
        expect(h.errored().some((m) => m.includes('could NOT be cancelled'))).toBe(true);
    });
});

describe('#21489: the uninstall cleanup cancels the uninstalled package\'s jobs', () => {
    const job = (name: string) => ({ name, schedule: INTERVAL, body: WRITE_BODY });

    it('is registered once per protocol, as runtime.package-jobs, when a package\'s jobs are scheduled', async () => {
        const h = harness({ withProtocol: true });

        await h.schedule(pkg([job('a_job')]), APP_ID);
        await h.schedule(pkg([job('b_job')]), 'com.example.other');

        expect(h.reg.registrations).toEqual([PACKAGE_JOBS_UNINSTALL_CLEANUP]);
        expect(PACKAGE_JOBS_UNINSTALL_CLEANUP).toBe('runtime.package-jobs');
    });

    it("cancels every job of the uninstalled package and none of another package's", async () => {
        const h = harness({ withProtocol: true });
        await h.schedule(pkg([job('a_job'), job('a_other')]), APP_ID);
        await h.schedule(pkg([job('b_job')]), 'com.example.other');
        const cleanup = h.reg.cleanups.get(PACKAGE_JOBS_UNINSTALL_CLEANUP)!;

        const result = await cleanup({ packageId: APP_ID });

        expect(result).toEqual({ success: true, removed: 2 });
        expect(h.jobs.cancels.sort()).toEqual(['a_job', 'a_other']);
        expect([...h.jobs.scheduled.keys()]).toEqual(['b_job']);
        // A second uninstall of the same package has nothing left to cancel.
        await expect(cleanup({ packageId: APP_ID })).resolves.toEqual({ success: true, removed: 0 });
    });

    it('a package that scheduled nothing is a no-op', async () => {
        const h = harness({ withProtocol: true });
        await h.schedule(pkg([job('a_job')]), APP_ID);

        await expect(h.reg.cleanups.get(PACKAGE_JOBS_UNINSTALL_CLEANUP)!({ packageId: 'com.example.never' }))
            .resolves.toEqual({ success: true, removed: 0 });
        expect(h.jobs.cancels).toEqual([]);
    });

    it('a job it could not cancel is an outcome, never a throw — success:false naming the job', async () => {
        const h = harness({ withProtocol: true, failCancel: 'stuck_job' });
        await h.schedule(pkg([job('stuck_job'), job('fine_job')]), APP_ID);

        const result = await h.reg.cleanups.get(PACKAGE_JOBS_UNINSTALL_CLEANUP)!({ packageId: APP_ID });

        expect(result.success).toBe(false);
        expect(result.removed).toBe(1);
        expect(result.error).toContain('stuck_job');
    });
});

describe('#21489: the sandbox job origin', () => {
    it("a job body with no timeoutMs gets the runner's JOB default — not the hook's, not the action's", async () => {
        const runner = new QuickJSScriptRunner({ jobTimeoutMs: 30, hookTimeoutMs: 5_000, actionTimeoutMs: 5_000 });
        const bind = jobBodyRunnerFactory(runner, { ql: recordingEngine().ql, appId: APP_ID });
        const run = bind({ name: 'spin_default', body: { language: 'js', source: 'while (true) {}' } })!;

        await expect(run({ jobId: 'spin_default' })).rejects.toThrow(/job 'spin_default' exceeded CPU budget of 30ms/);
    });
});

describe('#21489: collectJobsWithoutBody — what no JSON door can run', () => {
    it('names each ENABLED job without a body, with the function its handler declares', () => {
        expect(collectJobsWithoutBody(pkg([
            { name: 'handler_only', schedule: INTERVAL, handler: 'tick' },
            { name: 'neither', schedule: INTERVAL },
            { name: 'body_job', schedule: INTERVAL, body: WRITE_BODY },
            { name: 'both', schedule: INTERVAL, body: WRITE_BODY, handler: 'tick' },
            { name: 'disabled_handler', schedule: INTERVAL, handler: 'tick', enabled: false },
        ]))).toEqual([
            { name: 'handler_only', handler: 'tick' },
            { name: 'neither' },
        ]);
    });

    it('a package without jobs has nothing to refuse', () => {
        expect(collectJobsWithoutBody(pkg([]))).toEqual([]);
        expect(collectJobsWithoutBody({ id: APP_ID })).toEqual([]);
    });
});

describe('#21489: AppPlugin (the boot door) schedules a body job through the binder', () => {
    it('a body-only job — skipped at warn before — is scheduled on kernel:ready, and runs its body', async () => {
        const engine = recordingEngine();
        const jobs = recordingJobService();
        const ready: Array<() => Promise<void>> = [];
        const ctx = {
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            getService: vi.fn((name: string) => {
                if (name === 'job') return jobs.svc;
                if (name === 'objectql') return engine.ql;
                return undefined;
            }),
            getServices: vi.fn(() => []),
            hook: vi.fn((event: string, cb: () => Promise<void>) => { if (event === 'kernel:ready') ready.push(cb); }),
            trigger: vi.fn(),
        } as unknown as PluginContext;
        const plugin = new AppPlugin({ id: APP_ID, jobs: [{ name: 'boot_body', schedule: INTERVAL, body: WRITE_BODY }] });

        await plugin.start!(ctx);
        for (const cb of ready) await cb();
        await jobs.scheduled.get('boot_body')?.run({ jobId: 'boot_body' });

        expect([...jobs.scheduled.keys()]).toEqual(['boot_body']);
        expect(engine.writes).toEqual([{ object: TICK, data: { name: 'tick' }, context: { isSystem: true } }]);
    });
});
