// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15832 note 2] `ObjectStoreSuspendedRunStore.claimSuspension` must never
 * announce `'unsupported'` AFTER it has issued the compare-and-set.
 *
 * ## The defect, in the terms that make it a correctness card
 *
 * The refusal used to be decided on the SHAPE of the return value:
 *
 * ```ts
 * const affected = await this.engine.delete(TABLE, { where, multi: true, … });
 * if (typeof affected !== 'number') { warn(…); return 'unsupported'; }
 * ```
 *
 * `'unsupported'` means "no cross-replica advance guarantee is offered by this
 * store". Said HERE it is a statement about a write that has already landed
 * against the shared row: the conditional delete went out, its verdict was
 * discarded, and {@link AutomationEngine.claimAdvance} reads `'unsupported'`
 * as `unguarded` — so a replica that ACTUALLY LOST the compare-and-set (0 rows
 * affected) resumed anyway. That is the doubled side effect #14333 exists to
 * prevent, occurring on the one composition that declares itself unable to
 * prevent it.
 *
 * ⛔ The redundant delete round-trip the old shape also bought (`claimAdvance`
 * reads `unguarded`, so `forgetSuspendedRun` issues a second, unconditional
 * delete of the same row) is real and is NOT what this file is about. A change
 * that only removed it would leave every case below red.
 *
 * ## The invariant this file pins
 *
 * > No path through `claimSuspension` answers `'unsupported'` once a delete
 * > carrying the run's condition has been issued.
 *
 * Two arms, because the question "does this engine's multi-delete resolve a
 * count?" has no contractual answer to look up — `ObjectQL.delete` declares
 * `Promise<any>` — and therefore no read-only instrument:
 *
 *  - **before the write**: a one-time capability probe down the SAME route,
 *    against a predicate that matches no row. An engine that does not count is
 *    refused with nothing consumed, which is what makes `claimAdvance`'s
 *    `unguarded` reading TRUE when it is taken.
 *  - **after the write**: `'unsupported'` is retired as an answer. A committed
 *    compare-and-set whose verdict is unreadable is UNKNOWN, not unguarded —
 *    a winner and a loser both find the row gone, so nothing can tell them
 *    apart afterwards — and the store THROWS, which `claimAdvance` already
 *    turns into `STORE_UNAVAILABLE` and a REFUSED resume.
 *
 * ⚠️ What is deliberately NOT claimed: that an uncounted engine gains the
 * guarantee. It does not, and cannot from inside this store — the count is
 * contracted one layer down (`IDataDriver.deleteMany`, `Promise<number>`) and
 * erased to `any` at the engine boundary, which is #16033. What changes here
 * is that the store's declaration stops being false at the moment it is made.
 *
 * ## Population — what each case actually drives
 *
 * Fourteen cases over three populations:
 *
 *  1. **Store-level, one fake data engine** (`createProbeAwareEngine`, whose
 *     `delete` is bound to the producer's own dispatch predicate, so it cannot
 *     accept a call `ObjectQL.delete` refuses). Three engine return shapes are
 *     driven: a counting one, a uniformly non-counting one (`undefined`), and
 *     an INCONSISTENT one that counts for the probe and does not for the claim
 *     — the only shape on which the second arm above is reachable.
 *  2. **Two `AutomationEngine` replicas over ONE
 *     `ObjectStoreSuspendedRunStore`**, over one of those fake engines. Two
 *     replicas is the whole modelled fleet: it is the smallest number on which
 *     "the loser resumes too" is observable, and the side effects are counted
 *     off a shared ledger rather than off call spies.
 *  3. **A real kernel** — `ObjectKernel` + `ObjectQLPlugin` + `SqlDriver`
 *     (better-sqlite3) over a real `sys_automation_run` table — for the two
 *     facts a fake cannot witness: that the shipped composition takes the
 *     COUNTED path, and that the probe's predicate consumes nothing there.
 *     ⛔ Only better-sqlite3 is installable in this container, so postgres,
 *     mysql, mongodb and a hosted Turso endpoint are UNMEASURED here, as they
 *     were for this card's phase-1 sweep.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
// The PRODUCER's own delete-dispatch decision — the fake below routes `delete`
// through it so it physically cannot accept a call `ObjectQL.delete` refuses
// (`scripts/check-engine-double-contract.mjs`), and the cases read it directly
// to say WHICH route a recorded call would have taken.
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';

import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import { ObjectStoreSuspendedRunStore, type SuspendedRunStoreEngine } from './suspended-run-store.js';
import type { RunRecord, SuspendedRun } from './engine.js';

const silent = () => ({ info() {}, warn() {}, error() {}, debug() {}, child: silent }) as any;

/** Rows keyed by id, with `where` equality — the `sys_automation_run` table. */
function createProbeAwareEngine(
    /**
     * What a `multi` delete resolves to, given how many rows it matched and the
     * options bag it was called with. Omitted → the honest count, which is what
     * every shipped driver measured for this card answers.
     */
    multiResult?: (matched: number, options: any) => unknown,
): SuspendedRunStoreEngine & { rows: Map<string, any>; deletes: any[] } {
    const rows = new Map<string, any>();
    const deletes: any[] = [];
    const matches = (row: any, where: any) =>
        !where || Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return row[k] === v;
        });
    return {
        rows,
        deletes,
        async find(_object, options) {
            const out = [...rows.values()].filter(r => matches(r, options?.where));
            return typeof options?.limit === 'number' ? out.slice(0, options.limit) : out;
        },
        async insert(_object, data) { rows.set(String(data.id), { ...data }); return data; },
        async update(_object, data, options) {
            const id = options?.where?.id ?? data.id;
            rows.set(String(id), { ...(rows.get(String(id)) ?? { id }), ...data });
            return rows.get(String(id));
        },
        async delete(_object, options) {
            // Bound to the producer's predicate, never a hand-written
            // approximation of it: drop `multi: true` from the store and this
            // THROWS, exactly as a running server does.
            const dispatch = assertEngineDeleteDispatch(options as any);
            deletes.push(options);
            if (dispatch.kind === 'multi') {
                const doomed = [...rows.values()].filter(r => matches(r, options?.where));
                for (const r of doomed) rows.delete(String(r.id));
                return multiResult ? multiResult(doomed.length, options) : doomed.length;
            }
            rows.delete(String(dispatch.id));
            return true;
        },
    };
}

/**
 * Recognise the one-time capability probe by its SHAPE, not by its literal
 * sentinel: a `multi` delete whose three condition columns all carry the same
 * value. Pinning the characters would pin a private constant; pinning the
 * shape pins the property that makes the call safe — a row would have to carry
 * that one string in `id` AND `node_id` AND `correlation` to match it.
 */
function isCapabilityProbe(options: any): boolean {
    const where = options?.where ?? {};
    const keys = Object.keys(where).sort().join(',');
    return assertEngineDeleteDispatch(options).kind === 'multi'
        && keys === 'correlation,id,node_id'
        && where.id === where.node_id
        && where.node_id === where.correlation;
}

const baseRun = (over: Partial<SuspendedRun> = {}): SuspendedRun => ({
    runId: 'run_abc',
    flowName: 'approval_flow',
    flowVersion: 1,
    nodeId: 'approve_step',
    variables: { $runId: 'run_abc' },
    steps: [],
    context: { object: 'crm_deal', userId: 'u1', tenantId: 'org_1' } as any,
    startedAt: '2026-01-01T00:00:00.000Z',
    startTime: 1735689600000,
    correlation: 'areq_1',
    ...over,
});

describe('#15832 the capability question is settled BEFORE the compare-and-set', () => {
    it('⭐ an engine that does not count is refused with NOTHING consumed — the row survives the refusal', async () => {
        // The composition the card is about: a multi-delete that resolves
        // something other than an affected-row count.
        const data = createProbeAwareEngine(() => undefined);
        const lines: string[] = [];
        const store = new ObjectStoreSuspendedRunStore(data, { warn: (m: string) => lines.push(m) } as any);
        await store.save(baseRun());

        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('unsupported');

        // ⭐ THE CARD. Before this change the compare-and-set had already gone
        // out and taken the row with it, so this read was `false` — the store
        // said "no guarantee is offered" about a guard it had just executed.
        expect(data.rows.has('run_abc')).toBe(true);
        expect(data.rows.get('run_abc').node_id).toBe('approve_step');
        // And not one delete carried the run's condition.
        expect(data.deletes.filter(d => d.where?.id === 'run_abc')).toEqual([]);
        // The only delete issued is the probe, which can match nothing.
        expect(data.deletes).toHaveLength(1);
        expect(isCapabilityProbe(data.deletes[0])).toBe(true);

        // The degradation is still DECLARED, and now truthfully.
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('not an affected-row count');
        expect(lines[0]).toContain('no cross-replica advance guarantee');
        expect(lines[0]).toContain('NO delete was issued');
    });

    it('the probe cannot consume anything: neither a live suspension nor a terminal history row', async () => {
        const data = createProbeAwareEngine(() => undefined);
        const store = new ObjectStoreSuspendedRunStore(data, silent());
        // Both row families this table holds, written by their real writers.
        await store.save(baseRun());
        await store.recordTerminal({
            runId: 'abc2', flowName: 'approval_flow', status: 'completed',
            startedAt: '2026-01-01T00:00:00.000Z', triggerType: 'manual',
        } as RunRecord);
        const before = [...data.rows.keys()].sort();
        expect(before).toHaveLength(2);

        await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' });

        expect([...data.rows.keys()].sort()).toEqual(before);
    });

    it('the probe takes the SAME route the claim takes — `multi`, not by-id', async () => {
        // If it took the by-id route it would answer about `driver.delete`,
        // whose contract is a boolean, and every counted engine would read as
        // uncounted. The route IS the question.
        const data = createProbeAwareEngine();
        const store = new ObjectStoreSuspendedRunStore(data, silent());
        await store.claimSuspension('run_abc', { nodeId: 'approve_step' });

        expect(assertEngineDeleteDispatch(data.deletes[0])).toEqual({ kind: 'multi' });
        expect(isCapabilityProbe(data.deletes[0])).toBe(true);
    });

    it('costs ONE probe per store, not one per resume — three claims, one probe', async () => {
        const data = createProbeAwareEngine(() => undefined);
        const lines: string[] = [];
        const store = new ObjectStoreSuspendedRunStore(data, { warn: (m: string) => lines.push(m) } as any);

        for (let i = 0; i < 3; i++) {
            expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step' })).toBe('unsupported');
        }

        expect(data.deletes).toHaveLength(1);
        // Same posture the answer already had: a composition that cannot
        // express the condition cannot express it for the life of the process.
        expect(lines).toHaveLength(1);
    });

    it('concurrent first claims share ONE probe', async () => {
        const data = createProbeAwareEngine();
        const store = new ObjectStoreSuspendedRunStore(data, silent());
        await store.save(baseRun());

        const [first, second] = await Promise.all([
            store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }),
            store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }),
        ]);

        // Memoizing the VALUE rather than the promise would probe twice here.
        expect(data.deletes.filter(isCapabilityProbe)).toHaveLength(1);
        // And the claim itself is unchanged: exactly one of them consumed it.
        expect([first, second].filter(o => o === 'claimed')).toHaveLength(1);
        expect([first, second].filter(o => o === 'lost')).toHaveLength(1);
    });

    it('a counting engine pays the probe once and then claims exactly as before', async () => {
        const data = createProbeAwareEngine();
        const lines: string[] = [];
        const store = new ObjectStoreSuspendedRunStore(data, { warn: (m: string) => lines.push(m) } as any);
        await store.save(baseRun());

        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('claimed');
        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('lost');

        // probe + claim + claim, and no probe on the second claim.
        expect(data.deletes).toHaveLength(3);
        expect(data.deletes.filter(isCapabilityProbe)).toHaveLength(1);
        expect(isCapabilityProbe(data.deletes[0])).toBe(true);
        // Nothing is declared: this composition offers the guarantee.
        expect(lines).toEqual([]);
    });

    it('a THROWN probe is not memoized — a transient outage is not a permanent verdict', async () => {
        let failing = true;
        const data = createProbeAwareEngine();
        const throwing = {
            ...data,
            async delete(object: string, options: any) {
                if (failing) throw new Error('sqlite: database is locked');
                return data.delete!(object, options);
            },
        } as SuspendedRunStoreEngine & { rows: Map<string, any>; deletes: any[] };
        const store = new ObjectStoreSuspendedRunStore(throwing, silent());
        await store.save(baseRun());

        // The question could not be asked at all — which `claimAdvance` maps to
        // STORE_UNAVAILABLE, the same answer the claim itself produced when it
        // was the call that threw.
        await expect(store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .rejects.toThrow('database is locked');
        // ⛔ And it refused before touching the row.
        expect(data.rows.has('run_abc')).toBe(true);

        failing = false;
        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('claimed');
    });

    it('an engine with no delete() still short-circuits ahead of the probe', async () => {
        const data = createProbeAwareEngine();
        const noDelete = { find: data.find, insert: data.insert, update: data.update } as SuspendedRunStoreEngine;
        const lines: string[] = [];
        const store = new ObjectStoreSuspendedRunStore(noDelete, { warn: (m: string) => lines.push(m) } as any);

        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step' })).toBe('unsupported');
        expect(lines[0]).toContain('engine has no delete()');
        expect(data.deletes).toEqual([]);
    });
});

describe('#15832 after the write, `unsupported` is retired — an unreadable verdict is UNKNOWN', () => {
    /**
     * The ONLY shape on which this arm is reachable: an engine that answers a
     * count for the probe and something else for a real claim. No measured
     * composition does this; the arm exists because the probe cannot promise
     * what the next call resolves to, and a residual nobody can rule out must
     * fail SAFE rather than silently.
     */
    const inconsistent = () =>
        createProbeAwareEngine((matched, options) => (isCapabilityProbe(options) ? matched : undefined));

    it('⭐ the store THROWS rather than answering `unsupported` once the row has been touched', async () => {
        const data = inconsistent();
        const lines: string[] = [];
        const store = new ObjectStoreSuspendedRunStore(data, { warn: (m: string) => lines.push(m) } as any);
        await store.save(baseRun());

        await expect(store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .rejects.toThrow(/UNRECOVERABLE/);

        // The compare-and-set really did go out — that is what makes
        // `'unsupported'` unsayable here rather than merely untidy.
        expect(data.deletes.filter(d => d.where?.id === 'run_abc')).toHaveLength(1);
        // ⛔ And it did NOT declare "no guarantee is offered": that sentence is
        // the one `claimAdvance` reads as `unguarded`.
        expect(lines).toEqual([]);
    });

    it('⭐ THE HARM: a replica whose claim verdict is unreadable is REFUSED, not resumed', async () => {
        // Two replicas over one store, side effects counted off a shared
        // ledger. On `main` both resumed and `notify` fired TWICE.
        const data = inconsistent();
        const store = new ObjectStoreSuspendedRunStore(data, silent());
        const opened: string[] = [];
        const fired: string[] = [];
        const a = replica(store, opened, fired);
        const b = replica(store, opened, fired);

        const runId = (await a.execute('expense_approval')).runId!;
        expect(opened).toEqual(['lv1']);

        const both = await Promise.all([
            a.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as any),
            b.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as any),
        ]);

        // ⭐ The doubled side effect #14333 exists to prevent does not happen.
        expect(fired).toEqual([]);
        expect(both.every(r => !r.success)).toBe(true);
        // Unknown, never "gone for good": the same envelope the strict load's
        // failure uses, and the same remedy — retry.
        expect(both.map(r => r.code)).toEqual(['STORE_UNAVAILABLE', 'STORE_UNAVAILABLE']);
        expect(both[0].error).toContain('UNKNOWN');
    });
});

describe('#15832 the declared degradation still works — an uncounted engine resumes and cleans up', () => {
    it('the run advances, the durable row is still removed, and the engine declares once', async () => {
        // ⚠️ The guarantee is NOT restored by this card: on an engine that
        // cannot count, two replicas can still both advance. What changed is
        // that the store says so before consuming anything. Pinned here so a
        // future reader does not mistake the case above for a claim that the
        // guarantee is now universal.
        const data = createProbeAwareEngine(() => undefined);
        const store = new ObjectStoreSuspendedRunStore(data, silent());
        const lines: string[] = [];
        const opened: string[] = [];
        const fired: string[] = [];
        const engine = replica(store, opened, fired, lines);

        const runId = (await engine.execute('expense_approval')).runId!;
        const resumed = await engine.resume(runId, { [RESUME_AUTHORITY_SERVICE]: true } as any);

        expect(resumed.success).toBe(true);
        expect(fired).toEqual(['notify']);
        // ⛔ No durability regression: `claimSuspension` no longer deletes on
        // this path, and `forgetSuspendedRun`'s unconditional delete — which
        // `unguarded` has always reached — still removes the consumed row.
        expect(data.rows.has(runId)).toBe(false);
        // The engine's own one-time degradation line, now true when it is said.
        expect(lines.filter(l => l.includes('no cross-replica advance guarantee'))).toHaveLength(1);
    });
});

/** One replica over the shared store, appending to the shared ledgers. */
function replica(store: any, opened: string[], fired: string[], warnLines?: string[]): AutomationEngine {
    const logger: any = warnLines
        ? { info() {}, warn: (m: string) => warnLines.push(m), error() {}, debug() {}, child: () => logger }
        : silent();
    const engine = new AutomationEngine(logger, store);
    engine.registerNodeExecutor({
        type: 'approval_level',
        descriptor: defineActionDescriptor({
            type: 'approval_level', version: '1.0.0', name: 'Approval level',
            supportsPause: true, resumeAuthority: 'service',
        }),
        async execute(node) {
            opened.push(node.id);
            return { success: true, suspend: true, correlation: `req_${node.id}` };
        },
    });
    engine.registerNodeExecutor({
        type: 'notify_action',
        descriptor: defineActionDescriptor({ type: 'notify_action', version: '1.0.0', name: 'Notify' }),
        async execute(node) { fired.push(node.id); return { success: true }; },
    });
    engine.registerFlow('expense_approval', {
        name: 'expense_approval', label: 'Expense approval', type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'lv1', type: 'approval_level', label: 'Department head' },
            { id: 'notify', type: 'notify_action', label: 'Notify finance' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'lv1' },
            { id: 'e2', source: 'lv1', target: 'notify' },
            { id: 'e3', source: 'notify', target: 'end' },
        ],
    } as never);
    return engine;
}

/**
 * The two facts a fake engine cannot witness, measured against a real
 * `sys_automation_run` table through a real `ObjectQL`.
 *
 * ⛔ better-sqlite3 only — postgres, mysql, mongodb and a hosted Turso endpoint
 * are UNMEASURED by this file and are not implied by it.
 */
describe('#15832 real ObjectQL + SqlDriver: the shipped composition takes the COUNTED path', () => {
    let dir: string | undefined;
    const kernels: ObjectKernel[] = [];

    afterEach(async () => {
        for (const k of kernels.splice(0)) {
            try { await k.shutdown(); } catch { /* noop */ }
        }
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; }
    });

    async function boot() {
        dir = mkdtempSync(join(tmpdir(), 'os-15832-'));
        const kernel = new ObjectKernel({ logger: { level: 'fatal' } });
        kernels.push(kernel);
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();

        const ql = kernel.getService<ObjectQL>('objectql');
        const driver = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: join(dir, 'data.db') },
            useNullAsDefault: true,
        });
        await driver.connect();
        ql.registerDriver(driver, true);
        await ql.syncSchemas();
        return ql;
    }

    it('claims and loses off a real affected-row count, having probed first', async () => {
        const ql = await boot();
        const seen: any[] = [];
        // A pass-through recorder — the calls are the real engine's, only
        // observed on the way in.
        const recorded = new Proxy(ql as any, {
            get(target, prop, receiver) {
                if (prop !== 'delete') return Reflect.get(target, prop, receiver);
                return async (object: string, options: any) => { seen.push(options); return target.delete(object, options); };
            },
        }) as unknown as SuspendedRunStoreEngine;
        const store = new ObjectStoreSuspendedRunStore(recorded, silent());
        await store.save(baseRun());

        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('claimed');
        // A second claim is the LOSER's read: the row is gone, so the count is
        // 0 — and 0 is a number, which is the whole point of the probe.
        expect(await store.claimSuspension('run_abc', { nodeId: 'approve_step', correlation: 'areq_1' }))
            .toBe('lost');

        expect(seen.filter(isCapabilityProbe)).toHaveLength(1);
        expect(isCapabilityProbe(seen[0])).toBe(true);
    });

    it("the probe's own predicate resolves a COUNT of 0 and consumes nothing", async () => {
        const ql = await boot();
        const store = new ObjectStoreSuspendedRunStore(ql as unknown as SuspendedRunStoreEngine, silent());
        await store.save(baseRun());

        // The probe shape, issued directly at the real engine so the reading is
        // about ObjectQL rather than about this store.
        const sentinel = '__objectstack_suspended_run_claim_capability_probe__';
        const affected = await (ql as any).delete('sys_automation_run', {
            where: { id: sentinel, node_id: sentinel, correlation: sentinel },
            multi: true,
            context: { isSystem: true },
        });

        // NOT MEASURED by reading source: this is the real engine's own answer.
        expect(typeof affected).toBe('number');
        expect(affected).toBe(0);
        // …and the parked row is untouched.
        expect(await store.load('run_abc')).not.toBeNull();
    });
});
