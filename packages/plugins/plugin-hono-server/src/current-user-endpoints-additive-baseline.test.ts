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
// ## Why the baseline must arrive through the RESOLVER, not as an `everyone` row
//
// `resolveUserAuthzGrants` already expands the implicit `everyone` position and
// whatever is bound to it — that path was never on the cliff, and a fixture
// that delivered the baseline that way would pass before and after the fix.
// The deployment baseline is a different channel, so these fixtures bind the
// baseline set to NO position and let the resolver apply it.
//
// ## What #7616 changed about these cases, and what it did NOT
//
// The composition itself is no longer this file's: both handlers now delegate
// to `ISecurityService.resolvePermissionSetsForContext` on the `security`
// service — the enforcement path's own resolution — instead of composing the
// requested names and loading `sys_permission_set` themselves. So the ADDITIVE
// RULE is pinned where it now lives (plugin-security's own cases); the double
// below stands for the contract, not for the rule.
//
// What these cases still measure is the half that is genuinely this file's and
// is what a user sees: the endpoints hand the caller's context to that resolver
// and PROJECT the answer onto the wire correctly — apps in `/me/apps`,
// capabilities and object/field access in `/auth/me/permissions`. The counts
// below are therefore unchanged from the #7608 fix, and they are the reason a
// regression in the projection still fails here rather than in plugin-security.
// The delegation itself is pinned at the bottom of this file: one resolver
// call per request, the caller's context passed whole, and NONE of the
// `security.*` internal handles read.

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
        if (key.startsWith('$')) throw new Error(`fake driver: unsupported operator ${key}`);
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
 * [#7616] A stand-in for `ISecurityService.resolvePermissionSetsForContext` —
 * the ONE resolution both handlers delegate to. plugin-hono-server must not
 * depend on plugin-security (OPTIONAL in the stacks these endpoints serve), so
 * the double covers the one contract method both handlers call, and records
 * every context it is handed so the delegation cases can state the mechanism
 * alongside the user-visible counts.
 *
 * It reproduces exactly the two properties of the plugin's resolution these
 * cases stand on — requested = positions ∪ explicit sets ∪ baseline, ADDITIVE
 * and unconditional (ADR-0090 D5), and the sets returned WHOLE from
 * `sys_permission_set` — and nothing else. ⚠️ It is a stand-in, not the
 * authority: an assertion about the RULE belongs in plugin-security, where the
 * rule is. Everything asserted here is about what the endpoints do with the
 * answer.
 */
function makeSecurityService(rows: Row[], baseline: string[]) {
    const calls: any[] = [];
    const parse = (v: unknown, fallback: unknown) =>
        typeof v === 'string' ? JSON.parse(v || JSON.stringify(fallback)) : v ?? fallback;
    return {
        calls,
        service: {
            resolvePermissionSetsForContext: async (context: any) => {
                calls.push(context);
                const requested: string[] = [
                    ...(Array.isArray(context?.positions) ? context.positions : []),
                    ...(Array.isArray(context?.permissions) ? context.permissions : []),
                ];
                if (context?.userId) {
                    for (const name of baseline) {
                        if (!requested.includes(name)) requested.push(name);
                    }
                }
                // Resolution ORDER, like the plugin's: requested order, not row
                // order — the response's `permissionSets` array reports it.
                return requested.flatMap((name) =>
                    rows
                        .filter((r) => r.name === name)
                        .map((r) => ({
                            name: r.name,
                            label: r.label,
                            objects: parse(r.object_permissions, {}),
                            fields: parse(r.field_permissions, {}),
                            systemPermissions: parse(r.system_permissions, []),
                            tabPermissions: parse(r.tab_permissions, {}),
                        })),
                );
            },
        },
    };
}

const metadata = { list: async () => [] as unknown[] };

/**
 * The fixture: one member of one org, four apps, and a baseline set bound to no
 * position. `explicitGrant` is the ONLY axis — it adds a single
 * `sys_user_permission_set` row, the "first real grant" D5 names.
 */
function mount({
    explicitGrant,
    baseline = [BASELINE],
    grantedSetId = 'ps_ops',
    legacyHandles = true,
}: {
    explicitGrant: boolean;
    /** The deployment baseline the RESOLVER applies (its business since #7616). */
    baseline?: string[];
    /** Which set the explicit grant binds — `ps_baseline` for the overlap case. */
    grantedSetId?: 'ps_ops' | 'ps_baseline';
    /**
     * Whether the locator carries the `security.*` handles this file used to
     * resolve from. Present by DEFAULT, exactly as a real stack registers them,
     * so the cases below prove the answer no longer depends on them.
     */
    legacyHandles?: boolean;
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
    const security = makeSecurityService(tables.sys_permission_set, baseline);
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
        security: security.service,
    };
    if (legacyHandles) {
        // The handles this file used to resolve its own answer from, wired the
        // way SecurityPlugin wires them. They are here to be IGNORED: a
        // permission-set resolution rebuilt locally would read them and pass,
        // so their presence is what gives `lookups` below its teeth.
        services['security.permissions'] = {
            resolvePermissionSets: async () => {
                throw new Error('the endpoints must not resolve permission sets themselves');
            },
        };
        services['security.bootstrapPermissionSets'] = [];
        services['security.baselinePermissionSets'] = baseline;
        services['security.fallbackPermissionSet'] = baseline[0] ?? null;
    }
    /** Every service name the endpoints asked the locator for, in order. */
    const lookups: string[] = [];
    const app = new Hono();
    registerCurrentUserEndpoints({
        rawApp: app,
        ctx: {
            logger: { debug() {}, warn() {} },
            getService: <T,>(name: string): T => {
                lookups.push(name);
                if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services[name] as T;
            },
        },
    });
    return { app, security, lookups };
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

    it('[#7616] resolves ONCE, by delegating the caller\'s CONTEXT (no local resolution)', async () => {
        // The mechanism behind the counts above. Pre-#7616 this handler
        // composed a NAME LIST and called the evaluator with a DB loader of its
        // own; it now hands the resolver the context and merges what comes
        // back. Asserting the call shape here is what lets the cases above stay
        // about apps.
        const { app, security } = mount({ explicitGrant: true });
        await app.request(`http://localhost${ME_APPS}`);

        expect(security.calls).toHaveLength(1);
        expect(security.calls[0].userId).toBe(USER);
        // The caller's own grants arrive as the context's fields — NOT
        // pre-composed with the baseline by this file.
        expect(security.calls[0].permissions).toContain(EXPLICIT);
        expect(security.calls[0].permissions).not.toContain(BASELINE);
    });

    it('a member granted the baseline set DIRECTLY sees it once, not twice', async () => {
        // The overlap case, kept as a USER-VISIBLE assertion: a member whose
        // one explicit grant IS the baseline set must come out with exactly the
        // baseline's apps. De-duplicating the requested names is the resolver's
        // job since #7616 — what must hold here is that merging a set into
        // itself does not change the projection.
        const { app } = mount({ explicitGrant: true, grantedSetId: 'ps_baseline' });

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

    it('[#7616] delegates here too — one call, the caller\'s context, no name list', async () => {
        const { app, security } = mount({ explicitGrant: true });
        await app.request(`http://localhost${ME_PERMISSIONS}`);

        expect(security.calls).toHaveLength(1);
        expect(security.calls[0].userId).toBe(USER);
        expect(security.calls[0].permissions).toContain(EXPLICIT);
        expect(security.calls[0].permissions).not.toContain(BASELINE);
    });
});

describe('the baseline is a floor, not a licence (#7608)', () => {
    it('a deployment declaring an EMPTY baseline resolves the explicit grant alone', async () => {
        // A deployment that deliberately declared no baseline must come out
        // with the explicit grant and nothing invented on top of it.
        const { app } = mount({ explicitGrant: true, baseline: [] });

        expect(await appNamesOf(app)).toEqual(['exports']);
    });

    it('[#7616] the answer does not depend on the `security.*` internal handles', async () => {
        // REPLACES the case that pinned this file's own baseline fallback
        // chain (`security.baselinePermissionSets` → `security.fallback-
        // PermissionSet` → a bare `member_default`). That chain is deleted:
        // which baseline a deployment applies is the resolver's answer now, and
        // an assertion about the chain would pass here while measuring nothing
        // this file still does.
        //
        // What replaces it is the property that makes the deletion true. The
        // contract calls `security.permissions` and its siblings implementation
        // internals, "deliberately NOT part of this contract"; the default
        // fixture registers them anyway, and the endpoints must never ask for
        // them. The `security.permissions` double THROWS if called, so a
        // re-introduced local resolution fails loudly rather than quietly
        // agreeing.
        const withHandles = mount({ explicitGrant: true });
        const withoutHandles = mount({ explicitGrant: true, legacyHandles: false });

        expect(await appNamesOf(withHandles.app)).toEqual(['exports', 'home', 'reports']);
        expect(await appNamesOf(withoutHandles.app)).toEqual(['exports', 'home', 'reports']);
        for (const name of [
            'security.permissions',
            'security.bootstrapPermissionSets',
            'security.baselinePermissionSets',
            'security.fallbackPermissionSet',
        ]) {
            expect(withHandles.lookups).not.toContain(name);
        }
        // The control: the locator WAS asked for the published service, so the
        // assertion above is a real absence and not an empty recording.
        expect(withHandles.lookups).toContain('security');
    });

    it('an app whose requiredPermissions nobody holds stays filtered for both members', async () => {
        // The fail-direction guard: widening the baseline must not turn
        // `/me/apps` into a fail-open list.
        expect(await appNamesOf(mount({ explicitGrant: false }).app)).not.toContain('billing');
        expect(await appNamesOf(mount({ explicitGrant: true }).app)).not.toContain('billing');
    });
});
