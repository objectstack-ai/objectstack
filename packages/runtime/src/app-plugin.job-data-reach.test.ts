// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14094 — a declarative job's handler must be able to READ AND WRITE A RECORD.
 *
 * ## What was measured before the fix
 *
 * A real booted stack with one `defineJob` whose handler records its own
 * argument reported, on `origin/main` `66ecc50a` (and, in the filed card,
 * against published `@objectstack/*` 17.2.0):
 *
 * ```
 * JOB CONTEXT KEYS: bundle, data, jobId
 *    jobId  -> string
 *    data   -> undefined
 *    bundle -> object
 * ```
 *
 * That is the whole context. No engine, no service registry, no logger. The
 * platform ships exactly ONE metadata shape for scheduled work, resolves its
 * handler out of `defineStack({ functions })`, and then hands that handler
 * nothing to write with. The job registers, appears in the admin UI, is
 * scheduled, runs on time, and does nothing — `objectstack validate` passes.
 *
 * ## Why the flow-`script`-node contract is NOT the same case
 *
 * `FlowFunctionContext` carries no engine either, and that is COHERENT for a
 * flow function: the flow graph does the I/O around it (`get_record` before,
 * `create_record` after), which is what #4354's per-run write metrics count.
 * A JOB HAS NO GRAPH — no node before it, none after — so the same emptiness
 * leaves it unable to do the one thing jobs exist for. Nothing here changes
 * what a `script` node receives.
 *
 * ## Why the ARTIFACT path is tested, not just the TS-config path
 *
 * The documented escape (close over a client at module scope, bound from
 * `defineStack({ onEnable })`) does not survive the shipped deployment path:
 * `objectstack build` emits `{ functions, meta }` into a sibling runtime
 * module, the artifact JSON carries no `onEnable`, and `mergeRuntimeModule`
 * merges only `functions`. So the binding is never made on an artifact-served
 * boot and the module-scope slot stays empty — silently. A fix proved only on
 * the TS-config path would be a second escape with the same blind spot, so the
 * artifact boot is driven through the REAL `loadArtifactBundle` here.
 *
 * ## The backend, and why it is sqlite `:memory:`
 *
 * These tests need *a* store — nothing here is about any one driver's behaviour.
 * #5704 migrated this project's test backends to sqlite `:memory:` and ruled
 * that only the two files in `scripts/driver-memory-census.ledger.json` keep
 * `@objectstack/driver-memory`, each being one arm of a cross-family pin that
 * genuinely cannot run on SQL. This file is neither, so it boots on the migrated
 * backend. ⛔ Do not "simplify" it back onto the in-memory driver: that is an
 * unledgered arrival and `pnpm check:driver-memory-census` refuses it (#6664).
 * The card's own reproduction used the in-memory driver because that is what the
 * reporter had in hand — a manual probe, never a constraint on this rig.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext } from '@objectstack/core';
import type { JobHandler } from '@objectstack/spec/contracts';
import { defineJob } from '@objectstack/spec/system';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { CronJobAdapter } from '@objectstack/service-job';
import { AppPlugin } from './app-plugin.js';
import { loadArtifactBundle } from './load-artifact-bundle.js';
import type { JobHandlerContext } from './job-handler-context.js';
import {
    captureExpectedReadRefusals,
    type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';

/** The record a scheduled sweep is supposed to be able to write. */
const NOTE = {
    name: 'sweep_note',
    label: 'Sweep Note',
    fields: {
        title: { type: 'text' },
        swept: { type: 'text' },
    },
};

/**
 * The three members the context carried BEFORE #14094 — pinned as a set so the
 * widening is visible in the diff of anything that changes it, and so
 * "existing handlers unchanged" is asserted rather than asserted-about.
 */
const PRE_14094_KEYS = ['bundle', 'data', 'jobId'] as const;
/** What #14094 added, and nothing else. */
const ADDED_KEYS = ['logger', 'ql'] as const;

interface Harness {
    engine: ObjectQL;
    adapter: CronJobAdapter;
    ctx: PluginContext;
    fireReady: () => Promise<void>;
    errorLogs: () => string[];
    warnLogs: () => string[];
}

const live: Array<{
    engine?: ObjectQL;
    adapter?: CronJobAdapter;
    driver?: SqlDriver;
    dir?: string;
    noise?: ExpectedReadRefusalCapture;
    /** The channels this test's path MUST have provoked — see `harness()`. */
    requiredChannels?: readonly string[];
}> = [];

/**
 * [#10629] This fixture provisions `sweep_note` and nothing else, so the
 * engine's own single-tenant probe (`ObjectQL.probeInstallOrganizations`) reads
 * a `sys_organization` that was never created. The probe is fail-soft by
 * construction, but the driver and the engine each log the fault on the way out.
 * Withheld and ASSERTED rather than muted — see `expected-read-refusal-noise.ts`.
 */
const ABSENT_TENANCY_TABLE = 'sys_organization';

afterEach(async () => {
    for (const entry of live.splice(0)) {
        try { await entry.adapter?.destroy(); } catch { /* noop */ }
        try { await entry.engine?.destroy(); } catch { /* noop */ }
        try { await entry.driver?.disconnect(); } catch { /* noop */ }
        if (entry.dir) rmSync(entry.dir, { recursive: true, force: true });
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

/**
 * A real engine over the MIGRATED test backend — sqlite `:memory:` (#5704) —
 * with `sweep_note` provisioned and registered.
 */
async function bootEngine(): Promise<{ engine: ObjectQL; driver: SqlDriver; noise: ExpectedReadRefusalCapture }> {
    const driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
    // Installed before the driver runs a statement and before the engine issues
    // a read — the two sinks the expected refusal travels out on.
    const noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([NOTE as never]);
    const engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject(NOTE as never);
    return { engine, driver, noise };
}

/**
 * @param opts.touchesStore whether this test's path performs a data operation.
 *   `true` (the default) requires the tenancy probe to have fired and been
 *   withheld; a context-shape test that never reads or writes passes `false`,
 *   which keeps the withholding and drops only the must-have-fired requirement.
 */
async function harness(opts: { touchesStore?: boolean } = {}): Promise<Harness> {
    const { engine, driver, noise } = await bootEngine();
    const adapter = new CronJobAdapter();
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

    return {
        engine,
        adapter,
        ctx,
        fireReady: async () => { for (const cb of readyHooks) await cb(); },
        errorLogs: () => vi.mocked(ctx.logger.error).mock.calls.map(c => String(c[0])),
        warnLogs: () => vi.mocked(ctx.logger.warn).mock.calls.map(c => String(c[0])),
    };
}

/** The nightly-sweep shape the card is about: read some rows, write one back. */
async function sweepHandler(jobCtx: JobHandlerContext): Promise<void> {
    const { ql, jobId, logger } = jobCtx;
    const pending = await ql.find('sweep_note', { where: { swept: 'no' } }) as Array<{ id: string }>;
    for (const row of pending) {
        await ql.update('sweep_note', { id: row.id, swept: jobId });
    }
    logger.info('[test] sweep complete', { job: jobId, updated: pending.length });
}

const rowsOf = (result: unknown): Array<Record<string, unknown>> =>
    Array.isArray(result) ? result as Array<Record<string, unknown>> : [];

describe('#14094 — a declarative job handler has data reach (TS-config path)', () => {
    it('reads and writes a record through the context it is invoked with', async () => {
        const h = await harness();
        await h.engine.insert('sweep_note', { title: 'first', swept: 'no' });
        await h.engine.insert('sweep_note', { title: 'second', swept: 'no' });

        const plugin = new AppPlugin({
            id: 'com.test.job-reach',
            jobs: [defineJob({
                name: 'nightly_sweep',
                schedule: { type: 'cron', expression: '0 1 * * *' },
                handler: 'sweep',
            })],
            functions: { sweep: { handler: sweepHandler, effect: 'writes' } },
        });

        await plugin.start!(h.ctx);
        await h.fireReady();
        expect(await h.adapter.listJobs()).toContain('nightly_sweep');

        // The job runs the way the scheduler runs it — no direct handler call.
        await h.adapter.trigger('nightly_sweep');

        // SUBSTANCE: the STORE changed. Not "the handler was called", not "the
        // context had a key" — the rows a scheduled sweep exists to update.
        const after = rowsOf(await h.engine.find('sweep_note', {}));
        expect(after).toHaveLength(2);
        expect(after.map(r => r.swept).sort()).toEqual(['nightly_sweep', 'nightly_sweep']);
        expect(h.errorLogs()).toEqual([]);
    });

    it('the context is the pre-#14094 set PLUS exactly `ql` and `logger`', async () => {
        // Reads nothing and writes nothing — this one is about the shape.
        const h = await harness({ touchesStore: false });
        const seen: Array<Record<string, unknown>> = [];

        const plugin = new AppPlugin({
            id: 'com.test.job-reach',
            jobs: [defineJob({ name: 'probe_job', schedule: { type: 'interval', intervalMs: 60_000 }, handler: 'probe' })],
            functions: { probe: async (c: Record<string, unknown>) => { seen.push(c); } },
        });
        await plugin.start!(h.ctx);
        await h.fireReady();
        await h.adapter.trigger('probe_job');

        expect(seen).toHaveLength(1);
        const keys = Object.keys(seen[0]).sort();
        expect(keys).toEqual([...PRE_14094_KEYS, ...ADDED_KEYS].sort());

        // The pre-existing members keep their meaning — `jobId` is the job's
        // name, `bundle` is the metadata bundle, `data` is the trigger payload.
        expect(seen[0].jobId).toBe('probe_job');
        expect(seen[0].bundle).toBeTypeOf('object');
        expect(seen[0].data).toBeUndefined();

        // And the added members are the LIVE handles, not placeholders.
        expect(seen[0].ql).toBe(h.engine);
        expect(seen[0].logger).toBe(h.ctx.logger);
    });

    it('`data` from a manual trigger still reaches the handler beside the new members', async () => {
        const h = await harness({ touchesStore: false });
        const seen: Array<Record<string, unknown>> = [];
        const plugin = new AppPlugin({
            id: 'com.test.job-reach',
            jobs: [defineJob({ name: 'payload_job', schedule: { type: 'interval', intervalMs: 60_000 }, handler: 'probe' })],
            functions: { probe: async (c: Record<string, unknown>) => { seen.push(c); } },
        });
        await plugin.start!(h.ctx);
        await h.fireReady();

        await h.adapter.trigger('payload_job', { reason: 'manual' });

        expect(seen[0].data).toEqual({ reason: 'manual' });
        expect(seen[0].ql).toBe(h.engine);
    });
});

describe('#14094 — the same reach on the ARTIFACT path', () => {
    /**
     * Builds on disk what `objectstack build` emits: a JSON artifact carrying
     * NO `onEnable` plus a sibling ESM module exporting `{ functions, meta }`,
     * and loads it through the REAL `loadArtifactBundle` / `mergeRuntimeModule`.
     */
    async function bootFromArtifact() {
        const dir = mkdtempSync(join(tmpdir(), 'os-job-reach-14094-'));
        const h = await harness();
        live.push({ dir });

        // The handler lives only in the sibling module — exactly as a built app
        // ships it. It has no module-scope binding seam and no `onEnable` to
        // fill one: everything it writes with comes from its argument.
        writeFileSync(join(dir, 'runtime.mjs'), `
export const functions = {
  sweep: async ({ ql, jobId }) => {
    const pending = await ql.find('sweep_note', { where: { swept: 'no' } });
    for (const row of pending) await ql.update('sweep_note', { id: row.id, swept: jobId });
  },
};
export const meta = { builtAt: '2026-09-01T00:00:00.000Z' };
`, 'utf-8');

        const artifact = {
            manifest: { id: 'com.test.job-reach-artifact', name: 'Artifact Job Reach', version: '1.0.0' },
            // What the builder lowers a callable to: a handler REF plus what the
            // function declared about itself. The callable rides in the module.
            functions: { sweep: { handler: 'sweep', effect: 'writes' } },
            jobs: [JSON.parse(JSON.stringify(defineJob({
                name: 'artifact_sweep',
                schedule: { type: 'cron', expression: '0 2 * * *' },
                handler: 'sweep',
            })))],
            runtimeModule: './runtime.mjs',
        };
        const artifactPath = join(dir, 'objectstack.artifact.json');
        writeFileSync(artifactPath, JSON.stringify(artifact), 'utf-8');

        const bundle = await loadArtifactBundle(artifactPath, { tag: '[test:14094]' });
        return { dir, h, bundle };
    }

    it('an artifact-served job writes a record — the path where the module-scope escape silently fails', async () => {
        const { h, bundle } = await bootFromArtifact();

        // The premise of Zone 1.2, asserted rather than assumed: there is no
        // `onEnable` on this boot path, so "have onEnable assign a module-scope
        // global" is not available to the handler at all.
        expect(bundle).not.toBeNull();
        expect((bundle as Record<string, unknown>).onEnable).toBeUndefined();
        // The callable did arrive — via `functions`, the only thing merged.
        expect(typeof (bundle as any).functions.sweep.handler).toBe('function');

        await h.engine.insert('sweep_note', { title: 'artifact row', swept: 'no' });

        const plugin = new AppPlugin(bundle);
        await plugin.start!(h.ctx);
        await h.fireReady();
        expect(await h.adapter.listJobs()).toContain('artifact_sweep');

        await h.adapter.trigger('artifact_sweep');

        const after = rowsOf(await h.engine.find('sweep_note', {}));
        expect(after).toHaveLength(1);
        expect(after[0].swept).toBe('artifact_sweep');
        expect(h.errorLogs()).toEqual([]);
    });

    it('FIRING CONTROL: the same artifact handler cannot write without the reach', async () => {
        const { h, bundle } = await bootFromArtifact();
        await h.engine.insert('sweep_note', { title: 'artifact row', swept: 'no' });

        // The exact callable the artifact shipped, invoked with the context
        // shape this card measured BEFORE the fix. If the assertion above ever
        // passed vacuously — because something else wrote the row — this would
        // pass too. It does not: with no `ql` the handler cannot even start.
        const shipped = (bundle as any).functions.sweep.handler as (c: unknown) => Promise<void>;
        await expect(
            shipped({ jobId: 'artifact_sweep', data: undefined, bundle }),
        // Reaching through the absent handle — `undefined.find(...)` — is what
        // "no data reach" IS. The message wording is V8's, so only the shape is
        // pinned; the store assertion below is what carries the control.
        ).rejects.toThrow(TypeError);

        const after = rowsOf(await h.engine.find('sweep_note', {}));
        expect(after[0].swept).toBe('no');
    });
});

describe('#14094 — additivity (Zone 1.1)', () => {
    it('a handler written against the PRE-#14094 context runs unchanged, byte for byte', async () => {
        const h = await harness({ touchesStore: false });
        const calls: Array<{ jobId: string; data?: unknown }> = [];

        // Verbatim the shape `IJobService`'s `JobHandler` declares — the type an
        // existing handler was written against. It names two members and knows
        // nothing about `ql` / `logger`.
        const legacy = async (context: { jobId: string; data?: unknown }): Promise<void> => {
            calls.push({ jobId: context.jobId, data: context.data });
        };
        // Still a `JobHandler`: this line is what a NARROWING would break.
        const stillAJobHandler: JobHandler = legacy;
        expect(typeof stillAJobHandler).toBe('function');

        const plugin = new AppPlugin({
            id: 'com.test.job-reach',
            jobs: [defineJob({ name: 'legacy_job', schedule: { type: 'interval', intervalMs: 60_000 }, handler: 'legacy' })],
            functions: { legacy },
        });
        await plugin.start!(h.ctx);
        await h.fireReady();
        await h.adapter.trigger('legacy_job');

        expect(calls).toEqual([{ jobId: 'legacy_job', data: undefined }]);
        expect(h.errorLogs()).toEqual([]);
        expect(h.warnLogs()).toEqual([]);
    });

    it('`IJobService` is untouched: the function AppPlugin schedules still satisfies `JobHandler`', async () => {
        const h = await harness();
        const scheduled: Array<{ name: string; handler: JobHandler }> = [];
        // A THIRD-PARTY IJobService implementation, typed at the contract and
        // nothing wider. It compiles and runs against what AppPlugin hands it —
        // the widening happens INSIDE that wrapper, never at this boundary.
        const recording = {
            schedule: async (name: string, _schedule: unknown, handler: JobHandler) => {
                scheduled.push({ name, handler });
            },
            cancel: async () => { /* noop */ },
            trigger: async (name: string, data?: unknown) => {
                const entry = scheduled.find(s => s.name === name);
                await entry?.handler({ jobId: name, data });
            },
        };
        vi.mocked(h.ctx.getService).mockImplementation((name: string) => {
            if (name === 'job') return recording as never;
            if (name === 'objectql') return h.engine as never;
            return undefined as never;
        });

        await h.engine.insert('sweep_note', { title: 'third party', swept: 'no' });
        const plugin = new AppPlugin({
            id: 'com.test.job-reach',
            jobs: [defineJob({ name: 'third_party_job', schedule: { type: 'cron', expression: '0 3 * * *' }, handler: 'sweep' })],
            functions: { sweep: { handler: sweepHandler, effect: 'writes' } },
        });
        await plugin.start!(h.ctx);
        await h.fireReady();

        expect(scheduled.map(s => s.name)).toEqual(['third_party_job']);
        await recording.trigger('third_party_job');

        const after = rowsOf(await h.engine.find('sweep_note', {}));
        expect(after[0].swept).toBe('third_party_job');
    });

    it('FIRING CONTROL: the sweep handler fails on the pre-#14094 context', async () => {
        const h = await harness();
        await h.engine.insert('sweep_note', { title: 'control', swept: 'no' });

        await expect(
            (sweepHandler as unknown as (c: unknown) => Promise<void>)({
                jobId: 'nightly_sweep', data: undefined, bundle: {},
            }),
        ).rejects.toThrow(TypeError);

        const after = rowsOf(await h.engine.find('sweep_note', {}));
        expect(after[0].swept).toBe('no');
    });
});
