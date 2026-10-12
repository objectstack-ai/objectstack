// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23029: `AppPlugin`'s job scheduling and datasource readers take the boot's
 * ONE ADR-0087 forward conversion (`forwardConverted`, #22994), the copy the
 * `manifest` service and the security registrar already take.
 *
 * Three major-18 retired entries rename a duration key so that its unit is in
 * its name, each `retiredAfter` 17.3.0:
 *
 *   job-timeout-to-timeout-ms                     jobs[].timeout                            -> timeoutMs
 *   turso-config-timeout-to-timeout-ms            datasources[].config.timeout (turso)      -> config.timeoutMs
 *   memory-persistence-auto-save-interval-to-ms   datasources[].config.persistence.autoSaveInterval (memory)
 *                                                                                           -> autoSaveIntervalMs
 *
 * The scheduler reads `job.timeoutMs` and the drivers read `config.timeoutMs` /
 * `autoSaveIntervalMs`. Read off the RAW bundle, an artifact built by 17.x
 * tooling handed them none of the three, and the duration fell back to the
 * scheduler's or the driver's default with no notice.
 *
 * The route these pins take is a `plugins[]` bundle entry, by the one rule
 * `os serve` and `bootStack` wrap it by (`materializeStackPlugin`): the bundle
 * reaches `new AppPlugin(bundle)` as authored, because `loadArtifactBundle`
 * (which converts at load, #23027) is not on that route. The artifact declares
 * no `engines.protocol`: the D1 handshake admits it with a warning and the
 * conversion window opens (`converted-undeclared`). One that declares `^17`
 * is refused at D1 before any reader runs, so it is not this defect.
 *
 * Measured on `origin/main` 7f2f081e8a, before this change, through that route:
 * the job was scheduled with no options at all, and both datasources were
 * registered and handed to `connectDeclared` with the retired keys.
 */

import { describe, it, expect, vi } from 'vitest';
import { materializeStackPlugin } from '@objectstack/core';
import { AppPlugin } from './app-plugin.js';
import { withScheduledWorkOn } from './scheduled-work.test-support.js';

// [#17396] Package-authored jobs are scheduled only where the deployment runs
// package-authored scheduled work; these pins measure the READER.
withScheduledWorkOn();

const APP_ID = 'com.test.issue-23029';
const MANIFEST = { id: APP_ID, name: 'Converted Readers Probe', type: 'app', version: '1.0.0' } as const;
/** The ADR-0010 stamps the code-defined registration applies, plus its `origin`. */
const STAMPS = { origin: 'code', _packageId: APP_ID, _packageVersion: '1.0.0', _provenance: 'package' } as const;
const SCHEDULE = { type: 'interval', intervalMs: 60_000 } as const;
/** A body that never returns: only the job's own limit stops it. */
const SPIN_BODY = { language: 'js', source: 'while (true) {}' } as const;

/** Fresh bytes per boot: the readers stamp and the conversion rewrites what they are handed. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The card's artifact: every one of the three keys in its retired spelling. */
const RETIRED_ARTIFACT = {
    manifest: MANIFEST,
    jobs: [{ name: 'spin_job', schedule: SCHEDULE, body: SPIN_BODY, timeout: 40 }],
    datasources: [
        { name: 'edge_db', driver: 'turso', config: { url: 'libsql://app.turso.io', timeout: 30_000 } },
        {
            name: 'local_cache',
            driver: 'memory',
            config: { persistence: { type: 'file', path: '/var/data/cache.json', autoSaveInterval: 5_000 } },
        },
    ],
    objects: [{ name: 'edge_note', datasource: 'edge_db', fields: { title: { type: 'text' } } }],
};

/** The CONTROL: the same app authored in the current spellings. Nothing to convert. */
const CURRENT_ARTIFACT = {
    manifest: MANIFEST,
    jobs: [{ name: 'spin_job', schedule: SCHEDULE, body: SPIN_BODY, timeoutMs: 40 }],
    datasources: [
        { name: 'edge_db', driver: 'turso', config: { url: 'libsql://app.turso.io', timeoutMs: 30_000 } },
        {
            name: 'local_cache',
            driver: 'memory',
            config: { persistence: { type: 'file', path: '/var/data/cache.json', autoSaveIntervalMs: 5_000 } },
        },
    ],
    objects: [{ name: 'edge_note', datasource: 'edge_db', fields: { title: { type: 'text' } } }],
};

/**
 * A kernel context that captures what each reader is handed: the `manifest`
 * payload, the metadata registrations, `connectDeclared`'s input and what the
 * job service is asked to schedule. Unknown services answer `undefined`, the
 * optional reads `start()` degrades past.
 */
function capturingBoot() {
    const payloads: any[] = [];
    const registrations: Array<{ type: string; name: string; item: any }> = [];
    const connectInputs: any[] = [];
    const scheduled = new Map<string, { run: (c: any) => Promise<unknown>; options: unknown }>();
    const ready: Array<() => Promise<void>> = [];
    const services: Record<string, unknown> = {
        manifest: { register: (payload: unknown) => { payloads.push(payload); } },
        objectql: { setDatasourceMapping: () => undefined },
        metadata: {
            registerInMemory: (type: string, name: string, item: unknown) => {
                registrations.push({ type, name, item });
            },
        },
        'datasource-connection': {
            connectDeclared: async (input: unknown) => { connectInputs.push(input); return []; },
        },
        job: {
            schedule: async (name: string, _schedule: unknown, run: (c: any) => Promise<unknown>, options?: unknown) => {
                scheduled.set(name, { run, options });
            },
            cancel: async () => undefined,
            trigger: async () => undefined,
        },
    };
    const ctx = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn((name: string) => services[name]),
        getServices: vi.fn(() => new Map()),
        hook: vi.fn((event: string, cb: () => Promise<void>) => { if (event === 'kernel:ready') ready.push(cb); }),
        trigger: vi.fn(),
    } as any;
    /** A `plugins[]` bundle entry, wrapped and booted the way `os serve` mounts one. */
    const boot = async (bundle: Record<string, unknown>) => {
        const plugin: any = await materializeStackPlugin(bundle, {
            importSpecifier: async () => { throw new Error('this pin mounts a bundle entry, never a specifier'); },
            wrapBundle: (entry) => new AppPlugin(entry),
        });
        expect(plugin).toBeInstanceOf(AppPlugin);
        await plugin.init(ctx);
        await plugin.start(ctx);
        for (const cb of ready) await cb();
    };
    const datasources = () => registrations.filter((r) => r.type === 'datasource');
    return { ctx, boot, payloads, datasources, connectInputs, scheduled };
}

describe('#23029: a plugins[] bundle entry authored by 17.x tooling keeps its durations', () => {
    it('jobs[].timeout: the job is scheduled with that duration as timeoutMs, and it bounds the run', async () => {
        const h = capturingBoot();
        await h.boot(copy(RETIRED_ARTIFACT));

        const job = h.scheduled.get('spin_job');
        expect(job, 'the job is scheduled').toBeDefined();
        expect(job!.options).toEqual({ retryPolicy: undefined, timeoutMs: 40 });
        // The duration is honoured, not merely threaded: the job's limit is the
        // one a body job runs under.
        await expect(job!.run({ jobId: 'spin_job' })).rejects.toThrow(/job 'spin_job' exceeded CPU budget of 40ms/);
    });

    it('turso config.timeout: registered and connected with config.timeoutMs, stamped as before', async () => {
        const h = capturingBoot();
        await h.boot(copy(RETIRED_ARTIFACT));

        const edge = { name: 'edge_db', driver: 'turso', config: { url: 'libsql://app.turso.io', timeoutMs: 30_000 } };
        expect(h.datasources().find((r) => r.name === 'edge_db')?.item).toStrictEqual({ ...edge, ...STAMPS });
        expect(h.connectInputs).toHaveLength(1);
        expect(h.connectInputs[0].datasources.find((d: any) => d.name === 'edge_db')).toStrictEqual(edge);
    });

    it('memory config.persistence.autoSaveInterval: registered and connected with autoSaveIntervalMs, stamped as before', async () => {
        const h = capturingBoot();
        await h.boot(copy(RETIRED_ARTIFACT));

        const cache = {
            name: 'local_cache',
            driver: 'memory',
            config: { persistence: { type: 'file', path: '/var/data/cache.json', autoSaveIntervalMs: 5_000 } },
        };
        expect(h.datasources().find((r) => r.name === 'local_cache')?.item).toStrictEqual({ ...cache, ...STAMPS });
        expect(h.connectInputs[0].datasources.find((d: any) => d.name === 'local_cache')).toStrictEqual(cache);
    });

    it('one conversion: connectDeclared is handed the very objects the manifest service registered', async () => {
        const h = capturingBoot();
        await h.boot(copy(RETIRED_ARTIFACT));

        expect(h.payloads).toHaveLength(1);
        const payload = h.payloads[0];
        // A second pass would hand the reader a second, equal-looking copy;
        // identity is what tells the two apart.
        expect(h.connectInputs[0].datasources).toBe(payload.datasources);
        expect(h.connectInputs[0].objects).toBe(payload.objects);
    });
});

describe('#23029 control: an artifact authored in the current spellings is read exactly as authored', () => {
    it('the job keeps its timeoutMs; each datasource is registered byte for byte with the same stamps, and connected by reference', async () => {
        const authored = copy(CURRENT_ARTIFACT);
        const h = capturingBoot();
        await h.boot(authored);

        expect(h.scheduled.get('spin_job')?.options).toEqual({ retryPolicy: undefined, timeoutMs: 40 });
        expect(h.datasources().map((r) => [r.name, r.item])).toStrictEqual(
            authored.datasources.map((ds) => [ds.name, { ...ds, ...STAMPS }]),
        );
        // Copy-on-write: a conversion that changed nothing returns what it was
        // given, so the reader is handed the authored array itself.
        expect(h.connectInputs[0].datasources).toBe(authored.datasources);
        expect(h.connectInputs[0].objects).toBe(authored.objects);
        // The author's definition is not written to: the stamp lands on a copy.
        expect(authored.datasources[0]).not.toHaveProperty('_packageId');
    });

    it("the manifest's glob lists are not read as declarations: a stack declaring no datasources registers and connects none", async () => {
        // `ManifestSchema` declares `datasources` / `objects` as glob-pattern
        // lists. The converted copy is `{ ...manifest, ...collections }`, so it
        // carries them where the stack declares neither; which source the
        // readers take is decided on the raw inputs, as before.
        const h = capturingBoot();
        await h.boot({
            manifest: { ...MANIFEST, datasources: ['src/**/*.datasource.ts'], objects: ['src/**/*.object.ts'] },
            dashboards: [{ name: 'ops_board', label: 'Ops Board', widgets: [] }],
        });

        expect(h.datasources()).toEqual([]);
        expect(h.connectInputs).toEqual([]);
    });
});
