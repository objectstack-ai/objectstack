// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #6334 — position-bound capabilities must reach `/auth/me/permissions`.
//
// The standalone resolver behind these endpoints used to read `sys_member` +
// `sys_user_permission_set` and nothing else. `sys_user_position` /
// `sys_position_permission_set` — the ADR-0090 D3 DISTRIBUTION mechanism, which
// is how showcase grants every persona — were invisible to it, so a permission
// set bound to a position never reached the response: `positions: []`,
// `permissionSets` without the set, `systemPermissions` without its
// capabilities. objectui's four `useCapabilityGate` surfaces (ADR-0066 D4) read
// this endpoint, so the button was hidden from a user who genuinely HELD the
// capability, while the data plane (SecurityPlugin middleware, canonical chain)
// granted the same action. Hiding from an entitled user is the failure
// direction the fail-open design names as the worse one.
//
// The fix delegates all grant aggregation to `resolveUserAuthzGrants` — the
// canonical resolver's userId-driven core. These cases therefore assert BOTH
// halves: the issue's own repro (a position-bound set surfaces), and the
// semantics that come free with the delegation and would have to be re-written
// by hand otherwise — the implicit `everyone` anchor (ADR-0090 D5), null-org =
// global, active-org matching, and the ADR-0091 validity window.
//
// Every negative case here carries a co-present VALID grant and asserts it
// surfaced. A negative asserted on its own would pass in the pre-fix world for
// the wrong reason — because the resolver produced nothing at all, not because
// it judged the invalid row correctly.
//
// [#7616] The grant aggregation these cases are about is UNCHANGED: it is
// `resolveUserAuthzGrants` filling `execCtx.positions` / `execCtx.permissions`,
// and this file's diff for that card touched none of it. What changed is the
// step AFTER — the endpoints hand that context to
// `ISecurityService.resolvePermissionSetsForContext` instead of resolving the
// names themselves — so the double below is a stand-in for that contract method
// rather than for the evaluator, and every case still measures what it did: a
// position-bound set's capabilities reaching the wire.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const ME_APPS = '/api/v1/me/apps';

const USER = 'usr_ops';
const ACTIVE_ORG = 'org_active';
const OTHER_ORG = 'org_other';

/** Far past / far future bounds for the ADR-0091 window cases (real clock). */
const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

type Row = Record<string, any>;

/** `where` matcher: scalar equality plus the `$in` form both resolvers use. */
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

/**
 * A seeded fake data engine — READ ONLY (`find`), which is every verb this
 * surface uses. `where`/`limit` are honoured so a resolver that queries the
 * wrong table or the wrong scope gets nothing, exactly as it would in the
 * engine.
 */
function makeQl(tables: Record<string, Row[]>) {
    return {
        find: async (object: string, opts: any, _ctx?: any) => {
            const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
            return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
        },
        registry: { getAllApps: () => tables.__apps ?? [], getAllObjects: () => [] },
        getSchema: () => undefined,
    };
}

/** A permission set as `sys_permission_set` stores it (JSON columns as text). */
function permissionSet(id: string, name: string, systemPermissions: string[]): Row {
    return {
        id,
        name,
        object_permissions: '{}',
        field_permissions: '{}',
        system_permissions: JSON.stringify(systemPermissions),
        tab_permissions: '{}',
    };
}

/**
 * [#7616] A stand-in for `ISecurityService.resolvePermissionSetsForContext` —
 * the ONE resolution both handlers delegate to. plugin-hono-server must not
 * depend on plugin-security (that package is OPTIONAL in the stacks these
 * endpoints serve), so the double covers the one contract method both handlers
 * call.
 *
 * It resolves the caller's own names — `positions ∪ permissions`, which is
 * exactly what `resolveUserAuthzGrants` put on the context and therefore what
 * these cases are about — out of the `sys_permission_set` rows the fixture
 * seeded. No deployment baseline is added: these fixtures declare none, and the
 * additive-baseline rule has its own file.
 */
function makeSecurityService(rows: Row[]) {
    const parse = (v: unknown, fallback: unknown) =>
        typeof v === 'string' ? JSON.parse(v || JSON.stringify(fallback)) : v ?? fallback;
    return {
        resolvePermissionSetsForContext: async (context: any) => {
            const requested: string[] = [
                ...(Array.isArray(context?.positions) ? context.positions : []),
                ...(Array.isArray(context?.permissions) ? context.permissions : []),
            ];
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
    };
}

/** Minimal `metadata` — present so the endpoint takes its full (non-degraded) branch. */
const metadata = { list: async () => [] as unknown[] };

interface MountOptions {
    tables: Record<string, Row[]>;
    /** Active organization on the session (`session.activeOrganizationId`). */
    activeOrg?: string | null;
}

function mount({ tables, activeOrg = ACTIVE_ORG }: MountOptions) {
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => ({
                    user: { id: USER, email: 'ops@example.com' },
                    session: activeOrg ? { activeOrganizationId: activeOrg } : {},
                }),
            },
        },
        objectql: makeQl(tables),
        metadata,
        security: makeSecurityService(tables.sys_permission_set ?? []),
    };
    const app = new Hono();
    registerCurrentUserEndpoints({
        rawApp: app,
        ctx: {
            logger: { debug() {}, warn() {} },
            // Throws for an unclaimed slot, like the real kernel locator.
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

/** The showcase-shaped seed: `ops` position ↔ `showcase_ops` permission set. */
function baseTables(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
    return {
        sys_user: [{ id: USER, email: 'ops@example.com' }],
        sys_member: [{ user_id: USER, organization_id: ACTIVE_ORG, role: 'member' }],
        sys_user_position: [],
        sys_user_permission_set: [],
        sys_position: [
            { id: 'pos_ops', name: 'ops' },
            { id: 'pos_auditor', name: 'auditor' },
            { id: 'pos_everyone', name: 'everyone' },
        ],
        sys_position_permission_set: [
            { position_id: 'pos_ops', permission_set_id: 'ps_ops' },
            { position_id: 'pos_auditor', permission_set_id: 'ps_auditor' },
            { position_id: 'pos_everyone', permission_set_id: 'ps_default' },
        ],
        sys_permission_set: [
            permissionSet('ps_ops', 'showcase_ops', ['setup.access', 'showcase.export_data']),
            permissionSet('ps_auditor', 'showcase_auditor', ['showcase.audit_read']),
            permissionSet('ps_default', 'showcase_member_default', []),
            permissionSet('ps_direct', 'showcase_direct', ['showcase.direct_only']),
        ],
        ...overrides,
    };
}

describe('position-bound permission sets reach /auth/me/permissions (#6334)', () => {
    it('surfaces a sys_user_position → sys_position_permission_set grant', async () => {
        // The issue's repro, verbatim: one `sys_user_position` row for the
        // active org, `valid_from`/`valid_until` both empty.
        const app = mount({
            tables: baseTables({
                sys_user_position: [{ id: 'up1', user_id: USER, position: 'ops', organization_id: ACTIVE_ORG }],
            }),
        });

        const body = await permissionsOf(app);

        expect(body.authenticated).toBe(true);
        expect(body.positions).toContain('ops');
        expect(body.permissionSets).toContain('showcase_ops');
        expect(body.systemPermissions).toContain('showcase.export_data');
        expect(body.systemPermissions).toContain('setup.access');
    });

    it('still resolves a direct sys_user_permission_set binding (positive control)', async () => {
        // The table the pre-fix resolver DID read — the issue's own control,
        // where switching to a direct binding made the capability appear. It
        // must keep working after the delegation.
        const app = mount({
            tables: baseTables({
                sys_user_permission_set: [
                    { id: 'ups1', user_id: USER, permission_set_id: 'ps_direct', organization_id: null },
                ],
            }),
        });

        const body = await permissionsOf(app);

        expect(body.permissionSets).toContain('showcase_direct');
        expect(body.systemPermissions).toContain('showcase.direct_only');
    });

    it('carries the implicit `everyone` position and its default set (ADR-0090 D5)', async () => {
        // No position row at all: every AUTHENTICATED member implicitly holds
        // `everyone`, so sets bound to it resolve like any other position-bound
        // grant. The issue saw this missing too (`everyone → showcase_member_default`).
        const app = mount({ tables: baseTables() });

        const body = await permissionsOf(app);

        expect(body.positions).toContain('everyone');
        expect(body.permissionSets).toContain('showcase_member_default');
    });

    it('projects the normalized org-membership position (sys_member.role)', async () => {
        // `member` → `org_member` (mapMembershipRole). The pre-fix envelope put
        // these under `roles` while every reader here — and ExecutionContext
        // itself — calls the field `positions`, so they were dropped on the
        // floor independently of the position tables.
        const body = await permissionsOf(mount({ tables: baseTables() }));

        expect(body.positions).toContain('org_member');
    });

    it('treats a null-org position row as global (resolves under any active org)', async () => {
        const app = mount({
            tables: baseTables({
                sys_user_position: [{ id: 'up1', user_id: USER, position: 'ops', organization_id: null }],
            }),
        });

        const body = await permissionsOf(app);

        expect(body.positions).toContain('ops');
        expect(body.systemPermissions).toContain('showcase.export_data');
    });

    it('drops a position row scoped to another organization, keeping the active-org one', async () => {
        const app = mount({
            tables: baseTables({
                sys_user_position: [
                    { id: 'up1', user_id: USER, position: 'ops', organization_id: ACTIVE_ORG },
                    { id: 'up2', user_id: USER, position: 'auditor', organization_id: OTHER_ORG },
                ],
            }),
        });

        const body = await permissionsOf(app);

        // The co-present valid grant is asserted so the negative below cannot
        // pass merely because nothing resolved.
        expect(body.positions).toContain('ops');
        expect(body.positions).not.toContain('auditor');
        expect(body.permissionSets).not.toContain('showcase_auditor');
        expect(body.systemPermissions).not.toContain('showcase.audit_read');
    });

    it('drops position grants outside their ADR-0091 validity window', async () => {
        const app = mount({
            tables: baseTables({
                sys_user_position: [
                    { id: 'up1', user_id: USER, position: 'ops', organization_id: ACTIVE_ORG },
                    // Expired, and not-yet-active — both spellings of "outside
                    // the half-open [from, until) window".
                    {
                        id: 'up2', user_id: USER, position: 'auditor',
                        organization_id: ACTIVE_ORG, valid_until: PAST,
                    },
                    {
                        id: 'up3', user_id: USER, position: 'auditor',
                        organization_id: ACTIVE_ORG, valid_from: FUTURE,
                    },
                ],
            }),
        });

        const body = await permissionsOf(app);

        expect(body.positions).toContain('ops');
        expect(body.positions).not.toContain('auditor');
        expect(body.systemPermissions).not.toContain('showcase.audit_read');
    });
});

describe('/me/apps sees the same position-bound capabilities (#6334)', () => {
    it('lists an app whose requiredPermissions come from a position-bound set', async () => {
        const app = mount({
            tables: baseTables({
                sys_user_position: [{ id: 'up1', user_id: USER, position: 'ops', organization_id: ACTIVE_ORG }],
                __apps: [
                    { name: 'exports', requiredPermissions: ['showcase.export_data'] },
                    { name: 'billing', requiredPermissions: ['billing.manage'] },
                ],
            }),
        });

        const body = await (await app.request(`http://localhost${ME_APPS}`)).json() as any;

        // `exports` is entered through a capability the user holds ONLY via the
        // position chain; `billing` is the control that the filter still filters.
        expect(body.apps.map((a: any) => a.name)).toEqual(['exports']);
    });
});
