// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21489 — an installed package's job BODIES are scheduled, on the install
 * route and on the `kernel:ready` rehydrate, through the binder's job half
 * (`scheduleAppArtifactJobs`, the call `AppPlugin` makes on `kernel:ready`); and
 * the install route REFUSES a package whose enabled job has no `body`.
 *
 * The defect: a package's jobs were never scheduled by this door, hot or after
 * a restart. A job's code was only ever a `handler` — the name of a
 * `defineStack({ functions })` entry, which travels in the artifact's runtime
 * module, never in the JSON this door installs — so a handler-only package
 * installed with a 200 and its job never ran, with nothing saying so.
 *
 * What this file pins, against the scheduler's state and the engine's writes
 * rather than a call:
 *
 *   - install: the body job is handed to `IJobService.schedule`, and a run
 *     executes the body — its `ctx.api` write lands, as system;
 *   - rehydrate: a ledger entry written by an earlier process schedules the same
 *     way when a fresh plugin reaches `kernel:ready`;
 *   - refusal: a handler-only enabled job answers `422 VALIDATION_ERROR` naming
 *     the job, its handler and both remedies, and the runtime is left exactly as
 *     it was found — nothing registered, persisted or scheduled;
 *   - #21585: so does an enabled job whose `body` the declaration refuses (an
 *     expression body, a `body.timeoutMs`), naming the refused key;
 *   - so does an enabled job whose `pull` does not bind (a mapping the package
 *     does not declare, one with no `connectorSource`), naming the refusal the
 *     binder's own `judgeJobPull` gives; a pull naming a declared mapping
 *     installs and is scheduled, a DISABLED unbindable one installs, and an
 *     entry an earlier build persisted rehydrates with its unbindable pull job
 *     withheld and warned by name;
 *   - a package without jobs, and one whose handler-only job is DISABLED,
 *     install unchanged.
 *
 * The binder is the REAL `@objectstack/runtime` export (resolved through its
 * `exports`, i.e. its built `dist/`, like the plugin's own lazy import), and so
 * is the QuickJS sandbox the body runs in.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The first load of the runtime's dist paid at module top, never inside a
// clocked `it` (the clocked-window rule, `scripts/check-test-source-alias.mjs`):
// the plugin reaches the same module through a dynamic `import()`.
import '@objectstack/runtime';
import { SCHEDULED_WORK_ENV } from '@objectstack/types';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

const APP_ID = 'com.example.jobsapp';
const TICK = 'jobs_app_tick';
const INTERVAL = { type: 'interval', intervalMs: 1000 };

const BODY_JOB = {
    name: 'jobs_app_tick_body',
    schedule: INTERVAL,
    body: { language: 'js', capabilities: ['api.write'], source: `await ctx.api.object('${TICK}').insert({ name: 'tick' });` },
    timeoutMs: 10_000,
};
const HANDLER_JOB = { name: 'jobs_app_tick_handler', schedule: INTERVAL, handler: 'tick' };

/** The compiled-artifact shape `os build` writes and `os package install` sends. */
function artifact(jobs: unknown[] | undefined, id: string = APP_ID) {
    return {
        manifest: { id, namespace: 'jobs_app', version: '0.1.0', type: 'app', name: 'Jobs App' },
        objects: [{ name: TICK, label: 'Tick', fields: { name: { type: 'text', label: 'Name' } } }],
        ...(jobs ? { jobs } : {}),
    };
}

/** The engine surface a job body's `ctx.api` writes through, as state. */
function recordingEngine() {
    const writes: Array<{ object: string; data: unknown; context: unknown }> = [];
    return {
        writes,
        engine: {
            syncSchemas: async () => undefined,
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

/** `IJobService` as state: what was handed to `schedule`, by job name. */
function recordingJobService() {
    const scheduled = new Map<string, { run: (c: any) => Promise<unknown>; options: unknown }>();
    const cancels: string[] = [];
    return {
        scheduled,
        cancels,
        svc: {
            schedule: vi.fn(async (name: string, _schedule: unknown, run: (c: any) => Promise<unknown>, options?: unknown) => {
                scheduled.set(name, { run, options });
            }),
            // The adapters' own semantics: `cancel` stops the job and forgets it.
            cancel: async (name: string) => { cancels.push(name); scheduled.delete(name); },
            trigger: async () => undefined,
        },
    };
}

/**
 * The protocol's uninstall-cleanup registry, as its two verbs behave
 * (`packages/metadata-protocol`, #21490): one cleanup per name, and ONE runner
 * that calls every registered cleanup with the package id and reports each
 * outcome. The runner itself is pinned where it lives; this models it so the
 * door's `DELETE` reaches what the binder registered.
 */
function registryProtocol() {
    const cleanups = new Map<string, (args: { packageId: string }) => Promise<{ success: boolean; removed: number; error?: string }>>();
    return {
        registerUninstallCleanup: (name: string, cleanup: any) => { cleanups.set(name, cleanup); },
        runUninstallCleanups: async (request: { packageId: string }) => {
            const out: unknown[] = [];
            for (const [name, cleanup] of cleanups) out.push({ name, ...(await cleanup({ packageId: request.packageId })) });
            return out;
        },
    };
}

function makeDeleteC(manifestId: string) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: `http://localhost:3000/api/v1/marketplace/install-local/${manifestId}`,
            raw: new Request('http://localhost:3000/x'),
            json: async () => ({}),
            param: (name: string) => (name === 'manifestId' ? manifestId : undefined),
        },
        json,
    };
}

/**
 * The package ids handed to `manifest.register` — the plugin also registers its
 * own Setup nav bundle at `kernel:ready`, which is not the package under test.
 */
const registered = (register: ReturnType<typeof vi.fn>) =>
    register.mock.calls.map(([m]) => (m as { id?: string })?.id).filter((id) => id === APP_ID);

type Handler = (c: any) => Promise<any>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json,
    };
}

let dir: string;
let priorSwitch: string | undefined;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-jobs-'));
    // [#17396] Package-authored scheduled work is OFF by default in every
    // posture; this runtime is one that runs it.
    priorSwitch = process.env[SCHEDULED_WORK_ENV];
    process.env[SCHEDULED_WORK_ENV] = 'true';
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (priorSwitch === undefined) delete process.env[SCHEDULED_WORK_ENV];
    else process.env[SCHEDULED_WORK_ENV] = priorSwitch;
    vi.restoreAllMocks();
});

async function bootPlugin() {
    const rec = recordingEngine();
    const jobs = recordingJobService();
    const register = vi.fn();
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    // The `automation` service a pull job's run calls (`IAutomationService.pullConnectorSource`).
    const automation = {
        pullConnectorSource: vi.fn(async (request: { mapping: string }) => ({
            mapping: request.mapping, targetObject: 'order', connector: 'orders_api', action: 'request', pulled: 0,
            summary: { total: 0, processed: 0, created: 0, updated: 0, skipped: 0, errors: 0, ok: 0, cancelled: false },
        })),
    };
    const services: Record<string, unknown> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants(rec.engine),
        job: jobs.svc,
        protocol: registryProtocol(),
        automation,
    };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx as any);
    await hooks.get('kernel:ready')?.();
    const install = async (bundle: unknown) =>
        rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest: bundle }));
    const uninstall = async (manifestId: string) =>
        rawApp.routes.get('DELETE /api/v1/marketplace/install-local/:manifestId')!(makeDeleteC(manifestId));
    return { install, uninstall, rec, jobs, register, logger, automation };
}

describe('#21489: install-local schedules an installed package’s job bodies', () => {
    it('install — the body job is scheduled, and a run executes the body (its write lands, as system)', async () => {
        const { install, rec, jobs } = await bootPlugin();

        const res = await install(artifact([BODY_JOB]));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect([...jobs.scheduled.keys()]).toEqual([BODY_JOB.name]);
        // The job's own `timeoutMs` reaches the adapter.
        expect(jobs.scheduled.get(BODY_JOB.name)!.options).toEqual({ retryPolicy: undefined, timeoutMs: 10_000 });

        await jobs.scheduled.get(BODY_JOB.name)!.run({ jobId: BODY_JOB.name });

        expect(rec.writes).toEqual([{ object: TICK, data: { name: 'tick' }, context: { isSystem: true } }]);
    });

    it('rehydrate — a ledger entry from an earlier process schedules its body job at kernel:ready', async () => {
        const { manifest: meta, ...sections } = artifact([BODY_JOB]);
        new LocalManifestSource(dir).write({
            packageId: APP_ID,
            versionId: 'local',
            manifestId: APP_ID,
            version: '0.1.0',
            // What the install route persists: the compiled bundle, flattened.
            manifest: { ...meta, ...sections },
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
            withSampleData: false,
        });

        const { rec, jobs } = await bootPlugin();

        expect([...jobs.scheduled.keys()], 'a restart leaves the installed job unscheduled').toEqual([BODY_JOB.name]);
        await jobs.scheduled.get(BODY_JOB.name)!.run({ jobId: BODY_JOB.name });
        expect(rec.writes).toHaveLength(1);
    });
});

describe('#21489: an uninstalled or replaced package’s jobs STOP', () => {
    const OTHER_ID = 'com.example.otherjobs';
    const OTHER_JOB = { ...BODY_JOB, name: 'other_jobs_tick_body' };

    it('DELETE cancels the uninstalled package’s jobs through the uninstall cleanup — and no other package’s', async () => {
        const { install, uninstall, jobs } = await bootPlugin();
        expect((await install(artifact([BODY_JOB]))).status).toBe(200);
        expect((await install(artifact([OTHER_JOB], OTHER_ID))).status).toBe(200);

        const res = await uninstall(APP_ID);

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(jobs.cancels).toEqual([BODY_JOB.name]);
        expect([...jobs.scheduled.keys()], 'the control package’s job keeps running').toEqual([OTHER_JOB.name]);
        expect(res.payload.data.cleanups).toContainEqual({ name: 'runtime.package-jobs', success: true, removed: 1 });
    });

    it('a reinstall whose new version DROPS a job cancels it, and keeps the job it still declares', async () => {
        const { install, jobs } = await bootPlugin();
        const KEPT = { ...BODY_JOB, name: 'jobs_app_kept' };
        const GONE = { ...BODY_JOB, name: 'jobs_app_gone' };
        expect((await install(artifact([KEPT, GONE]))).status).toBe(200);

        expect((await install(artifact([KEPT]))).status).toBe(200);

        expect(jobs.cancels).toEqual([GONE.name]);
        expect([...jobs.scheduled.keys()]).toEqual([KEPT.name]);
    });
});

describe('#21489: install-local refuses an enabled job with no body', () => {
    it('answers 422 VALIDATION_ERROR naming the job, its handler and both remedies — and changes nothing', async () => {
        const { install, rec, jobs, register } = await bootPlugin();

        const res = await install(artifact([BODY_JOB, HANDLER_JOB]));

        expect(res.status).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('VALIDATION_ERROR');
        const message: string = res.payload.error.message;
        expect(message).toContain(`'${HANDLER_JOB.name}' (handler 'tick')`);
        expect(message).toMatch(/give the job a `body`/i);
        expect(message).toContain('os start --artifact');
        // The runtime is left exactly as it was found.
        expect(registered(register), 'a refused package must not be registered').toEqual([]);
        expect(new LocalManifestSource(dir).read(APP_ID).entry, 'nor persisted').toBeNull();
        expect(jobs.svc.schedule, 'nor any of its jobs scheduled — not even its body job').not.toHaveBeenCalled();
        expect(rec.writes).toEqual([]);
    });

    it('names every refused job, so the author fixes them in one pass', async () => {
        const { install } = await bootPlugin();
        const other = { name: 'jobs_app_other', schedule: INTERVAL };

        const res = await install(artifact([HANDLER_JOB, other]));

        expect(res.status).toBe(422);
        expect(res.payload.error.message).toContain(`2 of its enabled jobs '${HANDLER_JOB.name}' (handler 'tick'), 'jobs_app_other' (no handler) have no`);
    });

    it('a DISABLED handler-only job does not block the install, and is not scheduled', async () => {
        const { install, jobs, register } = await bootPlugin();

        const res = await install(artifact([{ ...HANDLER_JOB, enabled: false }]));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(registered(register)).toEqual([APP_ID]);
        expect(jobs.svc.schedule).not.toHaveBeenCalled();
    });

    it('#21585: an enabled job whose body is an expression (L1) is refused, naming the key the declaration refuses — and changes nothing', async () => {
        const { install, jobs, register } = await bootPlugin();
        const l1 = { name: 'jobs_app_expr', schedule: INTERVAL, body: { language: 'expression', source: '1 + 1' } };

        const res = await install(artifact([BODY_JOB, l1]));

        expect(res.status).toBe(422);
        expect(res.payload.error.code).toBe('VALIDATION_ERROR');
        const message: string = res.payload.error.message;
        expect(message).toContain(`its enabled job 'jobs_app_expr' (body.language: `);
        expect(message).toContain('has a `body` the declaration refuses');
        expect(message).toContain('os validate');
        expect(registered(register)).toEqual([]);
        expect(new LocalManifestSource(dir).read(APP_ID).entry).toBeNull();
        expect(jobs.svc.schedule).not.toHaveBeenCalled();
    });

    it('#21585: an enabled job whose body carries timeoutMs is refused, naming the one limit', async () => {
        const { install, jobs } = await bootPlugin();
        const twoLimits = { ...BODY_JOB, name: 'jobs_app_two_limits', body: { ...BODY_JOB.body, timeoutMs: 5_000 } };

        const res = await install(artifact([twoLimits]));

        expect(res.status).toBe(422);
        expect(res.payload.error.code).toBe('VALIDATION_ERROR');
        expect(res.payload.error.message).toContain(`its enabled job 'jobs_app_two_limits' (body.timeoutMs: `);
        expect(res.payload.error.message).toContain("job's own `timeoutMs`");
        expect(jobs.svc.schedule).not.toHaveBeenCalled();
    });

    it('#21585: a DISABLED job with an off-spec body does not block the install', async () => {
        const { install } = await bootPlugin();

        const res = await install(artifact([{ name: 'jobs_app_off', schedule: INTERVAL, enabled: false, body: { language: 'expression', source: '1' } }]));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
    });

    it('a package without jobs installs unchanged — the same answer, nothing scheduled', async () => {
        const { install, jobs, register } = await bootPlugin();

        const res = await install(artifact(undefined));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(Object.keys(res.payload.data).sort()).toEqual([
            'hotLoaded', 'installedAt', 'manifestId', 'note', 'seeded', 'storageDir',
            'translationsLoaded', 'upgradedFrom', 'version', 'versionId',
        ]);
        expect(registered(register)).toEqual([APP_ID]);
        expect(jobs.svc.schedule).not.toHaveBeenCalled();
    });
});

describe('install-local refuses an enabled job whose pull does not bind, by the binder\'s own judgeJobPull', () => {
    const MAPPING = {
        name: 'orders_pull',
        targetObject: TICK,
        fieldMapping: [{ source: 'id', target: 'name' }],
        mode: 'upsert',
        upsertKey: ['name'],
        connectorSource: { connector: 'orders_api', action: 'request' },
    };
    const { connectorSource: _dropped, ...IMPORT_ONLY } = MAPPING;
    const PULL_JOB = { name: 'jobs_app_pull', schedule: INTERVAL, pull: { mapping: 'orders_pull' } };
    const UNDECLARED = { ...PULL_JOB, name: 'jobs_app_pull_typo', pull: { mapping: 'orders_pul' } };

    /** The compiled-artifact shape, carrying `mappings` beside `jobs`. */
    const withMappings = (jobs: unknown[], mappings: unknown[] = [MAPPING]) => ({ ...artifact(jobs), mappings });

    it('a pull naming a mapping the package does not declare answers 422 VALIDATION_ERROR naming the job and the refusal — and changes nothing', async () => {
        const { install, jobs, register, automation } = await bootPlugin();

        const res = await install(withMappings([BODY_JOB, UNDECLARED]));

        expect(res.status).toBe(422);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('VALIDATION_ERROR');
        const message: string = res.payload.error.message;
        expect(message).toContain(`its enabled job '${UNDECLARED.name}' (pull.mapping: this artifact declares no mapping 'orders_pul'`);
        expect(message).toContain('has a `pull` that does not bind');
        expect(message).toContain('os validate');
        // The pull's own clause, never the no-`body` one: a `body` beside a `pull` is refused by the declaration.
        expect(message).not.toMatch(/give the job a `body`/i);
        // The runtime is left exactly as it was found.
        expect(registered(register), 'a refused package must not be registered').toEqual([]);
        expect(new LocalManifestSource(dir).read(APP_ID).entry, 'nor persisted').toBeNull();
        expect(jobs.svc.schedule, 'nor any of its jobs scheduled — not even its body job').not.toHaveBeenCalled();
        expect(automation.pullConnectorSource).not.toHaveBeenCalled();
    });

    it('a pull whose mapping declares no connectorSource is refused the same way', async () => {
        const { install, jobs, register } = await bootPlugin();

        const res = await install(withMappings([PULL_JOB], [IMPORT_ONLY]));

        expect(res.status).toBe(422);
        expect(res.payload.error.code).toBe('VALIDATION_ERROR');
        expect(res.payload.error.message).toContain(`its enabled job '${PULL_JOB.name}' (pull.mapping: mapping 'orders_pull' declares no connectorSource`);
        expect(registered(register)).toEqual([]);
        expect(jobs.svc.schedule).not.toHaveBeenCalled();
    });

    it('one answer names every kind the door cannot run — the unbindable pull beside a job with no body', async () => {
        const { install } = await bootPlugin();

        const res = await install(withMappings([HANDLER_JOB, UNDECLARED]));

        expect(res.status).toBe(422);
        const message: string = res.payload.error.message;
        expect(message).toContain(`'${HANDLER_JOB.name}' (handler 'tick') has no \`body\``);
        expect(message).toContain(`'${UNDECLARED.name}' (pull.mapping: `);
    });

    it('a DISABLED pull job naming an undeclared mapping does not block the install, and is not scheduled', async () => {
        const { install, jobs, register } = await bootPlugin();

        const res = await install(withMappings([{ ...UNDECLARED, enabled: false }]));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect(registered(register)).toEqual([APP_ID]);
        expect(jobs.svc.schedule).not.toHaveBeenCalled();
    });

    it('control: a pull naming a declared mapping with a connectorSource installs, is scheduled, and a run pulls that mapping', async () => {
        const { install, jobs, automation } = await bootPlugin();

        const res = await install(withMappings([PULL_JOB]));

        expect(res.status, JSON.stringify(res.payload)).toBe(200);
        expect([...jobs.scheduled.keys()]).toEqual([PULL_JOB.name]);
        await jobs.scheduled.get(PULL_JOB.name)!.run({ jobId: PULL_JOB.name });
        expect(automation.pullConnectorSource).toHaveBeenCalledTimes(1);
        expect(automation.pullConnectorSource.mock.calls[0][0]).toMatchObject({ mapping: 'orders_pull' });
    });

    it('rehydrate — an entry an earlier build persisted with an unbindable pull job: the job is withheld and warned by name, the bindable one scheduled', async () => {
        const { manifest: meta, ...sections } = withMappings([PULL_JOB, UNDECLARED]);
        new LocalManifestSource(dir).write({
            packageId: APP_ID,
            versionId: 'local',
            manifestId: APP_ID,
            version: '0.1.0',
            manifest: { ...meta, ...sections },
            installedAt: '2026-01-01T00:00:00.000Z',
            installedBy: 'admin',
            withSampleData: false,
        });

        const { jobs, logger, register } = await bootPlugin();

        expect(registered(register), 'the entry still rehydrates').toEqual([APP_ID]);
        expect([...jobs.scheduled.keys()]).toEqual([PULL_JOB.name]);
        const warned = logger.warn.mock.calls.find(([message, meta]) =>
            String(message).includes('NOT scheduled') && (meta as { job?: string } | undefined)?.job === UNDECLARED.name);
        expect(warned, 'no warn names the withheld pull job').toBeDefined();
        expect(String(warned![0])).toContain("pull.mapping: this artifact declares no mapping 'orders_pul'");
    });
});
