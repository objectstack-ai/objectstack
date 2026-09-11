// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/packages` has ONE implementation, and this file keeps "which door
 * answered" observable (#14503).
 *
 * ## What was measured
 *
 * `GET /api/v1/packages` and `GET /api/v1/packages/:id` used to have two HTTP
 * implementations: this domain, and three service-gated routes in
 * `@objectstack/rest`'s `registerPackageRoutes` that documented themselves as
 * SHADOWING this one. On a stock showcase boot the dispatcher answered — the
 * 404 wording decided it, `Package 'x' not found` (this file) against
 * `Package "x" was not found.` (the REST twin) — because the REST gate asked
 * for the `package` service once, at registration time, before
 * `PackageServicePlugin` had registered, so the three were never mounted at
 * all. The two bodies had already diverged (a `{ package }` wrapper and a
 * `source: 'registry' | 'database' | 'both'` stamp on one side, the bare row
 * on the other). The maintainer ruled (2026-09-02) that the REST three are
 * removed and this domain is the single implementation.
 *
 * ## What this file pins
 *
 * The surviving door's WORDING and ENVELOPE, unscoped and environment-scoped:
 *
 *   - a missing package answers `404 RESOURCE_NOT_FOUND` with the message
 *     `Package '<id>' not found` — single quotes, no trailing period — and
 *     never the retired REST spelling;
 *   - a found package answers `{ success: true, data: <row> }`: the bare
 *     installed-package row under `data`, with no `package` wrapper and no
 *     `source` key;
 *   - the list answers `{ packages, total, hasMore }` (`hasMore` added by
 *     #16781, reconciling the door to `ListInstalledPackagesResponseSchema`)
 *     whose rows carry no `source`;
 *   - the same answers arrive through the environment-scoped URL
 *     (`/environments/:environmentId/packages…`), because since #15859 the
 *     `@objectstack/hono` catch-all's scoped path is stripped to the domain's
 *     shape before `DomainHandlerRegistry` resolves it — which is what makes
 *     this domain the single implementation on the scoped mount too, where
 *     the REST registrar's mirror used to be the only door.
 *
 * ## Why this suite drives `dispatch()` with a hand-derived subpath
 *
 * `packages/runtime` cannot depend on `@objectstack/hono` (that adapter
 * depends on THIS package), and the adapter's own suite aliases this package
 * to a mock. The adapter's one contribution is
 * `const subPath = c.req.path.substring(prefix.length)` in its
 * `app.all(`${prefix}/*`)` catch-all, reproduced here exactly, as
 * `http-dispatcher.scoped-url-strip.test.ts` does. The same requests were
 * driven through the REAL adapter on the built dist while this was written
 * (quoted on PR #14503's body); this file is the durable pin.
 *
 * Identity goes through the real resolver: the kernel offers an `auth`
 * session and an ObjectQL engine whose `find` answers the permission-set
 * tables the shared authz resolver reads, so the caller holds
 * `studio.access` + `manage_metadata` the way a real one would, and the gate
 * inside the domain is exercised rather than bypassed.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher, type HttpDispatcherResult } from '../http-dispatcher.js';

const PREFIX = '/api/v1';
const ENV_ID = 'env_alpha';
const PKG_ID = 'com.acme.crm';
const MISSING = 'no.such.package';

/** The retired REST door's spelling — pinned ABSENT so a resurrection is a red test. */
const REST_SPELLING = `Package "${MISSING}" was not found.`;
/** This door's spelling, verbatim. */
const DISPATCHER_SPELLING = `Package '${MISSING}' not found`;

/** The `@objectstack/hono` catch-all's one contribution, reproduced exactly. */
function subPathAsTheCatchAllDerivesIt(url: string): string {
    return url.substring(PREFIX.length);
}

/**
 * The fixture's ONE hand-written where-matcher: equality plus `$in` — the two
 * shapes the shared resolver actually issues — and it REFUSES every other
 * shape loudly instead of silently matching (the check:where-matcher
 * convention).
 */
function matchesWhere(row: any, where: any): boolean {
    for (const [field, cond] of Object.entries(where ?? {})) {
        if (field.startsWith('$')) {
            throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
        }
        if (cond !== null && typeof cond === 'object') {
            const ops = Object.keys(cond as object);
            if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as any).$in)) {
                throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
            }
            if (!(cond as any).$in.includes(row[field])) return false;
            continue;
        }
        if (row[field] !== cond) return false;
    }
    return true;
}

/** The permission store the shared authz resolver reads, in its shipped shapes. */
const TABLES: Record<string, any[]> = {
    sys_user: [{ id: 'u_admin', email: 'u_admin@example.com' }],
    sys_user_permission_set: [{ user_id: 'u_admin', permission_set_id: 'ps_pkg' }],
    sys_permission_set: [
        { id: 'ps_pkg', name: 'pkg_admin', system_permissions: ['manage_metadata', 'studio.access'] },
    ],
};

function registryWith(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({
        id: PKG_ID,
        name: 'CRM',
        namespace: 'crm',
        version: '1.0.0',
        type: 'app',
        scope: 'user',
        objects: [{ name: 'lead', fields: { title: { type: 'text' } } }],
    } as any);
    return registry;
}

function kernelWith(registry: SchemaRegistry): any {
    const ql = {
        registry,
        find: async (object: string, q: any = {}) => {
            const rows = (TABLES[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
    };
    const auth = { api: { getSession: async () => ({ user: { id: 'u_admin' } }) } };
    const services: Record<string, unknown> = { objectql: ql, auth };
    return {
        getState: () => 'running',
        getService: (n: string) => services[n],
        getServiceAsync: async (n: string) => services[n],
    };
}

/** Exactly how `createHonoApp` builds its dispatcher: `new HttpDispatcher(kernel)`. */
function dispatcher(): HttpDispatcher {
    return new HttpDispatcher(kernelWith(registryWith()));
}

function responseOf(res: HttpDispatcherResult, what: string): NonNullable<HttpDispatcherResult['response']> {
    const { response } = res;
    if (!response) throw new Error(`${what} answered no response at all`);
    return response;
}

async function send(method: string, url: string): Promise<{ status: number; body: any; ctx: any }> {
    const ctx: any = { request: new Request(`http://pin.local${url}`, { method }) };
    const res = await dispatcher().dispatch(method, subPathAsTheCatchAllDerivesIt(url), undefined, {}, ctx, PREFIX);
    const response = responseOf(res, `${method} ${url}`);
    return { status: response.status, body: response.body, ctx };
}

const UNSCOPED = `${PREFIX}/packages`;
const SCOPED = `${PREFIX}/environments/${ENV_ID}/packages`;

describe('/packages — one implementation, and its 404 wording says which (#14503)', () => {
    it('NEGATIVE CONTROL: a path no domain claims answers 404 ROUTE_NOT_FOUND — the shape "no door answered" takes', async () => {
        for (const url of [`${PREFIX}/no-such-domain`, `${PREFIX}/environments/${ENV_ID}/no-such-domain`]) {
            const r = await send('GET', url);
            expect(r.status).toBe(404);
            expect(r.body?.error?.code).toBe('ROUTE_NOT_FOUND');
        }
    });

    for (const [label, base] of [['unscoped', UNSCOPED], ['environment-scoped', SCOPED]] as const) {
        it(`${label} GET /packages/:id for a missing package answers the dispatcher's spelling, never the retired REST one`, async () => {
            const r = await send('GET', `${base}/${MISSING}`);
            expect(r.status).toBe(404);
            expect(r.body?.success).toBe(false);
            expect(r.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
            expect(r.body?.error?.message).toBe(DISPATCHER_SPELLING);
            expect(r.body?.error?.message).not.toBe(REST_SPELLING);
            expect(r.body?.error?.message).not.toContain('was not found');
        });

        it(`${label} DELETE /packages/:id for a missing package answers the same spelling`, async () => {
            const r = await send('DELETE', `${base}/${MISSING}`);
            expect(r.status).toBe(404);
            expect(r.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
            expect(r.body?.error?.message).toBe(DISPATCHER_SPELLING);
        });

        it(`${label} GET /packages/:id for an installed package answers the BARE row under data — no { package } wrapper, no source stamp`, async () => {
            const r = await send('GET', `${base}/${PKG_ID}`);
            expect(r.status).toBe(200);
            expect(r.body?.success).toBe(true);
            expect(r.body?.data?.manifest?.id).toBe(PKG_ID);
            expect(r.body?.data?.package).toBeUndefined();
            expect('source' in (r.body?.data ?? {})).toBe(false);
            // The dispatcher envelope, measured: `data` + `meta` beside the flag.
            // The retired REST door answered `{ data, success }` with the row
            // one level down under `data.package` — the key set is part of
            // "which door answered".
            expect(Object.keys(r.body).sort()).toEqual(['data', 'meta', 'success']);
        });

        it(`${label} GET /packages answers { packages, total, hasMore } and its rows carry no source stamp`, async () => {
            const r = await send('GET', base);
            expect(r.status).toBe(200);
            expect(r.body?.success).toBe(true);
            expect(r.body?.data?.total).toBe(1);
            // [#16781] Part of "which door answered": the declared key set.
            expect(r.body?.data?.hasMore).toBe(false);
            expect(r.body?.data?.packages).toHaveLength(1);
            expect(r.body?.data?.packages[0]?.manifest?.id).toBe(PKG_ID);
            expect('source' in r.body.data.packages[0]).toBe(false);
        });
    }

    it('the scoped URL names its environment on the SAME request the domain served — one convention, read once', async () => {
        const r = await send('GET', `${SCOPED}/${PKG_ID}`);
        expect(r.status).toBe(200);
        expect(r.ctx.urlEnvironmentId).toBe(ENV_ID);
    });
});
