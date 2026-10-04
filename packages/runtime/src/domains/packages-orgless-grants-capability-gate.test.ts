// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20515] A member removed from an organization does not keep a capability
 * that organization granted: the `manage_metadata` gate of the `/packages`
 * doors refuses them `403`.
 *
 * ## The defect
 *
 * A member removed from `org_alpha` keeps a session that still names it. The
 * resolver drops that claim (no membership backs it) and re-resolves the grants
 * with no active organization. The resolution's organization filters read
 * "no tenant" as "every organization", so a permission set granted SCOPED to
 * `org_alpha` — operator-authored, and not revoked by the removal — went on
 * conferring `manage_metadata` with no organization boundary left on it. The
 * gate passed: `PATCH /packages/:id/disable` switched the package off for the
 * whole environment (200), and `DELETE /packages/:id` reached the door's own
 * organization check (400 `TENANT_SCOPE_REQUIRED`) instead of the gate's 403.
 *
 * The same held for a set the left organization bound to one of its own
 * POSITIONS: with no tenant the position read is installation-wide, so the left
 * organization's copy of `org_member` fed its bindings to anyone still an
 * `org_member` somewhere.
 *
 * The rule now: with no active organization only the global grants apply, and
 * a grant scoped to an organization applies only while that organization is the
 * active tenant (`resolveUserAuthzGrants`, `@objectstack/core`).
 *
 * ## The rig
 *
 * The one `packages-uninstall-refuse-before-mutate.test.ts` uses: `dispatch()`
 * runs the REAL identity resolution (`resolveRequestScope` →
 * `resolveExecutionContext` → `resolveAuthzContext`) under an `isolated`
 * posture, over a real `SchemaRegistry` holding the package, and a `protocol`
 * double that refuses an organization-less `deletePackage` the way
 * `@objectstack/metadata-protocol` does. `@objectstack/core` resolves to its
 * source here (this package's vitest alias), so the resolver under test is the
 * one in this checkout.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.acme.crm';
const ALPHA = 'org_alpha';
const BETA = 'org_beta';
const SESSION_HEADER = 'x-test-session';

/** Equality plus `$in`, and a loud refusal of every other shape. */
function matchesWhere(row: any, where: any): boolean {
    return Object.entries(where ?? {}).every(([field, cond]) => {
        if (field.startsWith('$')) throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
        if (cond !== null && typeof cond === 'object') {
            const ops = Object.keys(cond as object);
            if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as any).$in)) {
                throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
            }
            return (cond as any).$in.includes(row[field]);
        }
        return row[field] === cond;
    });
}

/**
 * `u_exmember` was removed from `org_alpha` and is still a member of
 * `org_beta`; `u_gone` has no membership left anywhere. Both still hold the
 * `org_alpha`-scoped `manage_metadata` set. `u_member` is the control: a
 * current `org_alpha` member holding the same grant. `u_global` was removed the
 * same way but holds the set GLOBALLY. `u_admin` holds `admin_full_access`
 * unscoped — the row the platform-admin bootstrap mints. `u_orgless` signed in,
 * never selected an organization and holds no grant at all.
 */
const TABLES: Record<string, any[]> = {
    sys_api_key: [],
    sys_member: [
        { user_id: 'u_member', organization_id: ALPHA, role: 'member' },
        { user_id: 'u_exmember', organization_id: BETA, role: 'member' },
        { user_id: 'u_global', organization_id: BETA, role: 'member' },
        { user_id: 'u_admin', organization_id: ALPHA, role: 'owner' },
        { user_id: 'u_posex', organization_id: BETA, role: 'member' },
        { user_id: 'u_posmember', organization_id: ALPHA, role: 'member' },
    ],
    sys_user: ['u_member', 'u_exmember', 'u_gone', 'u_global', 'u_admin', 'u_posex', 'u_posmember', 'u_orgless']
        .map((id) => ({ id, email: `${id}@example.com` })),
    sys_user_permission_set: [
        { user_id: 'u_member', permission_set_id: 'ps_meta', organization_id: ALPHA },
        { user_id: 'u_exmember', permission_set_id: 'ps_meta', organization_id: ALPHA },
        { user_id: 'u_gone', permission_set_id: 'ps_meta', organization_id: ALPHA },
        { user_id: 'u_global', permission_set_id: 'ps_meta', organization_id: null },
        { user_id: 'u_admin', permission_set_id: 'ps_admin', organization_id: null },
    ],
    sys_permission_set: [
        { id: 'ps_meta', name: 'alpha_metadata_editors', system_permissions: ['manage_metadata', 'studio.access'] },
        { id: 'ps_admin', name: 'admin_full_access', system_permissions: ['manage_metadata', 'studio.access', 'setup.access'] },
        { id: 'ps_members', name: 'alpha_member_tools', system_permissions: ['manage_metadata'] },
    ],
    // The per-organization copies of the `org_member` built-in a walled catalog
    // holds; org_alpha bound a metadata-editing set to ITS copy. This double
    // ignores the read's tenant, which is exactly what an organization-less
    // resolution's installation-wide `sys_position` read does.
    sys_position: [
        { id: 'pos_member_alpha', name: 'org_member', organization_id: ALPHA },
        { id: 'pos_member_beta', name: 'org_member', organization_id: BETA },
    ],
    sys_position_permission_set: [
        { position_id: 'pos_member_alpha', permission_set_id: 'ps_members' },
    ],
};

type Who = 'member' | 'exmember' | 'gone' | 'global' | 'admin' | 'admin_orgless' | 'posex' | 'posmember' | 'orgless';

/** Every session names `org_alpha` except `admin_orgless` and `orgless`, which name no organization. */
const SESSIONS: Record<Who, { id: string; token: string; userId: string; activeOrganizationId?: string }> = {
    member: { id: 'ses_member', token: 'tok_member', userId: 'u_member', activeOrganizationId: ALPHA },
    exmember: { id: 'ses_exmember', token: 'tok_exmember', userId: 'u_exmember', activeOrganizationId: ALPHA },
    gone: { id: 'ses_gone', token: 'tok_gone', userId: 'u_gone', activeOrganizationId: ALPHA },
    global: { id: 'ses_global', token: 'tok_global', userId: 'u_global', activeOrganizationId: ALPHA },
    admin: { id: 'ses_admin', token: 'tok_admin', userId: 'u_admin', activeOrganizationId: ALPHA },
    admin_orgless: { id: 'ses_admin2', token: 'tok_admin2', userId: 'u_admin' },
    posex: { id: 'ses_posex', token: 'tok_posex', userId: 'u_posex', activeOrganizationId: ALPHA },
    posmember: { id: 'ses_posmember', token: 'tok_posmember', userId: 'u_posmember', activeOrganizationId: ALPHA },
    orgless: { id: 'ses_orgless', token: 'tok_orgless', userId: 'u_orgless' },
};

function rig() {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({ id: PKG, namespace: 'crm', name: 'CRM', version: '1.0.0', type: 'app', scope: 'project' } as any);
    registry.registerObject({ name: 'crm_lead', fields: { title: { type: 'text' } } } as any, PKG, 'crm', 'own');

    const deleteRequests: any[] = [];
    const protocol = {
        deletePackage: async (req: any) => {
            deleteRequests.push({ ...req });
            if (!req?.organizationId && req?.allTenants !== true) {
                throw Object.assign(new Error('Refusing to uninstall with no organization scope.'), {
                    code: 'TENANT_SCOPE_REQUIRED', status: 400,
                });
            }
            return { success: true, deletedCount: 0, failedCount: 0, deleted: [], failed: [], cleanups: [] };
        },
    };
    const services: Record<string, unknown> = {
        objectql: {
            registry,
            find: async (object: string, q: any = {}) => {
                const found = (TABLES[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
                return typeof q?.limit === 'number' ? found.slice(0, q.limit) : found;
            },
        },
        auth: {
            api: {
                getSession: async ({ headers }: any) => {
                    const who = (typeof headers?.get === 'function' ? headers.get(SESSION_HEADER) : headers?.[SESSION_HEADER]) as Who | undefined;
                    const row = who ? SESSIONS[who] : undefined;
                    if (!row) return undefined;
                    return { user: { id: row.userId, email: `${row.userId}@example.com` }, session: { ...row } };
                },
            },
        },
        tenancy: { posture: 'isolated' },
        protocol,
    };
    const get = (n: string) => services[n] ?? null;
    const dispatcher = new HttpDispatcher({ context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) } as any);

    return {
        registry,
        deleteRequests,
        call: async (method: string, who: Who, path: string) => {
            const res = await dispatcher.dispatch(method, path, undefined, {}, {
                request: { headers: { [SESSION_HEADER]: who } },
            } as any);
            const body = JSON.parse(JSON.stringify(res.response?.body ?? null));
            return { status: res.response?.status ?? 0, code: body?.error?.code, httpStatus: body?.error?.httpStatus, body };
        },
    };
}

/** Whether the registry now holds the package switched off. */
function switchedOff(r: ReturnType<typeof rig>): boolean {
    const pkg: any = r.registry.getPackage(PKG);
    return pkg?.enabled === false || pkg?.status === 'disabled';
}

// An allowed disable or uninstall writes a REAL state file under the ObjectStack
// home, so the home is a temp dir for the whole file.
const envSnapshot = { OS_HOME: process.env.OS_HOME };
let home: string;
beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'os-20515-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    rmSync(home, { recursive: true, force: true });
});

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

const REMOVED: Array<[Who, string]> = [
    ['exmember', 'a member removed from org_alpha, still a member of org_beta'],
    ['gone', 'a member removed from org_alpha, with no membership left anywhere'],
    // The same set reached through a POSITION: org_alpha bound it to its own
    // copy of `org_member`, and this member is still an `org_member` elsewhere.
    ['posex', 'a member removed from org_alpha whose org_member binding there carried manage_metadata'],
];

describe('[#20515] a removed member\'s organization-scoped manage_metadata no longer passes the /packages gate', () => {
    for (const [who, label] of REMOVED) {
        it(`${label}: DELETE /packages/:id is refused 403 by the capability gate, and deletePackage is never asked`, async () => {
            const r = rig();
            const answer = await r.call('DELETE', who, `/packages/${PKG}`);
            expect({ status: answer.status, code: answer.code, httpStatus: answer.httpStatus })
                .toEqual({ status: 403, code: 'PERMISSION_DENIED', httpStatus: 403 });
            expect(r.deleteRequests).toEqual([]);
            expect(r.registry.getPackage(PKG)).toBeDefined();
        });

        it(`${label}: PATCH /packages/:id/disable is refused 403, and the package stays enabled for everyone`, async () => {
            const r = rig();
            const answer = await r.call('PATCH', who, `/packages/${PKG}/disable`);
            expect({ status: answer.status, code: answer.code, httpStatus: answer.httpStatus })
                .toEqual({ status: 403, code: 'PERMISSION_DENIED', httpStatus: 403 });
            expect(switchedOff(r)).toBe(false);
        });
    }

    it('the rig really drops the removed member\'s claim — the refusal is not a session that never named the organization', async () => {
        const r = rig();
        await r.call('DELETE', 'exmember', `/packages/${PKG}`);
        const dropped = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]))
            .filter((line: string) => line.includes('Session organization claim dropped'));
        expect(dropped.length).toBeGreaterThan(0);
        expect(dropped[0]).toContain(`organization=${ALPHA}`);
    });
});

describe('[#20515] what the rule leaves unchanged', () => {
    it('CONTROL · a current member with the same grant and org_alpha active passes: DELETE /packages/:id answers 200', async () => {
        const r = rig();
        const answer = await r.call('DELETE', 'member', `/packages/${PKG}`);
        expect(answer.status).toBe(200);
        expect(r.deleteRequests).toEqual([{ packageId: PKG, organizationId: ALPHA }]);
    });

    it('CONTROL · the same current member passes PATCH /packages/:id/disable: 200, and the package is switched off', async () => {
        const r = rig();
        expect((await r.call('PATCH', 'member', `/packages/${PKG}/disable`)).status).toBe(200);
        expect(switchedOff(r)).toBe(true);
    });

    it('CONTROL · the position-bound set: a current org_alpha member with org_alpha active passes: 200', async () => {
        const r = rig();
        const answer = await r.call('DELETE', 'posmember', `/packages/${PKG}`);
        expect(answer.status).toBe(200);
        expect(r.deleteRequests).toEqual([{ packageId: PKG, organizationId: ALPHA }]);
    });

    it('a GLOBAL grant still passes the gate for the removed member — the door\'s own organization check answers, not the gate', async () => {
        const r = rig();
        const answer = await r.call('DELETE', 'global', `/packages/${PKG}`);
        expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'TENANT_SCOPE_REQUIRED' });
        // …and the disable door, which asks no organization, lands — the
        // positive control that makes `switchedOff` false above mean something.
        const d = rig();
        expect((await d.call('PATCH', 'global', `/packages/${PKG}/disable`)).status).toBe(200);
        expect(switchedOff(d)).toBe(true);
    });

    it('platform-admin standing (unscoped admin_full_access) passes with org_alpha active, and with no organization at all', async () => {
        expect((await rig().call('DELETE', 'admin', `/packages/${PKG}`)).status).toBe(200);
        expect((await rig().call('PATCH', 'admin', `/packages/${PKG}/disable`)).status).toBe(200);
        const orgless = await rig().call('DELETE', 'admin_orgless', `/packages/${PKG}`);
        expect({ status: orgless.status, code: orgless.code }).toEqual({ status: 400, code: 'TENANT_SCOPE_REQUIRED' });
        expect((await rig().call('PATCH', 'admin_orgless', `/packages/${PKG}/disable`)).status).toBe(200);
    });

    it('a caller who never selected an organization and holds no grant is refused 403 on both doors, as before', async () => {
        const r = rig();
        const del = await r.call('DELETE', 'orgless', `/packages/${PKG}`);
        expect({ status: del.status, code: del.code, httpStatus: del.httpStatus })
            .toEqual({ status: 403, code: 'PERMISSION_DENIED', httpStatus: 403 });
        const dis = await r.call('PATCH', 'orgless', `/packages/${PKG}/disable`);
        expect({ status: dis.status, code: dis.code, httpStatus: dis.httpStatus })
            .toEqual({ status: 403, code: 'PERMISSION_DENIED', httpStatus: 403 });
        expect(r.deleteRequests).toEqual([]);
        expect(switchedOff(r)).toBe(false);
    });
});
