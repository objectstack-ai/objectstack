// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8050 — a durably PAUSED run must be visible to the automation API after a
 * cold restart, on BOTH read surfaces.
 *
 * `sys_automation_run` holds two disjoint row families: terminal history rows
 * (`recordTerminal`, id `run_`+runId) and live suspension rows (`save`, id =
 * the raw runId, status `paused`). `AutomationEngine.listRuns` merged the
 * in-memory ring buffer with the FIRST family only, and `getRun` fell back to
 * the first family only. So after a restart:
 *
 *   - `GET /automation/:name/runs`               → 200, zero rows
 *   - `GET /automation/:name/runs?status=paused` → 200, zero rows
 *   - `GET /automation/:name/runs/:runId`        → 404 "Execution not found"
 *
 * while the same run answered `GET …/runs/:runId/screen` and resumed cleanly —
 * the state was never lost, it simply had no reader. The second line is the
 * sharp one: #7359 had just made `?status=paused` a real filter, and with no
 * post-restart producer of a `paused` entry it could never match a row. The one
 * query an operator reaches for when asking "what is in flight?" was
 * structurally guaranteed to answer "nothing".
 *
 * ## Why the obvious test is worthless here
 *
 * Parking a run and enumerating it IN THE SAME PROCESS passes on `main` too —
 * the run is still in the ring buffer, and the ring is what every existing
 * `listRuns` test reads. Likewise the existing durability tests
 * (`suspended-screen-durability.test.ts`, `run-history.test.ts`) assert
 * RESUMABILITY across a restart, which is precisely the half that already
 * worked. The gate has to be: park → cold restart onto the same storage → read.
 *
 * ## Reverse verification — measured, not asserted
 *
 * Every case below was run against `origin/main` with ONLY the engine change
 * reverted (the test file unchanged). 8 red, 7 green:
 *
 *   RED   cold restart: ?status=paused returns the parked run    → []
 *   RED   cold restart: bare enumeration returns the parked run  → []
 *   RED   cold restart: run-detail answers                       → null
 *   RED   cold restart: trigger attribution + #7639 variables    → null
 *   RED   cold restart: no cross-flow leak                       → []
 *   RED   cold restart: ?status= narrows without widening        → [] (len 0, want 1)
 *   RED   an unreadable paused store degrades rather than throws → no such warning
 *   RED   full stack, cold boot over the same sqlite FILE        → [] / null
 *
 *   GREEN pre-restart: the run is in both sources and lists once
 *   GREEN pre-restart: another flow's paused run does not leak in
 *   GREEN a stale paused row cannot mask a finished run (ring side)
 *   GREEN a stale paused row cannot mask a finished run (durable side, cold)
 *   GREEN a parked run still resumes to completion after a restart
 *   GREEN an unknown run id is still not found
 *   GREEN a flow with no paused rows behaves exactly as before
 *
 * Three cases I had labelled GREEN when writing them are red above, and the
 * labels — not the tests — were wrong: no-cross-flow-leak, ?status=-does-not-
 * widen and the degradation pin all assert the row is THERE before they assert
 * anything about its scoping, so none of them can pass on a tree where it never
 * appears. They are recorded as red, with the extra invariant each carries
 * named on the case itself. The one genuinely-green scoping guard is the
 * PRE-restart half, which reads the ring and passes both sides.
 *
 * The greens are not decoration either. The fix adds a THIRD source to a merge
 * that had two, and a third source is exactly how duplicate rows, a resurrected
 * "paused forever" (#3456) and a cross-flow leak get introduced.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { AutomationEngine } from './engine.js';
import type { RunRecord, SuspendedRun, SuspendedRunStore } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { AutomationServicePlugin } from './plugin.js';

const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } } as never;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * `resumeAuthority: 'any'` is required of any pausing fixture since #5561 — a
 * node type that declares no authority is refused at the public `resume` door.
 * Nothing here is about that gate (`resume-authority-gate.test.ts` owns it), so
 * the fixture states the posture it relies on, as the pausing built-ins do.
 */
const HOLD_DESCRIPTOR = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'Hold',
    supportsPause: true, resumeAuthority: 'any',
});

const holdExecutor = {
    type: 'hold',
    descriptor: HOLD_DESCRIPTOR,
    async execute() { return { success: true, suspend: true, correlation: 'held' }; },
} as never;

/** start → hold (parks) → tail → end. */
function pausingFlow(name: string, tail = 'noop') {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 's' },
            { id: 'hold', type: 'hold', label: 'h' },
            { id: 'tail', type: tail, label: 't' },
            { id: 'end', type: 'end', label: 'e' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'hold' },
            { id: 'e2', source: 'hold', target: 'tail' },
            { id: 'e3', source: 'tail', target: 'end' },
        ],
    };
}

/**
 * One simulated process lifetime over `store`. A shared
 * {@link InMemorySuspendedRunStore} across two of these IS the cold restart at
 * the engine seam: engine B's ring buffer is empty, and the store JSON
 * round-trips on save/load so it exercises the same serialization boundary
 * `sys_automation_run` imposes. (The full-stack version over a real sqlite FILE
 * is the last describe block — this one isolates the engine.)
 */
function buildEngine(store: SuspendedRunStore, flows: string[] = ['approval_flow']) {
    const engine = new AutomationEngine(silent, store);
    engine.registerNodeExecutor(holdExecutor);
    engine.registerNodeExecutor({ type: 'noop', async execute() { return { success: true }; } } as never);
    for (const f of flows) engine.registerFlow(f, pausingFlow(f) as never);
    return engine;
}

const TRIGGER = {
    event: 'record_change',
    object: 'crm_order',
    record: { id: 'ord_1' },
    userId: 'usr_ops',
} as unknown as AutomationContext;

describe('#8050 durable paused runs are visible after a cold restart', () => {
    it('cold restart: ?status=paused returns the parked run (the query an operator reaches for)', async () => {
        const store = new InMemorySuspendedRunStore();
        const parked = await buildEngine(store).execute('approval_flow', TRIGGER);
        expect(parked.status).toBe('paused');

        // New process: empty ring, same durable rows.
        const cold = buildEngine(store);
        const paused = await cold.listRuns('approval_flow', { status: 'paused' });

        // RED on main: `[]`. #7359's filter had no post-restart producer of a
        // `paused` entry, so it could never match a row.
        expect(paused.map(r => r.id)).toEqual([parked.runId]);
        expect(paused[0].status).toBe('paused');
    });

    it('cold restart: bare enumeration returns the parked run', async () => {
        const store = new InMemorySuspendedRunStore();
        const parked = await buildEngine(store).execute('approval_flow', TRIGGER);

        const rows = await buildEngine(store).listRuns('approval_flow');

        // RED on main: `[]` — the flow had exactly one run and the Runs view
        // showed none of it.
        expect(rows.map(r => r.id)).toEqual([parked.runId]);
    });

    it('cold restart: run-detail answers, with the same story the list tells', async () => {
        const store = new InMemorySuspendedRunStore();
        const parked = await buildEngine(store).execute('approval_flow', TRIGGER);

        const cold = buildEngine(store);
        const detail = await cold.getRun(parked.runId!);

        // RED on main: `null` → the route's 404 "Execution not found". Fixing
        // only `listRuns` would have left this 404ing, trading a visible gap
        // for an inconsistency between two reads of the same run.
        expect(detail).not.toBeNull();
        expect(detail!.status).toBe('paused');

        // ONE story: by-id and list agree field for field.
        const [listed] = await cold.listRuns('approval_flow', { status: 'paused' });
        expect(detail).toEqual(listed);
    });

    it('cold restart: the rehydrated entry carries the trigger attribution and the #7639 variable snapshot', async () => {
        const store = new InMemorySuspendedRunStore();
        const parked = await buildEngine(store).execute('approval_flow', TRIGGER);

        const before = await store.load(parked.runId!);
        const cold = buildEngine(store);
        const detail = (await cold.getRun(parked.runId!))!;

        // #7533 — rebuilt through `buildRunTrigger` on the persisted context,
        // not from the flattened `trigger_*` filter columns (which spell an
        // absent type `null` where the log entry says 'manual'). A run
        // rehydrated after a restart still says what fired it and on which
        // record.
        expect(detail.trigger).toEqual({
            type: 'record_change', object: 'crm_order', recordId: 'ord_1', userId: 'usr_ops',
        });
        // #7639 — `variables` is part of what a PAUSED run discloses on
        // run-detail. Dropping it here would have re-opened that card for
        // exactly the runs that need it most: the ones that outlived the
        // process. It is the same snapshot the continuation will resume from.
        expect(detail.variables).toEqual(before!.variables);
        expect(detail.flowName).toBe('approval_flow');
        expect(detail.startedAt).toBe(before!.startedAt);
    });

    it('GREEN: durability is untouched — the run still resumes to completion after the restart', async () => {
        const store = new InMemorySuspendedRunStore();
        const parked = await buildEngine(store).execute('approval_flow', TRIGGER);

        // The half that already worked, and the half a read-path change is most
        // likely to break by accident: the filer measured resume 200 / acted:1
        // post-restart, so this must not regress.
        const cold = buildEngine(store);
        expect((await cold.resume(parked.runId!)).success).toBe(true);
        await flush();

        // …and the run now reports terminal on both surfaces, not "paused
        // forever" (#3456) off a suspension row that was just consumed.
        expect((await cold.getRun(parked.runId!))!.status).toBe('completed');
        expect(await cold.listRuns('approval_flow', { status: 'paused' })).toEqual([]);
        expect((await cold.listRuns('approval_flow')).map(r => r.status)).toEqual(['completed']);
    });

    it('GREEN: a genuinely unknown run id is still not found (the 404 envelope is unchanged)', async () => {
        const store = new InMemorySuspendedRunStore();
        await buildEngine(store).execute('approval_flow', TRIGGER);

        // The precondition of `deps.error('Execution not found', 404)` in
        // `packages/runtime/src/domains/automation.ts`. The new fallback must
        // not invent an entry for an id the store has never heard of — a store
        // read that answers `null` is what keeps the refusal envelope intact.
        expect(await buildEngine(store).getRun('run_does_not_exist')).toBeNull();
    });
});

describe('#8050 merging a third source: no duplicates, and a stated precedence', () => {
    it('GREEN: pre-restart the run is in BOTH the ring and the store, and enumerates once', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = buildEngine(store);
        const parked = await engine.execute('approval_flow', TRIGGER);

        // Both sources genuinely hold it — otherwise this pin proves nothing.
        expect(await store.load(parked.runId!)).not.toBeNull();

        const rows = await engine.listRuns('approval_flow');
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(parked.runId);
        // The RING copy wins, and it is the richer one: `durationMs` is the
        // time the run spent executing before it parked, which a suspension row
        // does not record (it stores only `started_at` / `start_time`).
        expect(rows[0].durationMs).toEqual(expect.any(Number));
        expect(await engine.getRun(parked.runId!)).toEqual(rows[0]);
    });

    it('GREEN: a STALE paused row cannot mask a finished run (ring side)', async () => {
        // The realistic shape: the run completes, but the best-effort delete of
        // its suspension row is lost to a store outage. The ring says
        // completed, the store still says paused.
        const store = new InMemorySuspendedRunStore();
        const engine = buildEngine(store);
        const parked = await engine.execute('approval_flow', TRIGGER);
        const runId = parked.runId!;
        const orphan = (await store.load(runId))!;

        expect((await engine.resume(runId)).success).toBe(true);
        await flush();
        await store.save(orphan); // the delete that "failed"

        const rows = await engine.listRuns('approval_flow');
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('completed');
        expect((await engine.getRun(runId))!.status).toBe('completed');
        // …and it is not double-counted into the paused view either.
        expect(await engine.listRuns('approval_flow', { status: 'paused' })).toEqual([]);
    });

    it('GREEN: a STALE paused row cannot mask a finished run (durable side, cold)', async () => {
        // Same orphan, but read by a process whose ring is empty — so the
        // precedence is decided purely between the two DURABLE families. The
        // terminal history row is later evidence and must win.
        const store = new InMemorySuspendedRunStore();
        const engine = buildEngine(store);
        const runId = (await engine.execute('approval_flow', TRIGGER)).runId!;
        const orphan = (await store.load(runId))!;
        expect((await engine.resume(runId)).success).toBe(true);
        await flush();
        await store.save(orphan);

        const cold = buildEngine(store);
        const rows = await cold.listRuns('approval_flow');
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('completed');
        expect((await cold.getRun(runId))!.status).toBe('completed');
        expect(await cold.listRuns('approval_flow', { status: 'paused' })).toEqual([]);
    });

    it('RED: cold restart — paused rows do not leak across flows', async () => {
        // Labelled red after measurement: on `main` this fails at `[]`, because
        // it has to see the row before it can check whose row it is. The
        // invariant it adds on top of the enumeration is the scoping one —
        // `store.list()` has NO flow slot (it returns every paused row in the
        // deployment), so narrowing is this method's job, and dropping the
        // filter would show one flow's in-flight runs under another. The
        // pre-restart twin below is the half that guards this on `main` too.
        const store = new InMemorySuspendedRunStore();
        const engine = buildEngine(store, ['approval_flow', 'other_flow']);
        const mine = await engine.execute('approval_flow', TRIGGER);
        await engine.execute('other_flow', TRIGGER);

        const cold = buildEngine(store, ['approval_flow', 'other_flow']);
        expect((await cold.listRuns('approval_flow')).map(r => r.id)).toEqual([mine.runId]);
    });

    it('GREEN: pre-restart — another flow\'s paused run does not leak in', async () => {
        // The genuinely-green scoping guard: the ring is filtered by flow name
        // on `main` too, so this passes on both trees and stays a real pin on
        // the narrowing rather than a vacuous one.
        const store = new InMemorySuspendedRunStore();
        const engine = buildEngine(store, ['approval_flow', 'other_flow']);
        const mine = await engine.execute('approval_flow', TRIGGER);
        await engine.execute('other_flow', TRIGGER);

        expect((await engine.listRuns('approval_flow')).map(r => r.id)).toEqual([mine.runId]);
        expect(await engine.listRuns('approval_flow', { status: 'paused' })).toHaveLength(1);
    });

    it('RED: cold restart — ?status= still narrows, and the new arm does not widen it', async () => {
        // Also red on `main`, for the same reason: the `paused` clause is the
        // new behaviour. The two clauses above it are the anti-widening pin —
        // a `paused` row must never be returned to a caller asking for a
        // terminal status, which is how a third source silently defeats #7359
        // in the other direction.
        const store = new InMemorySuspendedRunStore();
        const engine = buildEngine(store);
        await engine.execute('approval_flow', TRIGGER);

        const cold = buildEngine(store);
        expect(await cold.listRuns('approval_flow', { status: 'completed' })).toEqual([]);
        expect(await cold.listRuns('approval_flow', { status: 'failed' })).toEqual([]);
        expect(await cold.listRuns('approval_flow', { status: 'paused' })).toHaveLength(1);
    });

    it('RED: an unreadable paused store DEGRADES the listing — it never throws', async () => {
        // Red on `main` only because the warning it looks for is part of the
        // new arm — there is nothing on `main` to degrade. What it pins is that
        // the new read is best-effort, exactly like the history arm beside it:
        // a store outage must not turn the Runs view into a 500, and the
        // shortfall must be said out loud rather than read as "nothing
        // pending". The run itself stays parked and resumable through a
        // different door (`loadSuspendedRun`), unaffected by this failure.
        const store = new InMemorySuspendedRunStore();
        const engine = buildEngine(store);
        await engine.execute('approval_flow', TRIGGER);

        const warnings: string[] = [];
        const noisy = {
            info() {}, error() {}, debug() {},
            warn(m: unknown) { warnings.push(String(m)); },
            child() { return noisy; },
        } as never;
        // Delegating wrapper rather than a spread: `store` is a class instance,
        // so its methods live on the prototype and a spread would copy none of
        // them — the other arms of the merge would then fail for the wrong
        // reason and the pin would pass without measuring anything.
        const unreadable: SuspendedRunStore = {
            save: (run) => store.save(run),
            load: (id) => store.load(id),
            delete: (id) => store.delete(id),
            listHistory: (flow, n) => store.listHistory(flow, n),
            loadTerminal: (id) => store.loadTerminal(id),
            recordTerminal: (rec) => store.recordTerminal(rec),
            list: async () => { throw new Error('sqlite: database is locked'); },
        };
        const cold = new AutomationEngine(noisy, unreadable);
        cold.registerFlow('approval_flow', pausingFlow('approval_flow') as never);

        await expect(cold.listRuns('approval_flow', { status: 'paused' })).resolves.toEqual([]);
        expect(warnings.join('\n')).toContain('paused-run read failed');
    });

    it('GREEN: a store with no paused rows behaves exactly as before', async () => {
        // The pre-#8050 path, unchanged: terminal history alone still backs the
        // post-restart Runs view.
        const store = new InMemorySuspendedRunStore();
        const engine = new AutomationEngine(silent, store);
        engine.registerFlow('plain', {
            name: 'plain', label: 'plain', type: 'autolaunched',
            nodes: [{ id: 'start', type: 'start', label: 's' }, { id: 'end', type: 'end', label: 'e' }],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        } as never);
        expect((await engine.execute('plain', TRIGGER)).success).toBe(true);
        await flush();

        const cold = new AutomationEngine(silent, store);
        const rows = await cold.listRuns('plain');
        expect(rows.map(r => r.status)).toEqual(['completed']);
        expect(await cold.listRuns('plain', { status: 'paused' })).toEqual([]);
    });
});

/**
 * The card's literal reproduction, minus the HTTP hop: a real `sys_automation_run`
 * table in a real sqlite FILE, written by {@link ObjectStoreSuspendedRunStore}
 * through ObjectQL, then read by a second kernel booted over the same file.
 *
 * The engine-level blocks above already pin the logic; this one pins that the
 * fix survives the layer they stub — the serialize/deserialize boundary and the
 * `where: { status: 'paused' }` scan the DB-backed store actually issues. That
 * is where "works against a Map, empty against a table" would hide.
 */
describe('#8050 cold boot over the same sqlite file (full stack)', () => {
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
        automation.registerNodeExecutor(holdExecutor);
        automation.registerNodeExecutor({ type: 'noop', async execute() { return { success: true }; } } as never);
        automation.registerFlow('showcase_budget_approval', pausingFlow('showcase_budget_approval') as never);
        return { kernel, ql, automation };
    }

    it('a run parked before the restart is enumerable, readable and resumable after it', async () => {
        dir = mkdtempSync(join(tmpdir(), 'os-8050-'));
        const file = join(dir, 'data.db');

        // ── process 1: park a run ────────────────────────────────────────────
        const first = await boot(file);
        const parked = await first.automation.execute('showcase_budget_approval', TRIGGER);
        expect(parked.status).toBe('paused');
        const runId = parked.runId!;
        await first.kernel.shutdown();
        kernels.splice(kernels.indexOf(first.kernel), 1);

        // ── process 2: cold boot over the SAME file ─────────────────────────
        const second = await boot(file);

        // The row survived — the card's control reading, over the data API.
        // (If this ever fails, the defect is durability, not observability, and
        // it is a heavier card than #8050.)
        const row = await second.ql.findOne('sys_automation_run', {
            where: { id: runId }, context: { isSystem: true } as never,
        });
        expect(row, 'the suspension row must survive the restart').toBeTruthy();
        expect(row.status).toBe('paused');

        // RED on main: `[]` for both listings, `null` for the detail.
        const listed = await second.automation.listRuns('showcase_budget_approval', { status: 'paused' });
        expect(listed.map(r => r.id)).toEqual([runId]);
        expect((await second.automation.listRuns('showcase_budget_approval')).map(r => r.id)).toEqual([runId]);

        const detail = await second.automation.getRun(runId);
        expect(detail).not.toBeNull();
        expect(detail!.status).toBe('paused');
        expect(detail).toEqual(listed[0]);

        // GREEN: still not found for an id that never existed.
        expect(await second.automation.getRun('run_never_existed')).toBeNull();

        // GREEN: and the durability the filer measured is intact — the run
        // resumes to completion, and both surfaces then say so.
        expect((await second.automation.resume(runId)).success).toBe(true);
        await flush();
        expect((await second.automation.getRun(runId))!.status).toBe('completed');
        expect(await second.automation.listRuns('showcase_budget_approval', { status: 'paused' })).toEqual([]);
    });
});

/**
 * Type-level anchor: the two rehydration paths this card touches consume the
 * store's own contract types, so a future change to either row family has to
 * come past the compiler here rather than past a cast in the engine.
 */
export type _PausedRowSources = [SuspendedRun, RunRecord];
