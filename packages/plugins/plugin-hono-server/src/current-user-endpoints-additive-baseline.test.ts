// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7608 — the deployment baseline is ADDITIVE on the UI plane (ADR-0090 D5).
//
// Both resolutions in `current-user-endpoints.ts` used to apply the baseline
// permission set(s) only in a SECOND `resolvePermissionSets` call gated on
// `resolved.length === 0` — the fallback CLIFF D5 abolishes: "the first real
// grant silently removes the user's baseline". `SecurityPlugin.resolve-
// PermissionSetsForContext` (the DATA plane, one call away) has pushed the
// baseline into `requested` and resolved once for as long as D5 has existed, so
// the two planes disagreed the moment a member held any explicit grant at all.
//
// ## What these cases measure
//
// The accept bar for this fix is the USER-VISIBLE effect, not the guard. Every
// case here therefore drives the real HTTP surface and counts what a member
// SEES — apps in `/me/apps`, capabilities and object/field access in
// `/auth/me/permissions` — for two members who differ in exactly one thing:
// whether they hold one explicit permission-set grant.
//
//   zero-grant member  → baseline applies (this was already true; pinned so a
//                        regression cannot "fix" the cliff by deleting the
//                        baseline outright, which would pass every case below
//                        that only asserts the one-grant member gained things)
//   one-grant  member  → baseline ∪ explicit (this is the fix)
//
// The pre-fix numbers, measured on the parent commit with these same fixtures:
// the one-grant member saw 1 app (`exports`), 1 capability, and no baseline
// object/field access — while the zero-grant member saw 2 apps (`home`,
// `reports`). Receiving the grant COST that member two apps. The delta these
// cases now pin is +2 apps, +2 capabilities, +1 readable object, +1 readable
// field, all recovered.
//
// ## Why the baseline must arrive as a SERVICE here, not as an `everyone` row
//
// `resolveUserAuthzGrants` already expands the implicit `everyone` position and
// whatever is bound to it — that path was never on the cliff, and a fixture
// that delivered the baseline that way would pass before and after the fix.
// The deployment baseline is a different channel: SecurityPlugin registers
// `security.baselinePermissionSets` (#7555 — the app-declared baseline composed
// with the platform `member_default`), and `baselinePermissionSetNames` is the
// only thing that reads it. That channel is the one the cliff gated, so these
// fixtures bind the baseline set to NO position and supply it as the service.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const ME_APPS = '/api/v1/me/apps';

const USER = 'usr_member';
const ACTIVE_ORG = 'org_active';

/** The deployment baseline set — reachable ONLY via `security.baselinePermissionSets`. */
const BASELINE = 'member_default';
/** The one explicit grant that used to cost the member the baseline. */
const EXPLICIT = 'showcase_ops';

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
    return Object.entries(where ?? {}).every(([key, cond]) => {
        const value = row[key] ?? null;
        if (cond && typeof cond === 'object' && Array.isArray((cond as any).$in)) {
            return (cond as any).$in.includes(value);
        }
        return value === (cond ?? null);
    });
}

function makeQl(tables: Record<string, Row[]>) {
    return {
        find: async (object: string, opts: any) => {
            const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
            return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
        },
        registry: { getAllApps: () => tables.__apps ?? [], getAllObjects: () => [] },
        getSchema: () => undefined,
    };
}

/** A `sys_permission_set` row, JSON columns stored as text like the real table. */
function permissionSet(
    id: string,
    name: string,
    grant: {
        systemPermissions?: string[];
        tabPermissions?: Record<string, string>;
        objects?: Record<string, unknown>;
        fields?: Record<string, unknown>;
    },
): Row {
    return {
        id,
        name,
        object_permissions: JSON.stringify(grant.objects ?? {}),
        field_permissions: JSON.stringify(grant.fields ?? {}),
        system_permissions: JSON.stringify(grant.systemPermissions ?? []),
        tab_permissions: JSON.stringify(grant.tabPermissions ?? {}),
    };
}

/**
 * plugin-security's `PermissionEvaluator`, on the DB-backed branch this caller
 * exercises. plugin-hono-server must not depend on plugin-security (OPTIONAL in
 * the stacks these endpoints serve), so the double covers the one method both
 * handlers call — and it records every identifier list it is handed, which is
 * how the cases below can also state the mechanism (one call, baseline inside)
 * alongside the user-visible count.
 */
function makeEvaluator() {
    const calls: string[][] = [];
    return {
        calls,
        resolvePermissionSets: async (
            identifiers: string[],
            _metadata: unknown,
            _bootstrap: unknown[] | undefined,
            dbLoader?: (names: string[]) => Promise<unknown[]>,
        ) => {
            calls.push([...identifiers]);
            return dbLoader ? dbLoader(identifiers) : [];
        },
    };
}

const metadata = { list: async () => [] as unknown[] };

/**
 * The fixture: one member of one org, four apps, and a baseline set bound to no
 * position. `explicitGrant` is the ONLY axis — it adds a single
 * `sys_user_permission_set` row, the "first real grant" D5 names.
 */
function mount({ explicitGrant, baseline = [BASELINE], grantedSetId = 'ps_ops' }: {
    explicitGrant: boolean;
    /** The registered `security.baselinePermissionSets`; `null` = slot unclaimed. */
    baseline?: string[] | null;
    /** Which set the explicit grant binds — `ps_baseline` for the overlap case. */
    grantedSetId?: 'ps_ops' | 'ps_baseline';
}) {
    const tables: Record<string, Row[]> = {
        sys_user: [{ id: USER, email: 'member@example.com' }],
        sys_member: [{ user_id: USER, organization_id: ACTIVE_ORG, role: 'member' }],
        sys_user_position: [],
        sys_user_permission_set: explicitGrant
            ? [{ id: 'ups1', user_id: USER, permission_set_id: grantedSetId, organization_id: ACTIVE_ORG }]
            : [],
        // Deliberately EMPTY: nothing binds the baseline to `everyone`, so the
        // service channel is the only way it can reach the response.
        sys_position: [],
        sys_position_permission_set: [],
        sys_permission_set: [
            permissionSet('ps_baseline', BASELINE, {
                systemPermissions: ['home.access', 'reports.view'],
                tabPermissions: { home: 'visible', reports: 'visible' },
                objects: { sys_dashboard: { allowRead: true } },
                fields: { 'sys_dashboard.title': { readable: true, editable: false } },
            }),
            permissionSet('ps_ops', EXPLICIT, {
                systemPermissions: ['showcase.export_data'],
                tabPermissions: { exports: 'visible' },
                objects: { showcase_order: { allowRead: true } },
                fields: { 'showcase_order.total': { readable: true, editable: true } },
            }),
        ],
        __apps: [
            { name: 'home', requiredPermissions: ['home.access'] },
            { name: 'reports', requiredPermissions: ['reports.view'] },
            { name: 'exports', requiredPermissions: ['showcase.export_data'] },
            // The control: no grant anywhere reaches it, so it must stay out
            // of every answer — a baseline applied too WIDELY fails here.
            { name: 'billing', requiredPermissions: ['billing.manage'] },
        ],
    };
    const evaluator = makeEvaluator();
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => ({
                    user: { id: USER, email: 'member@example.com' },
                    session: { activeOrganizationId: ACTIVE_ORG },
                }),
            },
        },
        objectql: makeQl(tables),
        metadata,
        'security.permissions': evaluator,
    };
    // [#7555] The composed baseline, as SecurityPlugin registers it. Omitted
    // entirely for the unclaimed-slot case, where the locator THROWS (as the
    // real kernel's does) and `baselinePermissionSetNames` falls back.
    if (baseline !== null) services['security.baselinePermissionSets'] = baseline;
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
    return { app, evaluator };
}

const permissionsOf = async (app: any) =>
    (await app.request(`http://localhost${ME_PERMISSIONS}`)).json() as Promise<any>;

const appNamesOf = async (app: any) => {
    const body = await (await app.request(`http://localhost${ME_APPS}`)).json() as any;
    return (body.apps as any[]).map((a) => a.name).sort();
};

describe('/me/apps — the baseline survives the first explicit grant (#7608)', () => {
    it('a member with ZERO grants gets the baseline (unchanged by this fix)', async () => {
        // The half that always worked, because the cliff's own guard let it
        // through. Pinned so the fix cannot be "achieved" by dropping the
        // baseline everywhere — that would leave this member with 0 apps.
        const { app } = mount({ explicitGrant: false });

        expect(await appNamesOf(app)).toEqual(['home', 'reports']);
    });

    it('a member with ONE explicit grant KEEPS the baseline and gains their own', async () => {
        // THE regression. Pre-fix this answered `['exports']`: `resolved` was
        // non-empty, so the cliff withheld the baseline entirely and the member
        // LOST `home` and `reports` by being granted something.
        const { app } = mount({ explicitGrant: true });

        expect(await appNamesOf(app)).toEqual(['exports', 'home', 'reports']);
    });

    it('the measurement: the grant ADDS an app instead of costing two', async () => {
        // The number the card asks for, computed rather than asserted by hand —
        // stated as a delta between the two members so the direction is on the
        // record. Pre-fix this delta was -1 (2 apps → 1); it is now +1 (2 → 3),
        // with the two baseline apps retained rather than traded away.
        const zero = await appNamesOf(mount({ explicitGrant: false }).app);
        const one = await appNamesOf(mount({ explicitGrant: true }).app);

        const recovered = zero.filter((name) => one.includes(name));
        expect(recovered).toEqual(['home', 'reports']);
        expect(one.length - zero.length).toBe(1);
        // The control never appears for either member.
        expect(one).not.toContain('billing');
    });

    it('resolves ONCE, with the baseline inside the request (no second, gated call)', async () => {
        // The mechanism behind the counts above: the baseline is an INPUT to
        // the single resolution, not a consolation prize for resolving to
        // nothing. Asserting the call shape here is what lets the cases above
        // stay about apps.
        const { app, evaluator } = mount({ explicitGrant: true });
        await app.request(`http://localhost${ME_APPS}`);

        expect(evaluator.calls).toHaveLength(1);
        expect(evaluator.calls[0]).toContain(BASELINE);
        expect(evaluator.calls[0]).toContain(EXPLICIT);
    });

    it('does not duplicate a baseline name the caller already holds explicitly', async () => {
        // A member granted the baseline set DIRECTLY must not have it pushed a
        // second time: `resolvePermissionSets` would merge the same set into
        // itself, and the DB loader's `limit: names.length` would over-read.
        // The plugin's copy guards this with `if (!requested.includes(name))`;
        // this is the case that keeps the guard honest here.
        const { app, evaluator } = mount({ explicitGrant: true, grantedSetId: 'ps_baseline' });
        await app.request(`http://localhost${ME_APPS}`);

        const requested = evaluator.calls[0];
        expect(requested).toContain(BASELINE);
        expect(requested.filter((n) => n === BASELINE)).toHaveLength(1);
        expect(await appNamesOf(app)).toEqual(['home', 'reports']);
    });
});

describe('/auth/me/permissions — the same rule on the object/field surface (#7608)', () => {
    it('a member with ZERO grants reports the baseline (unchanged by this fix)', async () => {
        const body = await permissionsOf(mount({ explicitGrant: false }).app);

        expect(body.authenticated).toBe(true);
        expect(body.permissionSets).toEqual([BASELINE]);
        expect(body.objects.sys_dashboard?.allowRead).toBe(true);
        expect(body.systemPermissions.sort()).toEqual(['home.access', 'reports.view']);
    });

    it('a member with ONE explicit grant reports baseline ∪ explicit', async () => {
        // Pre-fix: `permissionSets: ['showcase_ops']`, no `sys_dashboard`, no
        // `home.access` — the endpoint reporting object access NARROWER than
        // the read it describes, since the data plane kept the baseline.
        const body = await permissionsOf(mount({ explicitGrant: true }).app);

        expect(body.permissionSets.sort()).toEqual([BASELINE, EXPLICIT].sort());
        // Baseline access, retained through the grant.
        expect(body.objects.sys_dashboard?.allowRead).toBe(true);
        expect(body.fields['sys_dashboard.title']?.readable).toBe(true);
        expect(body.systemPermissions).toContain('home.access');
        expect(body.systemPermissions).toContain('reports.view');
        expect(body.tabPermissions.home).toBe('visible');
        // …alongside the explicit grant, which must not be displaced either.
        expect(body.objects.showcase_order?.allowRead).toBe(true);
        expect(body.fields['showcase_order.total']?.editable).toBe(true);
        expect(body.systemPermissions).toContain('showcase.export_data');
    });

    it('the measurement: the grant costs the member NO object, field or capability', async () => {
        const zero = await permissionsOf(mount({ explicitGrant: false }).app);
        const one = await permissionsOf(mount({ explicitGrant: true }).app);

        const lost = (a: string[], b: string[]) => a.filter((k) => !b.includes(k));
        expect(lost(Object.keys(zero.objects), Object.keys(one.objects))).toEqual([]);
        expect(lost(Object.keys(zero.fields), Object.keys(one.fields))).toEqual([]);
        expect(lost(zero.systemPermissions, one.systemPermissions)).toEqual([]);
        // …and it strictly adds: +1 object, +1 field, +1 capability.
        expect(Object.keys(one.objects).length - Object.keys(zero.objects).length).toBe(1);
        expect(Object.keys(one.fields).length - Object.keys(zero.fields).length).toBe(1);
        expect(one.systemPermissions.length - zero.systemPermissions.length).toBe(1);
    });

    it('resolves ONCE here too, with the baseline inside the request', async () => {
        const { app, evaluator } = mount({ explicitGrant: true });
        await app.request(`http://localhost${ME_PERMISSIONS}`);

        expect(evaluator.calls).toHaveLength(1);
        expect(evaluator.calls[0]).toContain(BASELINE);
        expect(evaluator.calls[0]).toContain(EXPLICIT);
    });
});

describe('the baseline is a floor, not a licence (#7608)', () => {
    it('a deployment declaring an EMPTY baseline resolves the explicit grant alone', async () => {
        // The additive push must degrade to a plain resolution when there is
        // nothing to add — not throw, and not invent `member_default` on a
        // deployment that deliberately declared none.
        const { app, evaluator } = mount({ explicitGrant: true, baseline: [] });

        expect(await appNamesOf(app)).toEqual(['exports']);
        expect(evaluator.calls[0]).not.toContain(BASELINE);
    });

    it('an UNCLAIMED baseline slot still applies the `member_default` default, additively', async () => {
        // No SecurityPlugin baseline registration at all: `getService` throws,
        // both reads in `baselinePermissionSetNames` fall through, and the bare
        // `member_default` default stands — which in this fixture IS the
        // baseline set, so the member keeps it through their grant.
        const { app } = mount({ explicitGrant: true, baseline: null });

        expect(await appNamesOf(app)).toEqual(['exports', 'home', 'reports']);
    });

    it('an app whose requiredPermissions nobody holds stays filtered for both members', async () => {
        // The fail-direction guard: widening the baseline must not turn
        // `/me/apps` into a fail-open list.
        expect(await appNamesOf(mount({ explicitGrant: false }).app)).not.toContain('billing');
        expect(await appNamesOf(mount({ explicitGrant: true }).app)).not.toContain('billing');
    });
});
