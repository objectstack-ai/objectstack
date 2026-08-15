// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8805 — the REST `/meta` WRITE doors passed no organization, so every audit
// row a REST-authored metadata write produced was stamped env-wide
// (`recordMetadataAudit`: `organization_id: entry.organizationId ?? null`).
// Composed with #8803's scoped READ — own-org rows PLUS env-wide ones, a limb
// that is required rather than optional — that made every REST-authored audit
// row readable by every tenant, carrying its `actor`, `note`, `lock_state` and
// `request_id`.
//
// ── What these assertions are ABOUT, and why they are argument-level ───────
//
// The composition has three links, and two were already pinned before this
// card: `request.organizationId → sys_metadata_audit.organization_id` lives in
// `@objectstack/metadata-protocol`'s own suites, and the DISPATCHER twin's
// end-to-end row is pinned in `@objectstack/runtime`'s
// `meta-write-org-scope.test.ts` (measured for #8805: a `view` written by a
// session with an active org lands `organization_id: 'org_alpha'` on both the
// `sys_metadata` row and the audit row; a `flow` lands `null` on both). The
// missing link — the only one this package owns — is whether the REST door
// SUPPLIES the organization at all. That is an argument, so these are argument
// assertions, exactly as #8747's sibling suite next door reasons about its own.
//
// ── The trap this file exists to pin, which is NOT the obvious one ─────────
//
// Threading `ctx.tenantId` raw would close the disclosure and open an OUTAGE.
// `saveMetaItem`'s `organizationId` is one value feeding two things — the
// `sys_metadata` partition the row lands in AND the audit row — and the
// protocol REFUSES an org-scoped write of a type the registry declares
// `allowOrgOverride: false` (`NOT_OVERRIDABLE`, 403 — the #6190 ruling, which
// deliberately refuses rather than silently coercing the row to env-wide,
// because coercion rewrites the tenancy statement the author made). So a raw
// tenant would turn every `PUT /meta/object/*` from a tenant-admin session into
// a 403. `organizationIdForMetaWrite` is the registry-derived predicate that
// answers this, and it is the dispatcher's OWN — the cases below pin that the
// two doors now answer identically for the same request, which is the property
// the card is really about.

import { describe, it, expect, vi } from 'vitest';
import { organizationIdForMetaWrite } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const ORG = 'org_alpha';

/** `allowOrgOverride: true` — a tenant admin's own overlay really is theirs. */
const OVERRIDABLE = 'views';
/** `allowOrgOverride: false` — an org-scoped write here is refused by the protocol. */
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

    return { ...calls, drive };
}

/** The request object the route handed to the protocol. */
const requestFrom = (fn: any) => fn.mock.calls[0][0];

const AUTHORIZED = { userId: 'u1', systemPermissions: ['manage_metadata'], tenantId: ORG };
const AUTHORIZED_NO_ORG = { userId: 'u1', systemPermissions: ['manage_metadata'] };

/** Drive one write door with the given type + execution context. */
async function writeWith(type: string, execCtx: any) {
    const b = boot(execCtx);
    await b.drive('PUT', `${META}/:type/:name`, {
        params: { type, name: 'shared_grid' },
        body: { label: 'Shared grid' },
    });
    return requestFrom(b.saveMetaItem);
}

describe('#8805 the REST /meta write doors carry the caller organization', () => {
    describe('PUT /meta/:type/:name', () => {
        it('threads the execution-context tenant for an org-overridable type', async () => {
            const request = await writeWith(OVERRIDABLE, AUTHORIZED);
            expect(request.organizationId).toBe(ORG);
        });

        it('⛔ does NOT thread it for a type the registry declares non-overridable', async () => {
            // THE case that makes the fix safe rather than a trade. The protocol
            // answers `NOT_OVERRIDABLE` (403) to an org-scoped write of one of
            // these, so a raw `ctx.tenantId` here would turn a working
            // `PUT /meta/object/*` into an outage for every tenant-admin session
            // — swapping a disclosure for a regression. The write genuinely IS
            // env-wide (#6190 option A), so `null` is its truthful audit scope.
            const request = await writeWith(ENV_WIDE, AUTHORIZED);
            expect(request.organizationId).toBeUndefined();
        });

        it('is env-wide when the caller resolves no organization', async () => {
            const request = await writeWith(OVERRIDABLE, AUTHORIZED_NO_ORG);
            expect(request.organizationId).toBeUndefined();
        });

        it('judges the plural URL spelling identically to the singular', async () => {
            // `/meta/views/x` and `/meta/view/x` are the same item; a predicate
            // that scoped only one spelling would partition by URL style.
            expect((await writeWith('views', AUTHORIZED)).organizationId).toBe(ORG);
            expect((await writeWith('view', AUTHORIZED)).organizationId).toBe(ORG);
        });

        it('never omits the decision — the pre-fix call shape is unreachable', async () => {
            // The defect was an ABSENT key, not a wrong value: `orgId =
            // request.organizationId ?? null` reads absent and undefined the
            // same way downstream, so this asserts the door DECIDED rather than
            // forgot. An omitted key is what every REST-authored row had.
            for (const type of [OVERRIDABLE, ENV_WIDE]) {
                const request = await writeWith(type, AUTHORIZED);
                expect(
                    'organizationId' in request,
                    `door omitted organizationId for type ${type}`,
                ).toBe(true);
            }
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
    });

    describe('PUT /meta/:type/:section/:name (compound name)', () => {
        it('scopes the compound twin too — gating one door and scoping the other leaves a bypass', async () => {
            const b = boot(AUTHORIZED);
            await b.drive('PUT', `${META}/:type/:section/:name`, {
                params: { type: OVERRIDABLE, section: 'lead', name: 'all_leads' },
                body: { label: 'All leads' },
            });
            const request = requestFrom(b.saveMetaItem);
            expect(request.organizationId).toBe(ORG);
            expect(request.name).toBe('lead/all_leads');
        });
    });

    describe('DELETE /meta/:type/:name', () => {
        it('scopes the reset, so a tenant cannot destroy the env-wide row', async () => {
            const b = boot(AUTHORIZED);
            await b.drive('DELETE', `${META}/:type/:name`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
            });
            expect(requestFrom(b.deleteMetaItem).organizationId).toBe(ORG);
        });

        it('stays env-wide for a non-overridable type', async () => {
            const b = boot(AUTHORIZED);
            await b.drive('DELETE', `${META}/:type/:name`, {
                params: { type: ENV_WIDE, name: 'task' },
            });
            expect(requestFrom(b.deleteMetaItem).organizationId).toBeUndefined();
        });
    });

    describe('POST /meta/:type/:name/publish', () => {
        it('scopes the publish — without it the save fix would break the draft loop', async () => {
            // `promoteDraftForPublish` resolves the draft through
            // `getOverlayRepo(orgId)`. Once `PUT ?mode=draft` lands org-scoped,
            // an unscoped publish looks in the env-wide partition and answers
            // `no_draft`. The two halves are one change, not two.
            const b = boot(AUTHORIZED);
            await b.drive('POST', `${META}/:type/:name/publish`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
            });
            expect(requestFrom(b.publishMetaItem).organizationId).toBe(ORG);
        });
    });

    describe('POST /meta/:type/:name/rollback', () => {
        it('scopes the rollback so it restores into the partition the caller named', async () => {
            const b = boot(AUTHORIZED);
            await b.drive('POST', `${META}/:type/:name/rollback`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
                body: { toVersion: 2 },
            });
            const request = requestFrom(b.rollbackMetaItem);
            expect(request.organizationId).toBe(ORG);
            expect(request.toVersion).toBe(2);
        });
    });

    describe('GET /meta/:type/:name/published — the read that had to move with the write', () => {
        it('scopes the published read with the RAW tenant, not the write predicate', async () => {
            // This route's comment used to justify omitting the organization by
            // symmetry: "this door resolves exactly the publishes this door can
            // produce". The write-side fix ends that symmetry, so left unscoped
            // this read would 404 about a `view` the same caller published a
            // moment earlier through the same transport. The RAW tenant is
            // correct here because `getMetaItemLayered` is org-first-then-
            // env-wide: fail-open in the safe direction.
            const b = boot(AUTHORIZED);
            await b.drive('GET', `${META}/:type/:name/published`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
            });
            expect(requestFrom(b.getMetaItemLayered).organizationId).toBe(ORG);
        });

        it('omits it entirely for a caller with no organization', async () => {
            const b = boot(AUTHORIZED_NO_ORG);
            await b.drive('GET', `${META}/:type/:name/published`, {
                params: { type: OVERRIDABLE, name: 'shared_grid' },
            });
            expect(requestFrom(b.getMetaItemLayered)).not.toHaveProperty('organizationId');
        });
    });

    describe('twin parity — the property the card is actually about', () => {
        it('answers what the dispatcher answers, for every registered type', async () => {
            // Both doors call the SAME predicate now; this pins that the REST
            // door's answer is that predicate's answer rather than a
            // coincidence, across the whole registry rather than the two
            // specimens above. A registry entry flipping `allowOrgOverride`
            // moves both sides of this assertion together (Prime Directive #8).
            for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
                const request = await writeWith(entry.type, AUTHORIZED);
                expect(
                    request.organizationId,
                    `REST door disagreed with the dispatcher for type ${entry.type}`,
                ).toBe(organizationIdForMetaWrite(entry.type, ORG));
            }
        });
    });
});
