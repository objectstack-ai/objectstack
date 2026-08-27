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
 * ## [#11473] "the server registers" means every MOUNT BASE, not one
 *
 * `RestServer.registerRoutes` calls `registerForBase(...)` once per base, so
 * with `api.enableProjectScoping` on, the same door set is mounted a second time
 * under `/api/v1/environments/:environmentId`. The derivation above used to
 * filter the route table on a literal `/api/v1/meta` prefix, which no scoped
 * door can match — a filter whose blind spot was precisely the population it
 * exists to enumerate, and invisible from inside the assertion because the only
 * boot here was an unscoped one, for which the filter is complete. It now
 * matches the `meta` path SEGMENT and the expectation is built per base, so the
 * closed-set claim is checked against every mount the composition brings up.
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
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import { RestServer } from './rest-server.js';

/**
 * The unscoped mount base, and the `/meta` prefix on it. The `DOORS` table
 * below is written against `META`; every other mount is derived from it by
 * {@link onBase}.
 */
const UNSCOPED_BASE = '/api/v1';
const META = `${UNSCOPED_BASE}/meta`;

/**
 * [#11473] The environment-scoped mount base.
 *
 * `registerRoutes` calls `registerForBase(...)` **once per base**, and
 * `registerMetadataEndpoints` is one of the registrars it calls — so the whole
 * door set is mounted a SECOND time under this prefix whenever
 * `api.enableProjectScoping` is true. Measured by the boots below: 5 write
 * doors with scoping off, 10 with `projectResolution: 'auto'`, and 5 — the
 * scoped ones ONLY — with `'required'`.
 */
const SCOPED_BASE = `${UNSCOPED_BASE}/environments/:environmentId`;

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
 * The metadata write doors, as registered by `registerMetadataEndpoints` — five
 * of them since #12195 retired the compound-name save (the count is the table's
 * own length, never a number written in prose: it read "six" for as long as it
 * took #12195 to remove an entry without touching this sentence).
 *
 * Four carried the gate before #8919 (`_migrate-stored` #4857-era, the single
 * and compound saves #6603/#7019, the reset #7019); `publish` and `rollback`
 * are the two that card added.
 *
 * ⚠️ This table is COMPARED against the server's own route table below — do not
 * add a door here without adding its refusal case, and do not add a mutating
 * `/meta` route to the server without adding it here. The comparison is made
 * once PER MOUNT BASE (see {@link onBase}), so a door is enumerated on every
 * base the composition mounts it on, not only on `/api/v1`.
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
    // [#12195] `PUT /meta/:type/:section/:name — compound-name save` was
    // enumerated here until its arity was retired. It reached the same
    // `saveMetaItem` as the single-segment save above and carried the same
    // capability gate, so the door set loses a spelling, not a capability.
];

/** Every protocol method any door reaches — all present, so 501 is never the answer. */
const PROTOCOL_METHODS = [...new Set(DOORS.map((d) => d.protocolMethod))];

/**
 * [#11473] A `/meta` route on ANY mount base — matched on the `meta` path
 * SEGMENT, deliberately not on a `/api/v1/meta` prefix.
 *
 * The prefix spelling is what this file used until #11473, and its blind spot
 * was exactly the population the enumeration exists to enumerate: a scoped door
 * is mounted at `/api/v1/environments/:environmentId/meta/...`, which does not
 * start with `/api/v1/meta`. Because the only boot here was an unscoped one,
 * the filter was complete FOR THAT BOOT and the gap could not be seen from
 * inside the assertion it silently narrowed. Measured before the change, on the
 * three compositions the tests below now boot: the prefix filter derived 5, 5
 * and 0 doors where 5, 10 and 5 are mounted — so under
 * `projectResolution: 'required'` the "closed, enumerated set" was being
 * asserted over the EMPTY set while five real write doors were live.
 *
 * Over-inclusive by intent: this filter's job is to force a new mutating meta
 * route to be enumerated, so catching one route too many costs an explicit
 * table entry, while catching one too few costs the whole assertion.
 */
const META_SEGMENT = /(?:^|\/)meta(?:\/|$)/;

/**
 * The same door, addressed on another mount base
 * (`/api/v1/meta/...` → `/api/v1/environments/:environmentId/meta/...`).
 */
function onBase(door: Door, base: string): string {
    return `${base}${door.path.slice(UNSCOPED_BASE.length)}`;
}

/** Every door, on every base the composition under test mounts. */
function expectedDoors(bases: readonly string[]): string[] {
    return bases
        .flatMap((base) => DOORS.map((d) => `${d.method} ${onBase(d, base)}`))
        .sort();
}

/**
 * [#11473] The scoping half of the composition under test. Omitted → the
 * platform default, which is `enableProjectScoping: false` (`rest-server.ts`,
 * `api.enableProjectScoping ?? false`) and therefore a single unscoped mount.
 */
interface Composition {
    readonly enableProjectScoping?: boolean;
    readonly projectResolution?: 'required' | 'optional' | 'auto';
}

function boot(context: Record<string, unknown> | undefined, composition: Composition = {}) {
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

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false, ...composition } } as any,
    );
    (rest as any).resolveExecCtx = async () => context;
    rest.registerRoutes();

    return {
        rest,
        calls,
        /**
         * [#12702] The protocol double itself, so a case can assert WHAT an
         * admitted call carried (the threaded organization), not only that it
         * happened.
         */
        protocol,
        /**
         * Every mutating `/meta` route the composed server actually registers —
         * on EVERY base it registered one on (see {@link META_SEGMENT}).
         */
        registeredWriteDoors: () => (rest as any).getRoutes()
            .filter((r: any) => typeof r.path === 'string'
                && META_SEGMENT.test(r.path)
                && r.method !== 'GET')
            .map((r: any) => `${r.method} ${r.path}`)
            .sort(),
        /**
         * Drive one door as the composed server would route it. `base` selects
         * the mount: the scoped one needs an `environmentId` path param, which
         * is also what makes a scoped knock a REAL knock rather than a second
         * boot that never routes anything (#11373's shape, one layer out).
         */
        knock: async (door: Door, base: string = UNSCOPED_BASE) => {
            const path = onBase(door, base);
            const params = base === UNSCOPED_BASE
                ? door.params
                : { environmentId: 'env_probe', ...door.params };
            const route = (rest as any).getRoutes().find(
                (r: any) => r.method === door.method && r.path === path,
            );
            if (!route) throw new Error(`route not registered: ${door.method} ${path}`);
            const res = mockRes();
            await route.handler({
                method: door.method,
                path: path.replace(/:(\w+)/g, (_m: string, k: string) => params[k] ?? k),
                params,
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
        expect(stack.registeredWriteDoors()).toEqual(expectedDoors([UNSCOPED_BASE]));
    });
});

describe('#11473 — "CLOSED, enumerated set" holds for EVERY base, not just the one this file boots', () => {
    // The claim above this file's name is global; the derivation that backed it
    // was not. `registerRoutes` mounts the door set once per base, and the only
    // composition anyone booted here was the default one — so the assertion was
    // true about `/api/v1` and silent about everything else. These cases boot
    // the other two compositions the server can actually be configured into.
    //
    // ⚠️ LATENT, not live: `enableProjectScoping` defaults to `false`, so a
    // default deployment mounts none of the scoped doors and an anonymous probe
    // of one 404s (`ENDPOINT_NOT_FOUND`). What is being closed here is a
    // coverage gap in an anti-drift assertion, not a reachable hole.

    it("'auto' mounts BOTH bases, and both are enumerated", () => {
        const stack = boot(
            { userId: 'u', systemPermissions: [] },
            { enableProjectScoping: true, projectResolution: 'auto' },
        );
        const doors = stack.registeredWriteDoors();
        expect(doors).toEqual(expectedDoors([UNSCOPED_BASE, SCOPED_BASE]));
        // Stated as a count too, because the number is the part that regressed:
        // the pre-#11473 prefix filter saw 5 of these 10.
        expect(doors).toHaveLength(DOORS.length * 2);
    });

    it("'required' mounts ONLY the scoped base — the case a `/api/v1/meta` prefix filter enumerated as empty", () => {
        // The sharpest reading of the blind spot. Under `required`,
        // `registerForBase` is called with the scoped base and nothing else, so
        // a prefix filter anchored at `/api/v1/meta` derives ZERO doors and the
        // anti-drift comparison would have been asserting a closed set over an
        // empty one while five real write doors were mounted.
        const stack = boot(
            { userId: 'u', systemPermissions: [] },
            { enableProjectScoping: true, projectResolution: 'required' },
        );
        const doors = stack.registeredWriteDoors();
        expect(doors).toEqual(expectedDoors([SCOPED_BASE]));
        expect(doors).toHaveLength(DOORS.length);
        expect(doors.every((d: string) => d.includes(SCOPED_BASE))).toBe(true);
        // And nothing is left on the unscoped base to fall back to.
        expect(doors.some((d: string) => d.includes(`${META}/`))).toBe(false);
    });
});

describe('#11473 — the scoped mount really ROUTES, and refuses on the same terms', () => {
    // One probe, not a second copy of the matrix above, and the reason is
    // structural rather than economical: `registerMetadataEndpoints` swaps in a
    // guarded registrar, calls `registerMetadataEndpointsInner(basePath)` inside
    // the swap, and restores it in a `finally` — so the umbrella wraps whatever
    // that body registers, and the body is the same body on both passes. The
    // per-door capability gates live in that same body. There is no seam at
    // which the two mounts could carry different gates.
    //
    // What is NOT structural, and is therefore what these cases actually buy:
    // that a request addressed to the scoped path is routed at all. A scoping-on
    // fixture that boots but never routes into the scoped mount would pass while
    // measuring nothing — the failure shape #11373 found one layer down. Each
    // case below resolves a real route object by its scoped path and invokes it.

    const SCOPED_DOORS = DOORS.map((d) => [`${d.label} @ scoped`, d] as const);

    it.each(SCOPED_DOORS)(
        '%s → anonymous gets the flat anonymous-deny envelope, protocol never reached',
        async (_label, door) => {
            const stack = boot(undefined, { enableProjectScoping: true, projectResolution: 'auto' });
            const out = await stack.knock(door, SCOPED_BASE);
            // The `/data` + `/meta` family answers the FLAT envelope
            // (`{ error, code, message }`), not the wrapped one — both are live
            // and sanctioned per ADR-0112's 2026-07-30 amendment, and the rule
            // is to assert the envelope the seam DECLARES rather than a chain
            // that swallows either.
            expect(out.status).toBe(ANONYMOUS_DENY_STATUS);
            expect(out.body).toMatchObject({ code: ANONYMOUS_DENY_CODE });
            expect(stack.calls[door.protocolMethod]).toBe(0);
        },
    );

    it.each(SCOPED_DOORS)(
        '%s → a capability-less caller gets 403 FORBIDDEN, protocol never reached',
        async (_label, door) => {
            const stack = boot(
                { userId: 'u_portal', systemPermissions: [] },
                { enableProjectScoping: true, projectResolution: 'auto' },
            );
            const out = await stack.knock(door, SCOPED_BASE);
            expect(out.status).toBe(403);
            expect(out.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
            expect(stack.calls[door.protocolMethod]).toBe(0);
        },
    );

    it.each(SCOPED_DOORS)(
        '%s → the control: a `manage_metadata` holder reaches the protocol through the scoped path',
        async (_label, door) => {
            // Without this, the two refusals above cannot be told apart from a
            // scoped mount that refuses everything for the wrong reason (an
            // unrouted path, a missing param, a 404). The protocol call count
            // going from 0 to 1 on the SAME scoped path is what proves the
            // refusals were decisions and not accidents.
            const stack = boot(
                { userId: 'u_author', systemPermissions: ['manage_metadata'] },
                { enableProjectScoping: true, projectResolution: 'auto' },
            );
            const out = await stack.knock(door, SCOPED_BASE);
            expect(out.status).not.toBe(403);
            expect(out.status).not.toBe(ANONYMOUS_DENY_STATUS);
            expect(stack.calls[door.protocolMethod]).toBe(1);
        },
    );
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

/**
 * [#12702] `manage_org_presentation` across the door set — the org-scoped
 * presentation capability, run against EVERY enumerated door rather than one.
 *
 * The four ITEM doors (save / reset / publish / rollback) share one verdict
 * (`metaWriteCapabilityVerdict`, `@objectstack/metadata-core`): beside
 * `manage_metadata` they admit `manage_org_presentation`, ONLY for a type
 * whose registry entry declares `allowOrgOverride: true` AND a session with an
 * active organization — which is the organization each door threads, so an
 * admitted write can only land in the caller's own org partition.
 * `_migrate-stored` is the deliberate exclusion: an install-wide rewrite is
 * env-wide by definition, so the org condition can never hold there.
 */
describe('#12702 — `manage_org_presentation`: org-scoped tier-A admission, per door', () => {
    const ORG = 'org_a';
    const ORG_ADMIN = { userId: 'u_orgadmin', systemPermissions: ['manage_org_presentation'], tenantId: ORG };
    const ORG_ADMIN_NO_ORG = { userId: 'u_orgadmin', systemPermissions: ['manage_org_presentation'] };

    /** The doors the org capability may open — everything but the install-wide rewrite. */
    const ITEM_DOORS = DOORS.filter((d) => d.protocolMethod !== 'migrateStoredMetadata');
    const MIGRATE_DOOR = DOORS.find((d) => d.protocolMethod === 'migrateStoredMetadata')!;

    /** The same door, addressed at a tier-A type (`view` declares allowOrgOverride). */
    const asView = (door: Door): Door => ({
        ...door,
        params: { ...door.params, type: 'view', name: 'org_grid' },
        body: door.protocolMethod === 'saveMetaItem'
            ? { name: 'org_grid', label: 'Org Grid' }
            : door.body,
    });

    it.each(ITEM_DOORS.map((d) => [d.label, d] as const))(
        '%s → an org-active holder is admitted for a tier-A type, threaded to their OWN organization',
        async (_label, door) => {
            const stack = boot(ORG_ADMIN);
            const out = await stack.knock(asView(door));
            expect(out.status).not.toBe(403);
            expect(out.status).not.toBe(401);
            expect(stack.calls[door.protocolMethod]).toBe(1);
            // The threading IS the wall: the only organization an admitted
            // write can carry is the caller's own active one.
            const request = (stack.protocol[door.protocolMethod] as any).mock.calls[0][0];
            expect(request).toMatchObject({ organizationId: ORG });
        },
    );

    it.each(ITEM_DOORS.map((d) => [d.label, d] as const))(
        '%s → the SAME holder is refused a tier-B write (`object`), protocol never reached',
        async (_label, door) => {
            const stack = boot(ORG_ADMIN);
            const out = await stack.knock(door); // the table's own params: type 'object'
            expect(out.status).toBe(403);
            expect(out.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
            expect(stack.calls[door.protocolMethod]).toBe(0);
        },
    );

    it.each(ITEM_DOORS.map((d) => [d.label, d] as const))(
        '%s → the SAME holder with NO active organization is refused a tier-A write — env-wide is walled',
        async (_label, door) => {
            const stack = boot(ORG_ADMIN_NO_ORG);
            const out = await stack.knock(asView(door));
            expect(out.status).toBe(403);
            expect(out.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
            expect(stack.calls[door.protocolMethod]).toBe(0);
        },
    );

    it(`${MIGRATE_DOOR.label} → stays \`manage_metadata\`-only for an org-active holder (env-wide by definition)`, async () => {
        const stack = boot(ORG_ADMIN);
        const out = await stack.knock(MIGRATE_DOOR);
        expect(out.status).toBe(403);
        expect(out.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
        expect(stack.calls[MIGRATE_DOOR.protocolMethod]).toBe(0);
    });
});
