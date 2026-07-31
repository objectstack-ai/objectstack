// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3899 ④ — the request-side gate, dispatcher half: every route the catalog
 * (`plugin-rest-api.zod.ts`) declares a `requestSchema` for and the DISPATCHER
 * serves must reject a body violating that schema — never silently coerce it
 * into different semantics (an empty mark-read, an unfiltered aggregate).
 *
 * Driven at the dispatcher facade (`handleNotification` / `handleAnalytics`),
 * where a violating body raises the duck-typed validation failure
 * (`validationFailure`, `validation-failure.ts`) that BOTH HTTP error exits map
 * to `400 VALIDATION_FAILED` + `details.fields[]` — that thrown-shape → wire
 * contract is pinned separately by `dispatcher-validation-error.test.ts`
 * (#3918), for the exact `name`/`code`/`fields` shape asserted here.
 *
 * The COMPLETENESS half is the ratchet: a new catalog `requestSchema` on a
 * dispatcher-served route with no violating-body case here fails the suite, so
 * a declaration can no longer outrun its enforcement — the #3899 ① disease.
 * (The rest-served groups have the same gate in
 * `packages/rest/src/request-schema-gate.conformance.test.ts`; the spec-side
 * name-resolution half lives in
 * `packages/spec/src/api/plugin-rest-api.schema-refs.test.ts`.)
 */

import { describe, it, expect, vi } from 'vitest';

import {
    DEFAULT_NOTIFICATION_ROUTES,
    DEFAULT_ANALYTICS_ROUTES,
    DEFAULT_AUTOMATION_ROUTES,
} from '@objectstack/spec/api';
import { HttpDispatcher } from './http-dispatcher.js';
import { validationFailureDetails } from './validation-failure.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** The catalog groups whose mounted routes the dispatcher serves. */
const DISPATCHER_GROUPS = [
    DEFAULT_NOTIFICATION_ROUTES,
    DEFAULT_ANALYTICS_ROUTES,
    DEFAULT_AUTOMATION_ROUTES,
];

function makeDispatcher() {
    const spies = {
        markRead: vi.fn(async () => ({ success: true, readCount: 1 })),
        listInbox: vi.fn(async () => ({ notifications: [], unreadCount: 0 })),
        query: vi.fn(async () => ({ data: [] })),
        getMeta: vi.fn(async () => ({ cubes: [] })),
    };
    const services: Record<string, unknown> = {
        notification: { listInbox: spies.listInbox, markRead: spies.markRead },
        analytics: { query: spies.query, getMeta: spies.getMeta },
    };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), spies };
}

/** An authenticated caller — the routes under test sit behind the auth gate. */
const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;

interface GateCase {
    /** `METHOD prefix+path` exactly as the catalog spells it. */
    route: string;
    /** Bodies that violate the declared requestSchema. */
    violating: unknown[];
    /** A minimal body the schema accepts. */
    valid: unknown;
    drive: (dispatcher: HttpDispatcher, body: unknown) => Promise<any>;
    /** The service spy the route lands on — never called for a violating body. */
    spy: (spies: ReturnType<typeof makeDispatcher>['spies']) => ReturnType<typeof vi.fn>;
}

/**
 * One case per catalog route with a `requestSchema` served by the dispatcher.
 * The completeness test below forces this table to keep up with the catalog.
 */
const CASES: GateCase[] = [
    {
        route: 'POST /api/v1/notifications/read',
        // The #3899 ③ shapes: a misnamed key and a non-array both used to
        // become `markRead(userId, [])` — 200, badge never clears.
        violating: [{ notificationIds: ['n1'] }, { ids: 'n1' }, { ids: [42] }, 'garbage', [['n1']]],
        valid: { ids: ['n1', 'n2'] },
        drive: (d, body) => d.handleNotification('/read', 'POST', body, {}, CTX),
        spy: (s) => s.markRead,
    },
    {
        route: 'POST /api/v1/analytics/query',
        // Missing measures / retired envelope key — the #3878 shapes.
        violating: [{}, { cube: 'crm_account', query: { measures: ['count'] } }, { cube: 'crm_account' }],
        valid: { cube: 'crm_account', measures: ['count'] },
        drive: (d, body) => d.handleAnalytics('/query', 'POST', body, CTX),
        spy: (s) => s.query,
    },
];

describe('#3899 ④ — dispatcher routes with a declared requestSchema reject violating bodies', () => {
    it('every dispatcher-served catalog requestSchema has a violating-body case (ratchet)', () => {
        const covered = new Set(CASES.map((c) => c.route));
        for (const group of DISPATCHER_GROUPS) {
            for (const ep of group.endpoints ?? []) {
                if (!ep.requestSchema || !BODY_METHODS.has(ep.method)) continue;
                const route = `${ep.method} ${group.prefix}${ep.path}`;
                expect(
                    covered.has(route),
                    `${route} declares requestSchema '${ep.requestSchema}' but has no violating-body case in this suite — add one, or the declaration is a promise nothing checks`,
                ).toBe(true);
            }
        }
    });

    for (const gateCase of CASES) {
        describe(gateCase.route, () => {
            it('rejects each violating body with the VALIDATION_FAILED shape both HTTP exits map to 400', async () => {
                for (const body of gateCase.violating) {
                    const { dispatcher, spies } = makeDispatcher();
                    let thrown: unknown;
                    try {
                        await gateCase.drive(dispatcher, body);
                    } catch (e) {
                        thrown = e;
                    }
                    expect(
                        thrown,
                        `${gateCase.route} accepted ${JSON.stringify(body)} instead of rejecting it`,
                    ).toBeDefined();
                    // The duck shape `dispatcher-validation-error.test.ts` pins
                    // to a wire 400 on both exits — recognised by the SAME
                    // predicate the exits use, so this cannot drift from them.
                    const details = validationFailureDetails(thrown);
                    expect(details?.code).toBe('VALIDATION_FAILED');
                    expect(details?.fields.length).toBeGreaterThan(0);
                    expect(gateCase.spy(spies)).not.toHaveBeenCalled();
                }
            });

            it('still serves a conforming body (the 400 above is the schema, not a broken route)', async () => {
                const { dispatcher, spies } = makeDispatcher();
                const result = await gateCase.drive(dispatcher, gateCase.valid);
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(gateCase.spy(spies)).toHaveBeenCalledTimes(1);
            });
        });
    }
});
