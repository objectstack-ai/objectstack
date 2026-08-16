// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8919] EVERY metadata write door on the REST `/meta` surface demands the
 * ADR-0066 D1 `manage_metadata` authoring capability.
 *
 * ## Why this is an enumeration and not two more assertions
 *
 * The defect this file closes was not "two handlers forgot a gate". It was that
 * the gate was a CONVENTION held by repetition and by nothing else: four doors
 * carried the identical four lines, two did not, and no test anywhere asserted
 * the property. So the next agent adding a metadata write door copied whichever
 * neighbour was nearest and had a one-in-three chance of copying an ungated one
 * — with nothing going red either way. A defect that propagates by being
 * imitated is not fixed by fixing its instances.
 *
 * The load-bearing case in this file is therefore `covers every metadata write
 * door the server registers`: the door list is DERIVED from the composed
 * server's own route table and compared against the table below, so a new
 * mutating `/meta` route fails here on the day it is added, before anyone has to
 * notice it is missing a gate. The per-door refusal cases are what that
 * coverage assertion is worth something for.
 *
 * ## What was measured before the gate landed (both new doors)
 *
 *   shape                                   publish        rollback
 *   anonymous                               401, no call   401, no call
 *   authenticated, NO manage_metadata        200, CALLED    200, CALLED   <- the hole
 *   authenticated, manage_metadata           200, CALLED    200, CALLED
 *
 * So the reachable cohort was every authenticated principal holding no
 * authoring capability at all: it could promote a draft somebody else authored
 * to live, or restore any historical version as the live row. The `/meta`
 * umbrella (`registerMetadataEndpoints`) already refused ANONYMOUS callers, so
 * what these gates add is exactly the authenticated-but-uncapable cohort.
 *
 * ## Rejection cases assert the ENVELOPE (ADR-0112)
 *
 * `code` AND `status`, never a bare "it failed" — these routes answer by
 * *sending*, so a throw-shaped assertion could not tell "refused with the wrong
 * envelope" from "did not refuse at all". Each case also asserts the protocol
 * method was never CALLED: a gate that answers 403 after the promotion has
 * already run would still be the bug and would still pass a status-only check.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(),
    };
    return res;
}

/**
 * One metadata write door: how to address it, and which protocol method it
 * reaches once the gate lets it through. `protocolMethod` is what makes the
 * "nothing was written" half of each refusal checkable.
 */
interface Door {
    readonly label: string;
    readonly method: 'POST' | 'PUT' | 'DELETE';
    readonly path: string;
    readonly protocolMethod: string;
    readonly params: Record<string, string>;
    readonly body?: unknown;
}

/**
 * The six metadata write doors, as registered by `registerMetadataEndpoints`.
 * Four carried the gate before #8919 (`_migrate-stored` #4857-era, the single
 * and compound saves #6603/#7019, the reset #7019); `publish` and `rollback`
 * are the two this card added.
 *
 * ⚠️ This table is COMPARED against the server's own route table below — do not
 * add a door here without adding its refusal case, and do not add a mutating
 * `/meta` route to the server without adding it here.
 */
const DOORS: readonly Door[] = [
    {
        label: 'POST /meta/_migrate-stored — canonicalization rewrite',
        method: 'POST', path: `${META}/_migrate-stored`,
        protocolMethod: 'migrateStoredMetadata', params: {}, body: {},
    },
    {
        label: 'PUT /meta/:type/:name — save',
        method: 'PUT', path: `${META}/:type/:name`,
        protocolMethod: 'saveMetaItem',
        params: { type: 'object', name: 'account' },
        body: { name: 'account', label: 'Account', fields: {} },
    },
    {
        label: 'DELETE /meta/:type/:name — reset to artifact default',
        method: 'DELETE', path: `${META}/:type/:name`,
        protocolMethod: 'deleteMetaItem', params: { type: 'object', name: 'account' },
    },
    {
        label: 'POST /meta/:type/:name/publish — promote draft to live [#8919]',
        method: 'POST', path: `${META}/:type/:name/publish`,
        protocolMethod: 'publishMetaItem', params: { type: 'object', name: 'account' }, body: {},
    },
    {
        label: 'POST /meta/:type/:name/rollback — restore a historical version [#8919]',
        method: 'POST', path: `${META}/:type/:name/rollback`,
        protocolMethod: 'rollbackMetaItem',
        params: { type: 'object', name: 'account' }, body: { toVersion: 1 },
    },
    {
        label: 'PUT /meta/:type/:section/:name — compound-name save',
        method: 'PUT', path: `${META}/:type/:section/:name`,
        protocolMethod: 'saveMetaItem',
        params: { type: 'object', section: 'views', name: 'all_leads' },
        body: { name: 'all_leads' },
    },
];

/** Every protocol method any door reaches — all present, so 501 is never the answer. */
const PROTOCOL_METHODS = [...new Set(DOORS.map((d) => d.protocolMethod))];

function boot(context: Record<string, unknown> | undefined) {
    const calls: Record<string, number> = {};
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'account', item: {}, lock: 'none' }),
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
    };
    for (const name of PROTOCOL_METHODS) {
        calls[name] = 0;
        protocol[name] = vi.fn(async () => {
            calls[name]! += 1;
            return { success: true, type: 'object', name: 'account', version: '2', seq: 2, restoredFromVersion: 1 };
        });
    }

    const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => context;
    rest.registerRoutes();

    return {
        rest,
        calls,
        /** Every mutating `/meta` route the composed server actually registers. */
        registeredWriteDoors: () => (rest as any).getRoutes()
            .filter((r: any) => typeof r.path === 'string'
                && r.path.startsWith(`${META}`)
                && r.method !== 'GET')
            .map((r: any) => `${r.method} ${r.path}`)
            .sort(),
        knock: async (door: Door) => {
            const route = (rest as any).getRoutes().find(
                (r: any) => r.method === door.method && r.path === door.path,
            );
            if (!route) throw new Error(`route not registered: ${door.method} ${door.path}`);
            const res = mockRes();
            await route.handler({
                method: door.method,
                path: door.path.replace(/:(\w+)/g, (_m: string, k: string) => door.params[k] ?? k),
                params: door.params,
                query: {},
                headers: {},
                body: door.body,
            }, res);
            return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
        },
    };
}

describe('#8919 — the metadata write doors are a CLOSED, enumerated set', () => {
    it('covers every metadata write door the server registers (the anti-drift assertion)', () => {
        // THE POINT OF THIS FILE. If a new mutating `/meta` route is added, this
        // fails until it is enumerated above — at which point its refusal case
        // below runs and the author learns whether it carries the gate. A door
        // added without a gate can no longer arrive silently.
        const stack = boot({ userId: 'u', systemPermissions: [] });
        expect(stack.registeredWriteDoors()).toEqual(
            DOORS.map((d) => `${d.method} ${d.path}`).sort(),
        );
    });
});

describe('#8919 — every metadata write door refuses a capability-less caller', () => {
    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s → 403 FORBIDDEN, and the protocol is never reached',
        async (_label, door) => {
            const stack = boot({ userId: 'u_portal', systemPermissions: [] });
            const out = await stack.knock(door);
            // ADR-0112 envelope: code AND status.
            expect(out.status).toBe(403);
            expect(out.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
            // Nothing was written. A gate that refuses AFTER the write is the bug.
            expect(stack.calls[door.protocolMethod]).toBe(0);
        },
    );

    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s → refuses `studio.access` / `setup.access` alone (they are not authoring capabilities)',
        async (_label, door) => {
            // Measured and deliberately pinned in #6603/#7020: the capability
            // these doors demand and the ADR-0106 D4 mask-exemption set are
            // DIFFERENT SETS. `organization_admin` holds `setup.access` and is
            // refused here, consistent with its own declaration that a tenant
            // does not mutate shared metadata.
            const stack = boot({ userId: 'u_orgadmin', systemPermissions: ['studio.access', 'setup.access'] });
            const out = await stack.knock(door);
            expect(out.status).toBe(403);
            expect(stack.calls[door.protocolMethod]).toBe(0);
        },
    );
});

describe('#8919 — the control: capable callers keep working', () => {
    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s → a `manage_metadata` holder still reaches the protocol',
        async (_label, door) => {
            const stack = boot({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
            const out = await stack.knock(door);
            expect(out.status).not.toBe(403);
            expect(out.status).not.toBe(401);
            expect(stack.calls[door.protocolMethod]).toBe(1);
        },
    );

    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s → `isSystem` bypasses, matching every other capability gate on the platform',
        async (_label, door) => {
            const stack = boot({ isSystem: true });
            const out = await stack.knock(door);
            expect(out.status).not.toBe(403);
            expect(stack.calls[door.protocolMethod]).toBe(1);
        },
    );

    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s → the shipped `admin_full_access` shape works (the Studio designer)',
        async (_label, door) => {
            // `admin_full_access` is the only shipped set carrying `studio.access`,
            // and it carries `manage_metadata` too — so the Studio save→publish
            // loop, which saves `?mode=draft` and then POSTs `/publish`, clears
            // BOTH steps on the same capability. This is why gating publish
            // cannot break that loop: its first step was already gated.
            const stack = boot({
                userId: 'u_admin',
                systemPermissions: ['manage_metadata', 'setup.access', 'studio.access'],
            });
            const out = await stack.knock(door);
            expect(out.status).not.toBe(403);
            expect(stack.calls[door.protocolMethod]).toBe(1);
        },
    );
});

describe('#8919 — the umbrella still answers first for anonymous callers', () => {
    // Documents the LAYERING measured on this surface: the capability gate is
    // the second layer, not the only one. Pinned so a future refactor of
    // `registerMetadataEndpoints` cannot quietly turn a 401 into a 403 (which
    // would tell an anonymous prober that the door exists and is capability-
    // gated) — or, worse, into a 200.
    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s → 401 UNAUTHENTICATED from the /meta umbrella, protocol never reached',
        async (_label, door) => {
            const stack = boot(undefined);
            const out = await stack.knock(door);
            expect(out.status).toBe(401);
            expect(stack.calls[door.protocolMethod]).toBe(0);
        },
    );
});

describe('#8919 — the two new gates refuse BEFORE the protocol is probed', () => {
    // 403-vs-501 must not tell an unauthorized caller which kernels implement
    // publishing or rollback — the same discipline the save door documents.
    let saw: string[] = [];
    beforeEach(() => { saw = []; });

    it.each([
        ['publish', `${META}/:type/:name/publish`, {}],
        ['rollback', `${META}/:type/:name/rollback`, { toVersion: 1 }],
    ] as const)('%s answers 403 on a kernel that implements neither', async (_verb, path, body) => {
        // A protocol with NO publish/rollback method at all: an authorized
        // caller would get 501 here, an unauthorized one must not be able to
        // tell the two kernels apart.
        const protocol: any = {
            getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
            getMetaTypes: vi.fn().mockResolvedValue([]),
            getMetaItems: vi.fn().mockResolvedValue([]),
            getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'account', item: {}, lock: 'none' }),
            findData: vi.fn().mockResolvedValue([]),
            getData: vi.fn().mockResolvedValue({}),
            createData: vi.fn().mockResolvedValue({ id: '1' }),
            updateData: vi.fn().mockResolvedValue({}),
            deleteData: vi.fn().mockResolvedValue({ success: true }),
        };
        const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'u_portal', systemPermissions: [] });
        rest.registerRoutes();
        const route = (rest as any).getRoutes().find((r: any) => r.method === 'POST' && r.path === path);
        const res = mockRes();
        await route.handler({
            method: 'POST', path, params: { type: 'object', name: 'account' },
            query: {}, headers: {}, body,
        }, res);
        saw.push(String(res.statusCode));
        expect(res.statusCode).toBe(403);
        expect(res.json.mock.calls.at(-1)?.[0]).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });
});
