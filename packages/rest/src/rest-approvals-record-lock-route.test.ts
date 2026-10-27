// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26314] `GET /api/v1/approvals/records/:object/:recordId/lock` — the door
 * half of `IApprovalService.getRecordLock` (#25934 ruling A, "readers").
 *
 * The service owns the rule (read the record as the caller; `null` for a
 * record the caller cannot read, the same as one that does not exist); this
 * pins what the door adds and must not take away:
 *
 *  - preservation: the service is asked with the path's object and record id
 *    and the caller's own context, and its answer is served as
 *    `{ success: true, data: { locked } }` — `locked` and nothing else, even
 *    when an implementation hands back more;
 *  - one 404 for every `null`: the same status and the same body whatever the
 *    id, so the door cannot tell an unreadable record from a missing one;
 *  - the closed query-parameter set is EMPTY (AGENTS.md route rule 5): a name
 *    is refused with the located 400, and the service is never asked;
 *  - absent member ⇒ 501, never a guess in either direction.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';
import { APPROVAL_RECORD_LOCK_PARAMS } from './approvals-routes.js';
import { unknownQueryParamMessage } from './query-allowlist.js';

const LOCK = '/api/v1/approvals/records/:object/:recordId/lock';
const CALLER = { userId: 'u_reader', positions: [], permissions: [] };

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    };
    return res;
}

function boot(approvals: Record<string, unknown>) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        findData: vi.fn().mockResolvedValue({ records: [] }),
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
        undefined, // kernelManager
        undefined, // envRegistry
        undefined, // defaultEnvironmentIdProvider
        undefined, // authServiceProvider
        undefined, // objectQLProvider
        undefined, // emailServiceProvider
        undefined, // sharingServiceProvider
        undefined, // reportsServiceProvider
        async () => approvals as any, // approvalsServiceProvider
    );
    (rest as any).resolveExecCtx = async () => CALLER;
    rest.registerRoutes();

    return async (object: string, recordId: string, query: Record<string, unknown> = {}) => {
        const found = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === LOCK);
        if (!found) throw new Error(`route not registered: GET ${LOCK}`);
        const res = mockRes();
        await found.handler(
            { method: 'GET', path: LOCK, params: { object, recordId }, query, headers: {}, body: {} } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
}

describe('[#26314] GET /approvals/records/:object/:recordId/lock', () => {
    it('asks the service with the path and the caller, and serves `locked` alone', async () => {
        // An implementation that hands back MORE than the contract's payload:
        // the door still serves `locked` and nothing else.
        const getRecordLock = vi.fn().mockResolvedValue({ locked: true, requestId: 'req_1', pending: true });
        const drive = boot({ getRecordLock });
        expect(await drive('expense', 'rec_1')).toEqual({ status: 200, body: { success: true, data: { locked: true } } });
        expect(getRecordLock).toHaveBeenCalledTimes(1);
        expect(getRecordLock).toHaveBeenCalledWith('expense', 'rec_1', CALLER);

        getRecordLock.mockResolvedValueOnce({ locked: false });
        expect(await drive('expense', 'rec_2')).toEqual({ status: 200, body: { success: true, data: { locked: false } } });
    });

    it('answers every `null` with one 404, the same body whatever the id', async () => {
        const drive = boot({ getRecordLock: vi.fn().mockResolvedValue(null) });
        const unreadable = await drive('expense', 'rec_someone_elses');
        const missing = await drive('expense', 'rec_no_such_id');
        expect(unreadable.status).toBe(404);
        expect(unreadable.body?.success).toBe(false);
        expect(unreadable.body?.error?.code).toBe('RECORD_NOT_FOUND');
        expect(unreadable).toEqual(missing);
        expect(JSON.stringify(unreadable.body)).not.toContain('rec_someone_elses');
    });

    it('declares an EMPTY closed query set: a name is refused with the located 400 and the service is never asked', async () => {
        expect([...APPROVAL_RECORD_LOCK_PARAMS]).toEqual([]);
        const getRecordLock = vi.fn().mockResolvedValue({ locked: true });
        const drive = boot({ getRecordLock });
        const answer = await drive('expense', 'rec_1', { includeRequest: 'true' });
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toBe(unknownQueryParamMessage(['includeRequest'], []));
        expect(answer.body?.data).toBeUndefined();
        expect(getRecordLock).not.toHaveBeenCalled();
    });

    it('answers 501 when the approvals service does not declare the member', async () => {
        const drive = boot({ listRequests: vi.fn() });
        const answer = await drive('expense', 'rec_1');
        expect(answer.status).toBe(501);
        expect(answer.body?.code).toBe('NOT_IMPLEMENTED');
    });

    it('relays a refusal of the read at its own status, not as a lock answer', async () => {
        const denied = Object.assign(new Error('read on expense denied'), { code: 'PERMISSION_DENIED', statusCode: 403 });
        const drive = boot({ getRecordLock: vi.fn().mockRejectedValue(denied) });
        const answer = await drive('expense', 'rec_1');
        expect(answer.status).toBe(403);
        expect(answer.body?.data).toBeUndefined();
    });
});
