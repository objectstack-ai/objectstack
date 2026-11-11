// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D7] A pull job hands its pull the job run that drove it.
 *
 * `JobHandler`'s context may carry the job service's run-history id of the
 * attempt (`runId`, on `DbJobAdapter` the `sys_job_run` row) and why the run
 * started (`trigger`: `schedule` / `manual`). The binder's pull form
 * (`scheduleAppArtifactJobs`) forwards them to
 * `IAutomationService.pullConnectorSource` as `jobRunId` and `trigger`, which
 * the automation plugin writes on the pull's `sys_sync_run` row (pinned in
 * `service-automation`'s `datasource-pull.test.ts`). Pinned here:
 *
 *   - each is forwarded as the job service handed it;
 *   - a run handed neither sends neither (a direct `trigger` on a job service
 *     that sends no context of its own, or one written before the fields);
 *   - a value the contract does not spell (an empty run id, a trigger outside
 *     `schedule` / `manual`) is not forwarded;
 *   - on the REAL `DbJobAdapter`, a manual run and a scheduled fire each hand
 *     the pull the id of the `sys_job_run` row the adapter wrote for it, with
 *     its trigger.
 *
 * Its own file, beside `app-artifact-handlers.job-pull.test.ts`, whose
 * harness it restates in small.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { DbJobAdapter } from '@objectstack/service-job';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { scheduleAppArtifactJobs } from './app-artifact-handlers.js';
// The source under test reaches `@objectstack/metadata` by dynamic import
// (`app-plugin.ts`); paid here, at collection, not inside a case's clock.
import '@objectstack/metadata';
import { withScheduledWorkOn } from './scheduled-work.test-support.js';

withScheduledWorkOn();

const APP_ID = 'com.example.syncapp';
const TICK = 60_000;
const MAPPING = {
    name: 'orders_pull',
    targetObject: 'order',
    fieldMapping: [{ source: 'id', target: 'external_id' }],
    mode: 'upsert',
    upsertKey: ['external_id'],
    connectorSource: { connector: 'orders_api', action: 'request' },
};
const PULL_JOB = { name: 'orders_pull_hourly', schedule: { type: 'interval', intervalMs: TICK }, pull: { mapping: 'orders_pull' } };
const ASKED = { mapping: 'orders_pull', context: { isSystem: true }, callerPackageId: APP_ID };

const answer = () => ({
    mapping: 'orders_pull', targetObject: 'order', connector: 'orders_api', action: 'request', pulled: 0,
    summary: { total: 0, processed: 0, created: 0, updated: 0, skipped: 0, errors: 0, ok: 0, cancelled: false },
});

/**
 * The store `DbJobAdapter` writes `sys_job` / `sys_job_run` through: equality
 * filters only (a combinator is refused, not read as a field), the caller's
 * bound applied by presence, and `update` held to the engine's dispatch rule.
 */
function fakeJobStore() {
    const tables = new Map<string, Array<Record<string, unknown>>>();
    return {
        tables,
        async find(table: string, opts: { where?: Record<string, unknown>; limit?: number } = {}) {
            const rows = (tables.get(table) ?? []).filter((r) =>
                Object.entries(opts.where ?? {}).every(([k, v]) => {
                    if (k.startsWith('$')) throw new Error(`fake job store: unsupported operator ${k}`);
                    return r[k] === v;
                }));
            return typeof opts.limit === 'number' ? rows.slice(0, opts.limit) : rows;
        },
        async insert(table: string, data: Record<string, unknown>) {
            const t = tables.get(table) ?? [];
            t.push({ ...data });
            tables.set(table, t);
            return { id: data.id };
        },
        async update(table: string, patch: Record<string, unknown>, options?: any) {
            assertEngineUpdateDispatch(patch, options);
            const row = (tables.get(table) ?? []).find((r) => r.id === patch.id);
            if (row) Object.assign(row, patch);
            return row;
        },
    };
}

function harness(jobService?: unknown) {
    const scheduled = new Map<string, (c: any) => Promise<unknown>>();
    const pulls: unknown[] = [];
    const services: Record<string, unknown> = {
        job: jobService ?? {
            schedule: async (name: string, _s: unknown, run: (c: any) => Promise<unknown>) => { scheduled.set(name, run); },
            cancel: async (name: string) => { scheduled.delete(name); },
            trigger: async () => undefined,
        },
        automation: { pullConnectorSource: vi.fn(async (request: unknown) => { pulls.push(request); return answer(); }) },
    };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = {
        logger,
        getService: (name: string) => {
            if (services[name] !== undefined) return services[name];
            throw new Error(`no ${name}`);
        },
    } as unknown as PluginContext;
    const schedule = () => scheduleAppArtifactJobs(
        ctx,
        { id: APP_ID, version: '0.1.0', type: 'app', jobs: [PULL_JOB], mappings: [MAPPING] },
        { appId: APP_ID, ql: undefined, source: 'Test' },
    );
    return { scheduled, pulls, schedule };
}

describe('[ADR-0153 D7] the binder forwards the job run that drove a pull', () => {
    it('the run id and the trigger the job service handed the run reach pullConnectorSource', async () => {
        const h = harness();
        await h.schedule();
        const run = h.scheduled.get('orders_pull_hourly')!;

        await run({ jobId: 'orders_pull_hourly', runId: 'run_7', trigger: 'schedule' });
        await run({ jobId: 'orders_pull_hourly', runId: 'run_8', trigger: 'manual' });
        expect(h.pulls).toEqual([
            { ...ASKED, jobRunId: 'run_7', trigger: 'schedule' },
            { ...ASKED, jobRunId: 'run_8', trigger: 'manual' },
        ]);
    });

    it('a trigger with no run id (a job service that keeps no run history) sends the trigger alone', async () => {
        const h = harness();
        await h.schedule();

        await h.scheduled.get('orders_pull_hourly')!({ jobId: 'orders_pull_hourly', trigger: 'manual' });
        expect(h.pulls).toEqual([{ ...ASKED, trigger: 'manual' }]);
    });

    it('CONTROL: a run handed neither sends neither', async () => {
        const h = harness();
        await h.schedule();

        await h.scheduled.get('orders_pull_hourly')!({ jobId: 'orders_pull_hourly' });
        expect(h.pulls).toEqual([ASKED]);
        expect(Object.keys(h.pulls[0] as object)).not.toContain('jobRunId');
        expect(Object.keys(h.pulls[0] as object)).not.toContain('trigger');
    });

    it('a value the contract does not spell is not forwarded: an empty run id, a trigger outside schedule / manual', async () => {
        const h = harness();
        await h.schedule();

        await h.scheduled.get('orders_pull_hourly')!({ jobId: 'orders_pull_hourly', runId: '', trigger: 'replay' });
        expect(h.pulls).toEqual([ASKED]);
    });
});

describe('[ADR-0153 D7] on the real DbJobAdapter, a pull is handed the sys_job_run row of its run', () => {
    const adapters: DbJobAdapter[] = [];
    afterEach(async () => {
        vi.useRealTimers();
        while (adapters.length) await adapters.pop()!.destroy();
    });
    const build = () => {
        const store = fakeJobStore();
        const adapter = new DbJobAdapter({ engine: store });
        adapters.push(adapter);
        return { store, adapter, h: harness(adapter) };
    };
    const runRows = (store: ReturnType<typeof fakeJobStore>) => store.tables.get('sys_job_run') ?? [];

    it('a manual run: the pull carries the id of the row the adapter wrote, and `manual`', async () => {
        const { store, adapter, h } = build();
        const out = await h.schedule();
        expect(out.pulls).toEqual(['orders_pull_hourly']);
        const [name] = await adapter.listJobs();

        await adapter.trigger(name);
        const rows = runRows(store);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ job_name: name, status: 'success' });
        expect(h.pulls).toEqual([{ ...ASKED, jobRunId: rows[0].id, trigger: 'manual' }]);
    });

    it('a scheduled fire: the pull carries that fire\'s row, and `schedule`', async () => {
        vi.useFakeTimers();
        const { store, h } = build();
        await h.schedule();

        await vi.advanceTimersByTimeAsync(TICK);
        const rows = runRows(store);
        expect(rows).toHaveLength(1);
        expect(h.pulls).toEqual([{ ...ASKED, jobRunId: rows[0].id, trigger: 'schedule' }]);
    });
});
