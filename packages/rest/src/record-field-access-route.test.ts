// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26594 / ruling of record 6457467702] `GET /data/:object/:id/field-access`
 * — the field projection of ONE record, the answer a record's edit form reads.
 *
 * What the route owes, each pinned below:
 *
 * - the record is read FIRST, exactly as `GET /data/:object/:id` reads it, so
 *   a refusal of that read (404 for an absent or unreadable row, 403) is this
 *   route's answer too and the projection is never asked;
 * - the answer is the security service's `getRecordFieldAccess`, relayed in
 *   the shared envelope, asked with the caller's object, record and context;
 * - a row that leaves the caller's sight between the two reads answers the
 *   read path's own 404, never an empty projection;
 * - no service with the method → a loud 501, never an invented projection;
 * - a CLOSED, empty query-parameter set: any name is a located 400 and the
 *   service is never called.
 *
 * The end-to-end half — the real security stack judging a `when` on a row each
 * side of its condition — is `record-field-access-when.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';
import { RECORD_FIELD_ACCESS_PARAMS } from './data-action-routes.js';
import { unknownQueryParamMessage } from './query-allowlist.js';

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text', label: 'ID' },
        title: { name: 'title', type: 'text', label: 'Title' },
        amount: { name: 'amount', type: 'number', label: 'Amount' },
    },
};
const CTX = { userId: 'u1', permissions: ['member_default'] };
const ACCESS = { object: 'task', recordId: 'r1', readable: ['id', 'title', 'amount'], editable: ['title', 'amount'] };

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

function boot(opts: { getData?: () => Promise<unknown>; security?: unknown } = {}) {
    const getData = vi.fn(opts.getData ?? (async () => ({ object: 'task', id: 'r1', record: { id: 'r1' } })));
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [TASK] }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'task', item: TASK }),
        getData,
    };
    const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => CTX;
    (rest as any).resolveSecurityService = async () => opts.security;
    rest.registerRoutes();
    const route = (rest as any).getRoutes().find(
        (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/:id/field-access',
    );
    const call = async (query: Record<string, unknown> = {}, params = { object: 'task', id: 'r1' }) => {
        if (!route) throw new Error('route not registered: GET /api/v1/data/:object/:id/field-access');
        const res = mockRes();
        await route.handler({ method: 'GET', params, query, headers: {}, body: {} } as any, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
    return { getData, call };
}

const recordNotFound = () => Object.assign(new Error('Record r1 not found in task'), {
    code: 'RECORD_NOT_FOUND', status: 404, object: 'task',
});

describe('[#26594] GET /data/:object/:id/field-access', () => {
    it("relays the service's projection of this record, asked with the caller's object, record and context", async () => {
        const getRecordFieldAccess = vi.fn().mockResolvedValue(ACCESS);
        const { call, getData } = boot({ security: { getRecordFieldAccess } });
        const answer = await call();
        expect(answer).toEqual({ status: 200, body: { success: true, data: ACCESS } });
        expect(getRecordFieldAccess).toHaveBeenCalledWith('task', 'r1', CTX);
        // The record read the GET record route makes, as that route makes it.
        expect(getData).toHaveBeenCalledWith({ object: 'task', id: 'r1', context: CTX });
    });

    it('a record the read path refuses answers that refusal, and the projection is never asked', async () => {
        const getRecordFieldAccess = vi.fn().mockResolvedValue(ACCESS);
        const { call } = boot({ getData: async () => { throw recordNotFound(); }, security: { getRecordFieldAccess } });
        const answer = await call();
        expect(answer.status).toBe(404);
        expect(answer.body?.error?.code ?? answer.body?.code).toBe('RECORD_NOT_FOUND');
        expect(getRecordFieldAccess).not.toHaveBeenCalled();
    });

    it("a row the service cannot see after the read answers the read path's own 404, not an empty projection", async () => {
        const viaService = await boot({ security: { getRecordFieldAccess: vi.fn().mockResolvedValue(null) } }).call();
        const viaRead = await boot({ getData: async () => { throw recordNotFound(); }, security: {} }).call();
        expect(viaService.status).toBe(404);
        expect(viaService).toEqual(viaRead);
    });

    it('no security service with the method answers a loud 501, never an invented projection', async () => {
        for (const security of [undefined, {}]) {
            const answer = await boot({ security }).call();
            expect(answer.status).toBe(501);
            expect(answer.body?.success).toBe(false);
            expect(answer.body?.error?.code).toBe('NOT_IMPLEMENTED');
        }
    });

    it('takes no query parameter: a name is a located 400 and the service is never called', async () => {
        expect(RECORD_FIELD_ACCESS_PARAMS).toEqual([]);
        const getRecordFieldAccess = vi.fn().mockResolvedValue(ACCESS);
        const { call, getData } = boot({ security: { getRecordFieldAccess } });
        const answer = await call({ fields: 'amount' });
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toBe(unknownQueryParamMessage(['fields'], []));
        expect(getData).not.toHaveBeenCalled();
        expect(getRecordFieldAccess).not.toHaveBeenCalled();
    });
});
