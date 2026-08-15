// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8747 — `GET /api/v1/meta/:type/:name/audit` called `auditMetaItem` with
// `type`, `name`, `environmentId` and `limit`, and NO organization. The
// protocol method declared `organizationId` and never read it, so the read was
// unscoped on both ends and returned every tenant's audit rows for a
// `(type, name)`.
//
// This route has no capability gate in its handler — unlike its `PUT` twin,
// which gates on `manage_metadata` — so the reachable cohort was any
// authenticated principal of any tenant, on the published `meta.getAudit` SDK
// surface. That is why the assertions below are about the ARGUMENT rather than
// the status code: a 200 was always the answer; what leaked was the payload.
//
// The organization comes from `resolveExecCtx`, which this file already calls
// in 40+ handlers. Deliberately NOT a new `resolveActiveOrganizationId` — the
// `/published` route's comment in `rest-server.ts` records that inventing org
// plumbing in `packages/rest` under a bug fix would be a smuggled seam, and
// this change reads a field the execution context already carries instead.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const AUDIT = `${META}/:type/:name/audit`;

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

/**
 * @param execCtx what `resolveExecCtx` resolves to for the request under test.
 *   `undefined` models the branch where it rejects and the handler's `.catch`
 *   swallows it.
 */
function boot(execCtx: any) {
    const auditMetaItem = vi.fn().mockResolvedValue({ events: [] });
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        auditMetaItem,
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => execCtx;
    rest.registerRoutes();

    const drive = async (req: Record<string, unknown> = {}) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === 'GET' && r.path === AUDIT,
        );
        if (!found) throw new Error(`route not registered: GET ${AUDIT}`);
        const res = mockRes();
        await found.handler(
            {
                method: 'GET',
                path: AUDIT,
                params: { type: 'views', name: 'shared_grid' },
                query: {},
                headers: {},
                body: {},
                ...req,
            } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return { auditMetaItem, drive };
}

/** The request object the route handed to `auditMetaItem`. */
const requestFrom = (fn: any) => fn.mock.calls[0][0];

describe('#8747 GET /meta/:type/:name/audit scopes the read to the caller organization', () => {
    it('threads the execution context tenant as `organizationId`', async () => {
        const { auditMetaItem, drive } = boot({ userId: 'u1', tenantId: 'org_alpha' });
        await drive();

        expect(auditMetaItem).toHaveBeenCalledTimes(1);
        expect(requestFrom(auditMetaItem).organizationId).toBe('org_alpha');
    });

    it('is fail-closed when the caller resolves no organization', async () => {
        // A principal with no active organization must read env-wide rows, not
        // become a skeleton key. `null` is the env-wide read downstream; an
        // ABSENT key would be the pre-fix unscoped call.
        const { auditMetaItem, drive } = boot({ userId: 'u1' });
        await drive();

        const request = requestFrom(auditMetaItem);
        expect(request.organizationId).toBe(null);
        expect(request).toHaveProperty('organizationId');
    });

    it('an unresolvable execution context never reaches the read — the anonymous floor refuses first', async () => {
        // MEASURED, and it corrects an assumption worth recording: the
        // handler's `.catch(() => undefined)` looks like the fail-closed path
        // for this case, but it is not reachable through the route. An
        // unresolved context is refused by the anonymous floor (`enforceAuth`)
        // with a 401 before the handler body runs, so the protocol is never
        // called at all.
        //
        // That floor is the ONLY gate here — this route has no capability gate,
        // unlike the `PUT` twin's `manage_metadata` check — which is precisely
        // why the organization scope below has to do the tenant separation.
        const { auditMetaItem, drive } = boot(undefined);
        const answer = await drive();

        expect(answer.status).toBe(401);
        expect(auditMetaItem).not.toHaveBeenCalled();
    });

    it('never omits the organization — the call shape that leaked is unreachable', async () => {
        for (const ctx of [
            { userId: 'u1', tenantId: 'org_alpha' },
            { userId: 'u1', tenantId: undefined },
            { userId: 'u1' },
        ]) {
            const { auditMetaItem, drive } = boot(ctx);
            await drive();
            const request = requestFrom(auditMetaItem);
            expect(
                'organizationId' in request,
                `route omitted organizationId for ctx ${JSON.stringify(ctx)}`,
            ).toBe(true);
        }
    });

    it('does not pass the dead `environmentId` the request type never declared', async () => {
        // Swept with the fix: `auditMetaItem` neither declares nor reads it.
        // Environment scoping is unaffected — it comes from WHICH protocol
        // `resolveProtocol` hands back, not from this payload.
        const { auditMetaItem, drive } = boot({ userId: 'u1', tenantId: 'org_alpha' });
        await drive();

        expect(requestFrom(auditMetaItem)).not.toHaveProperty('environmentId');
    });

    it('still forwards the (type, name) key and a well-formed limit', async () => {
        const { auditMetaItem, drive } = boot({ userId: 'u1', tenantId: 'org_alpha' });
        await drive({ query: { limit: '5' } });

        const request = requestFrom(auditMetaItem);
        expect(request.type).toBe('views');
        expect(request.name).toBe('shared_grid');
        expect(request.limit).toBe(5);
    });
});
