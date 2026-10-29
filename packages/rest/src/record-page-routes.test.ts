// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27627] `POST /data/:object/:id/page` — the record page payload.
 *
 * What the route owes, each pinned below:
 *
 * - every part is the call the read it replaces makes, asked as the same
 *   caller: the record is `getData` as `GET /data/:object/:id` asks it, a
 *   related list is `findData` on the child with the parent condition AND the
 *   list's declared filter, its declared order and `count`, the projection is
 *   `getRecordFieldAccess`, a verdict is `explain` with the record id, the
 *   approval part is `listRequests` + `getRecordLock`;
 * - the answer parses against `RecordPageResponseSchema` (the route ledger's
 *   `responseSchema` names it);
 * - a record refusal is the whole request's answer, and no part is asked;
 * - a part whose read refuses carries the refusal and the others answer; a
 *   related list the caller may not read carries neither a count nor rows;
 * - an entry that is not a relationship of the child pointing at this object
 *   is a located 400 before anything is read;
 * - the body is strict, and the query-parameter set is closed and empty.
 *
 * The end-to-end half, under row-level and field-level security as a member who
 * is not an admin, is `record-page.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { RecordPageResponseSchema } from '@objectstack/spec/api';
import { RestServer } from './rest-server.js';
import { RECORD_PAGE_PARAMS } from './record-page-routes.js';
import { unknownQueryParamMessage } from './query-allowlist.js';

const ACCOUNT = {
    name: 'account',
    label: 'Account',
    fields: { id: { name: 'id', type: 'text' }, name: { name: 'name', type: 'text' } },
};
const NOTE = {
    name: 'note',
    label: 'Note',
    fields: {
        id: { name: 'id', type: 'text' },
        title: { name: 'title', type: 'text' },
        account: { name: 'account', type: 'lookup', reference: 'account' },
        watchers: { name: 'watchers', type: 'lookup', reference: 'account', multiple: true },
        owner: { name: 'owner', type: 'lookup', reference: 'user' },
    },
};
const HIDDEN = {
    name: 'hidden',
    label: 'Hidden',
    enable: { apiEnabled: false },
    fields: { account: { name: 'account', type: 'lookup', reference: 'account' } },
};
const ITEMS: Record<string, any> = { account: ACCOUNT, note: NOTE, hidden: HIDDEN };

const CTX = { userId: 'u1', permissions: ['member_default'] };
const RECORD = { id: 'a1', name: 'Acme' };
const ACCESS = { object: 'account', recordId: 'a1', readable: ['id', 'name'], editable: ['name'], writable: true };
const DECISION = (operation: string) => ({
    allowed: true,
    object: 'account',
    operation,
    principal: { userId: 'u1', positions: [], permissionSets: ['member_default'] },
    layers: [],
    record: { recordId: 'a1', visible: true, decidedBy: 'rls' },
});

function mockServer() {
    const noop = () => { /* routes are driven directly, never through the adapter */ };
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => { /* never started */ },
        close: async () => { /* never started */ },
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        header: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    };
    return res;
}

interface BootOpts {
    getData?: (req: any) => Promise<unknown>;
    findData?: (req: any) => Promise<unknown>;
    security?: unknown;
    approvals?: unknown;
    context?: unknown;
}

function boot(opts: BootOpts = {}) {
    const getData = vi.fn(opts.getData ?? (async () => ({ object: 'account', id: 'a1', record: RECORD })));
    const findData = vi.fn(opts.findData ?? (async (req: any) => ({
        object: req.object,
        records: [{ id: `${req.object}-1` }],
        total: 7,
    })));
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: Object.values(ITEMS) }),
        getMetaItem: vi.fn(async ({ name }: any) => (ITEMS[name] ? { type: 'object', name, item: ITEMS[name] } : null)),
        getData,
        findData,
    };
    const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ('context' in opts ? opts.context : CTX);
    (rest as any).resolveSecurityService = async () => opts.security;
    (rest as any).approvalsServiceProvider = opts.approvals === undefined ? undefined : async () => opts.approvals;
    rest.registerRoutes();
    const route = (rest as any).getRoutes().find(
        (r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/:id/page',
    );
    const call = async (body: unknown = {}, query: Record<string, unknown> = {}, params = { object: 'account', id: 'a1' }) => {
        if (!route) throw new Error('route not registered: POST /api/v1/data/:object/:id/page');
        const res = mockRes();
        await route.handler({ method: 'POST', params, query, headers: {}, body } as any, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
    return { getData, findData, call };
}

const recordNotFound = () => Object.assign(new Error('Record a1 not found in account'), {
    code: 'RECORD_NOT_FOUND', status: 404, object: 'account',
});
const permissionDenied = () => Object.assign(new Error('[Security] Access denied: read on note'), {
    code: 'PERMISSION_DENIED', status: 403,
});

describe('[#27627] POST /data/:object/:id/page', () => {
    it("answers every part with the call the read it replaces makes, as the caller, in the schema's shape", async () => {
        const getRecordFieldAccess = vi.fn().mockResolvedValue(ACCESS);
        const explain = vi.fn(async (req: any) => DECISION(req.operation));
        const pending = { id: 'ar1', status: 'pending', object: 'account', record_id: 'a1' };
        const approvals = {
            listRequests: vi.fn().mockResolvedValue([pending, { id: 'ar0', status: 'approved' }]),
            getRequest: vi.fn().mockResolvedValue({ id: 'ar1', approvers: ['u2'] }),
            getRecordLock: vi.fn().mockResolvedValue({ locked: true }),
        };
        const { call, getData, findData } = boot({ security: { getRecordFieldAccess, explain }, approvals });
        const answer = await call({
            expand: ['owner'],
            related: [
                { object: 'note', field: 'account', top: 3 },
                { object: 'note', field: 'account', filter: { title: 'x' }, top: 0 },
                { object: 'note', field: 'watchers', top: 1, sort: [{ field: 'title', order: 'desc' }] },
            ],
            fieldAccess: true,
            explain: ['update', 'delete'],
            approvals: true,
        });
        expect(answer.status).toBe(200);
        expect(answer.body.success).toBe(true);
        const data = RecordPageResponseSchema.parse(answer.body.data);

        // The record, as `GET /data/:object/:id?expand=` reads it.
        expect(getData).toHaveBeenCalledWith({ object: 'account', id: 'a1', expand: ['owner'], context: CTX });
        expect(data.record).toEqual(RECORD);

        // Each related list: the parent condition (to the field's arity), AND
        // the declared scope, with `count` — as `GET /data/note` reads it.
        expect(findData.mock.calls.map(([req]) => req)).toEqual([
            { object: 'note', query: { filter: { account: 'a1' }, top: 3, count: true }, context: CTX },
            { object: 'note', query: { filter: { $and: [{ account: 'a1' }, { title: 'x' }] }, top: 0, count: true }, context: CTX },
            { object: 'note', query: { filter: { watchers: { $contains: 'a1' } }, top: 1, count: true, orderBy: [{ field: 'title', order: 'desc' }] }, context: CTX },
        ]);
        expect(data.related.map((r) => [r.field, r.total, r.records])).toEqual([
            ['account', 7, [{ id: 'note-1' }]],
            ['account', 7, [{ id: 'note-1' }]],
            ['watchers', 7, [{ id: 'note-1' }]],
        ]);

        expect(getRecordFieldAccess).toHaveBeenCalledWith('account', 'a1', CTX);
        expect(data.fieldAccess).toEqual(ACCESS);
        expect(explain.mock.calls).toEqual([
            [{ object: 'account', operation: 'update', recordId: 'a1' }, CTX],
            [{ object: 'account', operation: 'delete', recordId: 'a1' }, CTX],
        ]);
        expect(data.explain).toEqual({ update: DECISION('update'), delete: DECISION('delete') });

        expect(approvals.listRequests).toHaveBeenCalledWith({ object: 'account', recordId: 'a1' }, CTX);
        expect(approvals.getRequest).toHaveBeenCalledWith('ar1', CTX);
        expect(approvals.getRecordLock).toHaveBeenCalledWith('account', 'a1', CTX);
        expect(data.approvals).toEqual({
            requests: [{ ...pending, id: 'ar1', approvers: ['u2'] }, { id: 'ar0', status: 'approved' }],
            lock: { locked: true },
        });
    });

    it('asks only for the parts the body names', async () => {
        const security = { getRecordFieldAccess: vi.fn(), explain: vi.fn() };
        const approvals = { listRequests: vi.fn(), getRecordLock: vi.fn() };
        const { call, findData } = boot({ security, approvals });
        const answer = await call({});
        expect(answer.status).toBe(200);
        expect(answer.body.data).toEqual({ object: 'account', id: 'a1', record: RECORD, related: [] });
        expect(findData).not.toHaveBeenCalled();
        expect(security.getRecordFieldAccess).not.toHaveBeenCalled();
        expect(security.explain).not.toHaveBeenCalled();
        expect(approvals.listRequests).not.toHaveBeenCalled();
    });

    it('a record the read path refuses answers that refusal whole, and no part is asked', async () => {
        const security = { getRecordFieldAccess: vi.fn(), explain: vi.fn() };
        const { call, findData } = boot({ getData: async () => { throw recordNotFound(); }, security });
        const answer = await call({ related: [{ object: 'note', field: 'account', top: 3 }], fieldAccess: true, explain: ['update'] });
        expect(answer.status).toBe(404);
        expect(answer.body?.error?.code ?? answer.body?.code).toBe('RECORD_NOT_FOUND');
        expect(findData).not.toHaveBeenCalled();
        expect(security.getRecordFieldAccess).not.toHaveBeenCalled();
        expect(security.explain).not.toHaveBeenCalled();
    });

    it('a related list whose read refuses carries the refusal and neither a count nor rows; the other parts answer', async () => {
        const { call } = boot({
            findData: async () => { throw permissionDenied(); },
            security: { getRecordFieldAccess: vi.fn().mockResolvedValue(ACCESS) },
        });
        const answer = await call({ related: [{ object: 'note', field: 'account', top: 3 }], fieldAccess: true });
        expect(answer.status).toBe(200);
        const data = RecordPageResponseSchema.parse(answer.body.data);
        expect(data.related[0]).toEqual({
            object: 'note', field: 'account',
            error: { code: 'PERMISSION_DENIED', status: 403, message: expect.any(String) },
        });
        expect(data.fieldAccess).toEqual(ACCESS);
    });

    it('a related list on an object the API does not expose is refused as its list read is, and never read', async () => {
        const { call, findData } = boot();
        const answer = await call({ related: [{ object: 'hidden', field: 'account', top: 3 }] });
        expect(answer.status).toBe(200);
        const [list] = RecordPageResponseSchema.parse(answer.body.data).related;
        expect(list).not.toHaveProperty('total');
        expect(list).not.toHaveProperty('records');
        expect(list.error).toMatchObject({ code: 'OBJECT_API_DISABLED', status: 404 });
        expect(findData).not.toHaveBeenCalled();
    });

    it('a field projection, verdict or approval read that refuses carries its refusal in its part', async () => {
        const { call } = boot({
            security: {
                getRecordFieldAccess: vi.fn().mockResolvedValue(null),
                explain: vi.fn(async () => { throw permissionDenied(); }),
            },
            approvals: { listRequests: vi.fn(async () => { throw permissionDenied(); }) },
        });
        const answer = await call({ fieldAccess: true, explain: ['transfer'], approvals: true });
        expect(answer.status).toBe(200);
        const data = RecordPageResponseSchema.parse(answer.body.data);
        expect(data.fieldAccess).toMatchObject({ error: { code: 'RECORD_NOT_FOUND', status: 404 } });
        expect(data.explain?.transfer).toMatchObject({ error: { code: 'PERMISSION_DENIED', status: 403 } });
        expect(data.approvals).toMatchObject({ error: { code: 'PERMISSION_DENIED', status: 403 } });
    });

    it('no service answers a loud 501 part for the projection and the verdicts, and no approvals as an empty part', async () => {
        const answer = await boot({ security: {} }).call({ fieldAccess: true, explain: ['update'], approvals: true });
        expect(answer.status).toBe(200);
        const data = RecordPageResponseSchema.parse(answer.body.data);
        expect(data.fieldAccess).toMatchObject({ error: { code: 'NOT_IMPLEMENTED', status: 501 } });
        expect(data.explain?.update).toMatchObject({ error: { code: 'NOT_IMPLEMENTED', status: 501 } });
        expect(data.approvals).toEqual({ requests: [], lock: null });
    });

    it('a caller without a user id (a system context) gets no verdict, as the explain route refuses them', async () => {
        const explain = vi.fn();
        const answer = await boot({ security: { explain }, context: { isSystem: true, permissions: [] } }).call({ explain: ['update'] });
        expect(answer.status).toBe(200);
        expect(answer.body.data.explain.update).toMatchObject({ error: { code: 'UNAUTHORIZED', status: 401 } });
        expect(explain).not.toHaveBeenCalled();
    });

    it('an entry that is not a relationship of the child to this object is a located 400 before anything is read', async () => {
        const { call, getData, findData } = boot();
        for (const field of ['title', 'owner', 'nope']) {
            const answer = await call({ related: [{ object: 'note', field: 'account', top: 1 }, { object: 'note', field, top: 1 }] });
            expect(answer.status, field).toBe(400);
            expect(answer.body.error.code).toBe('VALIDATION_FAILED');
            expect(answer.body.error.details.fields).toEqual([expect.objectContaining({ field: 'related.1.field', code: 'invalid_relationship' })]);
        }
        expect(getData).not.toHaveBeenCalled();
        expect(findData).not.toHaveBeenCalled();
    });

    it('the body is strict: an unknown key or an out-of-range top is a 400 and nothing is read', async () => {
        const { call, getData } = boot();
        for (const body of [
            { relatedLists: [] },
            { related: [{ object: 'note', field: 'account', top: 3, extra: 1 }] },
            { related: [{ object: 'note', field: 'account', top: 51 }] },
            { related: [{ object: 'note', field: 'account', top: 3, sort: [{ field: 'title', order: 'up' }] }] },
            { explain: ['read'] },
        ]) {
            const answer = await call(body);
            expect(answer.status, JSON.stringify(body)).toBe(400);
            expect(answer.body.error.code).toBe('VALIDATION_FAILED');
        }
        expect(getData).not.toHaveBeenCalled();
    });

    it('takes no query parameter: a name is a located 400 and nothing is read', async () => {
        expect(RECORD_PAGE_PARAMS).toEqual([]);
        const { call, getData } = boot();
        const answer = await call({}, { top: '3' });
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toBe(unknownQueryParamMessage(['top'], []));
        expect(getData).not.toHaveBeenCalled();
    });
});
