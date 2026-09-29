// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20477] The dispatcher's `/packages` doors scope a caller to the VETTED
 * active organization on the request's execution context, never to the
 * session's `activeOrganizationId` as stored.
 *
 * ## The defect
 *
 * Nine `/packages` doors take their organization from
 * `deps.resolveActiveOrganizationId`, and that source read
 * `session.activeOrganizationId` off the auth service unchanged. The value the
 * identity step VETS is a different one: `resolveAuthzContext`
 * (`@objectstack/core`) writes the caller's organization onto the execution
 * context as `tenantId`, and under a wall-enforcing posture it DROPS a session
 * claim naming an organization its owner no longer belongs to (maintainer
 * ruling B on #15409, implemented by PR #15794). The dispatcher's doors never
 * saw the drop, so a member removed from an organization kept that
 * organization's package partition for the rest of the session: they read its
 * commit history, export and duplicate source, and they published, discarded,
 * reverted, rolled back, adopted and uninstalled inside it.
 *
 * ## The rig
 *
 * The REAL identity resolution on every request: `dispatch()` runs
 * `resolveRequestScope` → `resolveExecutionContext` → `resolveAuthzContext`
 * under an `isolated` posture. Only the caller's stored session claim and
 * their `sys_member` rows differ between arms, and every caller holds the ONE
 * shared permission set, so RBAC cannot separate any two arms: only the
 * organization can.
 *
 * Both HTTP entries into the `/packages` domain drive it:
 *
 *  - `dispatch()` itself, the delegate of `createHonoApp`'s `${prefix}/*`
 *    catch-all;
 *  - `createDispatcherPlugin`'s explicit package mounts, over a real socket on
 *    `HonoServerPlugin`.
 *
 * `RestServer` is not a third: its package registrar mounts only
 * `POST /packages/publish`, and the dispatcher's domain is the family's one
 * implementation.
 *
 * ## The protocol double
 *
 * It keeps each organization's package state in its own partition, plus an
 * env-wide one, and answers every verb from the partition the request's
 * `organizationId` names (env-wide when none). Every partition's names carry
 * its organization, so a read of organization A's rows is visible in the
 * answer and a write to them is visible in the store. `deletePackage` mirrors
 * the real protocol's refusal of an uninstall that names no organization
 * (`400 TENANT_SCOPE_REQUIRED`, `metadata-protocol` `deletePackage`).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { LiteKernel, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';
import { HttpDispatcher } from '../http-dispatcher.js';
import { createDispatcherPlugin } from '../dispatcher-plugin.js';

const PREFIX = '/api/v1';
const PKG = 'com.acme.crm';
const ALPHA = 'org_alpha';
const BETA = 'org_beta';
/** The env-wide partition's key: what a request carrying no organization reaches. */
const ENV_WIDE = 'env_wide';
const SESSION_HEADER = 'x-test-session';

// ── The package store: one partition per organization, and the env-wide one ──

interface Partition {
    drafts: string[];
    commits: string[];
    rows: string[];
    orphans: string[];
    dashboards: Array<{ name: string; label: string }>;
}

function partition(tag: string): Partition {
    return {
        drafts: [`${tag}_draft`],
        commits: [`cmt_${tag}`],
        rows: [`${tag}_row`],
        orphans: [`${tag}_orphan`],
        dashboards: [{ name: `${tag}_board`, label: `${tag} board` }],
    };
}

function seedStore(): Record<string, Partition> {
    return { [ALPHA]: partition('alpha'), [BETA]: partition('beta'), [ENV_WIDE]: partition('shared') };
}

interface ProtocolCall { verb: string; organizationId: unknown }

/** Mutable per-test state the protocol double reads — reset before every test. */
const state: { store: Record<string, Partition>; calls: ProtocolCall[] } = { store: seedStore(), calls: [] };

/** A refusal whose text never echoes request input, so a leak check on the answer reads only partition data. */
function notFound(): Error {
    return Object.assign(new Error('No such commit in this scope.'), { code: 'NOT_FOUND', status: 404 });
}

function protocolDouble() {
    const scopeOf = (req: any): string => (typeof req?.organizationId === 'string' ? req.organizationId : ENV_WIDE);
    const record = (verb: string, req: any) => {
        state.calls.push({ verb, organizationId: req?.organizationId });
        return state.store[scopeOf(req)] ?? partition('unseeded');
    };
    const takeCommit = (p: Partition, commitId: unknown) => {
        const at = p.commits.indexOf(String(commitId));
        if (at < 0) throw notFound();
        p.commits.splice(at, 1);
    };
    return {
        publishPackageDrafts: async (req: any) => {
            const drafts = record('publishPackageDrafts', req).drafts.splice(0);
            return { success: true, publishedCount: drafts.length, failedCount: 0, published: [], failed: [], drafts };
        },
        discardPackageDrafts: async (req: any) => {
            const discarded = record('discardPackageDrafts', req).drafts.splice(0);
            return { success: true, discardedCount: discarded.length, discarded };
        },
        listCommits: async (req: any) =>
            record('listCommits', req).commits.map((id) => ({ id, packageId: req.packageId })),
        revertCommit: async (req: any) => {
            takeCommit(record('revertCommit', req), req.commitId);
            return { success: true };
        },
        rollbackToPackageCommit: async (req: any) => {
            takeCommit(record('rollbackToPackageCommit', req), req.commitId);
            return { success: true };
        },
        reassignOrphanedMetadata: async (req: any) => {
            const reassigned = record('reassignOrphanedMetadata', req).orphans.splice(0);
            return { success: true, reassignedCount: reassigned.length, reassigned };
        },
        duplicatePackage: async (req: any) => ({ success: true, copied: [...record('duplicatePackage', req).rows] }),
        deletePackage: async (req: any) => {
            state.calls.push({ verb: 'deletePackage', organizationId: req?.organizationId });
            if (!req?.organizationId && req?.allTenants !== true) {
                throw Object.assign(new Error('Refusing to uninstall with no organization scope.'), {
                    code: 'TENANT_SCOPE_REQUIRED', status: 400,
                });
            }
            // An org-scoped uninstall reaches the org's rows AND the env-wide ones (#7705).
            const deleted = [...state.store[scopeOf(req)].rows.splice(0), ...state.store[ENV_WIDE].rows.splice(0)];
            return { success: true, deletedCount: deleted.length, failedCount: 0, deleted };
        },
        getMetaItems: async (req: any) => {
            const p = record('getMetaItems', req);
            if (req?.type !== 'dashboard') return { items: [] };
            const items = scopeOf(req) === ENV_WIDE ? p.dashboards : [...state.store[ENV_WIDE].dashboards, ...p.dashboards];
            return { items: items.map((d) => ({ ...d })) };
        },
    };
}

// ── Identity: sessions and the permission store, in the shipped shapes ────────

/**
 * `u_exmember`'s stale session names `org_alpha` while their only current
 * `sys_member` row is `org_beta`. `u_member` is a current `org_alpha` member.
 * Both hold ONE shared permission set carrying both package capabilities.
 */
function makeQl() {
    const tables: Record<string, any[]> = {
        sys_api_key: [],
        sys_member: [
            { user_id: 'u_member', organization_id: ALPHA, role: 'member' },
            { user_id: 'u_exmember', organization_id: BETA, role: 'member' },
        ],
        sys_user: [
            { id: 'u_member', email: 'u_member@example.com' },
            { id: 'u_exmember', email: 'u_exmember@example.com' },
        ],
        sys_user_permission_set: [
            { user_id: 'u_member', permission_set_id: 'ps_shared' },
            { user_id: 'u_exmember', permission_set_id: 'ps_shared' },
        ],
        sys_permission_set: [
            { id: 'ps_shared', name: 'shared_access', system_permissions: ['manage_metadata', 'studio.access'] },
        ],
    };
    /** Equality plus `$in`, and a loud refusal of every other shape. */
    const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([field, cond]) => {
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
    const pkg = { manifest: { id: PKG, name: 'CRM', version: '1.0.0', scope: 'project' } };
    return {
        find: async (object: string, q: any = {}) => {
            const rows = (tables[object] ?? []).filter((row: any) => matches(row, q?.where));
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
        // The `/packages` domain's registry probe, answered for one writable base.
        registry: {
            getAllPackages: () => [pkg],
            getPackage: (id: string) => (id === PKG ? pkg : undefined),
            // `false` keeps the uninstall off the persisted disable-state file; the
            // subject here is the organization the protocol call carries.
            uninstallPackage: () => false,
        },
    };
}

interface SessionRow { id: string; token: string; userId: string; activeOrganizationId: string }

const SESSIONS: Record<string, SessionRow> = {
    sid_member: { id: 'ses_member', token: 'tok_member', userId: 'u_member', activeOrganizationId: ALPHA },
    // ⭐ THE SUBJECT: the claim outlived the membership that backed it.
    sid_exmember: { id: 'ses_exmember', token: 'tok_exmember', userId: 'u_exmember', activeOrganizationId: ALPHA },
    // The same person, switched to an organization they ARE in.
    sid_exmember_beta: { id: 'ses_exmember_beta', token: 'tok_exmember_beta', userId: 'u_exmember', activeOrganizationId: BETA },
};

function authService() {
    return {
        api: {
            getSession: async ({ headers }: any) => {
                const sid: string | undefined = typeof headers?.get === 'function'
                    ? headers.get(SESSION_HEADER) ?? undefined
                    : headers?.[SESSION_HEADER];
                const row = sid ? SESSIONS[sid] : undefined;
                if (!row) return undefined;
                return { user: { id: row.userId, email: `${row.userId}@example.com` }, session: { ...row } };
            },
        },
    };
}

const TENANCY = { posture: 'isolated' };

function services(): Record<string, unknown> {
    return { protocol: protocolDouble(), auth: authService(), objectql: makeQl(), tenancy: TENANCY };
}

// ── The two HTTP entries into the domain ──────────────────────────────────────

type Who = 'member' | 'exmember' | 'exmember_beta' | 'anonymous';
const SID: Record<Who, string | undefined> = {
    member: 'sid_member', exmember: 'sid_exmember', exmember_beta: 'sid_exmember_beta', anonymous: undefined,
};

interface Answer { status: number; code?: string; body: any }
type Call = (method: string, who: Who, path: string, body?: unknown) => Promise<Answer>;

/** `dispatch()` — the delegate of `createHonoApp`'s catch-all. */
function dispatchEntry(): Call {
    const svc = services();
    const get = (n: string) => svc[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    return async (method, who, path, body) => {
        const sid = SID[who];
        const res = await dispatcher.dispatch(method, path, body, {}, {
            request: { headers: sid ? { [SESSION_HEADER]: sid } : {} },
        } as any);
        const b: any = res.response?.body;
        return { status: res.response?.status ?? 0, code: b?.error?.code, body: b };
    };
}

/** `createDispatcherPlugin`'s explicit package mounts, over a real socket. */
function servicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.packages-vetted-org-source',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            for (const [name, svc] of Object.entries(services())) ctx.registerService(name, svc);
        },
    };
}

let socketKernel: LiteKernel | undefined;
let socketBase = '';

const socketEntry: Call = async (method, who, path, body) => {
    const sid = SID[who];
    const res = await fetch(`${socketBase}${PREFIX}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(sid ? { [SESSION_HEADER]: sid } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let b: any;
    try { b = await res.json(); } catch { b = undefined; }
    return { status: res.status, code: b?.error?.code, body: b };
};

const TRANSPORTS: Array<[string, () => Call]> = [
    ['dispatch()', dispatchEntry],
    ['the plugin mount (socket)', () => socketEntry],
];

beforeAll(async () => {
    socketKernel = new LiteKernel();
    socketKernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    socketKernel.use(servicesPlugin());
    socketKernel.use(createDispatcherPlugin({ prefix: PREFIX, securityHeaders: false }));
    await socketKernel.bootstrap();
    socketBase = `http://127.0.0.1:${socketKernel.getService<IHttpServer>('http.server').getPort!()}`;
}, 60_000);

afterAll(async () => {
    if (!socketKernel) return;
    await Promise.race([socketKernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
}, 30_000);

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    state.store = seedStore();
    state.calls = [];
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); });

// ── The nine doors that read the organization source ──────────────────────────

interface Door { name: string; method: string; path: string; body?: unknown; verb: string }

const DOORS: Door[] = [
    { name: 'POST /packages/:id/publish-drafts', method: 'POST', path: `/packages/${PKG}/publish-drafts`, body: {}, verb: 'publishPackageDrafts' },
    { name: 'POST /packages/:id/discard-drafts', method: 'POST', path: `/packages/${PKG}/discard-drafts`, body: {}, verb: 'discardPackageDrafts' },
    { name: 'GET /packages/:id/commits', method: 'GET', path: `/packages/${PKG}/commits`, verb: 'listCommits' },
    { name: 'POST /packages/:id/commits/:commitId/revert', method: 'POST', path: `/packages/${PKG}/commits/cmt_alpha/revert`, body: {}, verb: 'revertCommit' },
    { name: 'POST /packages/:id/rollback', method: 'POST', path: `/packages/${PKG}/rollback`, body: { commitId: 'cmt_alpha' }, verb: 'rollbackToPackageCommit' },
    { name: 'POST /packages/:id/adopt-orphans', method: 'POST', path: `/packages/${PKG}/adopt-orphans`, body: {}, verb: 'reassignOrphanedMetadata' },
    { name: 'POST /packages/:id/duplicate', method: 'POST', path: `/packages/${PKG}/duplicate`, body: { targetPackageId: 'com.acme.crm_copy' }, verb: 'duplicatePackage' },
    { name: 'DELETE /packages/:id', method: 'DELETE', path: `/packages/${PKG}`, verb: 'deletePackage' },
    { name: 'GET /packages/:id/export', method: 'GET', path: `/packages/${PKG}/export`, verb: 'getMetaItems' },
];

/** Did this request read or write organization `tag`'s partition? */
function touched(orgId: string, tag: string, answer: Answer): { wrote: boolean; read: boolean } {
    return {
        wrote: JSON.stringify(state.store[orgId]) !== JSON.stringify(partition(tag)),
        read: JSON.stringify(answer.body ?? null).includes(tag),
    };
}

const organizationsCarried = () => [...new Set(state.calls.map((c) => c.organizationId))];

// ── Controls: the rig separates the organizations, and the resolver drops the claim ──

describe('[#20477] controls: the rig can tell the organizations apart', () => {
    for (const [transport, entry] of TRANSPORTS) {
        for (const door of DOORS) {
            it(`${transport} · ${door.name}: a CURRENT member reaches their own organization's partition`, async () => {
                const answer = await entry()(door.method, 'member', door.path, door.body);
                expect(state.calls.map((c) => c.verb)).toContain(door.verb);
                expect(organizationsCarried()).toEqual([ALPHA]);
                const { wrote, read } = touched(ALPHA, 'alpha', answer);
                expect(wrote || read, `${door.name} -> ${answer.status} ${JSON.stringify(answer.body)}`).toBe(true);
            });

            it(`${transport} · ${door.name}: the ex-member, switched to an organization they ARE in, reaches that one and never the left one`, async () => {
                const answer = await entry()(door.method, 'exmember_beta', door.path, door.body);
                expect(organizationsCarried()).toEqual([BETA]);
                expect(touched(ALPHA, 'alpha', answer)).toEqual({ wrote: false, read: false });
            });

            it(`${transport} · ${door.name}: an anonymous caller is refused before any protocol call, as before`, async () => {
                const answer = await entry()(door.method, 'anonymous', door.path, door.body);
                expect({ status: answer.status, code: answer.code }).toEqual({ status: ANONYMOUS_DENY_STATUS, code: ANONYMOUS_DENY_CODE });
                expect(state.calls).toEqual([]);
            });
        }

        it(`${transport}: the resolver really DROPS the ex-member's claim — the subject below is not a rig that never presented it`, async () => {
            await entry()('GET', 'exmember', `/packages/${PKG}/commits`);
            const dropped = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]))
                .filter((line: string) => line.includes('Session organization claim dropped'));
            expect(dropped.length).toBeGreaterThan(0);
            expect(dropped[0]).toContain(`organization=${ALPHA}`);
        });
    }
});

// ── The subject: a claim the resolver dropped scopes nothing ──────────────────

describe('[#20477] a session claim the resolver DROPPED reaches no organization on any /packages door', () => {
    for (const [transport, entry] of TRANSPORTS) {
        // [#20492] The uninstall door is pinned on its own, below: it refuses a
        // caller with no organization BEFORE the protocol is asked at all, so
        // there is no protocol call for this generic pin to read.
        for (const door of DOORS.filter((d) => d.verb !== 'deletePackage')) {
            it(`${transport} · ${door.name}: the protocol is handed no organization, and the left organization's rows are neither read nor written`, async () => {
                const answer = await entry()(door.method, 'exmember', door.path, door.body);
                expect(state.calls.map((c) => c.verb)).toContain(door.verb);
                expect(organizationsCarried()).toEqual([undefined]);
                expect(touched(ALPHA, 'alpha', answer), `${door.name} -> ${answer.status} ${JSON.stringify(answer.body)}`)
                    .toEqual({ wrote: false, read: false });
            });
        }

        // [#20492] The refusal is the door's own now, taken before the registry
        // is touched: the protocol is never handed the org-less request. The
        // registry half of "nothing changed" is pinned in
        // `packages-uninstall-refuse-before-mutate.test.ts` (this rig's
        // registry cannot uninstall anything).
        it(`${transport} · DELETE /packages/:id: the org-less uninstall is refused by the door before the protocol is asked, and nothing is deleted`, async () => {
            const answer = await entry()('DELETE', 'exmember', `/packages/${PKG}`);
            expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'TENANT_SCOPE_REQUIRED' });
            expect(state.calls).toEqual([]);
            expect(state.store).toEqual(seedStore());
        });
    }
});
