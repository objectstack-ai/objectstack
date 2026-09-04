// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15353] The install-local doors supply the EFFECTIVE tenancy posture to
 * `resolveAuthzContext`, so both posture-conditional API-key refusals are
 * reachable here.
 *
 * ## What was open, and how it was measured
 *
 * `resolveAuthzContext` gates BOTH posture-conditional API-key refusals on a
 * posture its CALLER supplies — `organization_required` (an org-less key under
 * a wall) and `organization_membership_ended` (a key stamped with an
 * organization its owner has left). `resolveInstallPrincipal` supplied none, so
 * neither guard ran, and an API key's `tenantId` is
 * `sys_api_key.active_organization_id` copied verbatim: the caller's own stored
 * claim, never vetted against current membership.
 *
 * Driven through the composed plugin, over a real ledger directory, with a
 * `tenancy` service reporting `isolated` — an EX-MEMBER's org-stamped key:
 *
 * | door                              | before | after |
 * |:--|:--|:--|
 * | `POST /install-local` (registry + syncSchemas + ledger) | **200, all three effects fired** | **401, zero effects** |
 * | `GET /install-local` (the listing) | **200, the install list served** | **401** |
 * | an org-LESS key, same posture      | **200** | **401** |
 * | a CURRENT member's key (control)   | 200 | 200 — unchanged |
 * | no credential (control)            | 401 | 401 — unchanged |
 *
 * ## ⛔ This file is not about seeding, and its neighbours are not about this
 *
 * `marketplace-install-local-tenancy-posture.test.ts` says "tenancy posture"
 * and means WHICH SEEDING PATH runs; it was green the whole time this door was
 * open. `marketplace-install-local-capability-enumeration.test.ts` (#8976) asks
 * whether a caller holds `manage_metadata` and is likewise green throughout —
 * it never presents an API key at all. Admission by CREDENTIAL under a tenancy
 * wall is this file.
 *
 * ## Real registry, real classification
 *
 * The `tenancy` service is registered on a REAL `ObjectKernel`, so the
 * never-registered / registered-and-broken distinction (#13906 decision 1
 * option A) comes from the registry's own rejections rather than from a
 * hand-branded stub at the seam under measurement. A hand-thrown error here
 * would pin the fixture, not the classification.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const seedCalls: unknown[] = [];
vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load(request: unknown) {
            seedCalls.push(request);
            return { summary: { totalInserted: 0, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
        }
    },
    recordSeedOutcome: vi.fn(),
}));

import {
    ObjectKernel,
    hashApiKey,
    AUTHZ_STORE_UNAVAILABLE_CODE,
    AUTHZ_STORE_UNAVAILABLE_STATUS,
} from '@objectstack/core';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';

const ROUTE_BASE = '/api/v1/marketplace/install-local';
const LEDGER_FILE = 'com.acme.tenancy.json';

/**
 * No `data` section on purpose: seeding takes a DIFFERENT path per posture, and
 * this file's subject is admission. The effects counted below are the three a
 * refusal must leave untouched no matter which seeding path a posture selects.
 */
const APP = {
    id: 'com.acme.tenancy',
    namespace: 'tenancy',
    version: '1.0.0',
    objects: [{ name: 'widget', fields: { code: { type: 'text' } } }],
};

const RAW_MEMBER_KEY = 'osk_member_key_fixture';
const RAW_EXMEMBER_KEY = 'osk_exmember_key_fixture';
const RAW_ORGLESS_KEY = 'osk_orgless_key_fixture';

/**
 * The fixture's ONE where-matcher: equality plus `$in`, the two shapes the
 * shared resolver issues. Every other shape REFUSES loudly rather than reading
 * as a field that happened not to match — an unimplemented operator that
 * silently returns `false` turns "this fixture cannot express the query" into
 * "the row is not there", which is how a permission fixture comes to prove the
 * opposite of what it claims.
 */
function matchesWhere(row: any, where: any): boolean {
    for (const [field, cond] of Object.entries(where ?? {})) {
        if (field.startsWith('$')) {
            throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
        }
        if (cond !== null && typeof cond === 'object') {
            const ops = Object.keys(cond as object);
            if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as any).$in)) {
                throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
            }
            if (!(cond as any).$in.includes(row[field])) return false;
            continue;
        }
        if (row[field] !== cond) return false;
    }
    return true;
}

/**
 * A permission store in the SHIPPED aggregation shapes: keys in `sys_api_key`,
 * memberships in `sys_member`, capabilities through `sys_user_permission_set`
 * → `sys_permission_set`. All three principals hold `manage_metadata`, so a
 * refusal below can only be the tenancy wall — never a missing capability.
 *
 * `u_exmember`'s key still carries `active_organization_id: 'org_A'`; the row
 * that made that stamp true is simply gone from `sys_member`. That is the whole
 * defect: the stamp is the caller's own stored claim.
 */
function permissionStore(opts: { syncSchemas: () => Promise<void> }) {
    const tables: Record<string, any[]> = {
        sys_api_key: [
            { id: 'key_member', key: hashApiKey(RAW_MEMBER_KEY), user_id: 'u_member', active_organization_id: 'org_A', revoked: false },
            { id: 'key_exmember', key: hashApiKey(RAW_EXMEMBER_KEY), user_id: 'u_exmember', active_organization_id: 'org_A', revoked: false },
            { id: 'key_orgless', key: hashApiKey(RAW_ORGLESS_KEY), user_id: 'u_orgless', revoked: false },
        ],
        // `u_exmember` is deliberately ABSENT: the membership that backed the
        // stamp ended. `u_orgless` never had one.
        sys_member: [{ id: 'm1', user_id: 'u_member', organization_id: 'org_A' }],
        sys_user: [
            { id: 'u_member', email: 'u_member@acme.test' },
            { id: 'u_exmember', email: 'u_exmember@acme.test' },
            { id: 'u_orgless', email: 'u_orgless@acme.test' },
            { id: 'u_session', email: 'u_session@acme.test' },
        ],
        sys_user_position: [],
        sys_position: [],
        sys_position_permission_set: [],
        sys_user_permission_set: [
            { id: 'ups_member', user_id: 'u_member', permission_set_id: 'ps_install', organization_id: null },
            { id: 'ups_exmember', user_id: 'u_exmember', permission_set_id: 'ps_install', organization_id: null },
            { id: 'ups_orgless', user_id: 'u_orgless', permission_set_id: 'ps_install', organization_id: null },
            { id: 'ups_session', user_id: 'u_session', permission_set_id: 'ps_install', organization_id: null },
        ],
        sys_permission_set: [
            { id: 'ps_install', name: 'admin_full_access', system_permissions: ['manage_metadata', 'studio.access'] },
        ],
    };
    return {
        syncSchemas: opts.syncSchemas,
        find: async (object: string, q: any = {}) => {
            const rows = (tables[object] ?? []).filter((row) => matchesWhere(row, q?.where));
            // The caller's bound is held BY PRESENCE, never re-derived here.
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
    };
}

type Tenancy =
    | { kind: 'unregistered' }
    | { kind: 'service'; posture: string }
    | { kind: 'factory-throws' }
    | { kind: 'no-async-registry' };

interface Mounted {
    routes: Map<string, (c: any) => Promise<any>>;
    register: ReturnType<typeof vi.fn>;
    syncSchemas: ReturnType<typeof vi.fn>;
    storageDir: string;
}

/**
 * Compose the plugin the way the kernel does — `start()` plus the
 * `kernel:ready` hook — over a real ledger directory, with the plugin's
 * services living on a REAL kernel so the tenancy lookup resolves through the
 * real registry.
 */
async function mount(tenancy: Tenancy, storageDir: string): Promise<Mounted> {
    const register = vi.fn(async () => undefined);
    const syncSchemas = vi.fn(async () => undefined);
    const routes = new Map<string, (c: any) => Promise<any>>();
    const rawApp = {
        get: (p: string, h: any) => { routes.set(`GET ${p}`, h); },
        post: (p: string, h: any) => { routes.set(`POST ${p}`, h); },
        delete: (p: string, h: any) => { routes.set(`DELETE ${p}`, h); },
    };
    const hooks = new Map<string, any>();

    // `gracefulShutdown: false` — a fixture kernel must not hook the test
    // runner's process signals.
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
    kernel.registerService('http-server', { getRawApp: () => rawApp });
    kernel.registerService('manifest', { register });
    kernel.registerService('objectql', permissionStore({ syncSchemas }));
    kernel.registerService('metadata', { getObject: async () => ({ name: 'widget', fields: {} }) });
    kernel.registerService('auth', {
        api: {
            getSession: async ({ headers }: any) => {
                const uid = headers?.get?.('x-fixture-session-user');
                return uid ? { user: { id: uid }, session: { activeOrganizationId: 'org_A' } } : null;
            },
        },
    });
    if (tenancy.kind === 'service') {
        kernel.registerService('tenancy', { posture: tenancy.posture });
    } else if (tenancy.kind === 'factory-throws') {
        // The REAL "registered and FAILED to construct" class (#13905): the
        // registry's own unbranded rejection, not a stub thrown at the seam.
        kernel.registerServiceFactory('tenancy', () => {
            throw new Error('tenancy backend unavailable');
        });
    }
    // 'unregistered' → nothing registered: the branded not-registered rejection.

    // Bound OUT of the `any`-typed literal below: a lookup call nested inside a
    // `: any` declaration is the #4251 erasure shape, and `check:slot-lookup`
    // reports it here exactly as it would in source.
    const getService = kernel.getService.bind(kernel);
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService,
        registerService: () => undefined,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        // A `KernelBase`-shaped host exposes `getKernel()` and has NO
        // `getServiceAsync` at all — the shape the seam must answer quietly
        // rather than dereference into a `TypeError`.
        getKernel: () => (tenancy.kind === 'no-async-registry' ? { getService } : kernel),
    };

    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir });
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();
    // `kernel:ready` registers the plugin's own Setup nav bundle; the effect
    // counters start from AFTER that so a refusal cannot be blamed for
    // boot-time activity it never caused.
    register.mockClear();
    return { routes, register, syncSchemas, storageDir };
}

function makeC(body: unknown, headers: Record<string, string>, manifestId?: string) {
    const h = new Headers(headers);
    return {
        req: {
            url: `http://localhost:3000${ROUTE_BASE}`,
            raw: new Request('http://localhost:3000/x', { headers: h }),
            header: (n: string) => h.get(n) ?? undefined,
            json: async () => body,
            param: () => manifestId,
        },
        json: (payload: any, status?: number) => ({ payload, status: status ?? 200 }),
    };
}

/** Everything a refusal must leave untouched, whichever seeding path a posture picks. */
function effectsOf(m: Mounted): number {
    return m.register.mock.calls.length
        + m.syncSchemas.mock.calls.length
        + (existsSync(join(m.storageDir, LEDGER_FILE)) ? 1 : 0);
}

async function install(m: Mounted, headers: Record<string, string>) {
    const handler = m.routes.get(`POST ${ROUTE_BASE}`)!;
    return handler(makeC({ manifest: APP }, headers));
}

async function list(m: Mounted, headers: Record<string, string>) {
    const handler = m.routes.get(`GET ${ROUTE_BASE}`)!;
    return handler(makeC({}, headers));
}

const KEY = (raw: string) => ({ 'x-api-key': raw });

let dir: string;
let savedPosture: string | undefined;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-tenancy-admission-'));
    seedCalls.length = 0;
    savedPosture = process.env.OS_TENANCY_POSTURE;
    delete process.env.OS_TENANCY_POSTURE;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = savedPosture;
    vi.restoreAllMocks();
});

describe('#15353 — under a wall-enforcing posture the doors refuse an unbacked key', () => {
    it("refuses an ex-member's org-stamped key at POST /install-local and changes nothing", async () => {
        const m = await mount({ kind: 'service', posture: 'isolated' }, dir);
        const res = await install(m, KEY(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(401);
        expect(res.payload).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
        expect(effectsOf(m)).toBe(0);
    });

    it("refuses an ex-member's org-stamped key at GET /install-local (the read leak)", async () => {
        const m = await mount({ kind: 'service', posture: 'isolated' }, dir);
        const res = await list(m, KEY(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(401);
        expect(res.payload).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    });

    it('refuses an organization-less key where the posture requires one', async () => {
        const m = await mount({ kind: 'service', posture: 'isolated' }, dir);
        const res = await install(m, KEY(RAW_ORGLESS_KEY));
        expect(res.status).toBe(401);
        expect(res.payload).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
        expect(effectsOf(m)).toBe(0);
    });

    it("CONTROL — a CURRENT member's key on the same posture still installs", async () => {
        // Without this the suite above would pass on a door that authenticates
        // nobody. The membership row is the ONLY difference from the first case.
        const m = await mount({ kind: 'service', posture: 'isolated' }, dir);
        const res = await install(m, KEY(RAW_MEMBER_KEY));
        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(effectsOf(m)).toBeGreaterThan(0);
    });

    it('CONTROL — no credential is still the plain anonymous 401', async () => {
        const m = await mount({ kind: 'service', posture: 'isolated' }, dir);
        const res = await install(m, {});
        expect(res.status).toBe(401);
        expect(res.payload).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
        expect(effectsOf(m)).toBe(0);
    });
});

describe('#15353 — the posture is the EFFECTIVE one, never the requested one', () => {
    it('admits the ex-member when the service reports `single` and the ENV asks for `isolated`', async () => {
        // ⭐ The discriminator. `resolveTenancyPosture()` — the value this file's
        // install-time gating reads, and the one a "reuse what is already in
        // scope" fix would carry to this seam — answers `isolated` here. The
        // posture IN FORCE is `single`, so there is no wall to be walled out of
        // and refusing would break working automation (ADR-0093 D4/D5).
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const m = await mount({ kind: 'service', posture: 'single' }, dir);
        const res = await install(m, KEY(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
    });

    it('refuses the ex-member when the service reports `isolated` and the ENV asks for nothing', async () => {
        // The same discriminator from the other side: a requested-posture fix
        // reads "no posture requested" here and admits.
        delete process.env.OS_TENANCY_POSTURE;
        const m = await mount({ kind: 'service', posture: 'isolated' }, dir);
        const res = await install(m, KEY(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(401);
        expect(effectsOf(m)).toBe(0);
    });
});

describe('#15353 — decision 1 option A: a BROKEN tenancy service is an outage, not a quiet admit', () => {
    it('raises the ADR-0112 503 envelope from POST rather than admitting', async () => {
        const m = await mount({ kind: 'factory-throws' }, dir);
        // ⛔ `toThrow()` alone would pass for any error, including the
        // `TypeError` a careless dereference raises. The envelope is the claim.
        const err = await install(m, KEY(RAW_EXMEMBER_KEY)).then(
            () => undefined,
            (e: unknown) => e,
        );
        expect(err).toBeDefined();
        expect((err as any).code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
        expect((err as any).status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
        expect((err as any).object).toBe('tenancy');
        expect(effectsOf(m)).toBe(0);
    });

    it('raises the same envelope from the GET listing', async () => {
        const m = await mount({ kind: 'factory-throws' }, dir);
        const err = await list(m, KEY(RAW_MEMBER_KEY)).then(
            () => undefined,
            (e: unknown) => e,
        );
        expect(err).toBeDefined();
        expect((err as any).code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
        expect((err as any).status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
    });
});

describe('#15353 — a host that registers no tenancy service keeps the quiet answer', () => {
    it('admits the ex-member when `tenancy` was NEVER registered', async () => {
        // The supported no-tenancy composition (a lean embedding without
        // `plugin-auth`): there is no wall, so there is nothing to be walled
        // out of, and behaviour is exactly what it was. ⚠️ This is the half of
        // the classification that a blanket `catch { undefined }` and a
        // fail-closed rewrite would both get wrong — in opposite directions.
        const m = await mount({ kind: 'unregistered' }, dir);
        const res = await install(m, KEY(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
    });

    it('admits when the host exposes `getKernel()` but no async registry', async () => {
        // `KernelBase`/`LiteKernel`: no `getServiceAsync`, and no service
        // factories either, so absence is the only fault such a host could
        // report. Dereferencing would raise an unbranded — therefore LOUD —
        // `TypeError` and turn a supported host shape into an outage.
        const m = await mount({ kind: 'no-async-registry' }, dir);
        const res = await install(m, KEY(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
    });
});

describe('#15353 — BOUNDARY: the session path is not what this repairs', () => {
    it('does not refuse a SESSION whose active organization the caller does not belong to', async () => {
        // Measured, and pinned so nobody reads this card as having closed the
        // session path: both posture-conditional refusals in
        // `resolveAuthzContext` key on `keyPrincipal`, which is set only by the
        // API-key admission. A session's `activeOrganizationId` reaches
        // `ctx.tenantId` without passing either guard. Supplying the posture at
        // this door changes NOTHING for a session caller — that is a separate
        // question about a different mechanism, not a gap in this fix.
        const m = await mount({ kind: 'service', posture: 'isolated' }, dir);
        const res = await install(m, { 'x-fixture-session-user': 'u_session' });
        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
    });
});
