// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14241] What a flow CRUD node's `fields` write map ACTUALLY does when it
 * names a field the target object never declares — pinned end to end, through
 * the real AutomationEngine, the real builtin CRUD node executors, a real
 * ObjectQL and a real driver.
 *
 * ## The sentence this file holds up
 *
 * `validate-flow-node-writes` (@objectstack/lint) is `severity: 'error'` — it
 * GATES, where its two `ctx.api` siblings only advise — and its header states
 * the runtime consequence as measured fact:
 *
 *   • the declared-field door refuses the write — `INVALID_FIELD` / 400,
 *     "Unknown field 'stagee' on object 'deal'", identically on every
 *     datasource, before any statement is built;
 *   • the write is refused WHOLE: a correctly named field in the SAME payload
 *     does not land either;
 *   • on `create_record` the row is never created at all, so every later node
 *     expecting `{<node>.id}` is working from a record that does not exist;
 *   • the node catches the refusal and folds it into a step failure
 *     (`create_record(deal) failed: …`), so the RUN fails — far from the
 *     authoring mistake, which is why an author-time rule is worth having.
 *
 * #13858 rewrote that prose after measuring it. The harness it measured with
 * was a scratch and was deleted, so from that day the three corrected messages
 * asserted a runtime behaviour that nothing pinned — the exact drift
 * `packages/runtime/src/sandbox/undeclared-field-write-driver-split.integration.test.ts`
 * exists to prevent for the two call shapes IT covers. This file is the flow
 * node's half; the `ctx.api` half lives in that runtime file, beside the two
 * shapes it already pinned.
 *
 * ## Why this shape is not already covered
 *
 * The flow executor calls the data engine directly (`data.insert` /
 * `data.update` in service-automation's `builtin/crud-nodes.ts`), bypassing the
 * metadata-protocol ingress, so the node's `fields` map arrives as an ORDINARY
 * CALLER PAYLOAD. The refusal itself is therefore the pre-hook declared-field
 * door (#8682 insert, #8738 update) — which the runtime file already pins on
 * both driver families, including the schemaless family's "no shadow column".
 * What is unpinned, and what this file adds, is everything the flow layer wraps
 * around that refusal: whether the run fails or reports a clean success, what
 * the step says, whether the correctly named siblings survive, and whether the
 * row exists afterwards.
 *
 * ## Why there is no second driver arm here
 *
 * The lint prose says "identically on every datasource" — and the reason it can
 * is structural, not statistical: NO DRIVER IS REACHED. So this file proves the
 * structural fact directly (`writes` below counts every write verb the driver
 * is asked to perform, and the refusal cases assert zero) rather than sampling
 * two families and inferring it. A second family run could only ever agree with
 * the first about a code path neither of them executes.
 *
 * ⚠️ That is also the only shape available here. The schemaless witness in this
 * repo is `@objectstack/driver-memory`, whose every declaration is disposed of
 * in `scripts/driver-memory-census.ledger.json` and gated by
 * `pnpm check:driver-memory-census` (#6664, from #5704 / #5499). Admitting a
 * new test consumer of a frozen driver is a maintainer ruling, not a test
 * author's call — and the CLI's own ledger entry records that "the CLI imports
 * the driver nowhere". The zero-write assertion is what makes that a
 * non-sacrifice: the family-split question cannot arise below a door nothing
 * gets past.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine, registerCrudNodes } from '@objectstack/service-automation';
import type { EngineQueryOptions } from '@objectstack/spec/data';

/**
 * The read-backs, TYPED rather than cast — `check:query-options-erasure`
 * counts an `as any` options bag in test code too, and these are ordinary
 * `where` bags with no reason to be erased.
 */
const allRows: EngineQueryOptions = { where: {} };
const rowById = (id: unknown): EngineQueryOptions => ({ where: { id } });

/** `stagee` is the typo under test; `stage` is the field that exists. */
const DEAL = {
    name: 'deal',
    fields: {
        name: { type: 'text', name: 'name' },
        stage: { type: 'text', name: 'stage' },
        amount: { type: 'number', name: 'amount' },
    },
};

/** Silent logger — the engine and the node pack both take one. */
function makeLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}

/**
 * Every write verb the driver contract exposes, counted.
 *
 * This is the file's load-bearing instrument, not a convenience: "identically
 * on every datasource" is a claim about a code path that is never entered, and
 * the only honest way to pin a never-entered path is to watch the entrance.
 */
const WRITE_VERBS = ['create', 'update', 'upsert', 'delete', 'bulkCreate', 'bulkUpdate', 'updateMany', 'deleteMany'] as const;

function countWrites(driver: any): { total: () => number; byVerb: Record<string, number> } {
    const byVerb: Record<string, number> = {};
    for (const verb of WRITE_VERBS) {
        const original = driver[verb];
        if (typeof original !== 'function') continue;
        byVerb[verb] = 0;
        driver[verb] = function patched(this: unknown, ...args: unknown[]) {
            byVerb[verb] += 1;
            return original.apply(driver, args);
        };
    }
    return { total: () => Object.values(byVerb).reduce((a, b) => a + b, 0), byVerb };
}

/** A `create_record` flow whose node writes `fields` into `deal`. */
function createFlow(name: string, fields: Record<string, unknown>) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'c', type: 'create_record', label: 'Create', config: { objectName: 'deal', fields } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'c' },
            { id: 'e2', source: 'c', target: 'end' },
        ],
    } as any;
}

/** An `update_record` flow naming one row by scalar id (no bulk intent). */
function updateFlow(name: string, id: unknown, fields: Record<string, unknown>) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'u', type: 'update_record', label: 'Update', config: { objectName: 'deal', filter: { id }, fields } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'u' },
            { id: 'e2', source: 'u', target: 'end' },
        ],
    } as any;
}

describe('#14241 a flow CRUD node writing an undeclared field', () => {
    let engine: ObjectQL | null = null;
    let dir: string | null = null;

    afterEach(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
        engine = null;
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    });

    /** A real ObjectQL on a real sqlite table with only the declared columns. */
    async function boot() {
        dir = mkdtempSync(join(tmpdir(), 'os-14241-'));
        const driver = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: join(dir, 'data.sqlite') },
            useNullAsDefault: true,
        });
        await driver.initObjects([DEAL]);
        engine = new ObjectQL();
        engine.registerDriver(driver as any, true);
        await engine.init();
        engine.registry.registerObject(DEAL as any);
        return { ql: engine, driver };
    }

    /** The real builtin CRUD nodes over that engine — no stub in the chain. */
    function automationOver(ql: ObjectQL) {
        const logger = makeLogger();
        const automation = new AutomationEngine(logger);
        registerCrudNodes(automation, {
            logger,
            getService: (n: string) => (n === 'data' ? ql : undefined),
        } as any);
        return automation;
    }

    const stepOf = async (automation: AutomationEngine, flow: string, nodeId: string) => {
        const runs = await automation.listRuns(flow);
        return runs[0].steps.find((s: any) => s.nodeId === nodeId)!;
    };

    // ─── The envelope, at the seam the node hands the payload to ──────────────

    /**
     * The node's `fields` map IS a caller payload, so the refusal it meets is
     * the ADR-0112 envelope the three lint messages quote. The node folds that
     * envelope into a string, and the engine then stamps the step it failed
     * `NODE_FAILURE` (`create_record` re-surfaces a node-level `code` only for
     * `DUPLICATE_RECORD`, `update_record` for nothing at all, and neither
     * reaches `step.error.code` anyway). So this is the one place in the flow
     * chain where the DOOR's `code` and `status` are still observable, and the
     * step assertions below pin what is left of them. Asserted here rather than
     * left to the step's prose: a message can be reworded, and a `toThrow()`
     * would pass on any error at all — including the driver-level failure this
     * door exists to make unreachable.
     */
    it('the door answers INVALID_FIELD / 400 for the exact payload the node builds', async () => {
        const { ql } = await boot();

        const onInsert: any = await ql.insert('deal', { name: 'first', stagee: 'won' } as any)
            .catch((x: unknown) => x);
        const seed: any = await ql.insert('deal', { name: 'seed', stage: 'open', amount: 10 });
        const onUpdate: any = await ql.update('deal', { id: seed.id, stagee: 'won' } as any)
            .catch((x: unknown) => x);

        for (const err of [onInsert, onUpdate]) {
            expect(err?.code).toBe('INVALID_FIELD');
            expect(err?.status).toBe(400);
            expect(err?.field).toBe('stagee');
            expect(err?.message).toBe("Unknown field 'stagee' on object 'deal'");
        }
    }, 30000);

    // ─── create_record ────────────────────────────────────────────────────────

    describe('create_record', () => {
        it('fails the RUN, and the step names the refusal', async () => {
            const { ql } = await boot();
            const automation = automationOver(ql);
            automation.registerFlow('f_create_bad', createFlow('f_create_bad', { name: 'first', stagee: 'won' }));

            const res = await automation.execute('f_create_bad', { userId: 'u1' });

            expect(res.success).toBe(false);
            const step = await stepOf(automation, 'f_create_bad', 'c');
            expect(step.status).toBe('failure');
            // The step's error is an envelope of its own, and the WHOLE of it is
            // pinned: the flow layer reclassifies every failing node to
            // `NODE_FAILURE` (engine.ts, its single step-push site) and carries
            // the door's message verbatim inside it. So `INVALID_FIELD` is NOT
            // what a run reports — the message is the only channel that
            // survives the fold, which is why it is asserted whole rather than
            // by `toContain`.
            expect(step.error).toEqual({
                code: 'NODE_FAILURE',
                message: "create_record(deal) failed: Unknown field 'stagee' on object 'deal'",
            });
        }, 30000);

        it('creates NO row — so a later {<node>.id} has nothing to read', async () => {
            const { ql, driver } = await boot();
            const writes = countWrites(driver);
            const automation = automationOver(ql);
            automation.registerFlow('f_create_none', createFlow('f_create_none', { name: 'first', stagee: 'won' }));

            await automation.execute('f_create_none', { userId: 'u1' });

            expect(await ql.find('deal', allRows)).toHaveLength(0);
            // "before any statement is built", measured rather than asserted in
            // prose: the driver was never asked to write anything, which is why
            // no datasource can answer this differently.
            expect(writes.total()).toBe(0);
        }, 30000);

        it('CONTROL — the same node spelled right creates the row', async () => {
            const { ql } = await boot();
            const automation = automationOver(ql);
            automation.registerFlow('f_create_ok', createFlow('f_create_ok', { name: 'first', stage: 'won' }));

            const res = await automation.execute('f_create_ok', { userId: 'u1' });

            expect(res.success).toBe(true);
            const rows: any[] = await ql.find('deal', allRows);
            expect(rows).toHaveLength(1);
            expect(rows[0].stage).toBe('won');
        }, 30000);
    });

    // ─── update_record ────────────────────────────────────────────────────────

    describe('update_record', () => {
        it('fails the RUN, and the step names the refusal', async () => {
            const { ql } = await boot();
            const seed: any = await ql.insert('deal', { name: 'seed', stage: 'open', amount: 10 });
            const automation = automationOver(ql);
            automation.registerFlow('f_update_bad', updateFlow('f_update_bad', seed.id, { stagee: 'won' }));

            const res = await automation.execute('f_update_bad', { userId: 'u1' });

            expect(res.success).toBe(false);
            const step = await stepOf(automation, 'f_update_bad', 'u');
            expect(step.status).toBe('failure');
            expect(step.error).toEqual({
                code: 'NODE_FAILURE',
                message: "update_record(deal) failed: Unknown field 'stagee' on object 'deal'",
            });
        }, 30000);

        it('refuses the write WHOLE — the correctly named field in the same map does not land either', async () => {
            const { ql, driver } = await boot();
            const seed: any = await ql.insert('deal', { name: 'seed', stage: 'open', amount: 10 });
            const writes = countWrites(driver);
            const automation = automationOver(ql);
            automation.registerFlow(
                'f_update_whole',
                updateFlow('f_update_whole', seed.id, { name: 'renamed', stagee: 'won' }),
            );

            await automation.execute('f_update_whole', { userId: 'u1' });

            const after: any = (await ql.find('deal', rowById(seed.id)))[0];
            // `name` was spelled correctly and rode in the same payload. An
            // author reading "the unknown key is skipped" would expect it to
            // land; it does not.
            expect(after.name).toBe('seed');
            expect(after.stage).toBe('open');
            // The assertion that separates a refusal from a silent write: a
            // datasource with no schema to check against would keep the key.
            expect(after).not.toHaveProperty('stagee');
            expect(writes.total()).toBe(0);
        }, 30000);

        it('CONTROL — the same node spelled right updates the row', async () => {
            const { ql } = await boot();
            const seed: any = await ql.insert('deal', { name: 'seed', stage: 'open', amount: 10 });
            const automation = automationOver(ql);
            automation.registerFlow('f_update_ok', updateFlow('f_update_ok', seed.id, { name: 'renamed', stage: 'won' }));

            const res = await automation.execute('f_update_ok', { userId: 'u1' });

            expect(res.success).toBe(true);
            const after: any = (await ql.find('deal', rowById(seed.id)))[0];
            expect(after.name).toBe('renamed');
            expect(after.stage).toBe('won');
        }, 30000);
    });
});
