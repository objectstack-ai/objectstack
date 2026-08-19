// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7616 — `/auth/me/permissions` and `/me/apps` DELEGATE permission-set
// resolution instead of re-implementing it.
//
// Both handlers used to resolve the caller's sets themselves: compose the
// requested names (positions ∪ explicit sets ∪ the deployment baseline), build a
// `sys_permission_set` DB loader, call the evaluator. That made one rule three
// copies — the enforcement path's, and one per endpoint — and it drifted three
// times, each divergence found only after it reached a user (#7608, #7555,
// #6334). They now call `ISecurityService.resolvePermissionSetsForContext` on
// the `security` service, which is the enforcement path's own resolution.
//
// ## The two absences, which are NOT the same absence
//
// The contract declares the method OPTIONAL, and this file must go on serving
// stacks with no SecurityPlugin at all — it is optional in the compositions
// these endpoints serve, and taking a runtime dependency on it is the one thing
// the card forbids outright. So:
//
//   "present but too old to carry the method"  → the local fallback for it is
//                                                DELETED (the method ships in
//                                                @objectstack/spec@17.0.0)
//   "absent entirely"                          → the degraded branches STAY
//
// The cases below pin both, and pin that the second did not quietly become the
// first: absence must still produce a defined degraded answer, never a throw and
// never a hard dependency.
//
// ## The third state, which the two-absence framing does not name
//
// SecurityPlugin registers `security.permissions` in `init()` but the `security`
// service only in `start()` — which RETURNS EARLY on an engine that cannot take
// middleware. A stack in that state has the internal handle and no published
// service, AND no security middleware at all, so its data plane enforces
// nothing. Keying the degraded branch on the published service (rather than on
// the internal handle) is what makes the UI plane agree with that: see the
// `start() bailed` case below for the before/after this changed.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const ME_APPS = '/api/v1/me/apps';
const USER = 'usr_member';
const ACTIVE_ORG = 'org_active';
const GRANTED = 'showcase_ops';

type Row = Record<string, any>;

/** The sets a resolver hands back — whole, as the contract publishes them. */
const RESOLVED = [
    {
        name: GRANTED,
        label: 'Showcase Ops',
        systemPermissions: ['showcase.export_data'],
        tabPermissions: { exports: 'visible' },
        // The columns `/me/apps` never projected out of its own DB loader.
        // Delegating loads them; nothing here may put them on that wire.
        objects: { showcase_order: { allowRead: true, allowEdit: true } },
        fields: { 'showcase_order.total': { readable: true, editable: true } },
    },
];

const APPS = [
    { name: 'exports', requiredPermissions: ['showcase.export_data'] },
    { name: 'billing', requiredPermissions: ['billing.manage'] },
    { name: 'open', requiredPermissions: [] },
];

/** `where` matcher: scalar equality plus the `$in` form the resolver sends. */
function matches(row: Row, where: Row | undefined): boolean {
    return Object.entries(where ?? {}).every(([key, cond]) => {
        // REFUSE an unsupported combinator rather than reading it as a field
        // name — a silent `false` here would look exactly like a row that did
        // not match, and the case above it would pass for the wrong reason.
        if (key.startsWith('$')) throw new Error(`fake driver: unsupported operator ${key}`);
        const value = row[key] ?? null;
        if (cond && typeof cond === 'object' && Array.isArray((cond as any).$in)) {
            return (cond as any).$in.includes(value);
        }
        return value === (cond ?? null);
    });
}

const TABLES: Record<string, Row[]> = {
    sys_user: [{ id: USER, email: 'member@example.com' }],
    sys_member: [{ user_id: USER, organization_id: ACTIVE_ORG, role: 'member' }],
    sys_user_position: [],
    sys_user_permission_set: [
        { id: 'ups1', user_id: USER, permission_set_id: 'ps_ops', organization_id: ACTIVE_ORG },
    ],
    sys_position: [],
    sys_position_permission_set: [],
    sys_permission_set: [{ id: 'ps_ops', name: GRANTED }],
};

const ql = {
    find: async (object: string, opts: any) => {
        const rows = (TABLES[object] ?? []).filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    registry: { getAllApps: () => APPS, getAllObjects: () => [] },
    getSchema: () => undefined,
};

/**
 * @param security what the `security` slot holds:
 *   'resolver'  — a service carrying the method (the ordinary stack);
 *   'throws'    — a service whose resolution FAILS (the contract's fail-closed
 *                 stance: "callers must fail CLOSED on a throw rather than
 *                 reading it as no sets");
 *   'too-old'   — a service WITHOUT the method;
 *   'unclaimed' — no `security` service at all.
 * @param internalHandle whether `security.permissions` is registered — the
 *   `init()`-time handle a degraded-start SecurityPlugin leaves behind.
 */
function mount({
    security,
    internalHandle = false,
}: {
    security: 'resolver' | 'throws' | 'too-old' | 'unclaimed';
    internalHandle?: boolean;
}) {
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => ({
                    user: { id: USER, email: 'member@example.com' },
                    session: { activeOrganizationId: ACTIVE_ORG },
                }),
            },
        },
        objectql: ql,
        metadata: { list: async () => [] as unknown[] },
    };
    if (security === 'resolver') {
        services.security = { resolvePermissionSetsForContext: async () => RESOLVED };
    } else if (security === 'throws') {
        services.security = {
            resolvePermissionSetsForContext: async () => {
                throw new Error('permission-set resolution failed');
            },
        };
    } else if (security === 'too-old') {
        // Every OTHER method of the contract, and not this one.
        services.security = { getReadFilter: async () => undefined, resolvePermissionSetNames: async () => [] };
    }
    if (internalHandle) {
        services['security.permissions'] = {
            resolvePermissionSets: async () => {
                throw new Error('the endpoints must not resolve permission sets themselves');
            },
        };
    }
    const app = new Hono();
    registerCurrentUserEndpoints({
        rawApp: app,
        ctx: {
            logger: { debug() {}, warn() {} },
            getService: <T,>(name: string): T => {
                if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services[name] as T;
            },
        },
    });
    return app;
}

const permissionsOf = async (app: any) =>
    (await app.request(`http://localhost${ME_PERMISSIONS}`)).json() as Promise<any>;
const appsBodyOf = async (app: any) =>
    (await app.request(`http://localhost${ME_APPS}`)).json() as Promise<any>;
const appNamesOf = async (app: any) =>
    ((await appsBodyOf(app)).apps as any[]).map((a) => a.name).sort();

describe('[#7616] the delegated resolution reaches both wires', () => {
    it('/auth/me/permissions projects the resolved sets it is handed', async () => {
        const body = await permissionsOf(mount({ security: 'resolver' }));

        expect(body.authenticated).toBe(true);
        expect(body.permissionSets).toEqual([GRANTED]);
        expect(body.objects.showcase_order?.allowRead).toBe(true);
        expect(body.fields['showcase_order.total']?.editable).toBe(true);
        expect(body.systemPermissions).toEqual(['showcase.export_data']);
        expect(body.tabPermissions).toEqual({ exports: 'visible' });
    });

    it('/me/apps filters on the SAME resolution', async () => {
        // `billing` is gated on a capability nobody holds, `open` on none.
        expect(await appNamesOf(mount({ security: 'resolver' }))).toEqual(['exports', 'open']);
    });

    it('the wider column set stays OFF the /me/apps wire', async () => {
        // THE measurement this card asked for. `/me/apps` used to fetch a
        // narrower projection of `sys_permission_set` (`name` +
        // `systemPermissions` + `tabPermissions`) than `/auth/me/permissions`
        // did; delegating means one resolution serves both, so the sets now
        // arrive here carrying `objects` and `fields` too.
        //
        // Loading them changes what is in MEMORY. This asserts it changes
        // nothing that reaches the CLIENT: the body is the app list and only
        // the app list, byte-identical to the registry's own rows, with no
        // permission-set column leaking through the filter.
        const body = await appsBodyOf(mount({ security: 'resolver' }));

        expect(Object.keys(body)).toEqual(['apps']);
        expect(body.apps).toEqual([
            { name: 'exports', requiredPermissions: ['showcase.export_data'] },
            { name: 'open', requiredPermissions: [] },
        ]);
        expect(JSON.stringify(body)).not.toContain('showcase_order');
        expect(JSON.stringify(body)).not.toContain('readable');
    });
});

describe('[#7616] absence #1 — a service too old to carry the method', () => {
    // The absence the released floor cleared. There is no local resolution left
    // to fall back to, and re-adding one is what these two cases forbid.
    it('/auth/me/permissions degrades rather than resolving locally', async () => {
        const body = await permissionsOf(mount({ security: 'too-old' }));

        expect(body.authenticated).toBe(true);
        expect(body.userId).toBe(USER);
        expect(body.objects).toEqual({});
        expect(body.fields).toEqual({});
    });

    it('/me/apps degrades rather than resolving locally', async () => {
        expect(await appNamesOf(mount({ security: 'too-old' }))).toEqual(
            ['billing', 'exports', 'open'],
        );
    });
});

describe('[#7616] absence #2 — no SecurityPlugin at all (KEPT)', () => {
    // plugin-hono-server must not take a runtime dependency on plugin-security.
    // These are the pre-existing degraded branches, unchanged: they answer
    // without any security service in the locator, and they answer 200.
    it('/auth/me/permissions answers empty-but-authenticated', async () => {
        const body = await permissionsOf(mount({ security: 'unclaimed' }));

        expect(body.authenticated).toBe(true);
        expect(body.userId).toBe(USER);
        expect(body.objects).toEqual({});
        expect(body.fields).toEqual({});
        // The capability/tab keys are ABSENT from this body rather than empty —
        // the frontend's fail-open cue, and how it tells "no answer" from "no
        // access". An empty object here would read as the latter.
        expect('systemPermissions' in body).toBe(false);
        expect('tabPermissions' in body).toBe(false);
    });

    it('/me/apps fails OPEN and lists every app', async () => {
        expect(await appNamesOf(mount({ security: 'unclaimed' }))).toEqual(
            ['billing', 'exports', 'open'],
        );
    });
});

describe('[#7616] the third state — SecurityPlugin present, start() bailed', () => {
    // `security.permissions` is registered in `init()`; the `security` service
    // only in `start()`, which returns early on an engine that cannot take
    // middleware — and that same early return is BEFORE the plugin registers
    // any middleware, so nothing is enforced on the data plane either.
    //
    // Measured before/after on this branch: this state used to answer with a
    // restrictive map and 1 of 3 apps, computed against enforcement that does
    // not exist — the console hiding what the API serves, which is the
    // fail-direction #7608 names as the worse one. It now degrades, which is
    // what the degraded branch's own premise ("matches server behaviour when
    // SecurityPlugin isn't registered") asks for.
    it('degrades on both surfaces, and never calls the internal handle', async () => {
        // The `security.permissions` double THROWS if called, so a resolution
        // routed back through the internal handle fails here rather than
        // silently resurrecting the copy this card deleted.
        const body = await permissionsOf(mount({ security: 'unclaimed', internalHandle: true }));
        expect(body.authenticated).toBe(true);
        expect(body.objects).toEqual({});

        expect(await appNamesOf(mount({ security: 'unclaimed', internalHandle: true }))).toEqual(
            ['billing', 'exports', 'open'],
        );
    });
});

describe('[#7616] a failed resolution fails CLOSED, as the contract requires', () => {
    // "Throws on resolution failure; callers must fail CLOSED on a throw rather
    // than reading it as no sets." A thrown resolution is NOT absence: absence
    // is a composition fact and fails open, failure is a runtime fault and must
    // not hand out access it could not verify.
    it('/auth/me/permissions reports no access', async () => {
        const body = await permissionsOf(mount({ security: 'throws' }));

        expect(body.authenticated).toBe(true);
        expect(body.objects).toEqual({});
        expect(body.fields).toEqual({});
        expect(body.systemPermissions).toEqual([]);
        expect(body.tabPermissions).toEqual({});
    });

    it('/me/apps keeps filtering — it does not widen to the full list', async () => {
        // The distinction that matters: `open` requires nothing and survives;
        // `exports` and `billing` are permission-gated and must not appear on a
        // resolution nobody completed.
        expect(await appNamesOf(mount({ security: 'throws' }))).toEqual(['open']);
    });
});
