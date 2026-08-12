// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7678] `GET /api/v1/security/suggested-bindings?status=` — the LIVE REST
 * route's `?status=` vocabulary (ADR-0090 D5/D9).
 *
 * ## The defect these cases pin
 *
 * `registerSecurityEndpoints` forwarded `req.query.status` straight into
 * `listAudienceBindingSuggestions`, whose contract
 * (`AudienceBindingSuggestionFilter`) declares exactly three values. An unknown
 * one was not rejected anywhere — it simply matched no row, so
 * `?status=garbage` answered **200 with an empty list**. That is worse than an
 * error: an empty list is a plausible, actionable-looking answer, and it reads
 * as "there are no suggestions" rather than "your filter was not a status". So
 * a `not.toBe(200)` assertion would be worth nothing here — the unfixed code's
 * whole symptom IS a 200 — and every refusal case below asserts the ADR-0112
 * pair: the HTTP `status` AND the nested `body.error.code`.
 *
 * The rule itself is not new. The runtime dispatcher's `/security` domain has
 * refused unknown statuses since #4127, with a comment describing precisely the
 * empty-list arm above; the live REST route is a second seam onto the same
 * service call and never got it. The fix is therefore a CONVERGENCE — both
 * seams now call `isAudienceBindingSuggestionStatus` from `@objectstack/core` —
 * and the vocabulary is imported here rather than retyped, so a status added to
 * the contract is exercised by these cases automatically.
 *
 * ## The negatives are load-bearing
 *
 * A guard that 400s everything satisfies the refusal cases and breaks the
 * route. The bottom half pins the other direction: every declared status still
 * reaches the service, and omitting `?status` still lists unfiltered. Both
 * assert the ARGUMENT the service was handed, not merely that a 200 came back.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer } from './rest-server.js';
import {
    AUDIENCE_BINDING_SUGGESTION_STATUS_VALUES,
    unknownAudienceBindingSuggestionStatusMessage,
} from '@objectstack/core';

const SUGGESTED_BINDINGS = '/api/v1/security/suggested-bindings';

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
        header: vi.fn(function (this: any) { return this; }),
    };
    return res;
}

/** The rows the stub service answers with, so "listed" is distinguishable from "empty". */
const SUGGESTIONS = [{ id: 's1', status: 'pending', package_id: 'com.example.crm' }];

function boot() {
    const listAudienceBindingSuggestions = vi.fn().mockResolvedValue({
        suggestions: SUGGESTIONS,
        sync: { created: 0, confirmedObserved: 0, pruned: 0 },
    });

    const rest = new RestServer(
        mockServer() as any,
        { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: {} }) } as any,
        { api: { requireAuth: false } } as any,
    );
    // `isSystem` clears the auth gates that run BEFORE the query is read, so
    // every request below reaches the status rule it is named after.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    (rest as any).securityServiceProvider = async () => ({ listAudienceBindingSuggestions });
    rest.registerRoutes();

    const route = (rest as any).getRoutes().find(
        (r: any) => r.method === 'GET' && r.path === SUGGESTED_BINDINGS,
    );
    if (!route) throw new Error(`route not registered: GET ${SUGGESTED_BINDINGS}`);

    const drive = async (query: Record<string, unknown>) => {
        const res = mockRes();
        await route.handler(
            { method: 'GET', path: SUGGESTED_BINDINGS, params: {}, query, headers: {}, body: {} } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return { drive, listAudienceBindingSuggestions };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REFUSAL — the silent-empty-list arm, closed
// ─────────────────────────────────────────────────────────────────────────────

describe('#7678 — an unknown ?status is REFUSED, not answered with an empty list', () => {
    it('?status=garbage → 400 VALIDATION_ERROR (was: 200 with an empty list)', async () => {
        const { drive, listAudienceBindingSuggestions } = boot();
        const answer = await drive({ status: 'garbage' });

        // Both halves, per ADR-0112. `status` alone would pass on any 400 the
        // route emits for another reason; `code` alone would pass on the 200
        // this route used to answer if a code ever appeared in a success body.
        expect(
            answer.status,
            `expected 400 for an unknown ?status, got ${answer.status} with body ${JSON.stringify(answer.body)}`,
        ).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        // `error` is the object, not a bare string — the dialect #7035 retired.
        expect(typeof answer.body?.error).toBe('object');
        // The wording is the SHARED one, so the two seams cannot drift apart
        // while both still refusing.
        expect(answer.body?.error?.message).toBe(
            unknownAudienceBindingSuggestionStatusMessage('garbage'),
        );
        expect(
            listAudienceBindingSuggestions,
            'the refused filter must not reach the service at all',
        ).not.toHaveBeenCalled();
    });

    it('?status=PENDING → 400: the vocabulary is lowercase, so wrong case is not a status', async () => {
        // The card names this one explicitly. Measured, it is NOT accepted: the
        // contract's values are lowercase and the predicate is case-sensitive,
        // so `PENDING` is refused exactly like `garbage` rather than silently
        // filtering to nothing.
        const { drive, listAudienceBindingSuggestions } = boot();
        const answer = await drive({ status: 'PENDING' });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(listAudienceBindingSuggestions).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PRESERVATION — a guard that 400s everything would pass §1 and break the route
// ─────────────────────────────────────────────────────────────────────────────

describe('#7678 — every declared status, and no status at all, still list', () => {
    // Enumerated FROM the contract type, never hand-picked: a status added to
    // `AudienceBindingSuggestionFilter` is covered here the day it is declared.
    it.each(AUDIENCE_BINDING_SUGGESTION_STATUS_VALUES)(
        '?status=%s reaches the service and returns its list',
        async (status) => {
            const { drive, listAudienceBindingSuggestions } = boot();
            const answer = await drive({ status });

            expect(
                answer.status,
                `a valid ?status=${status} must not be refused`,
            ).toBe(200);
            expect(answer.body?.data?.suggestions).toEqual(SUGGESTIONS);
            // The argument, not just the status code — "still 200" is what the
            // defect looked like.
            expect(listAudienceBindingSuggestions).toHaveBeenCalledWith(
                expect.anything(),
                { status, packageId: undefined },
            );
        },
    );

    it('no ?status at all still returns the unfiltered list', async () => {
        const { drive, listAudienceBindingSuggestions } = boot();
        const answer = await drive({});

        expect(answer.status).toBe(200);
        expect(answer.body?.data?.suggestions).toEqual(SUGGESTIONS);
        expect(listAudienceBindingSuggestions).toHaveBeenCalledWith(
            expect.anything(),
            { status: undefined, packageId: undefined },
        );
    });

    it('an unrelated filter (?packageId) is untouched by the status rule', async () => {
        const { drive, listAudienceBindingSuggestions } = boot();
        const answer = await drive({ packageId: 'com.example.crm' });

        expect(answer.status).toBe(200);
        expect(listAudienceBindingSuggestions).toHaveBeenCalledWith(
            expect.anything(),
            { status: undefined, packageId: 'com.example.crm' },
        );
    });
});
