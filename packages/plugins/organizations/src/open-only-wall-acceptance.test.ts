// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ⭐ THE OPEN-ONLY WALL ACCEPTANCE (#16137) — an install that mounts only
 * Apache-2.0 packages RAISES the organization wall, and the matrix runs
 * against the posture that composition actually RESOLVES.
 *
 * ## The gap this closes, stated as a measurement
 *
 * `packages/rest/src/single-kernel-isolated-api-key-matrix.test.ts` and
 * `single-kernel-isolated-session-org-claim-matrix.test.ts` already drive the
 * whole matrix at REST level under a live `isolated` posture. Both MANUFACTURE
 * that posture:
 *
 *     const tenancyServiceProvider = async () => ({ posture: 'isolated' });
 *
 * ⇒ they prove the wall BEHAVES CORRECTLY GIVEN A POSTURE, and say nothing
 * about whether anything open can PRODUCE one. Until ADR-0132 moved this
 * package into the open core that was unavoidable — the only registrar was
 * cloud-private. This file is the other half: ⛔ NO STUB ANYWHERE. The posture
 * every arm below runs under is read back out of the `tenancy` service that a
 * real `LiteKernel` boot of the real `AuthPlugin` + the real
 * `OrganizationsPlugin` resolved.
 *
 * ## Why the acceptance lives in THIS package
 *
 * It cannot live beside the two suites it accepts. `no-framework-dependents.pin.test.ts`
 * refuses any `packages/**` workspace package declaring `@objectstack/organizations`
 * in any dependency field — that is ADR-0132's entitlement boundary, and a
 * devDependency added to `packages/rest` to reach the plugin would break it.
 * The prohibition is asymmetric on purpose, and this file is on the permitted
 * side of it: this package may depend on framework packages freely, so the
 * acceptance comes to the plugin rather than the plugin going to the acceptance.
 *
 * ⇒ The fixture below is a deliberate SECOND COPY of the two matrices' fixture,
 * not an extraction. Acceptance clause 4 is that the stub suites stay exactly as
 * they are; hoisting their fixture into a shared module would have rewritten
 * both of them, which is the one thing the clause forbids. The duplication is
 * the cost of leaving them untouched, and it is paid knowingly.
 *
 * ## What is real here, and what is fixture
 *
 * REAL, and load-bearing:
 *   - `LiteKernel` — the kernel's own Phase 1 / Phase 2 ordering, its
 *     `requiresServices` contract, its `kernel:ready` / `kernel:bootstrapped`
 *     propagating hooks. §1 only passes because a real boot completed.
 *   - `AuthPlugin` — the open-core home of `createTenancyService`, whose
 *     `probeIsolation` is `() => !!ctx.getService('org-scoping')` and whose
 *     `probeEntitledPostures` reads `supportedPostures` off whatever answers.
 *   - `OrganizationsPlugin` — THIS package, the open registrar, mounted with
 *     its constructor defaults. Its walled membership-policy gate really runs
 *     on `kernel:bootstrapped` (declare the policy or the boot is refused).
 *   - `RestServer` — the real routes and the real `resolveExecCtx` →
 *     `computeExecCtx` → `resolveAuthzContext` chain. ⛔ Not stubbed: what that
 *     chain derives from the resolved posture is the whole subject.
 *
 * FIXTURE, and stated so it is never mistaken for more:
 *   - the permission store (`makeQl`) and the data plane (`protocol`), in the
 *     shipped aggregation shapes, exactly as the two matrices write them. Layer
 *     0 is MODELLED as `tenant-layer.ts` computes it under `isolated` — hard
 *     equality, with a missing active organization as the DENY sentinel — plus
 *     ADR-0123 D2's write refusal. Modelled, not mocked away.
 *
 * ## The environment this boots under (acceptance clause 1, as sharpened)
 *
 * `OS_TENANCY_POSTURE=isolated` with **`OS_ALLOW_DEGRADED_TENANCY` UNSET**. The
 * degrade flag is the thing this card exists to make unnecessary — a wall
 * *configured but not enforced* is the state ADR-0093 D5 refuses — so setting it
 * anywhere here would void the acceptance. §0 asserts it is unset through the
 * same resolver `serve.ts` reads, rather than trusting that nobody set it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiteKernel, hashApiKey, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE } from '@objectstack/core';
import { resolveAllowDegradedTenancy, resolveTenancyPosture } from '@objectstack/types';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { RestServer } from '@objectstack/rest';
import { OrganizationsPlugin } from './organizations-plugin.js';

const DATA_COLLECTION = '/api/v1/data/:object';
const OBJECT = 'sys_business_unit';

const RAW_MEMBER_KEY = 'osk_16137_member';
const RAW_EXMEMBER_KEY = 'osk_16137_exmember';
const RAW_ORGLESS_KEY = 'osk_16137_orgless';

const COOKIE_MEMBER = 'os_session=sid_member';
const COOKIE_EXMEMBER = 'os_session=sid_exmember';

/**
 * The `sys_session.token`. A separate column from the row `id` — which is why a
 * drop line may name the id and never this: `sys-session.object.ts`'s own field
 * comment records a replay-proven impersonation.
 */
const TOKEN_EXMEMBER = 'sess_token_16137_never_log_me';

/** The declared platform owner. A walled boot refuses without one (#11184). */
const OWNER_EMAIL = 'operator@open-only.example';

// ---------------------------------------------------------------------------
// The store — the fixture's table, read directly by the write assertions
// ---------------------------------------------------------------------------

interface BusinessUnitRow {
    id: string;
    organization_id: string | undefined;
    created_by: string | undefined;
    name: string;
}

const SEED: BusinessUnitRow[] = [
    { id: 'bu_a1', organization_id: 'org_alpha', created_by: undefined, name: 'alpha unit 1' },
    { id: 'bu_a2', organization_id: 'org_alpha', created_by: undefined, name: 'alpha unit 2' },
    // The other organization, seeded so "the wall is live" is a control rather
    // than an assumption: a member of org_alpha must never see these two, and
    // the ex-member has somewhere legitimate to still work.
    { id: 'bu_b1', organization_id: 'org_beta', created_by: undefined, name: 'beta unit 1' },
    { id: 'bu_b2', organization_id: 'org_beta', created_by: undefined, name: 'beta unit 2' },
];

/**
 * The fixture's ONE hand-written where-matcher: equality plus `$in` — the two
 * shapes the shared resolver actually issues — refusing every other shape
 * loudly, so a combinator it does not implement can never read as a field that
 * happened not to match.
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

/** A session row, as `sys_session` declares it: `id` and `token` are separate. */
interface SessionRow {
    id: string;
    token: string;
    userId: string;
    activeOrganizationId: string | null;
}

/**
 * The permission store, in the SHIPPED aggregation shapes.
 *
 * `u_exmember` holds BOTH an org-stamped API key and a live session stamped
 * `org_alpha`, while its only current `sys_member` row is for `org_beta` — the
 * credential outlived the membership that backed it, in both of the two shapes
 * a credential comes in. Carrying both in one store is safe because a request
 * carries one credential: an API key sets the principal and the session path is
 * never reached, which is why every arm below passes exactly one.
 *
 * RBAC is opened SYMMETRICALLY for every principal through one permission set —
 * the cloud reading's discipline. With one shared grant, RBAC cannot be what
 * separates any two arms; only the organization wall can be.
 */
function makeQl() {
    const tables: Record<string, any[]> = {
        sys_api_key: [
            { id: 'key_member', key: hashApiKey(RAW_MEMBER_KEY), user_id: 'u_member', active_organization_id: 'org_alpha', revoked: false },
            { id: 'key_exmember', key: hashApiKey(RAW_EXMEMBER_KEY), user_id: 'u_exmember', active_organization_id: 'org_alpha', revoked: false },
            { id: 'key_orgless', key: hashApiKey(RAW_ORGLESS_KEY), user_id: 'u_orgless', revoked: false },
        ],
        sys_member: [
            { user_id: 'u_member', organization_id: 'org_alpha', role: 'member' },
            { user_id: 'u_exmember', organization_id: 'org_beta', role: 'member' },
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
        // The mounted plugin's own boot path reads this one (default-org
        // bootstrap / per-org seed pipeline). Empty is the honest answer for a
        // fixture that seeds no organization rows.
        sys_organization: [],
    };
    return {
        tables,
        find: async (object: string, q: any = {}) => {
            const rows = (tables[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
    };
}

// ---------------------------------------------------------------------------
// Layer 0, as `plugin-security/src/tenant-layer.ts` computes it under `isolated`
// ---------------------------------------------------------------------------

/**
 * `computeTenantLayer0Filter`'s `isolated` branch, transcribed: a missing active
 * organization is the DENY sentinel, never "no filter". Getting this backwards
 * is the whole defect class — a resolver that hands down no tenant and a wall
 * that reads that as "unscoped" is a wall that is off.
 */
function layer0IsDenied(tenantId: string | undefined): boolean {
    return !tenantId;
}

/** ADR-0123 D2's write half, as `security-plugin.ts` throws it. */
function tenantWriteRefusal(): Error {
    const err: any = new Error(
        "[Security] Access denied: 'sys_business_unit' is scoped to an organization, and this session "
        + 'has no active organization — so this create has no organization to place the record in. '
        + 'Join or select an active organization and retry.',
    );
    err.name = 'PermissionDeniedError';
    err.code = 'PERMISSION_DENIED';
    return err;
}

// ---------------------------------------------------------------------------
// The OPEN-ONLY COMPOSITION
// ---------------------------------------------------------------------------

/**
 * A `Map` that records every service NAME looked up through it.
 *
 * The kernel's `PluginContext.getService` reads `this.services` on each call, so
 * swapping the registry in before `bootstrap()` records every lookup any plugin
 * makes during boot AND every lookup the REST providers make per request.
 * Acceptance clause 3 is measured off this: a licence check has to ASK for
 * something, and this is the ledger of everything the open composition asked
 * for. §3 carries the positive control that the ledger can see one.
 */
class RecordingServiceRegistry extends Map<string, any> {
    readonly lookups: string[] = [];
    override get(name: string): any {
        this.lookups.push(name);
        return super.get(name);
    }
}

/**
 * The app-side data plane, standing in the `objectql` engine slot.
 *
 * Named `com.objectstack.engine.objectql` because BOTH real plugins declare
 * that id in `dependencies`, and `providesServices` is declared because
 * `AuthPlugin` lists `data` in `requiresServices` — the kernel's own
 * pre-Phase-1 ordering contract (#4131) refuses the boot otherwise, which is
 * the composition being checked rather than worked around.
 */
class FixtureDataPlanePlugin {
    name = 'com.objectstack.engine.objectql';
    type = 'standard' as const;
    version = '1.0.0';
    providesServices = ['objectql', 'data', 'manifest', 'metadata'];
    readonly middlewares: any[] = [];

    constructor(private readonly ql: ReturnType<typeof makeQl>) {}

    async init(ctx: any): Promise<void> {
        const engine = {
            registerMiddleware: (mw: any) => this.middlewares.push(mw),
            find: this.ql.find,
            getSchema: (name: string) => ({
                name,
                fields: { id: { name: 'id' }, organization_id: { name: 'organization_id' } },
            }),
        };
        ctx.registerService('manifest', { register: () => {} });
        ctx.registerService('metadata', { get: async () => undefined });
        ctx.registerService('data', engine);
        ctx.registerService('objectql', engine);
    }
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

interface TenancyShape {
    posture: string;
    requestedPosture: string;
    isolationActive: boolean;
    degraded: boolean;
}

interface Composition {
    kernel: LiteKernel;
    rest: RestServer;
    /** The plugin instance mounted, or `undefined` in the ablated composition. */
    orgPlugin?: OrganizationsPlugin;
    /** Every row the fixture table holds, in insertion order. */
    store: () => BusinessUnitRow[];
    warnings: () => string[];
    /** Every service name looked up through the kernel registry, in order. */
    lookups: () => string[];
    /**
     * better-auth's `setActiveOrganization`, modelled: it rewrites the claim on
     * the SAME session row — same id, same token, same cookie.
     */
    switchActiveOrganization: (cookie: string, org: string | null) => void;
}

/**
 * Boot the open-only composition and wire a real `RestServer` to the posture it
 * RESOLVED.
 *
 * `mountOrgScoping: false` is the ablation and the maintainer's negative
 * control in one: the identical composition with the single open registrar
 * removed. Nothing else moves — same kernel, same AuthPlugin, same env, same
 * fixture, same routes.
 */
async function bootOpenOnlyComposition(
    opts: { mountOrgScoping?: boolean } = {},
): Promise<Composition> {
    const mountOrgScoping = opts.mountOrgScoping !== false;
    const rows: BusinessUnitRow[] = SEED.map((r) => ({ ...r }));
    let seq = 0;
    const ql = makeQl();

    const sessions: Record<string, SessionRow> = {
        sid_member: { id: 'ses_member', token: 'sess_token_member', userId: 'u_member', activeOrganizationId: 'org_alpha' },
        // ⭐ THE SUBJECT of the session row: the claim outlived the membership.
        sid_exmember: { id: 'ses_exmember', token: TOKEN_EXMEMBER, userId: 'u_exmember', activeOrganizationId: 'org_alpha' },
    };

    // ── The kernel boot. Only Apache-2.0 packages are mounted. ──────────────
    // `silent` because the fixture's identity tables are deliberately partial
    // (users with no `sys_account` rows), which a real boot reports at ERROR
    // level once per boot — 30-odd times over this file. It silences the
    // KERNEL logger only: every line these arms assert on is a `console.warn`
    // written by `RestServer`, which holds no kernel logger and is untouched.
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    const registry = new RecordingServiceRegistry();
    (kernel as unknown as { services: Map<string, any> }).services = registry;

    kernel.use(new FixtureDataPlanePlugin(ql) as any);
    // A walled deployment must DECLARE what a new user joins — this package's
    // own `kernel:bootstrapped` gate refuses the boot otherwise. Declared the
    // way a host declares it, which is what makes the refusal survivable
    // rather than something the fixture routes around.
    kernel.use(new AuthPlugin({
        secret: 'open-only-acceptance-secret-at-least-32-chars',
        membershipPolicy: 'invite-only',
    }) as any);
    const orgPlugin = mountOrgScoping ? new OrganizationsPlugin() : undefined;
    if (orgPlugin) kernel.use(orgPlugin as any);

    await kernel.bootstrap();

    // ── The REST wiring, as `rest-api-plugin.ts` builds it for a single kernel.
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn(async (r: any) => {
            const tenantId = r?.context?.tenantId;
            // RLS_DENY_FILTER — zero rows, never "everything".
            if (layer0IsDenied(tenantId)) return { value: [], total: 0 };
            const visible = rows.filter((row) => row.organization_id === tenantId);
            return { value: visible, total: visible.length };
        }),
        createData: vi.fn(async (r: any) => {
            const tenantId = r?.context?.tenantId;
            // [ADR-0123 D2] No active organization → the write is REFUSED, not
            // landed with a NULL organization no reader could ever see.
            if (layer0IsDenied(tenantId)) throw tenantWriteRefusal();
            const row: BusinessUnitRow = {
                id: `w${++seq}`,
                organization_id: tenantId,
                created_by: r?.context?.userId,
                name: String(r?.data?.name ?? ''),
            };
            rows.push(row);
            return row;
        }),
    };

    const server: any = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };

    const authServiceProvider = async () => ({
        api: {
            getSession: async ({ headers }: any) => {
                const cookie: string | undefined = headers?.get?.('cookie') ?? undefined;
                const sid = cookie?.split('os_session=')[1]?.split(';')[0];
                const row = sid ? sessions[sid] : undefined;
                if (!row) return undefined;
                return { user: { id: row.userId, email: `${row.userId}@example.com` }, session: { ...row } };
            },
        },
    });
    const objectQLProvider = async () => ql;

    // ⭐ THE ONE LINE THIS CARD IS ABOUT. `rest-api-plugin.ts`'s sync leg,
    // verbatim in shape: a `KernelBase`-shaped host has no `getServiceAsync`,
    // so the provider reads the registry directly and absorbs only
    // "not registered". ⛔ It returns no literal — the posture it hands the
    // admission chain is whatever the booted composition RESOLVED.
    const tenancyServiceProvider = async () => {
        try { return kernel.getService<TenancyShape>('tenancy'); } catch { return undefined; }
    };

    const rest = new RestServer(
        server,
        protocol,
        {} as any,
        undefined,               // kernelManager — THE single-kernel wiring
        undefined,               // envRegistry
        undefined,               // defaultEnvironmentIdProvider
        authServiceProvider,
        objectQLProvider,
        undefined, undefined, undefined, undefined, undefined, undefined,  // email…i18n
        undefined, undefined, undefined, undefined, undefined, undefined,  // analytics…metadata
        tenancyServiceProvider,
    );
    rest.registerRoutes();

    return {
        kernel,
        rest,
        orgPlugin,
        store: () => rows.map((r) => ({ ...r })),
        warnings: () => warnSpy.mock.calls.map((c: unknown[]) => c.map(String).join(' ')),
        lookups: () => [...registry.lookups],
        switchActiveOrganization: (cookie, org) => {
            const sid = cookie.split('os_session=')[1]?.split(';')[0] as string;
            sessions[sid].activeOrganizationId = org;
        },
    };
}

function routeOf(rest: any, method: string, path: string) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    return route;
}

function headersFor(cookie?: string, apiKey?: string): Record<string, string> {
    const h: Record<string, string> = {};
    if (cookie) h.cookie = cookie;
    if (apiKey) h['x-api-key'] = apiKey;
    return h;
}

async function callGet(c: Composition, opts: { cookie?: string; apiKey?: string } = {}) {
    const res = makeRes();
    await routeOf(c.rest, 'GET', DATA_COLLECTION).handler(
        {
            method: 'GET', path: `/api/v1/data/${OBJECT}`, params: { object: OBJECT }, query: {},
            headers: headersFor(opts.cookie, opts.apiKey),
        },
        res,
    );
    return res;
}

async function callPost(c: Composition, name: string, opts: { cookie?: string; apiKey?: string } = {}) {
    const res = makeRes();
    await routeOf(c.rest, 'POST', DATA_COLLECTION).handler(
        {
            method: 'POST', path: `/api/v1/data/${OBJECT}`, params: { object: OBJECT }, query: {},
            headers: headersFor(opts.cookie, opts.apiKey), body: { name },
        },
        res,
    );
    return res;
}

const keyRefusalLines = (c: Composition) => c.warnings().filter((l) => l.includes('API key refused'));
const dropLines = (c: Composition) => c.warnings().filter((l) => l.includes('Session organization claim dropped'));

// ---------------------------------------------------------------------------
// Environment — the deployment shape acceptance clause 1 names
// ---------------------------------------------------------------------------

const ENV_KEYS = [
    'OS_TENANCY_POSTURE',
    'OS_MULTI_ORG_ENABLED',
    'OS_ALLOW_DEGRADED_TENANCY',
    'OS_PLATFORM_OWNER_EMAIL',
    'OS_AUTH_MEMBERSHIP_POLICY',
] as const;
const savedEnv: Record<string, string | undefined> = {};

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    // The walled request…
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    // …and NOTHING else. ⛔ The degrade flag is never set here: a wall
    // configured-but-not-enforced is exactly the state this card exists to make
    // unnecessary, and setting it would void the acceptance.
    delete process.env.OS_ALLOW_DEGRADED_TENANCY;
    delete process.env.OS_MULTI_ORG_ENABLED;
    delete process.env.OS_AUTH_MEMBERSHIP_POLICY;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k] as string;
    }
    warnSpy.mockRestore();
    errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// §0 — The deployment shape itself, before anything is read from it
// ---------------------------------------------------------------------------

describe('[#16137] §0 — the composition is the one the acceptance names', () => {
    it('the walled posture is REQUESTED through the same resolver `serve.ts` reads', () => {
        expect(resolveTenancyPosture()).toBe('isolated');
    });

    it('⛔ the degrade escape hatch is UNSET — asked of the resolver, not of a comment', () => {
        expect(process.env.OS_ALLOW_DEGRADED_TENANCY).toBeUndefined();
        // The resolver `serve.ts` calls for the ADR-0093 D5 gate. If this ever
        // reads `true`, every refusal below is being measured on a deployment
        // that was allowed to run its wall switched off, and the acceptance is
        // void rather than merely weakened.
        expect(resolveAllowDegradedTenancy()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// §1 — ⭐ THE ASSERTION THE CARD EXISTS FOR
// ---------------------------------------------------------------------------

describe('[#16137] §1 — an open-only composition RESOLVES the wall, with no stub', () => {
    it('⭐ `org-scoping` resolves, and it IS the open plugin instance that was mounted', async () => {
        const c = await bootOpenOnlyComposition();
        const svc = c.kernel.getService<OrganizationsPlugin>('org-scoping');
        expect(svc).toBeDefined();
        // Identity, not shape: a stand-in that merely registers the name would
        // satisfy a truthiness check. The service the open core probes has to be
        // the registrar this package ships.
        expect(svc).toBe(c.orgPlugin);
        expect(svc).toBeInstanceOf(OrganizationsPlugin);
    });

    it('⭐ the EFFECTIVE posture reads `isolated` and is NOT degraded — read back off the resolved service', async () => {
        const c = await bootOpenOnlyComposition();
        const tenancy = c.kernel.getService<TenancyShape>('tenancy');
        expect(tenancy.requestedPosture).toBe('isolated');
        // The load-bearing pair. `posture` is `isolationActive() ? requested :
        // 'single'`, and `degraded` is "a wall was asked for and could not be
        // stood up" — so these two together say the wall is ACTIVE, not merely
        // configured.
        expect(tenancy.isolationActive).toBe(true);
        expect(tenancy.posture).toBe('isolated');
        expect(tenancy.degraded).toBe(false);
    });

    it('the ONLY entitlement question open core asks is answered by an open constant', async () => {
        const c = await bootOpenOnlyComposition();
        // `probeEntitledPostures` reads `supportedPostures` off whatever answers
        // `org-scoping` (ADR-0105 D12). Here that is this package's own declared
        // constant — so the entitlement seam terminates inside Apache-2.0 code
        // and there is nothing left for a licence to be checked against.
        const svc = c.kernel.getService<OrganizationsPlugin>('org-scoping');
        expect([...svc.supportedPostures].sort()).toEqual(['group', 'isolated']);
        expect(svc.supportedPostures).toBe(c.orgPlugin!.supportedPostures);
    });
});

// ---------------------------------------------------------------------------
// §2 — THE MATRIX, against the resolved posture. Controls first, both directions.
// ---------------------------------------------------------------------------

describe('[#16137] §2 — controls: the probe can serve, and the door can refuse', () => {
    it('CONTROL · data REACHES: a CURRENT member reads its own organization and only that one', async () => {
        const c = await bootOpenOnlyComposition();
        const res = await callGet(c, { apiKey: RAW_MEMBER_KEY });
        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(2);
        expect(res.body.value.map((r: BusinessUnitRow) => r.id)).toEqual(['bu_a1', 'bu_a2']);
        // The wall IS live: org_beta's two rows exist in the store and are not served.
        expect(c.store().filter((r) => r.organization_id === 'org_beta')).toHaveLength(2);
        expect(res.body.value.map((r: BusinessUnitRow) => r.organization_id)).toEqual(['org_alpha', 'org_alpha']);
    });

    it('CONTROL · writes REACH: a CURRENT member\'s POST lands, read back FROM THE STORE', async () => {
        const c = await bootOpenOnlyComposition();
        const res = await callPost(c, 'w-member', { apiKey: RAW_MEMBER_KEY });
        expect(res.statusCode).toBe(201);
        const landed = c.store().filter((r) => r.name === 'w-member');
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ organization_id: 'org_alpha', created_by: 'u_member' });
    });

    it('CONTROL · a healthy member reads and writes over a SESSION too', async () => {
        const c = await bootOpenOnlyComposition();
        const get = await callGet(c, { cookie: COOKIE_MEMBER });
        expect(get.statusCode).toBe(200);
        expect(get.body.total).toBe(2);
        expect(get.body.value.map((r: BusinessUnitRow) => r.id)).toEqual(['bu_a1', 'bu_a2']);
        const post = await callPost(c, 'w-member-session', { cookie: COOKIE_MEMBER });
        expect(post.statusCode).toBe(201);
        const landed = c.store().filter((r) => r.name === 'w-member-session');
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ organization_id: 'org_alpha', created_by: 'u_member' });
    });

    it('CONTROL · the door refuses: no credential is 401 on both verbs, and nothing lands', async () => {
        const c = await bootOpenOnlyComposition();
        const get = await callGet(c);
        expect(get.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(get.body?.error?.code ?? get.body?.code).toBe(ANONYMOUS_DENY_CODE);
        const post = await callPost(c, 'w-anon');
        expect(post.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(c.store()).toHaveLength(SEED.length);
    });
});

describe('[#16137] §2 — an ex-member\'s org-stamped API KEY, under the resolved posture', () => {
    it('GET is 401, and the wire says nothing else', async () => {
        const c = await bootOpenOnlyComposition();
        const res = await callGet(c, { apiKey: RAW_EXMEMBER_KEY });
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(res.body?.error?.code ?? res.body?.code).toBe(ANONYMOUS_DENY_CODE);
        expect(JSON.stringify(res.body)).not.toMatch(/membership|organization_membership_ended|org_alpha|key_exmember/i);
    });

    it('POST is 401 and NOTHING LANDS — read back from the store', async () => {
        const c = await bootOpenOnlyComposition();
        const res = await callPost(c, 'w-exmember-key', { apiKey: RAW_EXMEMBER_KEY });
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(c.store().filter((r) => r.name === 'w-exmember-key')).toHaveLength(0);
        expect(c.store()).toHaveLength(SEED.length);
    });

    it('the refusal is said OUT LOUD once, naming key / principal / organization / reason — ⛔ never the credential', async () => {
        const c = await bootOpenOnlyComposition();
        await callGet(c, { apiKey: RAW_EXMEMBER_KEY });
        const lines = keyRefusalLines(c);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('organization_membership_ended');
        expect(lines[0]).toContain('key=key_exmember');
        expect(lines[0]).toContain('principal=u_exmember');
        expect(lines[0]).toContain('organization=org_alpha');
        expect(lines[0]).not.toContain(RAW_EXMEMBER_KEY);
        expect(lines[0]).not.toContain(hashApiKey(RAW_EXMEMBER_KEY));
    });
});

describe('[#16137] §2 — an organization-less caller, under the resolved posture', () => {
    it('GET is 401 — not a 200 carrying a silent empty set', async () => {
        const c = await bootOpenOnlyComposition();
        const res = await callGet(c, { apiKey: RAW_ORGLESS_KEY });
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(res.body?.error?.code ?? res.body?.code).toBe(ANONYMOUS_DENY_CODE);
    });

    it('POST is 401 and nothing lands', async () => {
        const c = await bootOpenOnlyComposition();
        const res = await callPost(c, 'w-orgless', { apiKey: RAW_ORGLESS_KEY });
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(c.store().filter((r) => r.name === 'w-orgless')).toHaveLength(0);
    });

    it('its refusal is its own line, with its own reason', async () => {
        const c = await bootOpenOnlyComposition();
        await callGet(c, { apiKey: RAW_ORGLESS_KEY });
        const lines = keyRefusalLines(c);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('organization_required');
        expect(lines[0]).toContain('principal=u_orgless');
        expect(lines[0]).toContain('organization=<none>');
    });
});

describe('[#16137] §2 — an ex-member SESSION, under the resolved posture', () => {
    /**
     * The session row is option B (#15409): the unbacked claim is DROPPED, the
     * principal is not refused. So "refused" here means refused ACCESS TO THE
     * ORGANIZATION IT LEFT — a 200 with nothing in it and an ADR-0123 D2 write
     * refusal — ⛔ not a 401. Asserting a 401 would pin option A, which the
     * maintainer's ruling rejected, and would read as a regression the day
     * someone re-checked it.
     */
    it('GET reads NOTHING from the organization it left, and those rows still exist', async () => {
        const c = await bootOpenOnlyComposition();
        const res = await callGet(c, { cookie: COOKIE_EXMEMBER });
        expect(res.body.total).toBe(0);
        expect(res.body.value).toEqual([]);
        expect(c.store().filter((r) => r.organization_id === 'org_alpha')).toHaveLength(2);
    });

    it('POST does NOT land in that organization — 403 PERMISSION_DENIED, store read back', async () => {
        const c = await bootOpenOnlyComposition();
        const res = await callPost(c, 'w-exmember-session', { cookie: COOKIE_EXMEMBER });
        expect(res.statusCode).toBe(403);
        expect(res.body?.error?.code ?? res.body?.code).toBe('PERMISSION_DENIED');
        expect(c.store().filter((r) => r.name === 'w-exmember-session')).toHaveLength(0);
        expect(c.store().filter((r) => r.created_by === 'u_exmember')).toHaveLength(0);
        expect(c.store()).toHaveLength(SEED.length);
    });

    it('the drop is said OUT LOUD once — session / principal / organization / reason, ⛔ never the token', async () => {
        const c = await bootOpenOnlyComposition();
        await callGet(c, { cookie: COOKIE_EXMEMBER });
        const lines = dropLines(c);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('organization_membership_ended');
        expect(lines[0]).toContain('session=ses_exmember');
        expect(lines[0]).toContain('principal=u_exmember');
        expect(lines[0]).toContain('organization=org_alpha');
        expect(lines[0]).not.toContain(TOKEN_EXMEMBER);
    });

    it('B, NOT A: the same person still WORKS in an organization they really are in', async () => {
        const c = await bootOpenOnlyComposition();
        await callGet(c, { cookie: COOKIE_EXMEMBER });
        c.switchActiveOrganization(COOKIE_EXMEMBER, 'org_beta');
        const get = await callGet(c, { cookie: COOKIE_EXMEMBER });
        expect(get.statusCode).toBe(200);
        expect(get.body.total).toBe(2);
        expect(get.body.value.map((r: BusinessUnitRow) => r.id)).toEqual(['bu_b1', 'bu_b2']);
        const post = await callPost(c, 'w-exmember-beta', { cookie: COOKIE_EXMEMBER });
        expect(post.statusCode).toBe(201);
        expect(c.store().filter((r) => r.name === 'w-exmember-beta')[0]).toMatchObject({
            organization_id: 'org_beta', created_by: 'u_exmember',
        });
    });
});

// ---------------------------------------------------------------------------
// §3 — ⛔ NO LICENCE CHECK IS REACHABLE FROM THE OPEN COMPOSITION (clause 3)
//
// Measured two ways, because one of them alone is assumption:
//   (a) at RUN TIME, off the ledger of every service the booted composition
//       actually asked the kernel for — a licence gate has to ASK for something;
//   (b) STRUCTURALLY, over the transitive workspace closure the composition is
//       assembled from, read from the manifests rather than recited.
// Each carries a positive control, because a detector that cannot find a
// planted offender reads exactly like compliance.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = (() => {
    let dir = HERE;
    for (;;) {
        if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
        const parent = dirname(dir);
        if (parent === dir) throw new Error('reached the filesystem root without a workspace root');
        dir = parent;
    }
})();

/** What a licence gate is SPELLED like, in a name or in a call. */
const LICENCE_SHAPE = /licen[cs]e|entitle|entitlement|security-enterprise/i;

/** The workspace globs that hold packages — `no-framework-dependents.pin.test.ts`'s list. */
const PACKAGE_ROOTS = [
    'packages', 'packages/apps', 'packages/drivers', 'packages/plugins', 'packages/qa',
    'packages/triggers', 'packages/services', 'packages/adapters', 'packages/connectors',
];

function workspaceManifests(): Map<string, { dir: string; manifest: any }> {
    const out = new Map<string, { dir: string; manifest: any }>();
    for (const root of PACKAGE_ROOTS) {
        const abs = join(REPO, root);
        if (!existsSync(abs)) continue;
        for (const entry of readdirSync(abs)) {
            const dir = join(abs, entry);
            if (!statSync(dir).isDirectory()) continue;
            const manifestPath = join(dir, 'package.json');
            if (!existsSync(manifestPath)) continue;
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (manifest?.name) out.set(String(manifest.name), { dir, manifest });
        }
    }
    return out;
}

/**
 * The RUNTIME closure of the composition: the four packages it mounts, plus
 * every workspace package reachable from their `dependencies`.
 *
 * `dependencies` only — a devDependency is not shipped and cannot be part of
 * what a deployment mounts, so folding it in would inflate the closure with
 * test-time packages and make the verdict about the wrong population.
 */
function compositionClosure(): { names: string[]; manifests: Map<string, { dir: string; manifest: any }> } {
    const manifests = workspaceManifests();
    const roots = ['@objectstack/organizations', '@objectstack/plugin-auth', '@objectstack/core', '@objectstack/rest'];
    const seen = new Set<string>();
    const queue = [...roots];
    while (queue.length) {
        const name = queue.shift() as string;
        if (seen.has(name)) continue;
        const entry = manifests.get(name);
        if (!entry) continue; // not a workspace package (an npm dependency)
        seen.add(name);
        for (const dep of Object.keys(entry.manifest.dependencies ?? {})) queue.push(dep);
    }
    return { names: [...seen].sort(), manifests };
}

describe('[#16137] §3a — nothing the open composition ASKS FOR is a licence gate', () => {
    it('every service the boot and the matrix looked up is named, and none of them is a gate', async () => {
        const c = await bootOpenOnlyComposition();
        // Drive the whole matrix once more so the ledger covers request time as
        // well as boot time — a gate consulted per request would be invisible in
        // a boot-only reading.
        await callGet(c, { apiKey: RAW_MEMBER_KEY });
        await callGet(c, { apiKey: RAW_EXMEMBER_KEY });
        await callGet(c, { apiKey: RAW_ORGLESS_KEY });
        await callGet(c, { cookie: COOKIE_EXMEMBER });
        await callPost(c, 'w-ledger', { apiKey: RAW_MEMBER_KEY });

        const lookups = c.lookups();
        // ── ANTI-VACUITY. A ledger that recorded nothing would pass the line
        // below while proving nothing at all.
        expect(lookups.length).toBeGreaterThan(5);
        expect(lookups).toContain('org-scoping');
        expect(lookups).toContain('tenancy');
        expect(lookups).toContain('objectql');

        expect(lookups.filter((name) => LICENCE_SHAPE.test(name))).toEqual([]);
    });

    it('CONTROL · the ledger can SEE a licence lookup — planted, and found', async () => {
        const c = await bootOpenOnlyComposition();
        // Exactly what a gate inside the composition would do. It is not
        // registered, so this throws — and the point is that the ASK is
        // recorded either way.
        try { c.kernel.getService('license-entitlement'); } catch { /* not registered — expected */ }
        expect(c.lookups().filter((name) => LICENCE_SHAPE.test(name))).toEqual(['license-entitlement']);
    });
});

describe('[#16137] §3b — the composition is assembled from open packages only', () => {
    it('walks a real closure that contains the four packages the composition mounts', () => {
        const { names } = compositionClosure();
        expect(names.length).toBeGreaterThan(8);
        for (const root of ['@objectstack/organizations', '@objectstack/plugin-auth', '@objectstack/core', '@objectstack/rest']) {
            expect(names).toContain(root);
        }
    });

    it('every package in the closure is Apache-2.0', () => {
        const { names, manifests } = compositionClosure();
        const notOpen = names.filter((n) => manifests.get(n)?.manifest.license !== 'Apache-2.0');
        expect(notOpen).toEqual([]);
    });

    it('no package in the closure depends on anything licence-shaped', () => {
        const { names, manifests } = compositionClosure();
        const offenders: string[] = [];
        for (const name of names) {
            const manifest = manifests.get(name)!.manifest;
            for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
                for (const dep of Object.keys(manifest[field] ?? {})) {
                    if (LICENCE_SHAPE.test(dep)) offenders.push(`${name} → ${field}["${dep}"]`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('CONTROL · the closure detector finds a planted offender', () => {
        const planted = { dependencies: { '@objectstack/security-enterprise': 'workspace:*' } } as any;
        const found = Object.keys(planted.dependencies).filter((d) => LICENCE_SHAPE.test(d));
        expect(found).toEqual(['@objectstack/security-enterprise']);
    });
});

// ---------------------------------------------------------------------------
// §4 — THE ABLATION, and the maintainer's negative control, in one.
//
// The ⭐ assertion has to DEPEND on the mount, or it is not measuring the
// mount. One variable moves: the open registrar. Same kernel, same AuthPlugin,
// same env, same fixture, same routes. A composition without it must
// refuse-or-degrade exactly as it did before this package existed — and if it
// silently gained a wall from somewhere else, the acceptance above was
// measuring the wrong thing.
// ---------------------------------------------------------------------------

describe('[#16137] §4 — ablation: remove the mount and the wall comes down', () => {
    it('⭐ `org-scoping` no longer resolves — the registrar was the only source of it', async () => {
        const c = await bootOpenOnlyComposition({ mountOrgScoping: false });
        expect(() => c.kernel.getService('org-scoping')).toThrow();
    });

    it('⭐ the posture DEGRADES: requested `isolated`, effective `single`, `degraded` true', async () => {
        const c = await bootOpenOnlyComposition({ mountOrgScoping: false });
        const tenancy = c.kernel.getService<TenancyShape>('tenancy');
        expect(tenancy.requestedPosture).toBe('isolated');
        expect(tenancy.isolationActive).toBe(false);
        expect(tenancy.posture).toBe('single');
        // ADR-0093 D5's brand. This is the state an open install could reach
        // BEFORE this package shipped, and the one `OS_ALLOW_DEGRADED_TENANCY`
        // was the only route past.
        expect(tenancy.degraded).toBe(true);
    });

    it('the ex-member READS the other organization again — the measured leak returns', async () => {
        const c = await bootOpenOnlyComposition({ mountOrgScoping: false });
        const res = await callGet(c, { apiKey: RAW_EXMEMBER_KEY });
        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(2);
        expect(res.body.value.map((r: BusinessUnitRow) => r.id)).toEqual(['bu_a1', 'bu_a2']);
    });

    it('the ex-member WRITES into it again — the row read back from the store carries `org_alpha` / `u_exmember`', async () => {
        const c = await bootOpenOnlyComposition({ mountOrgScoping: false });
        const res = await callPost(c, 'w-exmember-ablated', { apiKey: RAW_EXMEMBER_KEY });
        expect(res.statusCode).toBe(201);
        const landed = c.store().filter((r) => r.name === 'w-exmember-ablated');
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ organization_id: 'org_alpha', created_by: 'u_exmember' });
    });

    it('the ex-member SESSION keeps its unbacked claim — no drop is decided', async () => {
        const c = await bootOpenOnlyComposition({ mountOrgScoping: false });
        const res = await callGet(c, { cookie: COOKIE_EXMEMBER });
        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(2);
        expect(res.body.value.map((r: BusinessUnitRow) => r.id)).toEqual(['bu_a1', 'bu_a2']);
        expect(dropLines(c)).toHaveLength(0);
    });

    it('and NOTHING is said about any of it — no refusal line, because no refusal was decided', async () => {
        const c = await bootOpenOnlyComposition({ mountOrgScoping: false });
        await callGet(c, { apiKey: RAW_EXMEMBER_KEY });
        await callGet(c, { apiKey: RAW_ORGLESS_KEY });
        expect(keyRefusalLines(c)).toHaveLength(0);
    });

    it('NARROWNESS: the member control is UNCHANGED by the ablation — the mount is what moved', async () => {
        const c = await bootOpenOnlyComposition({ mountOrgScoping: false });
        const res = await callGet(c, { apiKey: RAW_MEMBER_KEY });
        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(2);
    });
});
