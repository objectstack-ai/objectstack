// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7527] `GET /api/v1/approvals/requests` refuses a query parameter it does
 * not know, instead of dropping it and answering with the whole list.
 *
 * ## The measured defect
 *
 * `?assignedToMe=true` answered **200 with every request the caller can see**.
 * The handler reads its known keys off the query string and ignores the rest,
 * so a caller who believes they asked for "the requests assigned to me" gets
 * the UNFILTERED list — and has no way to notice, because an unfiltered result
 * is shaped exactly like a genuinely broad one. Same anti-pattern as #7463's
 * defect 2 pointed the other way: there an unknown key silently narrows to
 * zero, here an unknown parameter silently widens to everything.
 *
 * ## Why a bare status assertion would not pin this
 *
 * These handlers *send*; they do not throw, and on the unfixed code the answer
 * was a perfectly ordinary **200**. So a `toThrow`-shaped assertion is
 * worthless here, and even `expect(status).toBe(400)` is only half: the defect
 * is that `listRequests` RAN and its rows were returned. Every refusal case
 * below therefore asserts three things — the ADR-0112 pair (`status` AND the
 * NESTED `body.error.code`, matching the multiplicity refusal that runs on this
 * same handler), the located message, and that **the service was never asked**.
 *
 * ## The other half: preservation
 *
 * A whitelist is only correct if it lets the real traffic through, and the
 * sharp edge is that the closed set is NOT "the filters" — it also carries
 * paging and the snake_case aliases the handler honours. Forgetting `limit`
 * would trade a silent-widening bug for a loud paging outage. The preservation
 * block asserts the ARGUMENT handed to the service, not merely that a 200 came
 * back, because "still 200" is exactly what the defect looked like. The card's
 * own control — `approverId=<id>,role:user`, the shape the Console uses to ask
 * this very question — is pinned there.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer, APPROVAL_REQUEST_LIST_PARAMS } from './rest-server.js';
import { refuseUnknownQueryParams, unknownQueryParamMessage } from './query-allowlist.js';

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

/** The full ADR-0112 assertion for one recognition refusal. */
function expectRefusal(answer: { status: number; body: any }, ...unknown: string[]) {
    expect(
        answer.status,
        `expected a 400 refusal for ${unknown.join(', ')}, got ${answer.status} `
        + `with body ${JSON.stringify(answer.body)}`,
    ).toBe(400);
    // Nested, per ADR-0112 — the same position and code the multiplicity
    // refusal on this same handler answers with (#6877 / PR #7293).
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(typeof answer.body?.error).toBe('object');
    expect(answer.body?.error?.message).toBe(
        unknownQueryParamMessage(unknown, [...APPROVAL_REQUEST_LIST_PARAMS].sort()),
    );
    // The refusal must not have leaked a row-shaped payload alongside itself.
    expect(answer.body?.data).toBeUndefined();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REFUSAL — the reported parameter, and the class it stands for
// ─────────────────────────────────────────────────────────────────────────────

describe('#7527 §1 — an unknown filter is refused, not dropped', () => {
    it('?assignedToMe=true is refused, and the whole list is NOT returned', async () => {
        const { drive, approvals } = boot();
        const answer = await drive({ assignedToMe: 'true' });
        expectRefusal(answer, 'assignedToMe');
        // THE assertion of this file. On the unfixed handler this call ran and
        // its rows were answered 200 — the status alone cannot see that.
        expect(
            approvals.listRequests,
            'the service must not have been queried at all — returning the unfiltered '
            + 'list is the defect, and a caller cannot distinguish it from a broad match',
        ).not.toHaveBeenCalled();
    });

    it('the message is LOCATED: it names the parameter and lists what is supported', async () => {
        const { drive } = boot();
        const { body } = await drive({ assignedToMe: 'true' });
        const message = String(body?.error?.message);
        expect(message).toContain('"assignedToMe"');
        // A caller must be able to fix the request from the response alone.
        for (const name of APPROVAL_REQUEST_LIST_PARAMS) {
            expect(message, `supported parameter "${name}" must appear in the refusal`)
                .toContain(name);
        }
        // And it must point at the right replacement being reachable already.
        expect(message).toContain('approverId');
    });

    it('every plausible misspelling of the same question fails the same way', async () => {
        // The bug is not `assignedToMe` specifically — a blacklist could only
        // ever name the spellings someone already tripped over.
        for (const name of ['assigned_to_me', 'assignee', 'mine', 'approver', 'ApproverId']) {
            const { drive, approvals } = boot();
            const answer = await drive({ [name]: 'x' });
            expectRefusal(answer, name);
            expect(approvals.listRequests).not.toHaveBeenCalled();
        }
    });

    it('several unknown parameters are all named, in a deterministic order', async () => {
        const { drive } = boot();
        // Supplied out of order; the refusal sorts them so the message does not
        // depend on how the adapter happened to build the query object.
        const answer = await drive({ mine: '1', assignedToMe: 'true', object: 'lead' });
        expectRefusal(answer, 'assignedToMe', 'mine');
    });

    it('an unknown parameter outranks a repeated known one', async () => {
        // A request committing both errors gets the answer explaining the more
        // fundamental one: "I do not know this parameter" precedes "this
        // parameter I do know was supplied twice".
        const { drive } = boot();
        const answer = await drive({ assignedToMe: 'true', status: ['open', 'closed'] });
        expectRefusal(answer, 'assignedToMe');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PRESERVATION — the closed set is the handler's real read set
// ─────────────────────────────────────────────────────────────────────────────

describe('#7527 §2 — every parameter the route really reads still works', () => {
    it('the card control: approverId=<id>,role:user still narrows', async () => {
        const { drive, approvals } = boot();
        const answer = await drive({ approverId: 'u_42,role:user' });
        expect(answer.status).toBe(200);
        expect(answer.body?.data).toEqual(ALL_ROWS);
        // The multi-identity arm the Console uses to ask "my pending approvals"
        // in ONE request — the capability `assignedToMe` was reaching for.
        expect(approvals.listRequests).toHaveBeenCalledWith(
            expect.objectContaining({ approverId: ['u_42', 'role:user'] }),
            expect.anything(),
        );
    });

    it('a request with no parameters still returns the full list', async () => {
        const { drive, approvals } = boot();
        const answer = await drive({});
        expect(answer.status).toBe(200);
        expect(answer.body?.data).toEqual(ALL_ROWS);
        expect(approvals.listRequests).toHaveBeenCalledTimes(1);
    });

    it('paging is inside the closed set — a whitelist of filters alone would break it', async () => {
        const { drive, approvals } = boot();
        const answer = await drive({ limit: '10', offset: '20' });
        expect(answer.status).toBe(200);
        // `total` is only computed for a paged call, so this also proves the
        // paged branch was reached rather than merely not refused.
        expect(answer.body?.total).toBe(2);
        expect(approvals.listRequests).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 10, offset: 20 }),
            expect.anything(),
        );
    });

    it('the snake_case aliases the handler honours are inside the closed set', async () => {
        const { drive, approvals } = boot();
        const answer = await drive({ record_id: 'rec_1', submitter_id: 'u_9', approver_id: 'u_8' });
        expect(answer.status).toBe(200);
        expect(approvals.listRequests).toHaveBeenCalledWith(
            expect.objectContaining({
                recordId: 'rec_1', submitterId: 'u_9', approverId: ['u_8'],
            }),
            expect.anything(),
        );
    });

    it('every name in the closed set is accepted — none of them is refused', async () => {
        // Asserts against the exported array rather than a hand-copied list, so
        // the pin cannot drift away from what the route actually declares.
        for (const name of APPROVAL_REQUEST_LIST_PARAMS) {
            const { drive } = boot();
            const answer = await drive({ [name]: '1' });
            expect(answer.status, `"${name}" is declared supported but was refused`).toBe(200);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The helper itself
// ─────────────────────────────────────────────────────────────────────────────

describe('#7527 §3 — refuseUnknownQueryParams', () => {
    it('answers nothing when there is no query object to judge', () => {
        const res = mockRes();
        expect(refuseUnknownQueryParams({}, res, ['a'])).toBe(false);
        expect(refuseUnknownQueryParams({ query: null }, res, ['a'])).toBe(false);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns false — and stays silent — when every name is recognised', () => {
        const res = mockRes();
        expect(refuseUnknownQueryParams({ query: { a: '1', b: '2' } }, res, ['a', 'b', 'c']))
            .toBe(false);
        expect(res.json).not.toHaveBeenCalled();
    });

    it('reads one name per parameter, singular and plural phrasing alike', () => {
        expect(unknownQueryParamMessage(['x'], ['a'])).toContain('The "x" query parameter is not');
        expect(unknownQueryParamMessage(['x', 'y'], ['a']))
            .toContain('The query parameters "x", "y" are not');
    });
});
