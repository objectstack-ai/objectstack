// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15256 — maintainer ruling 2026-09-04, decisions 1A + 2A] The #15163 matrix,
 * at REST level, on the SINGLE-KERNEL wiring under a live `isolated` posture.
 *
 * ## What was measured, twice, on two repositories
 *
 * Under `isolated`, on the provider wiring the open core actually builds, an
 * API key stamped with an organization its owner is no longer a member of
 * **read and wrote that organization's rows**:
 *
 * | credential | before | after (this card) |
 * |:--|:--|:--|
 * | no credential                     | 401 · 401 | 401 · 401 — unchanged |
 * | CURRENT member (positive control)  | 200 total 2 · 201 | 200 total 2 · 201 — unchanged |
 * | **ex-member, key stamped `org_alpha`** | **200 total 2 · 201, row LANDS in `org_alpha`** | **401 · 401** |
 * | organization-less key             | **200 total 0 (silent) · 403** | **401** |
 *
 * objectstack#15163 measured it on the framework; cloud#1982 reproduced it on
 * `apps/objectos-ee` with the REAL cloud-private `@objectstack/organizations`
 * mounted, reading the written row back out of the sqlite file — the enterprise
 * plugin adds no request-time refusal, so the blast radius was every walled
 * deployment.
 *
 * ## Why the fixture is shaped the way it is
 *
 * The three facts that make this a measurement rather than a shape assertion,
 * each carried over from the two readings:
 *
 *  1. **Data must be shown to REACH.** A probe that cannot serve a healthy
 *     member has measured nothing, so every arm below runs the member key on
 *     the same route and requires rows back.
 *  2. **The write is read back FROM THE STORE**, never from the response body.
 *     `store()` is the fixture's table; the assertions count rows in it.
 *  3. **Layer 0 is modelled as the hard equality it is** — `organization_id =
 *     context.tenantId`, `tenant-layer.ts`'s `isolated` branch, which is
 *     exactly what admits an ex-member whose key names the organization. The
 *     fixture seeds a SECOND organization the member must never see, so a wall
 *     that silently stopped applying would redden here rather than pass.
 *
 * ⛔ `resolveExecCtx` is NOT stubbed: the whole subject is what that method
 * derives, so the real `computeExecCtx` → `resolveAuthzContext` chain runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashApiKey, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE } from '@objectstack/core';
import { RestServer } from './rest-server.js';

const DATA_COLLECTION = '/api/v1/data/:object';
const OBJECT = 'sys_business_unit';

const RAW_MEMBER_KEY = 'osk_15256_member';
const RAW_EXMEMBER_KEY = 'osk_15256_exmember';
const RAW_ORGLESS_KEY = 'osk_15256_orgless';

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
    // than an assumption: a member of org_alpha must never see these two.
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

/**
 * The permission store, in the SHIPPED aggregation shapes. `u_exmember`'s key
 * is stamped `org_alpha` while its only current `sys_member` row is for
 * `org_beta` — the credential outlived the membership that backed it, which is
 * the whole scenario.
 */
function makeQl() {
    const tables: Record<string, any[]> = {
        sys_api_key: [
            { id: 'key_member', key: hashApiKey(RAW_MEMBER_KEY), user_id: 'u_member', active_organization_id: 'org_alpha', revoked: false },
            { id: 'key_exmember', key: hashApiKey(RAW_EXMEMBER_KEY), user_id: 'u_exmember', active_organization_id: 'org_alpha', revoked: false },
            { id: 'key_orgless', key: hashApiKey(RAW_ORGLESS_KEY), user_id: 'u_orgless', revoked: false },
        ],
        sys_member: [
            { user_id: 'u_member', organization_id: 'org_alpha' },
            { user_id: 'u_exmember', organization_id: 'org_beta' },
        ],
        sys_user: [
            { id: 'u_member', email: 'u_member@example.com' },
            { id: 'u_exmember', email: 'u_exmember@example.com' },
            { id: 'u_orgless', email: 'u_orgless@example.com' },
        ],
        // RBAC opened SYMMETRICALLY for all three principals through one
        // permission set — the cloud reading's discipline. If the three
        // principals held different capabilities, RBAC could be what separates
        // the arms; with one shared grant, only the organization wall can be.
        sys_user_permission_set: [
            { user_id: 'u_member', permission_set_id: 'ps_shared' },
            { user_id: 'u_exmember', permission_set_id: 'ps_shared' },
            { user_id: 'u_orgless', permission_set_id: 'ps_shared' },
        ],
        sys_permission_set: [
            { id: 'ps_shared', name: 'shared_access', system_permissions: ['manage_metadata', 'studio.access'] },
        ],
    };
    return {
        find: async (object: string, q: any = {}) => {
            const rows = (tables[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
    };
}

// ---------------------------------------------------------------------------
// The REST harness — real routes, real `computeExecCtx`, no stubbed exec ctx
// ---------------------------------------------------------------------------

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

interface Harness {
    rest: RestServer;
    /** Every row the fixture table holds, in insertion order. */
    store: () => BusinessUnitRow[];
    warnings: () => string[];
}

/**
 * The single-kernel wiring, byte-faithful to `rest-api-plugin.ts`: no
 * kernelManager, an auth provider and an objectql provider over the lone local
 * kernel — plus, unless `omitTenancyProvider` ablates it, the tenancy provider
 * decision 1A added.
 */
function setup(opts: { omitTenancyProvider?: boolean } = {}): Harness {
    const rows: BusinessUnitRow[] = SEED.map((r) => ({ ...r }));
    let seq = 0;
    const ql = makeQl();

    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        // ADR-0105 Layer 0 under `isolated`, as `tenant-layer.ts` computes it:
        // a HARD EQUALITY against the caller's active organization. It never
        // reads `accessible_org_ids` — that is the `group` union branch — which
        // is precisely why a key naming an organization its owner left passes
        // it. Modelled, not mocked away.
        findData: vi.fn(async (r: any) => {
            const tenantId = r?.context?.tenantId;
            const visible = rows.filter((row) => row.organization_id === tenantId);
            return { value: visible, total: visible.length };
        }),
        createData: vi.fn(async (r: any) => {
            const row: BusinessUnitRow = {
                id: `w${++seq}`,
                organization_id: r?.context?.tenantId,
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
        // No session path at all: this matrix is about API keys, and a session
        // that silently authenticated would make every arm unreadable.
        api: { getSession: async () => undefined },
    });
    const objectQLProvider = async () => ql;
    const tenancyServiceProvider = async () => ({ posture: 'isolated' });

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
        opts.omitTenancyProvider ? undefined : tenancyServiceProvider,
    );
    rest.registerRoutes();

    return {
        rest,
        store: () => rows.map((r) => ({ ...r })),
        warnings: () => warnSpy.mock.calls.map((c: unknown[]) => c.map(String).join(' ')),
    };
}

function routeOf(rest: any, method: string, path: string) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    return route;
}

function keyHeaders(raw?: string): Record<string, string> {
    return raw ? { 'x-api-key': raw } : {};
}

async function callGet(rest: any, raw?: string) {
    const res = makeRes();
    await routeOf(rest, 'GET', DATA_COLLECTION).handler(
        { method: 'GET', path: `/api/v1/data/${OBJECT}`, params: { object: OBJECT }, query: {}, headers: keyHeaders(raw) },
        res,
    );
    return res;
}

async function callPost(rest: any, raw: string | undefined, name: string) {
    const res = makeRes();
    await routeOf(rest, 'POST', DATA_COLLECTION).handler(
        {
            method: 'POST', path: `/api/v1/data/${OBJECT}`, params: { object: OBJECT }, query: {},
            headers: keyHeaders(raw), body: { name },
        },
        res,
    );
    return res;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); errorSpy.mockRestore(); });

// ---------------------------------------------------------------------------
// §1 — Instrument controls. Both directions, before any subject arm is read.
// ---------------------------------------------------------------------------

describe('[#15256] §1 — the probe can serve, and the door can refuse', () => {
    it('CONTROL · data REACHES: a CURRENT member reads its own organization and only that one', async () => {
        const h = setup();
        const res = await callGet(h.rest, RAW_MEMBER_KEY);
        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(2);
        expect(res.body.value.map((r: BusinessUnitRow) => r.id)).toEqual(['bu_a1', 'bu_a2']);
        // The wall IS live: org_beta's two rows exist in the store and are not served.
        expect(h.store().filter((r) => r.organization_id === 'org_beta')).toHaveLength(2);
        expect(res.body.value.map((r: BusinessUnitRow) => r.organization_id)).toEqual(['org_alpha', 'org_alpha']);
    });

    it('CONTROL · writes REACH: a CURRENT member\'s POST lands, read back FROM THE STORE', async () => {
        const h = setup();
        const res = await callPost(h.rest, RAW_MEMBER_KEY, 'w-member');
        expect(res.statusCode).toBe(201);
        const landed = h.store().filter((r) => r.name === 'w-member');
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ organization_id: 'org_alpha', created_by: 'u_member' });
    });

    it('CONTROL · the door refuses: no credential is 401 on both verbs', async () => {
        const h = setup();
        const get = await callGet(h.rest, undefined);
        expect(get.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(get.body?.error?.code ?? get.body?.code).toBe(ANONYMOUS_DENY_CODE);
        const post = await callPost(h.rest, undefined, 'w-anon');
        expect(post.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        // Nothing was written: the store still holds only the seed.
        expect(h.store()).toHaveLength(SEED.length);
    });
});

// ---------------------------------------------------------------------------
// §2 — THE SUBJECT ROW. The ex-member key, on the single-kernel wiring.
// ---------------------------------------------------------------------------

describe('[#15256] §2 — an ex-member\'s org-stamped key on the single-kernel wiring under `isolated`', () => {
    it('REPAIRED: GET is 401 — was 200 carrying the other organization\'s rows', async () => {
        const h = setup();
        const res = await callGet(h.rest, RAW_EXMEMBER_KEY);
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(res.body?.error?.code ?? res.body?.code).toBe(ANONYMOUS_DENY_CODE);
        // ⛔ And the wire says nothing else. A holder of someone else's key must
        // learn nothing the generic 401 does not already say (decision 2A).
        expect(JSON.stringify(res.body)).not.toMatch(/membership|organization_membership_ended|org_alpha|key_exmember/i);
    });

    it('REPAIRED: POST is 401 and NOTHING LANDS — read back from the store', async () => {
        const h = setup();
        const res = await callPost(h.rest, RAW_EXMEMBER_KEY, 'w-exmember');
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        // The measured defect was a write that LANDED, stamped with the other
        // organization. The store is the authority on whether it did.
        expect(h.store().filter((r) => r.name === 'w-exmember')).toHaveLength(0);
        expect(h.store()).toHaveLength(SEED.length);
    });

    it('[2A] the refusal is said OUT LOUD on the server side — one `warn`, naming key / principal / organization / reason', async () => {
        const h = setup();
        await callGet(h.rest, RAW_EXMEMBER_KEY);
        const lines = h.warnings().filter((l) => l.includes('API key refused'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('organization_membership_ended');
        expect(lines[0]).toContain('key=key_exmember');
        expect(lines[0]).toContain('principal=u_exmember');
        expect(lines[0]).toContain('organization=org_alpha');
        // ⛔ NEVER the credential — neither the raw key nor its at-rest hash.
        expect(lines[0]).not.toContain(RAW_EXMEMBER_KEY);
        expect(lines[0]).not.toContain(hashApiKey(RAW_EXMEMBER_KEY));
    });
});

// ---------------------------------------------------------------------------
// §3 — The organization-less key: the silent-empty row of the same matrix.
// ---------------------------------------------------------------------------

describe('[#15256] §3 — an organization-less key under `isolated`', () => {
    it('REPAIRED: GET is 401 — was 200 with total 0, a silent empty set', async () => {
        const h = setup();
        const res = await callGet(h.rest, RAW_ORGLESS_KEY);
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(res.body?.error?.code ?? res.body?.code).toBe(ANONYMOUS_DENY_CODE);
    });

    it('REPAIRED: POST is 401 and nothing lands', async () => {
        const h = setup();
        const res = await callPost(h.rest, RAW_ORGLESS_KEY, 'w-orgless');
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(h.store().filter((r) => r.name === 'w-orgless')).toHaveLength(0);
    });

    it('[2A] its refusal is its own line, with its own reason', async () => {
        const h = setup();
        await callGet(h.rest, RAW_ORGLESS_KEY);
        const lines = h.warnings().filter((l) => l.includes('API key refused'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('organization_required');
        expect(lines[0]).toContain('key=key_orgless');
        expect(lines[0]).toContain('principal=u_orgless');
        // The key names no organization — that IS the reason, said plainly.
        expect(lines[0]).toContain('organization=<none>');
        expect(lines[0]).not.toContain(RAW_ORGLESS_KEY);
    });

    it('a REFUSAL is not a key scanner\'s log: an unknown key is silent', async () => {
        // Volume control for 2A. `outcome: 'none'` — unknown, revoked, expired
        // or absent — is never a refusal, so a prober writes no lines here.
        const h = setup();
        const res = await callGet(h.rest, 'osk_not_a_real_key');
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(h.warnings().filter((l) => l.includes('API key refused'))).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// §4 — THE ABLATION. Remove the provider; the ex-member row comes back.
//
// One variable changes: the tenancy provider decision 1A wired. The tenancy
// service, the engine, the keys, the routes and the store are byte-identical to
// §2. A pin that cannot go red has measured nothing.
// ---------------------------------------------------------------------------

describe('[#15256] §4 — ablation: without the provider, the measured leak returns', () => {
    it('the ex-member READS the other organization again — GET 200, total 2', async () => {
        const h = setup({ omitTenancyProvider: true });
        const res = await callGet(h.rest, RAW_EXMEMBER_KEY);
        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(2);
        expect(res.body.value.map((r: BusinessUnitRow) => r.id)).toEqual(['bu_a1', 'bu_a2']);
    });

    it('the ex-member WRITES into it again — POST 201, the row read back from the store carries `org_alpha` / `u_exmember`', async () => {
        const h = setup({ omitTenancyProvider: true });
        const res = await callPost(h.rest, RAW_EXMEMBER_KEY, 'w-exmember');
        expect(res.statusCode).toBe(201);
        const landed = h.store().filter((r) => r.name === 'w-exmember');
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ organization_id: 'org_alpha', created_by: 'u_exmember' });
    });

    it('the organization-less key goes back to the silent empty set — 200, total 0', async () => {
        const h = setup({ omitTenancyProvider: true });
        const res = await callGet(h.rest, RAW_ORGLESS_KEY);
        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(0);
    });

    it('and NOTHING is said about any of it — no refusal line, because no refusal was decided', async () => {
        const h = setup({ omitTenancyProvider: true });
        await callGet(h.rest, RAW_EXMEMBER_KEY);
        await callGet(h.rest, RAW_ORGLESS_KEY);
        expect(h.warnings().filter((l) => l.includes('API key refused'))).toHaveLength(0);
    });

    it('NARROWNESS: the member control is UNCHANGED by the ablation — the provider is what moved, not the fixture', async () => {
        const h = setup({ omitTenancyProvider: true });
        const res = await callGet(h.rest, RAW_MEMBER_KEY);
        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(2);
    });
});
