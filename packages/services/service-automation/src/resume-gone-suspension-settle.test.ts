// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A resume the engine refuses as GONE FOR GOOD settles the run's
 * `sys_automation_run` row in the same act.
 *
 * `resumeInternal` has two never-dispatched exits for a suspension that is real
 * but can never continue: the run's flow is no longer registered, or the node
 * it parked on was edited away. The engine already classifies both as the
 * terminal "this pause is gone for good" class and answers `RUN_NOT_FOUND`
 * (a transport answers 404). Until this file's fix the exit returned WITHOUT
 * touching the row, so it kept `status: 'paused'` through every later resume,
 * an uninstall and a cold restart, and retention never pruned it: its
 * `onlyWhen` scope admits terminal statuses only, because paused rows are live
 * resumable state.
 *
 * What these pins hold, each on the layer that can see it:
 *
 *  - FULL STACK (a real `sys_automation_run` table in a sqlite file, written by
 *    `ObjectStoreSuspendedRunStore` through ObjectQL, the plugin's own boot):
 *    both causes, a run parked on a real `screen` node. After the refused
 *    resume the paused row is gone and the terminal row reads `failed` with
 *    the refusal's own text in `error`; a second resume answers the same code
 *    and leaves that row byte-for-byte as it was; a cold restart onto a flow
 *    that disappeared while the process was down settles on its first resume;
 *    and the settled status is one of the statuses retention's `onlyWhen`
 *    reads, so the existing rule ages the row out with nothing changed there.
 *  - ENGINE LEVEL: the refusals that are NOT gone-for-good leave the row
 *    parked. A resume before the host has sealed the boot reads a registry
 *    that is still filling (the plugin re-arms overdue wait timers in
 *    `start()`, BEFORE its `kernel:ready` handler binds inline app flows), so
 *    "absent" there means "not registered yet" and recording it would kill a
 *    run its flow arrives for a moment later. A claim the store cannot answer
 *    is STORE_UNAVAILABLE with the row untouched, and the retry settles it. A
 *    claim another consumer won writes nothing of this engine's own.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { defineActionDescriptor } from '@objectstack/spec/automation';

import { AutomationEngine, isTerminalRunStatus } from './engine.js';
import type { RunRecord, SuspendedRun, SuspendedRunStore, SuspensionClaimOutcome, SuspensionParkedAt } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { AutomationServicePlugin } from './plugin.js';
import { SysAutomationRun } from './sys-automation-run.object.js';
import { registerWaitNode, rearmSuspendedWaitTimers } from './builtin/wait-node.js';

const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } } as never;
const SYSTEM = { isSystem: true } as never;

/** start → collect (a real `screen` with one required field) → end. */
function screenFlow(name: string, withScreen = true) {
    return {
        name,
        label: name,
        type: 'screen',
        nodes: withScreen
            ? [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'collect',
                    type: 'screen',
                    label: 'Collect',
                    config: { fields: [{ name: 'x', label: 'X', type: 'text', required: true }] },
                },
                { id: 'end', type: 'end', label: 'End' },
            ]
            : [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'end', type: 'end', label: 'End' },
            ],
        edges: withScreen
            ? [
                { id: 'e1', source: 'start', target: 'collect' },
                { id: 'e2', source: 'collect', target: 'end' },
            ]
            : [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

/** The statuses retention's age sweep may prune — read off the object, never restated. */
function retentionPrunableStatuses(): readonly string[] {
    const onlyWhen = SysAutomationRun.lifecycle?.retention?.onlyWhen as
        | { status?: { $in?: readonly string[] } }
        | undefined;
    const statuses = onlyWhen?.status?.$in;
    if (!statuses || statuses.length === 0) throw new Error('sys_automation_run retention.onlyWhen.status.$in is not readable');
    return statuses;
}

describe('a gone-for-good resume settles the run row (full stack, sqlite file)', () => {
    let dir: string | undefined;
    const kernels: ObjectKernel[] = [];

    afterEach(async () => {
        for (const k of kernels.splice(0)) {
            try { await k.shutdown(); } catch { /* noop */ }
        }
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; }
    });

    /** One process lifetime: kernel + ObjectQL + automation over `file`. */
    async function boot(file: string) {
        const kernel = new ObjectKernel({ logger: { level: 'fatal' } });
        kernels.push(kernel);
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();

        const ql = kernel.getService<ObjectQL>('objectql');
        const driver = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: file },
            useNullAsDefault: true,
        });
        await driver.connect();
        ql.registerDriver(driver, true);
        await ql.syncSchemas();

        const automation = kernel.getService<AutomationEngine>('automation');
        return { kernel, ql, automation };
    }

    async function freshFile(): Promise<string> {
        dir = mkdtempSync(join(tmpdir(), 'os-gone-settle-'));
        return join(dir, 'data.db');
    }

    const pausedRow = (ql: ObjectQL, runId: string) =>
        ql.findOne('sys_automation_run', { where: { id: runId }, context: SYSTEM });
    const terminalRow = (ql: ObjectQL, runId: string) =>
        ql.findOne('sys_automation_run', { where: { id: `run_${runId}` }, context: SYSTEM });

    /** The terminal write is fire-and-forget, like every history row: poll for it, bounded. */
    async function settledRow(ql: ObjectQL, runId: string) {
        return vi.waitFor(async () => {
            const row = await terminalRow(ql, runId);
            if (!row) throw new Error(`no terminal row for '${runId}' yet`);
            return row as Record<string, unknown>;
        }, { timeout: 3000, interval: 20 });
    }

    async function parkOnScreen(automation: AutomationEngine, ql: ObjectQL, flowName: string) {
        automation.registerFlow(flowName, screenFlow(flowName) as never);
        const parked = await automation.execute(flowName, {} as never);
        expect(parked.status, 'the screen node parks the run').toBe('paused');
        const runId = parked.runId!;
        const before = await pausedRow(ql, runId);
        expect(before?.status, 'the paused row is on disk before the resume').toBe('paused');
        return runId;
    }

    it('flow removed: the refused resume moves the row to failed with the cause, in the same act', async () => {
        const { ql, automation } = await boot(await freshFile());
        const runId = await parkOnScreen(automation, ql, 'stalea_probe');

        automation.unregisterFlow('stalea_probe');
        const resumed = await automation.resume(runId, { output: { x: 'v' } });

        // The envelope is unchanged: the same code and the same text as before.
        expect(resumed.success).toBe(false);
        expect(resumed.code).toBe('RUN_NOT_FOUND');
        expect(resumed.error).toBe(`Flow 'stalea_probe' not found for run '${runId}'`);

        // The paused row is gone by the time `resume` returns: the consumption
        // is awaited inside the call, not left to a later sweep.
        expect(await pausedRow(ql, runId), 'the paused row must not survive the refusal').toBeNull();
        expect(await automation.hasSuspendedRun(runId)).toBe(false);

        const row = await settledRow(ql, runId);
        expect(row.status).toBe('failed');
        expect(row.error).toBe(resumed.error);
        expect(row.flow_name).toBe('stalea_probe');
        expect(row.finished_at, 'a settled row says when it ended').toBeTruthy();

        // Retention ages it out by its EXISTING rule: the status is in the set
        // the sweep reads, and that set still excludes `paused`.
        const prunable = retentionPrunableStatuses();
        expect(prunable).toContain(row.status);
        expect(prunable).not.toContain('paused');
        expect(isTerminalRunStatus(row.status)).toBe(true);
    });

    it('parked node edited away: the refused resume moves the row to failed with the cause', async () => {
        const { ql, automation } = await boot(await freshFile());
        const runId = await parkOnScreen(automation, ql, 'edited_probe');

        // The author republishes the flow without the node the run parked on.
        automation.registerFlow('edited_probe', screenFlow('edited_probe', false) as never);
        const resumed = await automation.resume(runId, { output: { x: 'v' } });

        expect(resumed.success).toBe(false);
        expect(resumed.code).toBe('RUN_NOT_FOUND');
        expect(resumed.error).toBe(`Suspended node 'collect' no longer exists in flow 'edited_probe'`);

        expect(await pausedRow(ql, runId)).toBeNull();
        const row = await settledRow(ql, runId);
        expect(row.status).toBe('failed');
        expect(row.error).toBe(resumed.error);
        expect(retentionPrunableStatuses()).toContain(row.status);
    });

    it('a second resume answers the same code and leaves the settled row unchanged', async () => {
        const { ql, automation } = await boot(await freshFile());
        const runId = await parkOnScreen(automation, ql, 'twice_probe');
        automation.unregisterFlow('twice_probe');

        const first = await automation.resume(runId, { output: { x: 'v' } });
        expect(first.code).toBe('RUN_NOT_FOUND');
        const settled = await settledRow(ql, runId);

        const second = await automation.resume(runId, { output: { x: 'v' } });
        expect(second.success).toBe(false);
        expect(second.code).toBe('RUN_NOT_FOUND');
        // Nothing parked is left to read, so the second answer is the plain
        // missing-suspension text — the same 404 class, no second settle.
        expect(second.error).toBe(`No suspended run '${runId}'`);

        // Give a stray second write every chance to land before comparing.
        await new Promise((r) => setTimeout(r, 50));
        expect(await terminalRow(ql, runId)).toEqual(settled);
        expect(await pausedRow(ql, runId)).toBeNull();
    });

    it('cold restart onto a flow that disappeared while the process was down: the first resume settles it', async () => {
        const file = await freshFile();
        const first = await boot(file);
        const runId = await parkOnScreen(first.automation, first.ql, 'restart_probe');
        await first.kernel.shutdown();
        kernels.splice(kernels.indexOf(first.kernel), 1);

        // Process 2 never registers the flow; its boot has completed (sealed).
        const second = await boot(file);
        expect((await pausedRow(second.ql, runId))?.status, 'the row survived the restart').toBe('paused');

        const resumed = await second.automation.resume(runId, { output: { x: 'v' } });
        expect(resumed.code).toBe('RUN_NOT_FOUND');
        expect(await pausedRow(second.ql, runId)).toBeNull();
        const row = await settledRow(second.ql, runId);
        expect(row.status).toBe('failed');
        expect(row.error).toBe(`Flow 'restart_probe' not found for run '${runId}'`);
    });
});

/**
 * `resumeAuthority: 'any'` is required of a pausing fixture since #5561; the
 * public resume door is not what this file is about.
 */
const HOLD_DESCRIPTOR = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'Hold',
    supportsPause: true, resumeAuthority: 'any',
});

function holdFlow(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 's' },
            { id: 'hold', type: 'hold', label: 'h' },
            { id: 'end', type: 'end', label: 'e' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'hold' },
            { id: 'e2', source: 'hold', target: 'end' },
        ],
    };
}

function engineOver(store: SuspendedRunStore, { sealed }: { sealed: boolean }) {
    const engine = new AutomationEngine(silent, store);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: HOLD_DESCRIPTOR,
        async execute() { return { success: true, suspend: true, correlation: 'held' }; },
    } as never);
    if (sealed) engine.sealNodeTypeVocabulary();
    return engine;
}

/** Park one run on `hold` in a throwaway "process 1" and return its id. */
async function parkInAnotherProcess(store: SuspendedRunStore, flowName: string): Promise<string> {
    const parker = engineOver(store, { sealed: true });
    parker.registerFlow(flowName, holdFlow(flowName) as never);
    const parked = await parker.execute(flowName, {} as never);
    expect(parked.status).toBe('paused');
    return parked.runId!;
}

/** Records every terminal write, so "wrote nothing" is a reading, not an absence. */
class RecordingStore extends InMemorySuspendedRunStore {
    readonly terminal: RunRecord[] = [];
    claimHook?: (runId: string) => Promise<void>;
    claimThrows = false;
    override async recordTerminal(record: RunRecord): Promise<void> {
        this.terminal.push(record);
        await super.recordTerminal(record);
    }
    override async claimSuspension(runId: string, parkedAt: SuspensionParkedAt): Promise<SuspensionClaimOutcome> {
        if (this.claimThrows) throw new Error('store connection reset');
        if (this.claimHook) await this.claimHook(runId);
        return super.claimSuspension(runId, parkedAt);
    }
}

describe('a refusal that is NOT gone-for-good leaves the row parked (engine level)', () => {
    it('before the host seals the boot, an absent flow is "not registered yet": the row stays paused and the run resumes once its flow arrives', async () => {
        const store = new RecordingStore();
        const runId = await parkInAnotherProcess(store, 'late_bound');

        // Process 2 mid-boot: the engine is up, the flow is not bound yet and
        // the host has not sealed — exactly where the plugin's `start()` stands
        // when it re-arms overdue wait timers.
        const booting = engineOver(store, { sealed: false });
        const early = await booting.resume(runId);
        expect(early.code).toBe('RUN_NOT_FOUND');
        expect((await store.load(runId))?.nodeId, 'the parked row is untouched').toBe('hold');
        expect(store.terminal).toEqual([]);

        // The boot finishes: the flow binds (kernel:ready) and the host seals
        // (kernel:bootstrapped). The run was never killed, so it continues.
        booting.registerFlow('late_bound', holdFlow('late_bound') as never);
        booting.sealNodeTypeVocabulary();
        const resumed = await booting.resume(runId);
        expect(resumed.success).toBe(true);
        expect(await store.load(runId)).toBeNull();
        await new Promise((r) => setTimeout(r, 0));
        expect(store.terminal.map((r) => r.status)).toEqual(['completed']);
    });

    it('the overdue-wait re-arm a booting plugin runs before its flows bind leaves the run parked, and it resumes after the bind', async () => {
        const store = new RecordingStore();
        const ctxNoJob = { logger: silent, getService() { throw new Error('no service'); } } as never;
        const waitFlow = {
            name: 'overdue_wait', label: 'Overdue Wait', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'pause', type: 'wait', label: 'Wait', waitEventConfig: { eventType: 'timer', timerDuration: '1' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'pause' },
                { id: 'e2', source: 'pause', target: 'end' },
            ],
        };

        // Process 1 parks at a 1 ms timer and dies before it fires.
        const parker = new AutomationEngine(silent, store);
        registerWaitNode(parker, ctxNoJob);
        parker.sealNodeTypeVocabulary();
        parker.registerFlow('overdue_wait', waitFlow as never);
        const parked = await parker.execute('overdue_wait', {} as never);
        expect(parked.status).toBe('paused');
        const runId = parked.runId!;
        await new Promise((r) => setTimeout(r, 10)); // the deadline lapses while "down"

        // Process 2, `start()`: the re-arm runs before `kernel:ready` binds the flow.
        const booting = new AutomationEngine(silent, store);
        registerWaitNode(booting, ctxNoJob);
        await rearmSuspendedWaitTimers(booting, store, undefined, silent);
        expect((await store.load(runId))?.nodeId, 'the overdue run is still parked, not killed').toBe('pause');
        expect(store.terminal).toEqual([]);

        // `kernel:ready` binds it, `kernel:bootstrapped` seals; a resume continues it.
        booting.registerFlow('overdue_wait', waitFlow as never);
        booting.sealNodeTypeVocabulary();
        expect((await booting.resume(runId)).success).toBe(true);
        await new Promise((r) => setTimeout(r, 0));
        expect(store.terminal.map((r) => r.status)).toEqual(['completed']);
    });

    it('a claim the store cannot answer is STORE_UNAVAILABLE with the row untouched, and the retry settles it', async () => {
        const store = new RecordingStore();
        const runId = await parkInAnotherProcess(store, 'flaky_store');
        const engine = engineOver(store, { sealed: true });

        store.claimThrows = true;
        const refused = await engine.resume(runId);
        expect(refused.success).toBe(false);
        expect(refused.code).toBe('STORE_UNAVAILABLE');
        expect((await store.load(runId))?.nodeId).toBe('hold');
        expect(store.terminal).toEqual([]);

        store.claimThrows = false;
        const retried = await engine.resume(runId);
        expect(retried.code).toBe('RUN_NOT_FOUND');
        expect(retried.error).toBe(`Flow 'flaky_store' not found for run '${runId}'`);
        expect(await store.load(runId)).toBeNull();
        await new Promise((r) => setTimeout(r, 0));
        expect(store.terminal.map((r) => [r.runId, r.status, r.error])).toEqual([
            [runId, 'failed', retried.error],
        ]);
    });

    it('a claim another consumer won writes no terminal record of this engine\'s own', async () => {
        const store = new RecordingStore();
        const runId = await parkInAnotherProcess(store, 'raced_flow');
        const engine = engineOver(store, { sealed: true });

        // Another replica cancels the run between this engine's read and its
        // claim: the compare-and-set finds nothing parked and answers `lost`.
        const other = engineOver(store, { sealed: true });
        store.claimHook = async (id) => {
            store.claimHook = undefined;
            expect(await other.cancelRun(id, 'operator cancelled')).toBe(true);
        };
        const refused = await engine.resume(runId);
        expect(refused.code).toBe('RUN_NOT_FOUND');
        await new Promise((r) => setTimeout(r, 0));
        expect(store.terminal.map((r) => [r.status, r.error])).toEqual([['cancelled', 'operator cancelled']]);
        expect((await store.loadTerminal(runId))?.status).toBe('cancelled');
    });
});

/** Type-level anchor: the store shapes this file reads come from the engine's own contract. */
export type _SettleSources = [SuspendedRun, RunRecord];
