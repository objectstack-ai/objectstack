// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29880] `GET /api/v1/approvals/requests` reads `?status=` against the value
 * set `sys_approval_request.status` declares, instead of handing any string to
 * the service.
 *
 * ## The measured defect (c5800818)
 *
 * `?status=bogus` and `?status=Pending` answered **200 `{"data":[]}`**: the
 * service filtered on a status no row can have and found nothing. A caller
 * could not tell "nothing in that state" from "that state does not exist".
 * `?status=pending,returned` (what `@objectstack/client` sends for an array)
 * was forwarded as ONE string and answered the same empty list.
 *
 * ## What each case asserts
 *
 * A refusal asserts the nested ADR-0112 pair the name and arity gates on this
 * handler answer, the located message (the value and every allowed value), and
 * that **the service was never asked**. A preservation case asserts the
 * ARGUMENT the service received, because "still 200" is exactly what the
 * defect looked like.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer } from './rest-server.js';
import { APPROVAL_STATUSES } from '@objectstack/spec/contracts';

const APPROVALS = '/api/v1/approvals/requests';

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

/** Two rows, so "the unfiltered list came back" is visibly distinguishable. */
const ALL_ROWS = [{ id: 'req_1' }, { id: 'req_2' }];

/**
 * A RestServer with a real approvals service wired, so a request that is NOT
 * refused runs all the way to `listRequests` — which is what lets the
 * preservation cases assert the filter argument rather than the status.
 */
function boot() {
    const approvals = {
        listRequests: vi.fn().mockResolvedValue(ALL_ROWS),
        countRequests: vi.fn().mockResolvedValue(2),
    };
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
        async () => approvals, // approvalsServiceProvider
    );
    // `isSystem` clears the capability gates that run BEFORE the query is read,
    // so every request below reaches the recognition rule it is named after.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();

    const drive = async (query: Record<string, unknown> = {}) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === 'GET' && r.path === APPROVALS,
        );
        if (!found) throw new Error(`route not registered: GET ${APPROVALS}`);
        const res = mockRes();
        await found.handler(
            { method: 'GET', path: APPROVALS, params: {}, query, headers: {}, body: {} } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return { approvals, drive };
}


/** The refusal: the shared envelope, the located sentence, no service call. */
async function expectStatusRefusal(status: unknown, ...named: string[]) {
    const { drive, approvals } = boot();
    const answer = await drive({ status });
    expect(
        answer.status,
        `?status=${JSON.stringify(status)} must be refused, got ${answer.status} `
        + `with body ${JSON.stringify(answer.body)}`,
    ).toBe(400);
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(answer.body?.data).toBeUndefined();
    const message = String(answer.body?.error?.message);
    expect(message).toContain('"status"');
    for (const value of named) expect(message).toContain(`"${value}"`);
    expect(message).toContain(`Allowed values: ${APPROVAL_STATUSES.join(', ')}.`);
    expect(
        approvals.listRequests,
        'the service must not be asked: an empty answer for a status that does not exist is the defect',
    ).not.toHaveBeenCalled();
    expect(approvals.countRequests).not.toHaveBeenCalled();
}

/** The status argument the service received for one request. */
async function statusHandedToService(query: Record<string, unknown>) {
    const { drive, approvals } = boot();
    const answer = await drive(query);
    expect(answer.status, `body ${JSON.stringify(answer.body)}`).toBe(200);
    expect(approvals.listRequests).toHaveBeenCalledTimes(1);
    return { filter: approvals.listRequests.mock.calls[0][0], answer, approvals };
}

describe('#29880 §1 — a status value outside the declared set is refused', () => {
    it('?status=bogus answers 400 naming the value and the allowed values', async () => {
        await expectStatusRefusal('bogus', 'bogus');
    });

    it('the match is exact: ?status=Pending is refused, not folded to pending', async () => {
        await expectStatusRefusal('Pending', 'Pending');
    });

    it('one bad entry in a comma list refuses the whole request, and each bad entry is named once', async () => {
        await expectStatusRefusal('pending,waiting,waiting', 'waiting');
        const { drive } = boot();
        const { body } = await drive({ status: 'pending,waiting,waiting' });
        expect(String(body?.error?.message).match(/"waiting"/g)).toHaveLength(1);
    });

    it('an empty value or an empty entry names no status and is refused, not read as "every status"', async () => {
        await expectStatusRefusal('', '');
        await expectStatusRefusal('pending,', '');
    });

    it('a value that is not a string (a nested query object) is refused', async () => {
        const { drive, approvals } = boot();
        const answer = await drive({ status: { $ne: 'pending' } });
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.data).toBeUndefined();
        expect(approvals.listRequests).not.toHaveBeenCalled();
        expect(approvals.countRequests).not.toHaveBeenCalled();
        // [#30525] The message says what shape the parameter takes and lists
        // the allowed values; it never quotes the parser's object as a value.
        const message = String(answer.body?.error?.message);
        expect(message).toBe(
            'The "status" query parameter must be one status, or several separated by commas, '
            + `given as plain text. Allowed values: ${APPROVAL_STATUSES.join(', ')}.`,
        );
        expect(message).not.toContain('[object Object]');
    });

    it('the name and arity gates still answer first', async () => {
        const { drive } = boot();
        const unknownName = await drive({ status: 'bogus', assignedToMe: 'true' });
        expect(String(unknownName.body?.error?.message)).toContain('"assignedToMe"');
        const repeated = await drive({ status: ['bogus', 'pending'] });
        expect(String(repeated.body?.error?.message)).toContain('supplied 2 times');
    });
});

describe('#29880 §2 — every declared status, and lists of them, still reach the service', () => {
    it.each([...APPROVAL_STATUSES])('?status=%s is handed to the service as that string', async (value) => {
        const { filter } = await statusHandedToService({ status: value });
        expect(filter.status).toBe(value);
    });

    it('a known status with no rows still answers 200 with an empty list', async () => {
        const { drive, approvals } = boot();
        approvals.listRequests.mockResolvedValue([]);
        const answer = await drive({ status: 'cancelled' });
        expect(answer.status).toBe(200);
        expect(answer.body).toEqual({ data: [] });
        expect(approvals.listRequests.mock.calls[0][0].status).toBe('cancelled');
    });

    it('a comma list reaches the service as an array (the spelling @objectstack/client sends)', async () => {
        const { filter } = await statusHandedToService({ status: 'pending,returned' });
        expect(filter.status).toEqual(['pending', 'returned']);
    });

    it('spaces around entries are trimmed and a repeated entry is sent once', async () => {
        const { filter } = await statusHandedToService({ status: ' approved , rejected,approved' });
        expect(filter.status).toEqual(['approved', 'rejected']);
    });

    it('no ?status= leaves the filter unset, and paging still counts on the same filter', async () => {
        const { filter } = await statusHandedToService({});
        expect(filter.status).toBeUndefined();
        const paged = await statusHandedToService({ status: 'pending,returned', limit: '10' });
        expect(paged.approvals.countRequests).toHaveBeenCalledTimes(1);
        expect(paged.approvals.countRequests.mock.calls[0][0].status).toEqual(['pending', 'returned']);
        expect(paged.answer.body).toEqual({ data: [{ id: 'req_1' }, { id: 'req_2' }], total: 2 });
    });
});
