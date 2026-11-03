// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An action body's `ctx.engine.delete` whose `master_detail` cascade is
 * stopped by a dependent's failing roll-up is refused, never answered as the
 * success of a delete that rolled back.
 *
 * `ctx.engine` answers a write's own success over the engine's stale-roll-up
 * refusal (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written"), so
 * a body runs on after a write that landed. Deleting an account cascades to its
 * lines under the `'atomic'` plan. Each line's delete recomputes a roll-up on
 * ANOTHER parent (`qca_bucket.memo_sum`, a sum over a text field, which every
 * recompute refuses), so the first line's refusal stops the cascade and the
 * transaction rolls everything back. The engine now answers that delete with a
 * refusal that is not the stale-roll-up one, so the body does not run on and
 * the action door answers it as the internal failure it declares (#29421: `500
 * INTERNAL_ERROR`, before that the `400` any undeclared throw out of a body
 * gets) carrying the engine's message, `success: false`.
 *
 * Pinned through the real stack: `HttpDispatcher` → the action door →
 * `ctx.engine` → `ObjectQL` → a real `SqlDriver` on better-sqlite3, which rolls
 * back for real (the harness of `dispatcher-unique-violation-wire-code.test.ts`).
 *
 * - the account's delete: the action answers `500`, the body's next line never
 *   ran, and the account and its lines are all still stored;
 * - CONTROL a line's own delete landed: the action answers its body's own
 *   result and the line is gone.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from './http-dispatcher.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const PREFIX = '/api/v1';
const TEST_PACKAGE_ID = 'objectstack-test';
const ACCOUNT = 'qca_account';
const BUCKET = 'qca_bucket';
const LINE = 'qca_line';

const ACCOUNT_OBJECT = {
    name: ACCOUNT,
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
    actions: [
        { name: 'delete_account', label: 'Delete account', type: 'script', target: 'delete_account' },
        { name: 'delete_line', label: 'Delete line', type: 'script', target: 'delete_line' },
    ],
};

const BUCKET_OBJECT = {
    name: BUCKET,
    label: 'Bucket',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        // A sum over a text field: every recompute of it is refused.
        memo_sum: { name: 'memo_sum', type: 'summary' as const, label: 'Memo sum', summaryOperations: { object: LINE, function: 'sum', field: 'memo' } },
    },
};

const LINE_OBJECT = {
    name: LINE,
    label: 'Line',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        memo: { name: 'memo', type: 'text' as const, label: 'Memo' },
        account: { name: 'account', type: 'master_detail' as const, reference: ACCOUNT, deleteBehavior: 'cascade', label: 'Account' },
        bucket: { name: 'bucket', type: 'lookup' as const, reference: BUCKET, label: 'Bucket' },
    },
};

let engine: ObjectQL;
let dispatcher: HttpDispatcher;
const bodyRanOn: string[] = [];

afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
});

beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await engine.init();
    for (const o of [ACCOUNT_OBJECT, BUCKET_OBJECT, LINE_OBJECT]) engine.registry.registerObject(o as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    await engine.insert(ACCOUNT, { id: 'a1', name: 'A' });
    await engine.insert(BUCKET, { id: 'b1', name: 'B' });
    for (const id of ['l1', 'l2', 'l3']) {
        await engine.insert(LINE, { id, name: id, account: 'a1', bucket: 'b1' }).catch((e: any) => {
            // The seed itself meets the failing roll-up; its rows are written.
            if (e?.code !== 'ERR_SUMMARY_RECOMPUTE') throw e;
        });
    }
    const ql = engine as any;
    ql.registerAction(ACCOUNT, 'delete_account', async (ctx: any) => {
        await ctx.engine.delete(ACCOUNT, 'a1');
        bodyRanOn.push('delete_account');
        return { deleted: 'a1' };
    });
    ql.registerAction(ACCOUNT, 'delete_line', async (ctx: any) => {
        await ctx.engine.delete(LINE, 'l3');
        bodyRanOn.push('delete_line');
        return { deleted: 'l3' };
    });
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const services: Record<string, unknown> = { objectql: engine, data: engine, protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ userId: 'u_member', isSystem: false });
}, 60_000);

/** `POST /api/v1/actions/<rest>` as `@objectstack/hono`'s catch-all hands it to `dispatch()`. */
async function postAction(rest: string) {
    const path = `/actions/${rest}`;
    const request = new Request(`http://localhost${PREFIX}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    });
    const res: any = await dispatcher.dispatch('POST', path, {}, {}, { request } as any, PREFIX);
    return res.response as { status: number; body: any };
}

const rowIds = async (object: string) =>
    ((await engine.find(object, { fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();

describe('an action\'s ctx.engine.delete whose cascade a dependent\'s failing roll-up stops is refused', () => {
    it('the account\'s delete: the action answers a 500 INTERNAL_ERROR refusal, the body stopped there, and nothing is deleted', async () => {
        const response = await postAction(`${ACCOUNT}/delete_account`);
        expect(response.status, JSON.stringify(response.body)).toBe(500);
        expect(response.body?.success, JSON.stringify(response.body)).toBe(false);
        expect(response.body?.error?.code, JSON.stringify(response.body)).toBe('INTERNAL_ERROR');
        expect(response.body?.error?.message).toContain('The delete of "qca_account" did not complete');
        expect(bodyRanOn).not.toContain('delete_account');
        expect(await rowIds(ACCOUNT)).toEqual(['a1']);
        expect(await rowIds(LINE)).toEqual(['l1', 'l2', 'l3']);
    });

    it('CONTROL a line\'s own delete landed: the action answers its body\'s result, the line is gone', async () => {
        const response = await postAction(`${ACCOUNT}/delete_line`);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(JSON.stringify(response.body)).toContain('"deleted":"l3"');
        expect(bodyRanOn).toContain('delete_line');
        expect(await rowIds(LINE)).toEqual(['l1', 'l2']);
    });
});
