// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20492] `DELETE /packages/:id` refuses an uninstall that names no
 * organization BEFORE it touches the running registry.
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
 * `deletePackage` request, and refuses an org-less one the way
 * `@objectstack/metadata-protocol`'s `deletePackage` does (its request type:
 * "Omitted together with `allTenants` ⇒ refused").
 *
 * Two refused populations, both measured reaching the old half-applied state:
 * a member removed from the organization whose session still names it (the
 * resolver drops the claim), and a caller who never selected an organization.
 * The control is a current member, who uninstalls exactly as before.
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
    ],
    sys_user: [
        { id: 'u_member', email: 'u_member@example.com' },
        { id: 'u_exmember', email: 'u_exmember@example.com' },
        { id: 'u_orgless', email: 'u_orgless@example.com' },
    ],
    sys_user_permission_set: [
        { user_id: 'u_member', permission_set_id: 'ps_shared' },
        { user_id: 'u_exmember', permission_set_id: 'ps_shared' },
        { user_id: 'u_orgless', permission_set_id: 'ps_shared' },
    ],
    sys_permission_set: [
        { id: 'ps_shared', name: 'shared_access', system_permissions: ['manage_metadata', 'studio.access'] },
    ],
};

type Who = 'member' | 'exmember' | 'orgless';

const SESSIONS: Record<Who, { id: string; token: string; userId: string; activeOrganizationId?: string }> = {
    member: { id: 'ses_member', token: 'tok_member', userId: 'u_member', activeOrganizationId: ALPHA },
    // The claim outlived the membership that backed it.
    exmember: { id: 'ses_exmember', token: 'tok_exmember', userId: 'u_exmember', activeOrganizationId: ALPHA },
    // Signed in, and never selected an organization.
    orgless: { id: 'ses_orgless', token: 'tok_orgless', userId: 'u_orgless' },
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

function rig(opts: { persistedHalf?: boolean } = {}): Rig {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({ id: PKG, namespace: 'crm', name: 'CRM', version: '1.0.0', type: 'app', scope: 'project' } as any);
    registry.registerObject({ name: 'crm_lead', fields: { title: { type: 'text' } } } as any, PKG, 'crm', 'own');
    const objectName = registry.getAllObjects().map((o: any) => o.name).find((n: string) => n.endsWith('crm_lead'))!;

    const rows = ['object:crm_lead', 'view:crm_lead_list'];
    const deleteRequests: any[] = [];
    const protocol = {
        deletePackage: async (req: any) => {
            deleteRequests.push({ ...req });
            if (!req?.organizationId && req?.allTenants !== true) {
                throw Object.assign(new Error('Refusing to uninstall with no organization scope.'), {
                    code: 'TENANT_SCOPE_REQUIRED', status: 400,
                });
            }
            const deleted = rows.splice(0);
            return { success: true, deletedCount: deleted.length, failedCount: 0, deleted: [], failed: [], cleanups: [] };
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

// ── The subject: a refused uninstall changes nothing ──────────────────────────

const REFUSED: Array<[Who, string]> = [
    ['exmember', 'a member removed from the organization, whose session still names it'],
    ['orgless', 'a caller who never selected an organization'],
];

describe('[#20492] DELETE /packages/:id with no organization is refused before the registry is touched', () => {
    for (const [who, label] of REFUSED) {
        it(`${label}: answered 400 TENANT_SCOPE_REQUIRED by the door, and deletePackage is never asked`, async () => {
            const r = rig();
            const answer = await r.call('DELETE', who, `/packages/${PKG}`);
            expect({ status: answer.status, code: answer.code, httpStatus: answer.body?.error?.httpStatus })
                .toEqual({ status: 400, code: 'TENANT_SCOPE_REQUIRED', httpStatus: 400 });
            expect(r.deleteRequests).toEqual([]);
        });

        it(`${label}: afterwards the package is still served, listed and registered with its object, and its stored rows are untouched`, async () => {
            const r = rig();
            expect(await observed(r), 'precondition: the package is installed').toEqual(UNTOUCHED);
            await r.call('DELETE', who, `/packages/${PKG}`);
            expect(await observed(r)).toEqual(UNTOUCHED);
        });
    }

    it('the rig really drops the removed member\'s claim — that arm is not a session that never presented one', async () => {
        const r = rig();
        await r.call('DELETE', 'exmember', `/packages/${PKG}`);
        const dropped = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]))
            .filter((line: string) => line.includes('Session organization claim dropped'));
        expect(dropped.length).toBeGreaterThan(0);
        expect(dropped[0]).toContain(`organization=${ALPHA}`);
    });
});

// ── The control: a member with an organization uninstalls as before ───────────

describe('[#20492] control: a current member uninstalls exactly as before', () => {
    it('200; the package and its object leave the registry, GET answers 404, and deletePackage removes the rows in that organization', async () => {
        const r = rig();
        const answer = await r.call('DELETE', 'member', `/packages/${PKG}`);
        expect(answer.status).toBe(200);
        expect(answer.body?.data).toMatchObject({ packageId: PKG, success: true, registryRemoved: true });
        expect(r.deleteRequests).toEqual([{ packageId: PKG, organizationId: ALPHA }]);
        expect(await observed(r)).toEqual({
            detailStatus: 404,
            listed: false,
            inRegistry: false,
            objectRegistered: false,
            storedRows: [],
        });
    });
});

// ── The mirror's reach: exactly the refusal the persisted half would give ─────

describe('[#20492] the door mirrors the persisted refusal — no wider, no narrower', () => {
    it('a host with no persisted half (no deletePackage) has no refusal to mirror: the org-less uninstall proceeds as before', async () => {
        const r = rig({ persistedHalf: false });
        const answer = await r.call('DELETE', 'orgless', `/packages/${PKG}`);
        expect(answer.status).toBe(200);
        expect(r.registry.getPackage(PKG)).toBeUndefined();
    });

    it('no isSystem bypass — the protocol refuses an org-less uninstall whoever asks, so the door does too, before the registry', async () => {
        const r = rig();
        const registry = r.registry;
        const get = (n: string) => (n === 'objectql' ? { registry } : n === 'protocol' ? { deletePackage: vi.fn() } : null);
        const d = new HttpDispatcher({ context: { getService: get } } as any);
        const res = await d.handlePackages(`/${PKG}`, 'DELETE', undefined, {}, {
            request: {}, executionContext: { isSystem: true },
        } as any);
        expect({ status: res.response?.status, code: (res.response?.body as any)?.error?.code })
            .toEqual({ status: 400, code: 'TENANT_SCOPE_REQUIRED' });
        expect(registry.getPackage(PKG)).toBeDefined();
    });
});
