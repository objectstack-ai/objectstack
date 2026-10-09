// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D6, C5 stage S3] The REST `/meta` WRITE doors carry NO organization.
//
// History. #8805 found these doors passing no organization and made them
// thread the caller's active one for the five types the registry declared
// `allowOrgOverride` (through `organizationIdForMetaWrite`, the dispatcher's
// predicate), so a tenant admin's overlay landed in that tenant's partition and
// its audit row with it. ADR-0131 D6 retires the per-organization overlay
// axis: environment metadata belongs to the whole deployment. The doors now
// thread no organization for any type — every write lands environment-wide
// (`organization_id` NULL) and audits there — and the predicate is deleted.
//
// ── What these assertions are ABOUT ───────────────────────────────────────
//
// The link this package owns is whether the door SUPPLIES an organization,
// so these are argument assertions on the request each door builds. That the
// protocol stores an absent organization as `organization_id` NULL is pinned in
// `@objectstack/metadata-protocol`'s own suites, and the dispatcher twin's
// end-to-end row in `@objectstack/runtime`'s `meta-write-org-scope.test.ts`.
//
// Reverse verification of the PUT pin (re-threading `ctx.tenantId` into the
// save request) turns the first two cases red; recorded in the stage's PR.

import { describe, it, expect, vi } from 'vitest';
import * as metadataCore from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const ORG = 'org_alpha';

/** `allowOrgOverride: true` — until ADR-0131 D6, written into the caller's organization. */
const OVERRIDABLE = 'views';
/** `allowOrgOverride: false` — always written environment-wide. */
const ENV_WIDE = 'object';

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
 *   Every write door below gates on `manage_metadata` (#6603 / #7019) BEFORE it
 *   reaches the scoping decision, so the capability is present in every case —
 *   without it each one would 403 and pass for the wrong reason.
 */
function boot(execCtx: any) {
    const calls = {
        saveMetaItem: vi.fn().mockResolvedValue({ success: true, version: 'v1', seq: 1 }),
        deleteMetaItem: vi.fn().mockResolvedValue({ success: true }),
        publishMetaItem: vi.fn().mockResolvedValue({ success: true, version: 'v1', seq: 1 }),
        rollbackMetaItem: vi.fn().mockResolvedValue({
            success: true, version: 'v1', seq: 1, restoredFromVersion: 1,
        }),
        getMetaItemLayered: vi.fn().mockResolvedValue({ overlay: { name: 'x' } }),
    };
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        ...calls,
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => execCtx;
    rest.registerRoutes();

    const drive = async (
        method: string,
        path: string,
        req: Record<string, unknown> = {},
    ) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const res = mockRes();
        await found.handler(
            { method, path, params: {}, query: {}, headers: {}, body: {}, ...req } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    /** [commit 7986d973f] Every mounted route, for absence sweeps. */
    const routes = () => (rest as any).getRoutes();

    return { ...calls, drive, routes };
}

/** The request object the route handed to the protocol. */
const requestFrom = (fn: any) => fn.mock.calls[0][0];

// [#21124] `manage_platform_settings` too: these suites iterate every registered type, and a
// `datasource` write is admitted only with it (`metaTypeWriteRefusal`, the type-level write admission).
const AUTHORIZED = { userId: 'u1', systemPermissions: ['manage_metadata', 'manage_platform_settings'], tenantId: ORG };
const AUTHORIZED_NO_ORG = { userId: 'u1', systemPermissions: ['manage_metadata', 'manage_platform_settings'] };

/** Drive one write door with the given type + execution context. */
async function writeWith(type: string, execCtx: any) {
    const b = boot(execCtx);
    await b.drive('PUT', `${META}/:type/:name`, {
        params: { type, name: 'shared_grid' },
        body: { label: 'Shared grid' },
    });
    return requestFrom(b.saveMetaItem);
}

describe('[ADR-0131 D6] the REST /meta write doors carry no organization', () => {
    describe('PUT /meta/:type/:name', () => {
        it('⭐ a caller WITH an active organization writes an org-overridable type environment-wide', async () => {
            const request = await writeWith(OVERRIDABLE, AUTHORIZED);
            expect(request.organizationId).toBeUndefined();
            expect('organizationId' in request).toBe(false);
        });

        it('⭐ no registered type carries the organization — the twin-parity property, now trivially one answer', async () => {
            for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
                const request = await writeWith(entry.type, AUTHORIZED);
                expect(
                    request.organizationId,
                    `the REST door threaded an organization for type ${entry.type}`,
                ).toBeUndefined();
            }
        });

        it('a non-overridable type stays environment-wide, as before', async () => {
            const request = await writeWith(ENV_WIDE, AUTHORIZED);
            expect(request.organizationId).toBeUndefined();
        });

        it('is environment-wide when the caller resolves no organization, as before', async () => {
            const request = await writeWith(OVERRIDABLE, AUTHORIZED_NO_ORG);
            expect(request.organizationId).toBeUndefined();
        });

        it('judges the plural URL spelling identically to the singular', async () => {
            expect((await writeWith('views', AUTHORIZED)).organizationId).toBeUndefined();
            expect((await writeWith('view', AUTHORIZED)).organizationId).toBeUndefined();
        });

        it('leaves the rest of the write request untouched', async () => {
            const b = boot(AUTHORIZED);
            await b.drive('PUT', `${META}/:type/:name`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
                headers: { 'if-match': '"sha256:abc"' },
                query: { package: 'pkg_a' },
                body: { label: 'Shared grid' },
            });
            const request = requestFrom(b.saveMetaItem);
            expect(request.type).toBe(OVERRIDABLE);
            expect(request.name).toBe('shared_grid');
            expect(request.item).toEqual({ label: 'Shared grid' });
            expect(request.parentVersion).toBe('sha256:abc');
            expect(request.packageId).toBe('pkg_a');
        });

        it('the write-side predicate is gone from `@objectstack/metadata-core`', () => {
            expect('organizationIdForMetaWrite' in metadataCore).toBe(false);
            // Control: the barrel is the real one.
            expect('metaWriteCapabilityVerdict' in metadataCore).toBe(true);
        });
    });

    describe('[#12195] the compound-name PUT twin is retired', () => {
        it('mounts no compound `:section` arity', () => {
            const b = boot(AUTHORIZED);
            const compound = b.routes()
                .map((r: any) => String(r.path))
                .filter((path: string) => path.includes(':section'));
            expect(compound).toEqual([]);
        });
    });

    describe('DELETE /meta/:type/:name', () => {
        it('names no organization: the reset reaches the environment-wide row', async () => {
            const b = boot(AUTHORIZED);
            await b.drive('DELETE', `${META}/:type/:name`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
            });
            expect(requestFrom(b.deleteMetaItem).organizationId).toBeUndefined();
        });
    });

    describe('POST /meta/:type/:name/publish', () => {
        it('names no organization: the promotion looks in the environment partition the save wrote', async () => {
            const b = boot(AUTHORIZED);
            await b.drive('POST', `${META}/:type/:name/publish`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
            });
            expect(requestFrom(b.publishMetaItem).organizationId).toBeUndefined();
        });
    });

    describe('POST /meta/:type/:name/rollback', () => {
        it('names no organization: it restores a version of the environment-wide row', async () => {
            const b = boot(AUTHORIZED);
            await b.drive('POST', `${META}/:type/:name/rollback`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
                body: { toVersion: 2 },
            });
            const request = requestFrom(b.rollbackMetaItem);
            expect(request.organizationId).toBeUndefined();
            expect(request.toVersion).toBe(2);
        });
    });

    describe('GET /meta/:type/:name/published — the read that moves with the write', () => {
        it('names no organization for a caller with one: it resolves exactly the publishes the doors produce', async () => {
            const b = boot(AUTHORIZED);
            await b.drive('GET', `${META}/:type/:name/published`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
            });
            expect(requestFrom(b.getMetaItemLayered)).not.toHaveProperty('organizationId');
        });

        it('nor for a caller with no organization', async () => {
            const b = boot(AUTHORIZED_NO_ORG);
            await b.drive('GET', `${META}/:type/:name/published`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
            });
            expect(requestFrom(b.getMetaItemLayered)).not.toHaveProperty('organizationId');
        });
    });
});
