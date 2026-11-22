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
import { APPROVAL_RECORD_LOCK_PARAMS, APPROVAL_RECORD_LOCKS_PARAMS } from './approvals-routes.js';
import { APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS } from '@objectstack/spec/contracts';
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

function bootRest(approvals: Record<string, unknown>) {
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
    return rest;
}

function boot(approvals: Record<string, unknown>) {
    const rest = bootRest(approvals);
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

const LOCKS = '/api/v1/approvals/records/:object/locks';

/** Drive `POST …/records/:object/locks` with a body (and a query string). */
function bootLocks(approvals: Record<string, unknown>) {
    const rest = bootRest(approvals);
    return async (object: string, body: unknown, query: Record<string, unknown> = {}) => {
        const found = (rest as any).getRoutes().find((r: any) => r.method === 'POST' && r.path === LOCKS);
        if (!found) throw new Error(`route not registered: POST ${LOCKS}`);
        const res = mockRes();
        await found.handler(
            { method: 'POST', path: LOCKS, params: { object }, query, headers: {}, body } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
}

/**
 * `POST /api/v1/approvals/records/:object/locks` — the page form of the door
 * above, the half of `IApprovalService.getRecordLocks` a list reads before it
 * opens a cell editor. Each entry is the single door's answer for its id, the
 * 404 folded into `locked: null`; the body is refused whole when it is not the
 * one shape the door reads, and the service is never asked then.
 */
describe('POST /approvals/records/:object/locks — the lock of a page of records', () => {
    it('asks the service once with the ids in order and the caller, and serves one entry per id', async () => {
        const getRecordLocks = vi.fn().mockResolvedValue([
            { locked: true, requestId: 'req_1' }, null, { locked: false },
        ]);
        const drive = bootLocks({ getRecordLocks });
        const answer = await drive('expense', { recordIds: ['rec_1', 'rec_hidden', 'rec_3'] });
        expect(answer).toEqual({
            status: 200,
            body: {
                success: true,
                data: {
                    records: [
                        { recordId: 'rec_1', locked: true },
                        { recordId: 'rec_hidden', locked: null },
                        { recordId: 'rec_3', locked: false },
                    ],
                },
            },
        });
        expect(getRecordLocks).toHaveBeenCalledTimes(1);
        expect(getRecordLocks).toHaveBeenCalledWith('expense', ['rec_1', 'rec_hidden', 'rec_3'], CALLER);
    });

    it('takes a full page at the cap', async () => {
        const ids = Array.from({ length: APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS }, (_, i) => `rec_${i}`);
        const getRecordLocks = vi.fn().mockResolvedValue(ids.map(() => ({ locked: false })));
        const drive = bootLocks({ getRecordLocks });
        const answer = await drive('expense', { recordIds: ids });
        expect(answer.status).toBe(200);
        expect(answer.body?.data?.records).toHaveLength(APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS);
        expect(getRecordLocks).toHaveBeenCalledWith('expense', ids, CALLER);
    });

    it.each([
        ['no body', undefined, 'must be a JSON object'],
        ['a list for a body', ['rec_1'], 'must be a JSON object'],
        ['no recordIds', {}, '"recordIds" must be a list'],
        ['a string for recordIds', { recordIds: 'rec_1' }, '"recordIds" must be a list'],
        ['a number among the ids', { recordIds: ['rec_1', 7] }, '"recordIds" must be a list'],
        ['a blank id', { recordIds: ['rec_1', '  '] }, '"recordIds" must be a list'],
        ['an empty list', { recordIds: [] }, 'names no record'],
        ['one id over the cap', {
            recordIds: Array.from({ length: APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS + 1 }, (_, i) => `rec_${i}`),
        }, `at most ${APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS}`],
        ['a body key the door does not read', { recordIds: ['rec_1'], includeRequest: true }, 'Unknown body field "includeRequest"'],
    ])('refuses %s whole with the located 400, and never asks the service', async (_label, body, sentence) => {
        const getRecordLocks = vi.fn().mockResolvedValue([{ locked: true }]);
        const drive = bootLocks({ getRecordLocks });
        const answer = await drive('expense', body);
        expect(answer.status).toBe(400);
        expect(answer.body?.success).toBe(false);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toContain(sentence);
        expect(answer.body?.data).toBeUndefined();
        expect(getRecordLocks).not.toHaveBeenCalled();
    });

    it('declares an EMPTY closed query set: a name is refused with the located 400 and the service is never asked', async () => {
        expect([...APPROVAL_RECORD_LOCKS_PARAMS]).toEqual([]);
        const getRecordLocks = vi.fn().mockResolvedValue([{ locked: true }]);
        const drive = bootLocks({ getRecordLocks });
        const answer = await drive('expense', { recordIds: ['rec_1'] }, { ids: 'rec_2' });
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toBe(unknownQueryParamMessage(['ids'], []));
        expect(getRecordLocks).not.toHaveBeenCalled();
    });

    it('answers 501 when the service declares only the one-record member, never one read per id', async () => {
        const getRecordLock = vi.fn().mockResolvedValue({ locked: true });
        const drive = bootLocks({ getRecordLock });
        const answer = await drive('expense', { recordIds: ['rec_1', 'rec_2'] });
        expect(answer.status).toBe(501);
        expect(answer.body?.code).toBe('NOT_IMPLEMENTED');
        expect(getRecordLock).not.toHaveBeenCalled();
    });

    it('relays a refusal of the read at its own status, not as a lock answer', async () => {
        const denied = Object.assign(new Error('read on expense denied'), { code: 'PERMISSION_DENIED', statusCode: 403 });
        const drive = bootLocks({ getRecordLocks: vi.fn().mockRejectedValue(denied) });
        const answer = await drive('expense', { recordIds: ['rec_1'] });
        expect(answer.status).toBe(403);
        expect(answer.body?.data).toBeUndefined();
    });
});
