// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20281 stage ③ — "the `job` driving it", built to rulings Q1-B + Q2-O1.
 *
 * Q1-B: a job drives a connector pull BY DECLARATION — `JobSchema.pull:
 * { mapping }`, a third run form the ONE binder binds (`scheduleAppArtifactJobs`)
 * by calling the `automation` service's contract method,
 * `IAutomationService.pullConnectorSource`, resolved through the service
 * registry. Pinned here:
 *
 *   - a pull job is scheduled, and each run calls the contract method with the
 *     mapping and the job's execution context;
 *   - the outcome is mapped once, by the binder: a refused pull REJECTS (the job
 *     service's `failed`, the retry trigger), a pull with refused rows resolves
 *     `degraded` with the counts, anything else `completed`;
 *   - a pull that does not bind (a mapping the artifact does not declare, one
 *     with no `connectorSource`, code beside it) and a composition with no pull
 *     door are NOT scheduled, and the reason is said;
 *   - `collectJobsWithoutBody` — what the install-local door refuses by — names
 *     an enabled pull job exactly when the binder's `judgeJobPull` does not
 *     bind it, with that refusal as its `pullRefusal`, and never a pull job that
 *     binds: every pull job it names is one the binder does not schedule, and
 *     every enabled pull job it does not name the binder schedules.
 *
 * Q2-O1: a job declares the organization it runs as, judged at bind by the
 * scheduled flows' posture rule (`resolveScheduledWorkPolicy`). Pinned here:
 *
 *   - every form runs as `{ isSystem: true, tenantId }` — the pull's `context`,
 *     the body's `ctx.api` envelope (against the REAL QuickJS sandbox), the
 *     handler's `executionContext` — and as `{ isSystem: true }` with none;
 *   - `isolated` (switch on): a job declaring none is NOT scheduled, at `error`;
 *   - `group`: an undeclared job is scheduled and named once at `warn`;
 *   - `single`: an undeclared job is scheduled, silently;
 *   - an unreadable posture fails closed; with the switch OFF it is never read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import type { ConnectorSourcePullResult } from '@objectstack/spec/contracts';
import { SCHEDULED_WORK_ENV } from '@objectstack/types';
import { runImport, type ExportFieldMeta, type ImportProtocolLike, type ImportRunSummary } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { composeStacks, defineStack } from '@objectstack/spec';
import { SqlDriver } from '@objectstack/driver-sql';
import { CronJobAdapter } from '@objectstack/service-job';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { collectJobsWithoutBody, jobDeclaringPackages, scheduleAppArtifactJobs } from './app-artifact-handlers.js';
// The source under test reaches `@objectstack/metadata` by dynamic import
// (`app-plugin.ts`); paid here, at collection, not inside a case's clock.
import '@objectstack/metadata';
import { withScheduledWorkOn } from './scheduled-work.test-support.js';

withScheduledWorkOn();

/** Run each test of a suite under `OS_TENANCY_POSTURE=<posture>`, restoring the previous value. */
function withPosture(posture: string | undefined): void {
    let prior: string | undefined;
    beforeEach(() => {
        prior = process.env.OS_TENANCY_POSTURE;
        if (posture === undefined) delete process.env.OS_TENANCY_POSTURE;
        else process.env.OS_TENANCY_POSTURE = posture;
    });
    afterEach(() => {
        if (prior === undefined) delete process.env.OS_TENANCY_POSTURE;
        else process.env.OS_TENANCY_POSTURE = prior;
    });
}

const APP_ID = 'com.example.syncapp';
const INTERVAL = { type: 'interval', intervalMs: 60000 };
const MAPPING = {
    name: 'orders_pull',
    targetObject: 'order',
    fieldMapping: [{ source: 'id', target: 'external_id' }],
    mode: 'upsert',
    upsertKey: ['external_id'],
    connectorSource: { connector: 'orders_api', action: 'request' },
};
const PULL_JOB = { name: 'orders_pull_hourly', schedule: INTERVAL, pull: { mapping: 'orders_pull' } };

/** A pull result as the service answers it. */
const result = (summary: Partial<Record<'total' | 'processed' | 'created' | 'updated' | 'skipped' | 'errors' | 'ok', number>> = {}, pulled = 3) => ({
    mapping: 'orders_pull',
    targetObject: 'order',
    connector: 'orders_api',
    action: 'request',
    pulled,
    summary: { total: pulled, processed: pulled, created: pulled, updated: 0, skipped: 0, errors: 0, ok: pulled, cancelled: false, ...summary },
});

function harness(opts: { automation?: unknown; engine?: Record<string, unknown> } = {}) {
    const writes: Array<{ object: string; data: unknown; context: unknown }> = [];
    const ql = {
        ...opts.engine,
        createContext: (context: unknown) => ({
            object: (object: string) => ({
                insert: async (data: Record<string, unknown>) => {
                    writes.push({ object, data, context });
                    return { id: `r${writes.length}`, ...data };
                },
            }),
        }),
    };
    const scheduled = new Map<string, { run: (c: any) => Promise<unknown> }>();
    const jobService = {
        schedule: async (name: string, _schedule: unknown, run: (c: any) => Promise<unknown>) => { scheduled.set(name, { run }); },
        cancel: async (name: string) => { scheduled.delete(name); },
        trigger: async () => undefined,
    };
    const pulls: unknown[] = [];
    const defaultAutomation = {
        pullConnectorSource: vi.fn(async (request: unknown) => { pulls.push(request); return result(); }),
    };
    const services: Record<string, unknown> = {
        job: jobService,
        automation: 'automation' in opts ? opts.automation : defaultAutomation,
    };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = {
        logger,
        getService: (name: string) => {
            if (services[name] !== undefined) return services[name];
            throw new Error(`no ${name}`);
        },
    } as unknown as PluginContext;
    const schedule = (jobs: unknown[], extra: Record<string, unknown> = {}) =>
        scheduleAppArtifactJobs(ctx, { id: APP_ID, version: '0.1.0', type: 'app', jobs, mappings: [MAPPING], ...extra }, {
            appId: APP_ID, ql: ql as any, source: 'Test',
        });
    const run = (name: string) => scheduled.get(name)!.run({ jobId: name });
    const said = (level: 'warn' | 'error' | 'info') => logger[level].mock.calls.map((c) => String(c[0]));
    return { writes, scheduled, services, pulls, defaultAutomation, logger, schedule, run, said };
}

describe('#20281 stage ③ (Q1-B): a job pulls a mapping by declaration, through the automation service', () => {
    withPosture(undefined);

    it('schedules a pull job, and each run calls pullConnectorSource with the mapping and the job\'s context', async () => {
        const h = harness();

        const out = await h.schedule([PULL_JOB]);
        expect(out.pulls).toEqual(['orders_pull_hourly']);
        expect(out.bodies).toEqual([]);
        expect(out.handlers).toEqual([]);
        expect(out.notScheduled).toEqual([]);
        expect([...h.scheduled.keys()]).toEqual(['orders_pull_hourly']);

        const outcome = await h.run('orders_pull_hourly');
        expect(h.pulls).toEqual([{ mapping: 'orders_pull', context: { isSystem: true }, callerPackageId: APP_ID }]);
        expect(outcome).toEqual({ outcome: 'completed' });
    });

    it('a pull whose rows the import runner refused resolves degraded, with the counts as its reason', async () => {
        const h = harness();
        h.defaultAutomation.pullConnectorSource.mockResolvedValueOnce(result({ created: 2, ok: 2, errors: 3 }, 5));
        await h.schedule([PULL_JOB]);

        const outcome = (await h.run('orders_pull_hourly')) as { outcome: string; reason?: string };
        expect(outcome.outcome).toBe('degraded');
        expect(outcome.reason).toContain('3 of 5');
    });

    it('a pull that carried no records completes — nothing new is not degraded', async () => {
        const h = harness();
        h.defaultAutomation.pullConnectorSource.mockResolvedValueOnce(result({ total: 0, processed: 0, created: 0, ok: 0 }, 0));
        await h.schedule([PULL_JOB]);

        expect(await h.run('orders_pull_hourly')).toEqual({ outcome: 'completed' });
    });

    it('a refused pull REJECTS the run — the job service records failed and the retry policy applies', async () => {
        const h = harness();
        const refusal = Object.assign(new Error('Mapping "orders_pull": orders_api.request answered ok:false'), {
            code: 'EXTERNAL_SERVICE_ERROR', status: 502, reason: 'upstream_not_ok',
        });
        h.defaultAutomation.pullConnectorSource.mockRejectedValueOnce(refusal);
        await h.schedule([PULL_JOB]);

        await expect(h.run('orders_pull_hourly')).rejects.toMatchObject({ code: 'EXTERNAL_SERVICE_ERROR', status: 502 });
    });

    it('a pull naming a mapping the artifact does not declare is NOT scheduled, and the warn names `pull.mapping`', async () => {
        const h = harness();

        const out = await h.schedule([{ ...PULL_JOB, pull: { mapping: 'orders_pul' } }]);
        expect(out.pulls).toEqual([]);
        expect(out.notScheduled).toEqual(['orders_pull_hourly']);
        expect(h.scheduled.size).toBe(0);
        expect(h.said('warn').some((m) => m.includes('pull.mapping') && m.includes("'orders_pul'"))).toBe(true);
        expect(h.defaultAutomation.pullConnectorSource).not.toHaveBeenCalled();
    });

    it('a pull whose mapping declares no connectorSource is NOT scheduled — there is nothing to pull', async () => {
        const h = harness();
        const { connectorSource: _dropped, ...importOnly } = MAPPING;

        const out = await h.schedule([PULL_JOB], { mappings: [importOnly] });
        expect(out.notScheduled).toEqual(['orders_pull_hourly']);
        expect(h.said('warn').some((m) => m.includes('connectorSource') && m.includes('datasourceSource'))).toBe(true);
    });

    it('[ADR-0153 D1] a pull whose mapping declares a datasourceSource is scheduled, and a degraded run names the object it read', async () => {
        const h = harness();
        const { connectorSource: _dropped, ...rest } = MAPPING;
        const sourced = { ...rest, datasourceSource: { object: 'erp_order', watermark: { field: 'updated_at', start: '2026-01-01' } } };
        const datasourceResult: ConnectorSourcePullResult = {
            source: 'datasource', mapping: 'orders_pull', targetObject: 'order', object: 'erp_order', datasource: 'erp',
            readPath: 'builtin', watermark: { field: 'updated_at', from: '2026-01-01T00:00:00.000Z' }, pulled: 4,
            summary: { total: 4, processed: 4, created: 3, updated: 0, skipped: 0, errors: 1, ok: 3, cancelled: false },
        };
        // The harness mock is typed from the connector fixture (`result`); the datasource arm is the contract's own.
        h.defaultAutomation.pullConnectorSource.mockResolvedValueOnce(datasourceResult as unknown as ReturnType<typeof result>);

        const out = await h.schedule([PULL_JOB], { mappings: [sourced] });
        expect(out.pulls).toEqual(['orders_pull_hourly']);
        expect(out.notScheduled).toEqual([]);
        const outcome = (await h.run('orders_pull_hourly')) as { outcome: string; reason?: string };
        expect(h.defaultAutomation.pullConnectorSource).toHaveBeenCalledWith({ mapping: 'orders_pull', context: { isSystem: true }, callerPackageId: APP_ID });
        expect(outcome.outcome).toBe('degraded');
        expect(outcome.reason).toContain("from 'erp_order'");
        expect(outcome.reason).toContain('1 of 4');
    });

    it('a pull beside a body is NOT scheduled — neither run form runs', async () => {
        const h = harness();
        const body = { language: 'js', capabilities: ['api.write'], source: "await ctx.api.object('order').insert({});" };

        const out = await h.schedule([{ ...PULL_JOB, body }]);
        expect(out.notScheduled).toEqual(['orders_pull_hourly']);
        expect(out.bodies).toEqual([]);
        expect(h.scheduled.size).toBe(0);
    });

    it('a pull resolves a mapping a sibling package of the same artifact declares (ADR-0130 D4)', async () => {
        const h = harness();
        const out = await scheduleAppArtifactJobs(
            { logger: h.logger, getService: (n: string) => h.services[n] } as unknown as PluginContext,
            {
                manifest: { id: 'com.example.maps', name: 'Maps', version: '0.1.0', type: 'app' },
                packages: [
                    { manifest: { id: 'com.example.maps', name: 'Maps', version: '0.1.0', type: 'app', mappings: [MAPPING] } },
                    { manifest: { id: 'com.example.jobs', name: 'Jobs', version: '0.1.0', type: 'module', jobs: [PULL_JOB] } },
                ],
            },
            { appId: APP_ID, ql: undefined, source: 'Test' },
        );
        expect(out.pulls).toEqual(['orders_pull_hourly']);
        // [#32071] …and the pull is asked as the body that declares the job,
        // not the top-level id the job service keys it under.
        await h.run('orders_pull_hourly');
        expect(h.pulls).toEqual([{ mapping: 'orders_pull', context: { isSystem: true }, callerPackageId: 'com.example.jobs' }]);
    });

    it('with no automation service serving pullConnectorSource the pull job is NOT scheduled, and the composition remedy is said', async () => {
        const h = harness({ automation: { execute: async () => ({ success: true }) } });

        const out = await h.schedule([PULL_JOB]);
        expect(out.notScheduled).toEqual(['orders_pull_hourly']);
        expect(h.scheduled.size).toBe(0);
        expect(h.said('warn').some((m) => m.includes('pullConnectorSource') && m.includes('AutomationServicePlugin'))).toBe(true);
    });

    it('the automation service is resolved on every run, through the registry — not the instance seen at bind', async () => {
        const h = harness();
        await h.schedule([PULL_JOB]);
        const replacement = { pullConnectorSource: vi.fn(async () => result()) };
        h.services.automation = replacement;

        await h.run('orders_pull_hourly');
        expect(replacement.pullConnectorSource).toHaveBeenCalledTimes(1);
        expect(h.defaultAutomation.pullConnectorSource).not.toHaveBeenCalled();
    });

});

describe('collectJobsWithoutBody judges a pull job by the binder\'s own judgeJobPull', () => {
    withPosture(undefined);

    const { connectorSource: _dropped, ...IMPORT_ONLY } = { ...MAPPING, name: 'orders_import' };
    const BODY = { language: 'js', capabilities: ['api.write'], source: "await ctx.api.object('order').insert({});" };
    const JOBS = [
        PULL_JOB,
        { ...PULL_JOB, name: 'undeclared_pull', pull: { mapping: 'orders_pul' } },
        { ...PULL_JOB, name: 'sourceless_pull', pull: { mapping: 'orders_import' } },
        { ...PULL_JOB, name: 'pull_beside_body', body: BODY },
        { ...PULL_JOB, name: 'disabled_undeclared_pull', pull: { mapping: 'orders_pul' }, enabled: false },
        { name: 'fn_job', schedule: INTERVAL, handler: 'sweep' },
    ];
    const bundle = { id: APP_ID, version: '0.1.0', type: 'app', jobs: JOBS, mappings: [MAPPING, IMPORT_ONLY] };

    it('names each ENABLED pull job that does not bind, with its pullRefusal — never as a job with no body; a pull that binds is not named', () => {
        const named = collectJobsWithoutBody(bundle);

        expect(named.map((j) => j.name)).toEqual(['undeclared_pull', 'sourceless_pull', 'pull_beside_body', 'fn_job']);
        const byName = new Map(named.map((j) => [j.name, j]));
        expect(byName.get('undeclared_pull')).toEqual({
            name: 'undeclared_pull',
            pullRefusal: expect.stringMatching(/^pull\.mapping: this artifact declares no mapping 'orders_pul'/),
        });
        expect(byName.get('sourceless_pull')).toEqual({
            name: 'sourceless_pull',
            pullRefusal: expect.stringMatching(/^pull\.mapping: mapping 'orders_import' declares no source/),
        });
        // Code beside the `pull` is the pull's refusal — judged before the body
        // beside it, as the binder judges it — never a `bodyRefusal`.
        expect(byName.get('pull_beside_body')).toEqual({
            name: 'pull_beside_body',
            pullRefusal: expect.stringMatching(/^pull: the job declares `body` or `handler` beside `pull`/),
        });
        // Control: a job with no run form at all is still named with neither refusal.
        expect(byName.get('fn_job')).toEqual({ name: 'fn_job', handler: 'sweep' });
    });

    it('the door and the binder agree: every pull job named is NOT scheduled, with the same refusal said; every enabled pull job not named IS', async () => {
        const h = harness();

        const named = collectJobsWithoutBody(bundle).filter((j) => j.pullRefusal !== undefined);
        const out = await scheduleAppArtifactJobs(
            { logger: h.logger, getService: (n: string) => h.services[n] } as unknown as PluginContext,
            bundle,
            { appId: APP_ID, ql: undefined, source: 'Test' },
        );

        expect(out.pulls).toEqual(['orders_pull_hourly']);
        expect(named.map((j) => j.name).sort()).toEqual([...out.notScheduled].filter((n) => n !== 'fn_job').sort());
        // One judge: the refusal the door answers with is the sentence the binder logs when it withholds the job.
        for (const job of named) {
            expect(h.said('warn').some((m) => m.endsWith(job.pullRefusal!)), `no binder warn carries ${job.name}'s refusal`).toBe(true);
        }
    });
});

describe('#20281 stage ③ (Q2-O1): every run form runs as the job\'s declared organization', () => {
    withPosture('single');

    it('a pull job\'s context carries the organization as tenantId', async () => {
        const h = harness();
        await h.schedule([{ ...PULL_JOB, organization: 'org_a' }]);

        await h.run('orders_pull_hourly');
        expect(h.pulls).toEqual([{ mapping: 'orders_pull', context: { isSystem: true, tenantId: 'org_a' }, callerPackageId: APP_ID }]);
    });

    it('a body job\'s ctx.api write runs under { isSystem: true, tenantId } — the real QuickJS sandbox', async () => {
        const h = harness();
        const body = { language: 'js', capabilities: ['api.write'], source: "await ctx.api.object('tick').insert({ name: 'tick' });" };
        await h.schedule([
            { name: 'scoped_body', schedule: INTERVAL, body, organization: 'org_a' },
            { name: 'plain_body', schedule: INTERVAL, body },
        ]);

        await h.run('scoped_body');
        await h.run('plain_body');
        expect(h.writes.map((w) => w.context)).toEqual([{ isSystem: true, tenantId: 'org_a' }, { isSystem: true }]);
    });

    it('a handler job is handed the same envelope as executionContext; ql stays the raw engine', async () => {
        const h = harness();
        const seen: unknown[] = [];
        const sweep = async (jobCtx: { executionContext?: unknown; ql: unknown }) => { seen.push([jobCtx.executionContext, typeof jobCtx.ql]); };
        await h.schedule(
            [{ name: 'scoped_fn', schedule: INTERVAL, handler: 'sweep', organization: 'org_a' }, { name: 'plain_fn', schedule: INTERVAL, handler: 'sweep' }],
            { functions: { sweep } },
        );

        await h.run('scoped_fn');
        await h.run('plain_fn');
        expect(seen).toEqual([[{ isSystem: true, tenantId: 'org_a' }, 'object'], [{ isSystem: true }, 'object']]);
    });

    it('under single an undeclared job is scheduled and nothing is said about its organization', async () => {
        const h = harness();
        const out = await h.schedule([PULL_JOB]);
        expect(out.pulls).toEqual(['orders_pull_hourly']);
        expect(out.missingOrganization).toEqual([]);
        expect(h.said('warn').some((m) => m.includes('NO acting organization'))).toBe(false);
    });
});

describe('#20281 stage ③ (Q2-O1): under isolated, a job that declares no organization is not scheduled', () => {
    withPosture('isolated');

    it('every run form without an organization is refused at error, naming the job and the key; a declared one is scheduled', async () => {
        const h = harness();
        const body = { language: 'js', capabilities: ['api.read'], source: "await ctx.api.object('tick').find({});" };

        const out = await h.schedule(
            [
                PULL_JOB,
                { name: 'bare_body', schedule: INTERVAL, body },
                { name: 'bare_fn', schedule: INTERVAL, handler: 'sweep' },
                { ...PULL_JOB, name: 'scoped_pull', organization: 'org_a' },
            ],
            { functions: { sweep: async () => undefined } },
        );

        expect(out.missingOrganization).toEqual(['orders_pull_hourly', 'bare_body', 'bare_fn']);
        expect(out.pulls).toEqual(['scoped_pull']);
        expect([...h.scheduled.keys()]).toEqual(['scoped_pull']);
        const errors = h.said('error');
        for (const name of ['orders_pull_hourly', 'bare_body', 'bare_fn']) {
            expect(errors.some((m) => m.includes('NOT SCHEDULED') && m.includes(`'${name}'`) && m.includes('`organization`'))).toBe(true);
        }
    });

    it('an empty-string organization is not a declaration — it is refused like none', async () => {
        const h = harness();
        const out = await h.schedule([{ ...PULL_JOB, organization: '' }]);
        expect(out.missingOrganization).toEqual(['orders_pull_hourly']);
    });
});

describe('#20281 stage ③ (Q2-O1): under group, an undeclared job is scheduled and named once', () => {
    withPosture('group');

    it('schedules both; one warn names only the undeclared job', async () => {
        const h = harness();
        const out = await h.schedule([PULL_JOB, { ...PULL_JOB, name: 'scoped_pull', organization: 'org_a' }]);

        expect(out.pulls).toEqual(['orders_pull_hourly', 'scoped_pull']);
        expect(out.missingOrganization).toEqual([]);
        const warns = h.said('warn').filter((m) => m.includes('NO acting organization'));
        expect(warns).toHaveLength(1);
        expect(warns[0]).toContain('orders_pull_hourly');
        expect(warns[0]).not.toContain('scoped_pull');
    });
});

describe('#20281 stage ③: an unreadable tenancy posture fails closed — and is never read with the switch off', () => {
    withPosture('isolatd');

    it('switch on: nothing is scheduled, withheld scheduled-work-policy-unreadable, said at error', async () => {
        const h = harness();
        const out = await h.schedule([PULL_JOB, { ...PULL_JOB, name: 'scoped_pull', organization: 'org_a' }]);

        expect(out.withheld).toBe('scheduled-work-policy-unreadable');
        expect(h.scheduled.size).toBe(0);
        expect(h.said('error').some((m) => m.includes('scheduled-work policy could not be read'))).toBe(true);
    });

    it('switch off: the posture is not read — the deployment-policy withholding answers, as before', async () => {
        const prior = process.env[SCHEDULED_WORK_ENV];
        delete process.env[SCHEDULED_WORK_ENV];
        try {
            const h = harness();
            const out = await h.schedule([PULL_JOB]);
            expect(out.withheld).toBe('scheduled-work-disabled');
            expect(h.said('error')).toEqual([]);
        } finally {
            if (prior === undefined) delete process.env[SCHEDULED_WORK_ENV];
            else process.env[SCHEDULED_WORK_ENV] = prior;
        }
    });
});

/**
 * A job that declares no `organization` pulls as the organization its writes
 * are stamped with: the engine's own system-write decision
 * (`ObjectQL#systemWriteOrganization`, ADR-0131 D9), asked once per run before
 * the pull reads or writes. Only `derived` changes the context; every other
 * decision, an engine that does not answer, and a probe that throws keep
 * `{ isSystem: true }`. The `body` and `handler` forms are unchanged.
 */
describe('a pull of a job with no organization runs as the organization its writes are stamped with', () => {
    withPosture('single');

    const decide = (decision: unknown) => vi.fn(async () => decision);

    it('derived: the pull context carries it, asked once per run', async () => {
        const systemWriteOrganization = decide({ kind: 'derived', organizationId: 'org_one' });
        const h = harness({ engine: { systemWriteOrganization } });
        await h.schedule([PULL_JOB]);
        expect(systemWriteOrganization).not.toHaveBeenCalled();

        await h.run('orders_pull_hourly');
        await h.run('orders_pull_hourly');
        expect(h.pulls).toEqual([
            { mapping: 'orders_pull', context: { isSystem: true, tenantId: 'org_one' }, callerPackageId: APP_ID },
            { mapping: 'orders_pull', context: { isSystem: true, tenantId: 'org_one' }, callerPackageId: APP_ID },
        ]);
        expect(systemWriteOrganization).toHaveBeenCalledTimes(2);
    });

    it('CONTROL: a job that declares an organization runs as it, and the engine is not asked', async () => {
        const systemWriteOrganization = decide({ kind: 'derived', organizationId: 'org_one' });
        const h = harness({ engine: { systemWriteOrganization } });
        await h.schedule([{ ...PULL_JOB, organization: 'org_a' }]);

        await h.run('orders_pull_hourly');
        expect(h.pulls).toEqual([{ mapping: 'orders_pull', context: { isSystem: true, tenantId: 'org_a' }, callerPackageId: APP_ID }]);
        expect(systemWriteOrganization).not.toHaveBeenCalled();
    });

    for (const [label, decision] of [
        ['refuse (several organizations)', { kind: 'refuse', reason: 'ambiguous-organization', organizationCount: 2 }],
        ['refuse (no organization)', { kind: 'refuse', reason: 'no-organization', organizationCount: 0 }],
        ['refuse (a walled posture)', { kind: 'refuse', reason: 'walled-posture' }],
        ['no-organization-object', { kind: 'no-organization-object' }],
    ] as const) {
        it(`CONTROL: ${label} keeps today's context, and nothing is said`, async () => {
            const h = harness({ engine: { systemWriteOrganization: decide(decision) } });
            await h.schedule([PULL_JOB]);

            expect(await h.run('orders_pull_hourly')).toEqual({ outcome: 'completed' });
            expect(h.pulls).toEqual([{ mapping: 'orders_pull', context: { isSystem: true }, callerPackageId: APP_ID }]);
            expect(h.said('warn')).toEqual([]);
        });
    }

    it('CONTROL: an engine that does not answer the question keeps today\'s context', async () => {
        const h = harness();
        await h.schedule([PULL_JOB]);

        await h.run('orders_pull_hourly');
        expect(h.pulls).toEqual([{ mapping: 'orders_pull', context: { isSystem: true }, callerPackageId: APP_ID }]);
    });

    it('a probe that throws is said once at warn, naming the job, and the run goes on with today\'s context', async () => {
        const systemWriteOrganization = vi.fn(async () => { throw new Error('connection reset'); });
        const h = harness({ engine: { systemWriteOrganization } });
        await h.schedule([PULL_JOB]);

        expect(await h.run('orders_pull_hourly')).toEqual({ outcome: 'completed' });
        expect(h.pulls).toEqual([{ mapping: 'orders_pull', context: { isSystem: true }, callerPackageId: APP_ID }]);
        const warns = h.logger.warn.mock.calls.filter((c) => String(c[0]).includes("'orders_pull_hourly'"));
        expect(warns).toHaveLength(1);
        expect(warns[0][1]).toMatchObject({ job: 'orders_pull_hourly', mapping: 'orders_pull', error: 'connection reset' });
    });

    it('CONTROL: a body job and a handler job with no organization keep { isSystem: true }, and the engine is not asked', async () => {
        const systemWriteOrganization = decide({ kind: 'derived', organizationId: 'org_one' });
        const h = harness({ engine: { systemWriteOrganization } });
        const seen: unknown[] = [];
        const body = { language: 'js', capabilities: ['api.write'], source: "await ctx.api.object('tick').insert({ name: 'tick' });" };
        await h.schedule(
            [{ name: 'plain_body', schedule: INTERVAL, body }, { name: 'plain_fn', schedule: INTERVAL, handler: 'sweep' }],
            { functions: { sweep: async (jobCtx: { executionContext?: unknown }) => { seen.push(jobCtx.executionContext); } } },
        );

        await h.run('plain_body');
        await h.run('plain_fn');
        expect(h.writes.map((w) => w.context)).toEqual([{ isSystem: true }]);
        expect(seen).toEqual([{ isSystem: true }]);
        expect(systemWriteOrganization).not.toHaveBeenCalled();
    });
});

/**
 * The same, against the REAL engine: `ObjectQL` over a `SqlDriver`
 * (better-sqlite3 `:memory:`), the real protocol and the real `runImport`. The
 * `automation` service here runs the import step a connector pull runs
 * (`connector-pull.ts`: `runImport` over the protocol, under the pull's
 * `context`), with the pulled records in hand, so the pin reads the query the
 * match lookup actually sends. Before this, a no-organization job's lookup was
 * `where external_id = ?` (a scan per row under `single`, where the engine adds
 * no tenant scope to a read, ADR-0131 D11), while its writes were stamped with
 * the one organization anyway.
 */
describe('a no-organization job pull on a real engine: the match lookup carries the organization its writes carry', () => {
    withPosture('single');

    const ITEM = {
        name: 'po_item_31823', label: 'Item',
        fields: {
            external_id: { name: 'external_id', type: 'text' as const, label: 'External id', unique: true },
            title: { name: 'title', type: 'text' as const, label: 'Title' },
        },
    };
    const ORG_OBJECT = { name: 'sys_organization', label: 'Organization', fields: { name: { name: 'name', type: 'text' as const, label: 'Name' } } };
    const metaMap = new Map<string, ExportFieldMeta>([
        ['external_id', { name: 'external_id', type: 'text' }],
        ['title', { name: 'title', type: 'text' }],
    ]);
    const live: ObjectQL[] = [];
    afterEach(async () => {
        while (live.length) {
            try { await live.pop()?.destroy(); } catch { /* noop */ }
        }
    });

    interface Statement { sql: string; bindings: unknown[] }

    async function boot(organizations: string[]) {
        const engine = new ObjectQL();
        live.push(engine);
        engine.setTenancyPostureProvider(() => 'single');
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of [ITEM, ORG_OBJECT, SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
            if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
        }
        await engine.syncSchemas();
        // The install's organizations, planted through the driver (each its own
        // owner, as the Default Organization row is): the engine only reads
        // them, through its organization probe.
        for (const id of organizations) await driver.create('sys_organization', { id, name: id, organization_id: id });
        const knex = (driver as unknown as { knex: any }).knex;
        const protocol = new ObjectStackProtocolImplementation(engine as any) as unknown as ImportProtocolLike;

        const lookups: Statement[] = [];
        knex.on('query', (q: Statement) => {
            if (/^select \*/i.test(q.sql) && q.sql.includes(`\`${ITEM.name}\``) && q.sql.includes('`external_id` = ?')) {
                lookups.push({ sql: q.sql, bindings: q.bindings });
            }
        });
        const contexts: unknown[] = [];
        const summaries: ImportRunSummary[] = [];
        const automation = {
            pullConnectorSource: vi.fn(async ({ context }: { mapping: string; context: Record<string, unknown> }) => {
                contexts.push(context);
                const summary = await runImport({
                    p: protocol, objectName: ITEM.name, context, metaMap,
                    rows: [{ external_id: 'E1', title: 'pulled' }, { external_id: 'E2', title: 'pulled' }],
                    writeMode: 'upsert', matchFields: ['external_id'], dryRun: false, runAutomations: true,
                    treatAsHistorical: false, trimWhitespace: true, createMissingOptions: false, skipBlankMatchKey: true,
                });
                summaries.push(summary);
                return { ...result(), summary };
            }),
        };
        const h = harness({ automation });
        const schedule = (jobs: unknown[]) => scheduleAppArtifactJobs(
            { logger: h.logger, getService: (n: string) => h.services[n] ?? (() => { throw new Error(`no ${n}`); })() } as unknown as PluginContext,
            { id: APP_ID, version: '0.1.0', type: 'app', jobs, mappings: [MAPPING] },
            { appId: APP_ID, ql: engine as any, source: 'Test' },
        );
        const stored = async () => (await knex(ITEM.name).select('external_id', 'organization_id').orderBy('external_id')) as Array<Record<string, unknown>>;
        return { h, schedule, lookups, contexts, summaries, stored, engine };
    }

    it('one organization: the pull runs as it, its lookup carries it on the tenant column, and its writes are stamped with it', async () => {
        const b = await boot(['org_one']);
        await b.schedule([PULL_JOB]);

        await b.h.run('orders_pull_hourly');
        expect(b.contexts).toEqual([{ isSystem: true, tenantId: 'org_one' }]);
        expect(b.lookups).toHaveLength(2);
        for (const [i, key] of (['E1', 'E2'] as const).entries()) {
            expect(b.lookups[i].sql).toMatch(/where `organization_id` = \? and `external_id` = \?/);
            expect(b.lookups[i].bindings.slice(0, 2)).toEqual(['org_one', key]);
        }
        expect(b.summaries[0]).toMatchObject({ errors: 0, created: 2 });
        expect(await b.stored()).toEqual([
            { external_id: 'E1', organization_id: 'org_one' },
            { external_id: 'E2', organization_id: 'org_one' },
        ]);

        // A second run matches the rows the first created: the same organization.
        await b.h.run('orders_pull_hourly');
        expect(b.summaries[1]).toMatchObject({ errors: 0, created: 0, updated: 2 });
    });

    it('CONTROL: a job that declares the organization reads and writes the same way, and the engine is not asked', async () => {
        const b = await boot(['org_one']);
        const asked = vi.spyOn(b.engine, 'systemWriteOrganization');
        await b.schedule([{ ...PULL_JOB, organization: 'org_one' }]);

        await b.h.run('orders_pull_hourly');
        expect(b.contexts).toEqual([{ isSystem: true, tenantId: 'org_one' }]);
        expect(b.lookups[0].bindings.slice(0, 2)).toEqual(['org_one', 'E1']);
        expect(asked).not.toHaveBeenCalled();
    });

    it('CONTROL: two organizations: the pull runs with none, its lookup is the key alone, and its writes refuse as today', async () => {
        const b = await boot(['org_one', 'org_two']);
        await b.schedule([PULL_JOB]);

        await b.h.run('orders_pull_hourly');
        expect(b.contexts).toEqual([{ isSystem: true }]);
        expect(b.lookups[0].sql).not.toContain('organization_id');
        expect(b.summaries[0]).toMatchObject({ errors: 2, created: 0 });
        expect(JSON.stringify(b.summaries[0].results)).toContain('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
        expect(await b.stored()).toEqual([]);
    });
});

/**
 * [#32071 Part B, ADR-0150 D3] A pull job's run names the package that
 * declares the job as `callerPackageId`, so the automation service reads its
 * mapping from that package. On an artifact of several packages that is the
 * body declaring the job (`jobDeclaringPackages`, over
 * `resolveArtifactPackageOrder`), never the top-level id the job service keys
 * every job under; a top-level job no body declares is the residual, declared
 * from the top-level id.
 */
describe('[#32071] a pull job names the package that declares it', () => {
    withPosture(undefined);

    it('a single-package artifact: the app itself', async () => {
        const h = harness();
        await h.schedule([PULL_JOB]);
        await h.run('orders_pull_hourly');
        expect(h.pulls).toEqual([{ mapping: 'orders_pull', context: { isSystem: true }, callerPackageId: APP_ID }]);
    });

    it('several packages: each body\'s job its own body; a residual top-level job no package', async () => {
        const residual = { ...PULL_JOB, name: 'residual_pull' };
        const bundle = {
            manifest: { id: 'com.example.maps', name: 'Maps', version: '0.1.0', type: 'app' },
            jobs: [residual],
            packages: [
                { manifest: { id: 'com.example.maps', name: 'Maps', version: '0.1.0', type: 'app', mappings: [MAPPING] } },
                { manifest: { id: 'com.example.jobs', name: 'Jobs', version: '0.1.0', type: 'module', jobs: [PULL_JOB] } },
            ],
        };
        const of = jobDeclaringPackages(bundle, 'com.example.top');
        expect(of(PULL_JOB)).toBe('com.example.jobs');
        // A top-level copy of a body's job (an assembled artifact) is that body's.
        expect(of({ ...PULL_JOB })).toBe('com.example.jobs');
        // The residual's owner is no package (`recordResidualOwner`)…
        expect(of(residual)).toBeUndefined();
        // …unless a body carries the top-level id: then that body is its package.
        expect(jobDeclaringPackages(bundle, 'com.example.maps')(residual)).toBe('com.example.maps');
        // No `packages[]`: every job is the app's.
        expect(jobDeclaringPackages({ id: APP_ID, jobs: [PULL_JOB] }, APP_ID)(PULL_JOB)).toBe(APP_ID);
    });
    it('two bodies each declaring job `sync`, loaded as top-level copies: neither run pulls as the other — each is refused 409 naming both', async () => {
        // A JSON-loaded artifact binds the flattened top-level copies, so the
        // job is met by name, and the name is the two bodies'.
        const h = harness();
        const runs: Array<(c: unknown) => Promise<unknown>> = [];
        h.services.job = { ...(h.services.job as object), schedule: async (_n: string, _s: unknown, run: (c: unknown) => Promise<unknown>) => { runs.push(run); } };
        const sync = { ...PULL_JOB, name: 'sync' };
        const bundle = JSON.parse(JSON.stringify({
            manifest: { id: 'com.example.top', name: 'Top', version: '0.1.0', type: 'app' },
            jobs: [sync, sync],
            packages: [
                { manifest: { id: 'com.example.alpha', name: 'Alpha', version: '0.1.0', type: 'app', mappings: [MAPPING], jobs: [sync] } },
                { manifest: { id: 'com.example.beta', name: 'Beta', version: '0.1.0', type: 'app', mappings: [MAPPING], jobs: [sync] } },
            ],
        }));
        const of = jobDeclaringPackages(bundle, 'com.example.top');
        expect(typeof of({ ...sync }), 'never the first body').toBe('object');
        await scheduleAppArtifactJobs(
            { logger: h.logger, getService: (n: string) => h.services[n] } as unknown as PluginContext,
            bundle,
            { appId: 'com.example.top', ql: undefined, source: 'Test' },
        );
        expect(runs.length).toBeGreaterThan(0);
        for (const run of runs) {
            const err = await run({ jobId: 'sync' }).then(() => undefined, (e: unknown) => e as { code?: string; status?: number; message?: string });
            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'RESOURCE_CONFLICT', status: 409 });
            expect(err?.message).toContain('com.example.alpha');
            expect(err?.message).toContain('com.example.beta');
        }
        // Before any call or write: no pull was asked for, as any package or as none.
        expect(h.pulls).toEqual([]);
    });

    it('a residual top-level job\'s run names no package, so the pull reads by no package as before', async () => {
        const h = harness();
        const residual = { ...PULL_JOB, name: 'residual_pull' };
        const out = await scheduleAppArtifactJobs(
            { logger: h.logger, getService: (n: string) => h.services[n] } as unknown as PluginContext,
            {
                manifest: { id: 'com.example.top', name: 'Top', version: '0.1.0', type: 'app' },
                jobs: [residual],
                packages: [
                    { manifest: { id: 'com.example.maps', name: 'Maps', version: '0.1.0', type: 'app', mappings: [MAPPING] } },
                ],
            },
            { appId: 'com.example.top', ql: undefined, source: 'Test' },
        );
        expect(out.pulls).toEqual(['residual_pull']);
        await h.run('residual_pull');
        expect(h.pulls).toEqual([{ mapping: 'orders_pull', context: { isSystem: true } }]);
        expect(Object.keys(h.pulls[0] as object)).not.toContain('callerPackageId');
    });
});

/**
 * [#32355, ADR-0150 D3] A job name a package body declares and the residual
 * carries too. `composeStacks(…, { manifest: 'preserve' })` with an input that
 * has no `manifest` emits that input's jobs at the top level only (the
 * residual), beside the flattened copies of every body's jobs; loaded from JSON,
 * the binder meets them all by name. The residual's job is not the body's, so
 * the name is attributed to neither: each run is refused before any call or
 * write, naming the declaring body and the residual. The job service keys both
 * under the one name and keeps the later; when that is the residual's job, it
 * was pulled as the body before.
 */
describe('[#32355] a job name a package body declares and the residual carries is attributed to neither', () => {
    withPosture(undefined);

    const SYNCED = { name: 'order', label: 'Order', managedBy: 'synced', fields: { external_id: { type: 'text', label: 'External id' } } };
    const mappingOf = (name: string, connector: string) => ({ ...MAPPING, name, connectorSource: { connector, action: 'request' } });
    const pullJob = (name: string, mapping: string) => ({ name, schedule: INTERVAL, pull: { mapping } });
    const alpha = (jobs: unknown[]) => defineStack({
        manifest: { id: 'com.example.alpha', name: 'Alpha', version: '0.1.0', type: 'module' },
        objects: [SYNCED],
        mappings: [mappingOf('alpha_map', 'alpha_api')],
        jobs,
    } as never);
    // No `manifest`: its jobs reach the artifact's top level and no package body.
    const host = (jobs: unknown[]) => defineStack({
        objects: [{ ...SYNCED, name: 'host_record', label: 'Host record' }],
        mappings: [{ ...mappingOf('host_map', 'host_api'), targetObject: 'host_record' }],
        jobs,
    } as never);
    const beta = defineStack({
        manifest: { id: 'com.example.beta', name: 'Beta', version: '0.1.0', type: 'app' },
        objects: [{ ...SYNCED, name: 'beta_record', label: 'Beta record' }],
    } as never);
    /** The artifact as `os build` writes it and a boot reads it back: composed, then through JSON. */
    const jsonLoaded = (stacks: unknown[]) =>
        JSON.parse(JSON.stringify(composeStacks(stacks as never[], { manifest: 'preserve' }))) as Record<string, any>;

    /**
     * Schedule `bundle` as `appId` on a real job service (`CronJobAdapter`), then fire every job it holds:
     * what each run answered, and every pull asked. Real, because the service keys both jobs of a shared
     * name under one key and the later replaces the earlier, so which job survives is the service's to say.
     */
    async function scheduleAndRun(bundle: unknown, appId: string) {
        const h = harness();
        const adapter = new CronJobAdapter();
        type Thrown = { code?: string; status?: number; message?: string };
        const thrown = new Map<string, Thrown>();
        const schedule = adapter.schedule.bind(adapter);
        adapter.schedule = (key, when, run, options) => schedule(key, when, async (c) => {
            try { return await run(c); } catch (e) { thrown.set(key, e as Thrown); throw e; }
        }, options);
        h.services.job = adapter;
        try {
            const out = await scheduleAppArtifactJobs(
                { logger: h.logger, getService: (n: string) => h.services[n] } as unknown as PluginContext,
                bundle,
                { appId, ql: undefined, source: 'Test' },
            );
            const answers: Array<Thrown & { key: string; run?: string }> = [];
            for (const key of await adapter.listJobs()) {
                await adapter.trigger(key);
                const err = thrown.get(key);
                const run = (await adapter.getExecutions(key)).at(-1)?.status;
                answers.push({ key, run, code: err?.code, status: err?.status, message: err?.message });
            }
            return { out, answers, pulls: h.pulls };
        } finally {
            await adapter.destroy();
        }
    }

    it('the artifact a build emits carries the pair: the body job copied to the top level, and the residual\'s own job of the same name', () => {
        const bundle = jsonLoaded([alpha([pullJob('sync', 'alpha_map')]), host([pullJob('sync', 'host_map')]), beta]);
        expect(bundle.manifest.id).toBe('com.example.beta');
        expect(bundle.jobs.map((j: any) => [j.name, j.pull.mapping])).toEqual([['sync', 'alpha_map'], ['sync', 'host_map']]);
        expect(bundle.packages.map((p: any) => [p.manifest.id, (p.manifest.jobs ?? []).map((j: any) => j.name)]))
            .toEqual([['com.example.alpha', ['sync']], ['com.example.beta', []]]);
    });

    it('JSON-loaded, on a real job service: the run of the name is refused 409 naming the body and the residual — never pulled as the body', async () => {
        const bundle = jsonLoaded([alpha([pullJob('sync', 'alpha_map')]), host([pullJob('sync', 'host_map')]), beta]);
        const { out, answers, pulls } = await scheduleAndRun(bundle, 'com.example.beta');
        // Both are scheduled, under one key: the later (the residual's, `host_map`) replaces the body's copy.
        expect(out.pulls).toEqual(['sync', 'sync']);
        expect(answers.map((a) => [a.key, a.run])).toEqual([['sync', 'failed']]);
        expect({ code: answers[0].code, status: answers[0].status }).toEqual({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect(answers[0].message).toContain('package "com.example.alpha"');
        expect(answers[0].message).toContain('package "com.example.beta"');
        // Before any call or write: no pull was asked for, as any package or as none —
        // never `host_map` pulled as `com.example.alpha`, the body that declares the name.
        expect(pulls).toEqual([]);
        // Every job of the name, by name: the refusal, with both packages its candidates.
        const of = jobDeclaringPackages(bundle, 'com.example.beta');
        for (const job of bundle.jobs) {
            expect(of(job)).toMatchObject({
                status: 'refused',
                reason: 'ambiguous-in-environment',
                type: 'job',
                name: 'sync',
                candidates: [{ kind: 'package', packageId: 'com.example.alpha' }, { kind: 'package', packageId: 'com.example.beta' }],
            });
        }
        // A residual whose owner is no package (no body carries the top-level id): named all the same.
        const noPackage = jobDeclaringPackages(bundle, 'com.example.top')(bundle.jobs[1]) as { status?: string; candidates?: unknown; message?: string };
        expect(noPackage.status).toBe('refused');
        expect(noPackage.candidates).toEqual([{ kind: 'package', packageId: 'com.example.alpha' }]);
        expect(noPackage.message).toContain('names no package');
    });

    it('control: the residual\'s owner IS the one declaring body — one holder, that body', async () => {
        // `alpha` last: the artifact's id is alpha's, so the residual runs as alpha, the body that declares `sync`.
        const bundle = jsonLoaded([host([pullJob('sync', 'host_map')]), alpha([pullJob('sync', 'alpha_map')])]);
        expect(bundle.manifest.id).toBe('com.example.alpha');
        const { answers, pulls } = await scheduleAndRun(bundle, 'com.example.alpha');
        expect(answers.map((a) => [a.key, a.run, a.code])).toEqual([['sync', 'success', undefined]]);
        // One key for the pair: the later (the body's copy, `alpha_map`) replaces the residual's, and runs as alpha.
        expect(pulls.map((p: any) => [p.mapping, p.callerPackageId])).toEqual([['alpha_map', 'com.example.alpha']]);
    });

    it('controls: a residual job with a name of its own binds as today, and a body job with no residual twin binds to its body', async () => {
        const bundle = jsonLoaded([
            alpha([pullJob('sync', 'alpha_map'), pullJob('alpha_only', 'alpha_map')]),
            host([pullJob('host_sync', 'host_map'), pullJob('sync', 'host_map')]),
            beta,
        ]);
        const of = jobDeclaringPackages(bundle, 'com.example.beta');
        const byName = (name: string) => bundle.jobs.find((j: any) => j.name === name);
        // The residual's own name: its owner, the body carrying the artifact's id — as before.
        expect(of(byName('host_sync'))).toBe('com.example.beta');
        // …and no package when no body carries that id — as before.
        expect(jobDeclaringPackages(bundle, 'com.example.top')(byName('host_sync'))).toBeUndefined();
        // A body's job no residual job shares a name with: its body.
        expect(of(byName('alpha_only'))).toBe('com.example.alpha');
        // Only the shared name is refused.
        expect(typeof of(byName('sync'))).toBe('object');

        const { answers, pulls } = await scheduleAndRun(bundle, 'com.example.beta');
        expect(answers.map((a) => [a.key, a.run, a.code])).toEqual([
            ['alpha_only', 'success', undefined],
            ['host_sync', 'success', undefined],
            ['sync', 'failed', 'RESOURCE_CONFLICT'],
        ]);
        expect(pulls).toEqual([
            { mapping: 'alpha_map', context: { isSystem: true }, callerPackageId: 'com.example.alpha' },
            { mapping: 'host_map', context: { isSystem: true }, callerPackageId: 'com.example.beta' },
        ]);
    });
});
