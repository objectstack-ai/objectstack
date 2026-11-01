// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20492] `DELETE /packages/:id` refused an uninstall that names no
 * organization BEFORE it touched the running registry.
 *
 * [ADR-0131 D6/D12] That refusal is RETIRED: an uninstall is environment-wide
 * by construction and names no organization, so every caller the doors admit
 * — with or without an active organization — uninstalls, and `deletePackage`
 * is handed no organization. [ADR-0131 D12 items 7–8] Under this rig's
 * `isolated` posture the doors admit only the platform operator: every caller
 * below that rung is refused by the walled refusal BEFORE anything moves,
 * which is this file's original lesson (a refused request changes nothing).
 * The history below is kept for the rig's sake.
 *
 * ## The defect
 *
 * The door ran `registry.uninstallPackage(id)` and only then reached the
 * persisted delete, whose `deletePackage` refuses an uninstall that names no
 * organization (`400 TENANT_SCOPE_REQUIRED`). So a caller holding
 * `manage_metadata` with no active organization was answered that refusal while
 * the package, and every object it registers, had already left the running
 * process for everyone it serves — `GET /packages/:id` 200 before, 404 after —
 * and its stored rows still said it was installed, until a restart re-seeded
 * the registry. A refused request had changed the process.
 *
 * ## The rig
 *
 * Identity is the REAL resolution on every request, as in
 * `packages-vetted-org-source.test.ts`: `dispatch()` runs
 * `resolveRequestScope` → `resolveExecutionContext` → `resolveAuthzContext`
 * under an `isolated` posture, and every caller holds the ONE shared permission
 * set, so only the organization separates the arms. The registry is a REAL
 * `SchemaRegistry` holding the package and one object it owns, so "the package
 * left the process" is read off the registry itself and through the door's own
 * `GET`. The `protocol` double keeps the package's stored rows, records every
 * `deletePackage` request, and refuses one carrying the retired
 * `organizationId` / `allTenants` keys the way
 * `@objectstack/metadata-protocol`'s `deletePackage` does.
 *
 * Three populations below the operator rung: a current member, a member
 * removed from the organization whose session still names it (the resolver
 * drops the claim), and a caller who never selected an organization. All three
 * are refused the same way. The platform operator (an `admin_full_access`
 * grant owned by the Default Organization) uninstalls, with or without an
 * active organization, naming none.
 *
 * ## [#28408, ADR-0146 D3] A base under its paired customization package
 *
 * The epic's two-minute check, verbatim: 「卸载 HotCRM 被拒并点名
 * `hotcrm.custom`」. While the registry holds `com.acme.crm.custom`, the
 * operator's `DELETE` of `com.acme.crm` is refused `409 RESOURCE_CONFLICT`
 * naming the pair, and nothing moves: the stored rows, the registry entry, its
 * object and its disable record stay. The `protocol` double asks the registry
 * that refusal before its store delete, as `deletePackage` does; a host with
 * no persisted half meets it in the registry's own uninstall. Deleting the pair
 * first is a real way out. And on a base the deployment ships (a booted code
 * package) the read-only `422` still answers first: this door cannot remove
 * that base with or without its pair, so it is the truer answer.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';
import { bindCatalogFromTables } from '../security/security-catalog.testkit.js';
import { loadDisabledPackageIds, setPackageDisabled } from '../package-state-store.js';

const PKG = 'com.acme.crm';
/** `PKG`'s paired customization package (ADR-0146 D3): the id `customizationPackageId` derives. */
const PAIR = 'com.acme.crm.custom';
const ALPHA = 'org_alpha';
const BETA = 'org_beta';
/** The Default Organization, which owns the operator's grant. */
const DEFAULT_ORG = 'org_default';
const SESSION_HEADER = 'x-test-session';

// ── Identity: sessions and the permission store, in the shipped shapes ────────

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
        // An absent column reads as NULL, as it does in SQL (`organization_id: null`).
        if (cond === null) return (row[field] ?? null) === null;
        return row[field] === cond;
    });
}

/**
 * `u_member` is a current `org_alpha` member. `u_exmember`'s only current
 * membership is `org_beta`, so a session naming `org_alpha` is a claim the
 * resolver drops. `u_orgless` belongs to no organization at all.
 */
const TABLES: Record<string, any[]> = {
    sys_api_key: [],
    sys_member: [
        { user_id: 'u_member', organization_id: ALPHA, role: 'member' },
        { user_id: 'u_exmember', organization_id: BETA, role: 'member' },
        { user_id: 'u_admin', organization_id: ALPHA, role: 'owner' },
    ],
    sys_user: [
        { id: 'u_member', email: 'u_member@example.com' },
        { id: 'u_exmember', email: 'u_exmember@example.com' },
        { id: 'u_orgless', email: 'u_orgless@example.com' },
        { id: 'u_admin', email: 'u_admin@example.com' },
    ],
    // The Default Organization: it owns the operator's `admin_full_access`
    // grant, the one grant that anchors platform standing.
    sys_organization: [{ id: DEFAULT_ORG, slug: 'default' }],
    sys_user_permission_set: [
        { user_id: 'u_admin', permission_set_id: 'ps_admin', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG },
    ],
    // The ONE shared set reaches every caller through the built-in `everyone`
    // position, so it holds in whichever organization a caller acts in and with
    // none. A user grant applies only in its own organization, so it could not
    // be shared by a caller whose claim is dropped or who never selected one.
    sys_position: [{ id: 'pos_everyone', name: 'everyone' }],
    sys_position_permission_set: [{ id: 'pps_everyone_shared', position_id: 'pos_everyone', permission_set_id: 'ps_shared' }],
    sys_permission_set: [
        { id: 'ps_shared', name: 'shared_access', system_permissions: ['manage_metadata', 'studio.access'] },
        { id: 'ps_admin', name: 'admin_full_access', system_permissions: ['manage_metadata', 'studio.access', 'setup.access'] },
    ],
};

type Who = 'member' | 'exmember' | 'orgless' | 'admin' | 'admin_orgless';

const SESSIONS: Record<Who, { id: string; token: string; userId: string; activeOrganizationId?: string }> = {
    member: { id: 'ses_member', token: 'tok_member', userId: 'u_member', activeOrganizationId: ALPHA },
    // The claim outlived the membership that backed it.
    exmember: { id: 'ses_exmember', token: 'tok_exmember', userId: 'u_exmember', activeOrganizationId: ALPHA },
    // Signed in, and never selected an organization.
    orgless: { id: 'ses_orgless', token: 'tok_orgless', userId: 'u_orgless' },
    // The platform operator, with an organization selected and with none.
    admin: { id: 'ses_admin', token: 'tok_admin', userId: 'u_admin', activeOrganizationId: ALPHA },
    admin_orgless: { id: 'ses_admin2', token: 'tok_admin2', userId: 'u_admin' },
};

function authService() {
    return {
        api: {
            getSession: async ({ headers }: any) => {
                const who = (typeof headers?.get === 'function' ? headers.get(SESSION_HEADER) : headers?.[SESSION_HEADER]) as Who | undefined;
                const row = who ? SESSIONS[who] : undefined;
                if (!row) return undefined;
                return { user: { id: row.userId, email: `${row.userId}@example.com` }, session: { ...row } };
            },
        },
    };
}

// ── The package: a real registry, and the stored rows behind it ───────────────

interface Rig {
    registry: SchemaRegistry;
    /** The object the package owns, by the name the registry answers it under. */
    objectName: string;
    /** The package's stored rows — what `deletePackage` removes. */
    rows: string[];
    /** Every `deletePackage` request the door made. */
    deleteRequests: any[];
    call(method: string, who: Who, path: string): Promise<{ status: number; code?: string; body: any }>;
}

function rig(opts: {
    persistedHalf?: boolean;
    /** `PKG` is a booted code package — the engine's manifest map holds it — so the deployment ships it. */
    managed?: boolean;
} = {}): Rig {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({ id: PKG, namespace: 'crm', name: 'CRM', version: '1.0.0', type: 'app', scope: 'project' } as any, 'code');
    registry.registerObject({ name: 'crm_lead', fields: { title: { type: 'text' } } } as any, PKG, 'crm', 'own');
    // The organization object the platform registers: the resolver reads the
    // Default Organization (the owner of the anchoring admin grant) only from a
    // registry that holds it.
    registry.registerObject({ name: 'sys_organization', fields: { slug: { type: 'text' } } } as any, 'com.objectstack.platform', 'sys', 'own');
    const objectName = registry.getAllObjects().map((o: any) => o.name).find((n: string) => n.endsWith('crm_lead'))!;

    const rows = ['object:crm_lead', 'view:crm_lead_list'];
    const deleteRequests: any[] = [];
    const protocol = {
        deletePackage: async (req: any) => {
            deleteRequests.push({ ...req });
            if ('organizationId' in (req ?? {}) || 'allTenants' in (req ?? {})) {
                throw Object.assign(new Error('organizationId / allTenants are retired request keys.'), {
                    code: 'INVALID_REQUEST', status: 400,
                });
            }
            // The registry's uninstall refusal, asked before the store delete and
            // thrown as is with nothing removed, as `deletePackage` asks it.
            registry.assertPackageUninstallable(req.packageId);
            // The stored rows are `PKG`'s: another package's delete removes none.
            const deleted = req.packageId === PKG ? rows.splice(0) : [];
            return { success: true, deletedCount: deleted.length, failedCount: 0, deleted: [], failed: [], cleanups: [] };
        },
    };

    const services: Record<string, unknown> = {
        objectql: bindCatalogFromTables({
            registry,
            ...(opts.managed ? { manifests: new Map([[PKG, {}]]) } : {}),
            find: async (object: string, q: any = {}) => {
                const found = (TABLES[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
                return typeof q?.limit === 'number' ? found.slice(0, q.limit) : found;
            },
        }, TABLES),
        auth: authService(),
        tenancy: { posture: 'isolated' },
        ...(opts.persistedHalf === false ? {} : { protocol }),
    };
    const get = (n: string) => services[n] ?? null;
    const dispatcher = new HttpDispatcher({ context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) } as any);

    return {
        registry,
        objectName,
        rows,
        deleteRequests,
        call: async (method, who, path) => {
            const res = await dispatcher.dispatch(method, path, undefined, {}, {
                request: { headers: { [SESSION_HEADER]: who } },
            } as any);
            const body = JSON.parse(JSON.stringify(res.response?.body ?? null));
            return { status: res.response?.status ?? 0, code: body?.error?.code, body };
        },
    };
}

/** What a reader of the process sees about the package right now, through the door and in the registry. */
async function observed(r: Rig) {
    const detail = await r.call('GET', 'member', `/packages/${PKG}`);
    const list = await r.call('GET', 'member', '/packages');
    return {
        detailStatus: detail.status,
        listed: (list.body?.data?.packages ?? []).map((p: any) => p?.manifest?.id).includes(PKG),
        inRegistry: r.registry.getPackage(PKG) !== undefined,
        objectRegistered: r.registry.getObject(r.objectName) !== undefined,
        storedRows: [...r.rows],
    };
}

const UNTOUCHED = {
    detailStatus: 200,
    listed: true,
    inRegistry: true,
    objectRegistered: true,
    storedRows: ['object:crm_lead', 'view:crm_lead_list'],
};

// `setPackageDisabled` writes a REAL state file under the ObjectStack home on
// every uninstall that removed a registry row (the control arm below), so the
// home is a temp dir for the whole file.
const envSnapshot = { OS_HOME: process.env.OS_HOME };
let home: string;
beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'os-20492-'));
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

// ── The subject: the doors refuse below the operator before anything moves ───

const CALLERS: Array<[Who, string]> = [
    ['member', 'a current member'],
    ['exmember', 'a member removed from the organization, whose session still names it'],
    ['orgless', 'a caller who never selected an organization'],
];

describe('[ADR-0131 D12 items 7–8] DELETE /packages/:id below the operator rung is refused before anything moves', () => {
    for (const [who, label] of CALLERS) {
        it(`${label}: 403 PERMISSION_DENIED naming the posture; the package, its object and its stored rows stay, and deletePackage is never asked`, async () => {
            const r = rig();
            expect(await observed(r), 'precondition: the package is installed').toEqual(UNTOUCHED);
            const answer = await r.call('DELETE', who, `/packages/${PKG}`);
            expect({ status: answer.status, code: answer.body?.error?.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
            expect(String(answer.body?.error?.message)).toContain("'isolated' tenancy posture");
            expect(r.deleteRequests).toEqual([]);
            expect(await observed(r)).toEqual(UNTOUCHED);
        });
    }
});

const OPERATORS: Array<[Who, string]> = [
    ['admin', 'the platform operator, with an organization selected'],
    ['admin_orgless', 'the platform operator, with no organization selected'],
];

describe('[ADR-0131 D6] DELETE /packages/:id names no organization, whoever the doors admit', () => {
    for (const [who, label] of OPERATORS) {
        it(`${label}: 200; the package and its object leave the registry, GET answers 404, and deletePackage is handed no organization`, async () => {
            const r = rig();
            expect(await observed(r), 'precondition: the package is installed').toEqual(UNTOUCHED);
            const answer = await r.call('DELETE', who, `/packages/${PKG}`);
            expect(answer.status).toBe(200);
            expect(answer.body?.data).toMatchObject({ packageId: PKG, success: true, registryRemoved: true });
            expect(r.deleteRequests).toEqual([{ packageId: PKG }]);
            expect(await observed(r)).toEqual({
                detailStatus: 404,
                listed: false,
                inRegistry: false,
                objectRegistered: false,
                storedRows: [],
            });
        });
    }
});

// ── [#28408, ADR-0146 D3] a base under its paired customization package ──────

/** Install `PKG`'s paired customization package, declaring its base as the pair does. */
function installPair(r: Rig): void {
    r.registry.installPackage({
        id: PAIR, namespace: 'crm_custom', name: 'CRM customizations', version: '1.0.0', type: 'app', scope: 'project',
        dependencies: { [PKG]: '^1' },
    } as any, 'authored');
}

describe('[#28408, ADR-0146 D3] DELETE /packages/:id of a base whose paired customization package is installed', () => {
    // The disable record is a real file under the temp home: none outlives its test.
    afterEach(() => { setPackageDisabled(undefined, PKG, false); });

    it('409 RESOURCE_CONFLICT naming the pair; the stored rows, the registry entry, its object and its disable record stay', async () => {
        const r = rig();
        installPair(r);
        expect((await r.call('PATCH', 'admin', `/packages/${PKG}/disable`)).status, 'precondition: disabled').toBe(200);
        expect(loadDisabledPackageIds().has(PKG), 'precondition: the disable record is written').toBe(true);

        const answer = await r.call('DELETE', 'admin', `/packages/${PKG}`);

        expect({ status: answer.status, code: answer.code }).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
        expect(String(answer.body?.error?.message).startsWith(`Delete the customization package "${PAIR}" first`),
            String(answer.body?.error?.message)).toBe(true);
        expect(await observed(r)).toEqual(UNTOUCHED);
        expect(r.registry.getPackage(PKG)?.enabled, 'the registry entry is still disabled').toBe(false);
        expect(loadDisabledPackageIds().has(PKG), 'the disable record is intact').toBe(true);
        expect(r.registry.getPackage(PAIR), 'the pair is untouched').toBeDefined();
    });

    it('a host with no persisted half: the registry\'s own uninstall refuses the same way, and nothing moves', async () => {
        const r = rig({ persistedHalf: false });
        installPair(r);

        const answer = await r.call('DELETE', 'admin', `/packages/${PKG}`);

        expect({ status: answer.status, code: answer.code }).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
        expect(String(answer.body?.error?.message)).toContain(`"${PAIR}"`);
        expect(await observed(r)).toEqual(UNTOUCHED);
    });

    it('control — the pair deleted first through the same door, the same uninstall succeeds', async () => {
        const r = rig();
        installPair(r);

        expect((await r.call('DELETE', 'admin', `/packages/${PAIR}`)).status, 'the pair itself uninstalls as before').toBe(200);
        const answer = await r.call('DELETE', 'admin', `/packages/${PKG}`);

        expect(answer.status).toBe(200);
        expect(answer.body?.data).toMatchObject({ packageId: PKG, success: true, registryRemoved: true });
        expect((await observed(r)).inRegistry).toBe(false);
    });

    it('a base the deployment ships (a booted code package) still answers the read-only 422 first, and deletePackage is never asked', async () => {
        const r = rig({ managed: true });
        installPair(r);

        const answer = await r.call('DELETE', 'admin', `/packages/${PKG}`);

        expect({ status: answer.status, code: answer.code }).toEqual({ status: 422, code: 'WRITABLE_PACKAGE_REQUIRED' });
        expect(r.deleteRequests).toEqual([]);
        expect(await observed(r)).toEqual(UNTOUCHED);
    });
});
