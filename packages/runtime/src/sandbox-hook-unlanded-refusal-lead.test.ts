// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29527] A converted refusal a sandboxed hook body lets leave keeps its lead
 * and its `cause` at the write the hook is bound to.
 *
 * ## What was wrong
 *
 * objectql converts a nested write's stale-roll-up refusal once the write it
 * stopped did not land (`summary-errors.ts`): a delete whose cascade stopped,
 * a transaction that rolled back, a hook that stopped. The hook-dispatch seam
 * (`triggerHooks`) converts again on the way out and RE-LEADS an earlier
 * conversion, so the outer write's caller is told about the outer write and
 * `cause` stays the original refusal.
 *
 * A sandboxed hook body's `ctx.api` write is that write one VM hop further.
 * Its converted refusal crossed out of the QuickJS runner as a `SandboxError`
 * (`500`, `INTERNAL_ERROR` lifted, class and `cause` dropped), which the seam
 * no longer recognised, so it passed through unchanged: the caller of
 * `insert('hcase')` read `The delete of "hacct" did not complete`, the hook's
 * own write, and the summaries the refusal named were gone from `cause`.
 *
 * ## What is pinned
 *
 * The runner hands the engine's own refusal back out when the body let it
 * leave unchanged (as it already did the engine's duplicate-record refusal),
 * so the seam re-leads it:
 *
 * - `beforeInsert`, `afterInsert` and `beforeFind` hooks, each a sandboxed body
 *   deleting an account whose cascade a line's failing roll-up stops. The three
 *   events share one dispatch seam (`afterFind` and the other events with
 *   them); `beforeFind` stands for the read events;
 * - the status and code are unchanged, `500 INTERNAL_ERROR`;
 * - nothing the hook's write touched is stored, and an `afterInsert` hook's
 *   own record is rolled back with it;
 * - CONTROL a body that catches the refusal and throws its own error speaks
 *   for itself, and leaves the runner as a `SandboxError` exactly as before;
 * - CONTROL a body that rewrites the refusal's message before re-throwing it
 *   is a speaker too.
 *
 * The rig is `action-delete-cascade-summary-rollback.test.ts`'s: a real
 * `ObjectQL` over `SqlDriver` on better-sqlite3, which rolls back for real, and
 * the line's roll-up into `hbucket.memo_sum` is a sum over a text field, which
 * every recompute refuses. Hook bodies run through `hookBodyRunnerFactory` over
 * a real `QuickJSScriptRunner`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hookBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner, SandboxError } from './sandbox/quickjs-runner.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const TEST_PACKAGE_ID = 'objectstack-test';
const ACCOUNT = 'hacct';
const BUCKET = 'hbucket';
const LINE = 'hline';
const CASE = 'hcase';
const FINDER = 'hfinder';

const text = (name: string) => ({ name, type: 'text' as const, label: name });
const id = { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' };

const OBJECTS = [
    { name: ACCOUNT, label: 'Account', fields: { id, name: text('name') } },
    {
        name: BUCKET, label: 'Bucket',
        fields: {
            id, name: text('name'),
            // A sum over a text field: every recompute of it is refused.
            memo_sum: { name: 'memo_sum', type: 'summary' as const, label: 'Memo sum', summaryOperations: { object: LINE, function: 'sum', field: 'memo' } },
        },
    },
    {
        name: LINE, label: 'Line',
        fields: {
            id, name: text('name'), memo: text('memo'),
            account: { name: 'account', type: 'master_detail' as const, reference: ACCOUNT, deleteBehavior: 'cascade', label: 'Account' },
            bucket: { name: 'bucket', type: 'lookup' as const, reference: BUCKET, label: 'Bucket' },
        },
    },
    { name: CASE, label: 'Case', fields: { id, name: text('name'), mode: text('mode') } },
    { name: FINDER, label: 'Finder', fields: { id, name: text('name') } },
];

/** Deletes the account; its cascade is stopped by the first line's refused roll-up. */
const PURGE = `await ctx.api.object('${ACCOUNT}').delete({ where: { id: 'a1' } });`;
const WRITE_CAPS = ['api.read', 'api.write'];

/** A sandboxed hook on `hcase`, active only for records whose `mode` names it. */
const caseHook = (name: string, event: string, mode: string, source: string) => ({
    name, object: CASE, events: [event],
    body: { language: 'js', capabilities: WRITE_CAPS, source: `if (ctx.input?.mode !== '${mode}') return; ${source}` },
});

const HOOKS = [
    caseHook('purge_before', 'beforeInsert', 'before', PURGE),
    caseHook('purge_after', 'afterInsert', 'after', PURGE),
    caseHook('purge_speaks', 'beforeInsert', 'speaks', `try { ${PURGE} } catch (e) { throw new Error('The account could not be purged'); }`),
    caseHook('purge_rewrites', 'beforeInsert', 'rewrites', `try { ${PURGE} } catch (e) { e.message = 'Purge refused: ' + e.message; throw e; }`),
    { name: 'purge_on_find', object: FINDER, events: ['beforeFind'], body: { language: 'js', capabilities: WRITE_CAPS, source: PURGE } },
];

let engine: ObjectQL;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await engine.init();
    for (const o of OBJECTS) engine.registry.registerObject(o as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    await engine.insert(ACCOUNT, { id: 'a1', name: 'A' });
    await engine.insert(BUCKET, { id: 'b1', name: 'B' });
    for (const lineId of ['l1', 'l2']) {
        await engine.insert(LINE, { id: lineId, name: lineId, account: 'a1', bucket: 'b1' }).catch((e: any) => {
            // The seed itself meets the failing roll-up; its rows are written.
            if (e?.code !== 'ERR_SUMMARY_RECOMPUTE') throw e;
        });
    }
    engine.setDefaultBodyRunner(hookBodyRunnerFactory(new QuickJSScriptRunner({ hookTimeoutMs: 10_000 }), { ql: engine, appId: 'hcase_app' }));
    bindHooksToEngine(engine, HOOKS as any, { packageId: TEST_PACKAGE_ID });
}, 60_000);

afterAll(async () => {
    errorLog?.mockRestore();
    try { await engine?.destroy(); } catch { /* noop */ }
});

const refusal = (p: Promise<unknown>): Promise<any> => p.then(() => null, (e: unknown) => e);
const rowIds = async (object: string) =>
    ((await engine.find(object, { fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();

/** The re-led refusal: the outer write leads, the line's own refusal is `cause`, the status unchanged. */
function expectReLed(err: any, lead: string) {
    expect(err, 'the write was refused').toBeInstanceOf(Error);
    expect(err.status).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message.startsWith(lead), err.message).toBe(true);
    expect(err.message).not.toContain(`"${ACCOUNT}"`);
    expect(err.message).toContain(`${BUCKET}.memo_sum`);
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(err.cause?.failures?.[0]?.childObject).toBe(LINE);
}

async function expectNothingPurged() {
    expect(await rowIds(ACCOUNT)).toEqual(['a1']);
    expect(await rowIds(LINE)).toEqual(['l1', 'l2']);
}

describe('[#29527] a converted refusal a sandboxed hook body lets leave is re-led for the write the hook is bound to', () => {
    it('beforeInsert: the caller reads the insert of the case, `cause` is the line\'s own refusal', async () => {
        const err = await refusal(engine.insert(CASE, { id: 'c_before', name: 'x', mode: 'before' }));
        expectReLed(err, `The insert of "${CASE}" did not complete: its beforeInsert hook "purge_before" stopped.`);
        expect(err).not.toBeInstanceOf(SandboxError);
        await expectNothingPurged();
        expect(await rowIds(CASE)).not.toContain('c_before');
    });

    it('afterInsert: re-led the same way, and the case\'s own row is rolled back with the hook\'s', async () => {
        const err = await refusal(engine.insert(CASE, { id: 'c_after', name: 'x', mode: 'after' }));
        expectReLed(err, `The insert of "${CASE}" did not complete: its afterInsert hook "purge_after" stopped.`);
        await expectNothingPurged();
        expect(await rowIds(CASE)).not.toContain('c_after');
    });

    it('beforeFind: the read events share the seam, so a find is re-led too', async () => {
        const err = await refusal(engine.find(FINDER, {}));
        expectReLed(err, `The find of "${FINDER}" did not complete: its beforeFind hook "purge_on_find" stopped.`);
        await expectNothingPurged();
    });
});

describe('[#29527] CONTROL a body that speaks for itself keeps the relay it had', () => {
    it('a body that catches the refusal and throws its own error: a SandboxError with the body\'s sentence', async () => {
        const err = await refusal(engine.insert(CASE, { id: 'c_speaks', name: 'x', mode: 'speaks' }));
        expect(err).toBeInstanceOf(SandboxError);
        expect(err.innerMessage).toBe('The account could not be purged');
        expect(err.cause).toBeUndefined();
        await expectNothingPurged();
    });

    it('a body that rewrites the refusal\'s message before re-throwing it: a SandboxError, not re-led', async () => {
        const err = await refusal(engine.insert(CASE, { id: 'c_rewrites', name: 'x', mode: 'rewrites' }));
        expect(err).toBeInstanceOf(SandboxError);
        expect(err.message).toContain('Purge refused: ');
        expect(err.message).not.toContain(`The insert of "${CASE}"`);
        await expectNothingPurged();
    });
});
