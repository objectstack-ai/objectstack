// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16263, the sixth site] `enforceProjectMembership`'s control-plane SKIP
 * LIST stops at a segment boundary.
 *
 * ## Why this site ranks ahead of the ten domain claims
 *
 * It is the identical predicate — `skipPaths.some(p => path.startsWith(p))`
 * with `'/auth'` in the list — making the identical mistake about the
 * identical prefix: `/authentication/foo` is not under `/auth` by any reading,
 * yet it satisfied the test. What differs is the CONSEQUENCE, and the contract
 * review that found it said so plainly rather than dressing it up:
 *
 *     a claim that is too wide sends traffic somewhere wrong,
 *     while a skip list that is too wide sends traffic PAST A CHECK.
 *
 * ⚠️ It is LATENT, not harmless, and must not be graded as either extreme.
 * Nothing claims `/authentication/*` today, so such a request 404s further
 * down before the missing membership check can matter. It goes live the day
 * any domain claims a path of that shape — and on that day the symptom is a
 * non-member reading a scoped route, not a 404.
 *
 * ## The observation point, stated plainly
 *
 * These cases call `enforceProjectMembership` directly. That is deliberate and
 * it is the honest point: reaching this gate through `dispatch()` needs a
 * resolved `context.environmentId`, which comes from a host KernelResolver or
 * a single-environment plugin, and standing one up would put the thing under
 * test behind two seams that are not what this file is about. The gate's
 * inputs are exactly `(context, path)`, and both are supplied here.
 *
 * The fixture makes the two outcomes DISTINGUISHABLE, which a bare fixture
 * does not: `enforceProjectMembership` fails open in a great many ways (no
 * auth service, no session, no ObjectQL, a cached membership), and under any
 * of them "skipped" and "checked and passed" both return `null` — a test built
 * on that could not fail. So the session resolves to a real user in a
 * non-platform org, and `sys_environment_member` answers with NO row. A path
 * that reaches the check therefore comes back 403; a path that is skipped
 * comes back `null`. The two classes are then separated by the answer itself.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';

const USER_ID = 'user-not-a-member';
const ENVIRONMENT_ID = 'env-scoped-1';

function makeGate() {
    const find = vi.fn().mockResolvedValue([]); // no membership row -> not a member
    const objectql = {
        find,
        getObjects: vi.fn().mockReturnValue({}),
        registry: { getObject: vi.fn().mockReturnValue(null), getRegisteredTypes: vi.fn().mockReturnValue([]) },
    };
    const auth = {
        getApi: async () => ({
            getSession: async () => ({
                user: { id: USER_ID },
                session: { userId: USER_ID, activeOrganizationId: 'org-tenant' },
            }),
        }),
    };
    const services: Record<string, any> = { objectql, auth };
    const kernel: any = {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
    };
    const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: true });
    const check = (path: string) =>
        (dispatcher as any).enforceProjectMembership(
            { environmentId: ENVIRONMENT_ID, request: { headers: new Headers() } },
            path,
        );
    return { check, find };
}

/** Paths the skip list must NOT wave past the check — the defect rows. */
const MUST_BE_CHECKED = [
    '/authentication/foo',
    '/authx',
    '/authx/foo',
    '/cloudy/foo',
    '/healthz',
    '/readyx',
    '/discoveryx/foo',
];

/** Paths the skip list must KEEP waving past — the overshoot controls. */
const MUST_BE_SKIPPED = [
    '/auth',
    '/auth/me/permissions',
    '/cloud',
    '/cloud/environments/abc',
    '/health',
    '/ready',
    '/discovery',
];

describe('#16263: the membership skip list stops at a segment boundary', () => {
    describe('sibling namespaces are CHECKED — they no longer ride the control-plane exemption', () => {
        for (const path of MUST_BE_CHECKED) {
            it(`${path} reaches the membership check and is refused with the 403 envelope`, async () => {
                const { check, find } = makeGate();
                const result = await check(path);

                // Asserting the ENVELOPE, not merely "not null": any other
                // refusal from any other layer would otherwise read as this
                // gate running.
                expect(result).not.toBeNull();
                expect(result?.status).toBe(403);
                expect(result?.body?.success).toBe(false);
                expect(result?.body?.error?.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
                expect(result?.body?.error?.httpStatus).toBe(403);

                // …and the check really ran, rather than the envelope arriving
                // from somewhere that never asked the control plane.
                expect(find).toHaveBeenCalledWith('sys_environment_member', expect.objectContaining({
                    where: { environment_id: ENVIRONMENT_ID, user_id: USER_ID },
                }));
            });
        }
    });

    describe('⭐ the overshoot controls — the control plane is still exempt', () => {
        for (const path of MUST_BE_SKIPPED) {
            it(`${path} is still skipped before the check runs`, async () => {
                const { check, find } = makeGate();
                expect(await check(path)).toBeNull();
                // `null` alone cannot tell "skipped" from "checked and passed" —
                // this fixture has no membership row, so a checked path would
                // have queried and then 403'd. Never querying is the evidence.
                expect(find).not.toHaveBeenCalled();
            });
        }
    });

    describe('the query-string form keeps its exemption — the boundary is `/`, `?` or end', () => {
        for (const path of ['/auth?redirect=%2Fapp', '/health?verbose=1', '/cloud?page=2']) {
            it(`${path} is still skipped`, async () => {
                const { check, find } = makeGate();
                expect(await check(path)).toBeNull();
                expect(find).not.toHaveBeenCalled();
            });
        }

        it('a `?` does not smuggle a sibling namespace back in', async () => {
            const { check } = makeGate();
            const result = await check('/authentication/foo?x=1');
            expect(result?.status).toBe(403);
            expect(result?.body?.error?.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
        });
    });

    it('an ordinary scoped route is unchanged — it was always checked and still is', async () => {
        const { check } = makeGate();
        const result = await check('/data/contacts');
        expect(result?.status).toBe(403);
        expect(result?.body?.error?.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
    });

    it('the public share-link carve-out is unchanged — it is a different rule, below the skip list', async () => {
        const { check, find } = makeGate();
        expect(await check('/share-links/tok-123/resolve')).toBeNull();
        expect(find).not.toHaveBeenCalled();
    });
});
