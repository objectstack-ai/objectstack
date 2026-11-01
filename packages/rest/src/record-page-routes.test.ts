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
 * - the body is strict, and the query-parameter set is closed and empty;
 * - [#28470] a related list's `expand` is its read's own `$expand`, and each
 *   stream part — the discussion (the thread, then its reactions), the
 *   activity and the attachments — is the `findData` the console's own read of
 *   it makes, behind that object's exposure gate, refused on its own.
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
const systemObject = (name: string) => ({ name, label: name, fields: { id: { name: 'id', type: 'text' } } });
const ITEMS: Record<string, any> = {
    account: ACCOUNT,
    note: NOTE,
    hidden: HIDDEN,
    sys_comment: systemObject('sys_comment'),
    sys_comment_reaction: systemObject('sys_comment_reaction'),
    sys_activity: systemObject('sys_activity'),
    sys_attachment: systemObject('sys_attachment'),
};

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
    items?: Record<string, any>;
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
        getMetaItems: vi.fn().mockResolvedValue({ items: Object.values(opts.items ?? ITEMS) }),
        getMetaItem: vi.fn(async ({ name }: any) => {
            const items = opts.items ?? ITEMS;
            return items[name] ? { type: 'object', name, item: items[name] } : null;
        }),
        getData,
        findData,
    };
    const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ('context' in opts ? opts.context : CTX);
    (rest as any).resolveSecurityService = async () => opts.security;
    (rest as any).approvalsServiceProvider = opts.approvals === undefined ? undefined : async () => opts.approvals;
    const apiGate = vi.spyOn(rest as any, 'enforceApiAccess');
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
    return { getData, findData, call, apiGate };
}

const recordNotFound = () => Object.assign(new Error('Record a1 not found in account'), {
    code: 'RECORD_NOT_FOUND', status: 404, object: 'account',
});
const permissionDenied = () => Object.assign(new Error('[Security] Access denied: read on note'), {
    code: 'PERMISSION_DENIED', status: 403,
});

describe('[#27627] POST /data/:object/:id/page', () => {
    it('asks the object-exposure gate as GET /data/:object/:id does, with the caller\'s context (#27692)', async () => {
        const { call, apiGate } = boot();
        expect((await call({})).status).toBe(200);
        expect(apiGate).toHaveBeenCalledTimes(1);
        const [, , , environmentId, operation, context] = apiGate.mock.calls[0];
        expect([environmentId, operation, context]).toEqual([undefined, 'get', CTX]);
    });

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
            { object: 'note', query: { object: 'note', where: { account: 'a1' }, limit: 3, count: true }, context: CTX },
            { object: 'note', query: { object: 'note', where: { $and: [{ account: 'a1' }, { title: 'x' }] }, limit: 0, count: true }, context: CTX },
            { object: 'note', query: { object: 'note', where: { watchers: { $contains: 'a1' } }, limit: 1, count: true, orderBy: [{ field: 'title', order: 'desc' }] }, context: CTX },
        ]);
        expect(data.related.map((r) => ('total' in r ? [r.field, r.total, r.records] : [r.field, r.error]))).toEqual([
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
        expect('error' in list ? list.error : undefined).toMatchObject({ code: 'OBJECT_API_DISABLED', status: 404 });
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

    it('a declared filter the list read refuses is a located 400 before anything is read', async () => {
        const { call, getData, findData } = boot();
        const answer = await call({ related: [{ object: 'note', field: 'account', top: 1, filter: { title: { $in: 'x' } } }] });
        expect(answer.status).toBe(400);
        expect(answer.body.error.code).toBe('VALIDATION_FAILED');
        expect(answer.body.error.details.fields).toEqual([expect.objectContaining({ field: 'related.0.filter', code: 'invalid_filter' })]);
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

const objectNotFound = (name: string) => Object.assign(new Error(`Object '${name}' not found`), {
    code: 'OBJECT_NOT_FOUND', status: 404,
});

describe('[#28470] the record\'s streams and the related rows\' names ride in the payload', () => {
    // Answers each stream read with rows of its own object, so a part that
    // carried another read's rows would show.
    const rowsOf = (req: any) => {
        if (req.object === 'sys_comment') return { records: [{ id: 'c1' }, { id: 'c2', parent_id: 'c1' }], total: 2 };
        if (req.object === 'sys_comment_reaction') return { records: [{ id: 'x1', comment_id: 'c1', emoji: '👍', user_id: 'u1' }], total: 1 };
        if (req.object === 'sys_activity') return { records: [{ id: 'act1', type: 'updated' }], total: 9 };
        if (req.object === 'sys_attachment') return { records: [{ id: 'f1', name: 'a.pdf' }], total: 4 };
        return { records: [{ id: `${req.object}-1`, owner: { id: 'user-1', name: 'Una' } }], total: 7 };
    };

    it('answers each stream with the read the console makes for it, as the caller, in the schema\'s shape', async () => {
        const { call, findData } = boot({ findData: async (req) => rowsOf(req) });
        const answer = await call({
            related: [{ object: 'note', field: 'account', top: 3, expand: ['owner'] }],
            discussion: true,
            activity: { top: 200 },
            attachments: { top: 100 },
        });
        expect(answer.status).toBe(200);
        const data = RecordPageResponseSchema.parse(answer.body.data);
        const reads = findData.mock.calls.map(([req]) => req);

        // The related list's read carries its own `$expand`, and its rows the
        // resolved references.
        expect(reads).toContainEqual({
            object: 'note',
            query: { object: 'note', where: { account: 'a1' }, limit: 3, count: true, expand: ['owner'] },
            context: CTX,
        });
        expect(data.related[0]).toEqual({ object: 'note', field: 'account', total: 7, records: [{ id: 'note-1', owner: { id: 'user-1', name: 'Una' } }] });

        // The discussion: the whole thread (no page size), oldest first; then
        // the reactions of exactly those comments, oldest first.
        expect(reads).toContainEqual({
            object: 'sys_comment',
            query: { object: 'sys_comment', where: { thread_id: 'account:a1' }, orderBy: [{ field: 'created_at', order: 'asc' }] },
            context: CTX,
        });
        expect(reads).toContainEqual({
            object: 'sys_comment_reaction',
            query: { object: 'sys_comment_reaction', where: { comment_id: { $in: ['c1', 'c2'] } }, orderBy: [{ field: 'created_at', order: 'asc' }] },
            context: CTX,
        });
        expect(data.discussion).toEqual({
            comments: [{ id: 'c1' }, { id: 'c2', parent_id: 'c1' }],
            reactions: { records: [{ id: 'x1', comment_id: 'c1', emoji: '👍', user_id: 'u1' }] },
        });

        // The activity: the newest `top` rows with their count, the actor expanded.
        expect(reads).toContainEqual({
            object: 'sys_activity',
            query: {
                object: 'sys_activity',
                where: { object_name: 'account', record_id: 'a1' },
                orderBy: [{ field: 'timestamp', order: 'desc' }],
                limit: 200,
                count: true,
                expand: ['actor_id'],
            },
            context: CTX,
        });
        expect(data.activity).toEqual({ total: 9, records: [{ id: 'act1', type: 'updated' }] });

        // The attachments: the newest `top` rows with their count.
        expect(reads).toContainEqual({
            object: 'sys_attachment',
            query: {
                object: 'sys_attachment',
                where: { parent_object: 'account', parent_id: 'a1' },
                orderBy: [{ field: 'created_at', order: 'desc' }],
                limit: 100,
                count: true,
            },
            context: CTX,
        });
        expect(data.attachments).toEqual({ total: 4, records: [{ id: 'f1', name: 'a.pdf' }] });
        expect(reads).toHaveLength(5);
    });

    it('a thread with no comment asks no reaction read, and answers no reactions', async () => {
        const { call, findData } = boot({ findData: async (req) => (req.object === 'sys_comment' ? { records: [], total: 0 } : rowsOf(req)) });
        const answer = await call({ discussion: true });
        const data = RecordPageResponseSchema.parse(answer.body.data);
        expect(data.discussion).toEqual({ comments: [], reactions: { records: [] } });
        expect(findData.mock.calls.map(([req]) => req.object)).toEqual(['sys_comment']);
    });

    it('a stream whose read refuses carries the refusal alone; the record and the other parts answer', async () => {
        const { call } = boot({
            findData: async (req) => {
                if (req.object === 'sys_activity') throw permissionDenied();
                return rowsOf(req);
            },
        });
        const answer = await call({ related: [{ object: 'note', field: 'account', top: 1 }], discussion: true, activity: { top: 5 }, attachments: { top: 5 } });
        expect(answer.status).toBe(200);
        const data = RecordPageResponseSchema.parse(answer.body.data);
        expect(data.record).toEqual(RECORD);
        expect(data.activity).toEqual({ error: { code: 'PERMISSION_DENIED', status: 403, message: expect.any(String) } });
        expect(data.discussion).toMatchObject({ comments: [{ id: 'c1' }, { id: 'c2', parent_id: 'c1' }] });
        expect(data.attachments).toEqual({ total: 4, records: [{ id: 'f1', name: 'a.pdf' }] });
        expect(data.related[0]).toMatchObject({ total: 7 });
    });

    it('a refused comment read refuses the discussion and asks no reaction read', async () => {
        const { call, findData } = boot({ findData: async () => { throw permissionDenied(); } });
        const data = RecordPageResponseSchema.parse((await call({ discussion: true })).body.data);
        expect(data.discussion).toEqual({ error: { code: 'PERMISSION_DENIED', status: 403, message: expect.any(String) } });
        expect(findData.mock.calls.map(([req]) => req.object)).toEqual(['sys_comment']);
    });

    it('a refused reaction read leaves the comments answered (a deployment without sys_comment_reaction)', async () => {
        const items = { ...ITEMS };
        delete items.sys_comment_reaction;
        const { call } = boot({
            items,
            findData: async (req) => {
                if (req.object === 'sys_comment_reaction') throw objectNotFound('sys_comment_reaction');
                return rowsOf(req);
            },
        });
        const data = RecordPageResponseSchema.parse((await call({ discussion: true })).body.data);
        expect(data.discussion).toEqual({
            comments: [{ id: 'c1' }, { id: 'c2', parent_id: 'c1' }],
            reactions: { error: { code: expect.any(String), status: 404, message: expect.any(String) } },
        });
    });

    it('a stream on an object the API does not expose is refused as its list read is, and never read', async () => {
        const items = {
            ...ITEMS,
            sys_activity: { ...ITEMS.sys_activity, enable: { apiEnabled: false } },
            sys_attachment: { ...ITEMS.sys_attachment, enable: { apiEnabled: false } },
            sys_comment: { ...ITEMS.sys_comment, enable: { apiEnabled: false } },
        };
        const { call, findData } = boot({ items, findData: async (req) => rowsOf(req) });
        const data = RecordPageResponseSchema.parse((await call({ discussion: true, activity: { top: 5 }, attachments: { top: 5 } })).body.data);
        for (const part of [data.discussion, data.activity, data.attachments]) {
            expect(part).toEqual({ error: expect.objectContaining({ code: 'OBJECT_API_DISABLED', status: 404 }) });
        }
        expect(findData).not.toHaveBeenCalled();
    });

    it('the widened body stays strict: a window past its cap, an undeclared key or a non-boolean flag is a 400 and nothing is read', async () => {
        const { call, getData, findData } = boot();
        for (const body of [
            { activity: { top: 201 } },
            { activity: { top: 0 } },
            { activity: { top: 5, sort: 'asc' } },
            { attachments: { top: 101 } },
            { attachments: { top: 5, filter: {} } },
            { discussion: 'yes' },
            { related: [{ object: 'note', field: 'account', top: 3, expand: 'owner' }] },
            { mentions: { top: 50 } },
        ]) {
            const answer = await call(body);
            expect(answer.status, JSON.stringify(body)).toBe(400);
            expect(answer.body.error.code).toBe('VALIDATION_FAILED');
        }
        expect(getData).not.toHaveBeenCalled();
        expect(findData).not.toHaveBeenCalled();
    });
});
