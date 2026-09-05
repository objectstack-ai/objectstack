// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15349 — censused under #15256, maintainer ruling 2026-09-04 item 5] The
 * share-link ADMISSION seam derives the tenancy posture.
 *
 * ## What was measured
 *
 * `SharingServicePlugin`'s `verifiedContextFromRequest` called
 * `resolveAuthzContext({ ql, headers, getSession })` with no `tenancyPosture`.
 * The resolver gates EVERY posture-conditional refusal on a posture its caller
 * supplies, so on this door none of the three ran:
 *
 * | credential (`isolated`)                | before | after |
 * |:--|:--|:--|
 * | no credential (control)                | 401 · 401 | 401 · 401 — unchanged |
 * | CURRENT member's key (control)         | 200 · 201 | 200 · 201 — unchanged |
 * | **ex-member, key stamped `org_alpha`** | **200 · 201, a share LINK lands on `org_alpha`'s record** | **401 · 401** |
 * | organization-less key                  | **200 · 201** | **401** |
 * | ex-member's SESSION claim (#15409)     | **201, link lands** | **403, nothing lands — still signed in** |
 *
 * The write here is worse than a row: `createLink` mints a CAPABILITY TOKEN on
 * a record inside the organization its minter has left, and `resolveToken`
 * serves that record anonymously under a system context for as long as the link
 * lives. The visibility read it is gated on ran with `tenantId = org_alpha` —
 * the key's own stored claim, copied verbatim from
 * `sys_api_key.active_organization_id` and never vetted against current
 * membership.
 *
 * ## Why the fixture is shaped the way it is (#15365's acceptance shape)
 *
 *  1. **Data must be shown to REACH.** A door that authenticates nobody cannot
 *     "pass" by refusing for the wrong reason, so every section runs the
 *     CURRENT member on the same routes and requires a 201 / rows back.
 *  2. **The write is read back FROM THE STORE**, never from the response body:
 *     `store()` is the fixture's `sys_share_link` table and the assertions
 *     count rows in it.
 *  3. **Layer 0 is modelled as the hard equality it is** — `organization_id =
 *     context.tenantId`, `plugin-security`'s `tenant-layer.ts` `isolated`
 *     branch, with `!tenantId ⇒ deny`. A SECOND organization is seeded so "the
 *     wall is live" is a control (§1) rather than an assumption. The model is
 *     applied to the business object only — `sys_share_link` carries no
 *     `organization_id`, and inventing one for it would be a fixture asserting
 *     about itself.
 *  4. **The ablation is held PERMANENTLY**, §4: the `tenancy` service — the
 *     wiring fact this seam reads — is removed and the measured leak returns,
 *     byte-identical fixture otherwise. A pin that cannot go red has measured
 *     nothing.
 *
 * ## The section the REST sibling did not need: §5
 *
 * #13906 decision 1 option A splits the two facts a naive `try { … } catch {
 * undefined }` collapses. A `tenancy` service that was NEVER REGISTERED is a
 * supported composition (quiet `undefined`); one that was registered and FAILED
 * to build is an OUTAGE and must reach the wire as `SERVICE_UNAVAILABLE` / 503,
 * because admission was never decided. §5 drives the real registry rejection —
 * a factory that throws — rather than a hand-thrown stub at the seam.
 *
 * ⛔ Nothing here stubs `verifiedContextFromRequest`, `resolveAuthzContext` or
 * the plugin's route registration: the whole subject is what that closure
 * derives, so the real plugin is booted and the real chain runs. The kernel is
 * a real `ObjectKernel`, so the branded / unbranded rejection classification is
 * the registry's own and not a test double's imitation of it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectKernel, hashApiKey } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import type {
  IHttpServer,
  IHttpRequest,
  IHttpResponse,
  RouteHandler,
} from '@objectstack/spec/contracts';
import { SharingServicePlugin } from './sharing-plugin.js';
import { bootRequestContext } from './exec-context-seam.testkit.js';

const BASE = '/api/v1/share-links';
const OBJECT = 'crm_account';

const ORG_ALPHA = 'org_alpha';
const ORG_BETA = 'org_beta';
const REC_ALPHA = 'acc_alpha';
const REC_BETA = 'acc_beta';

const RAW_MEMBER_KEY = 'osk_15349_member';
const RAW_EXMEMBER_KEY = 'osk_15349_exmember';
const RAW_ORGLESS_KEY = 'osk_15349_orgless';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

class MockHttp implements IHttpServer {
    routes = new Map<string, RouteHandler>();
    private add(method: string, path: string, handler: RouteHandler) {
        this.routes.set(`${method} ${path}`, handler);
    }
    get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
    post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
    put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
    delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
    patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
    use() { return this as any; }
    listen() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    getInstance() { return null; }
}

/**
 * The fixture's ONE hand-written where-matcher: equality plus `$in` — the two
 * shapes the shared resolver and the link service actually issue — refusing
 * every other shape loudly, so a combinator it does not implement can never
 * read as a field that happened not to match.
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
 * ADR-0105 Layer 0 under `isolated`, as `tenant-layer.ts` computes it: a HARD
 * EQUALITY against the caller's active organization, and a DENY when the
 * caller has none. It never reads `accessible_org_ids` — that is the `group`
 * union branch — which is precisely why a key naming an organization its owner
 * left passes it. Modelled, not mocked away.
 *
 * Applied to the business object only; see the header's fixture note 3.
 */
function layer0Admits(row: any, context: any): boolean {
    if (context?.isSystem === true) return true;
    if (!context?.tenantId) return false;
    return row.organization_id === context.tenantId;
}

/** The identity + business rows a real deployment holds for these principals. */
function fixtureTables(): Record<string, any[]> {
    return {
        sys_api_key: [
            { id: 'key_member', key: hashApiKey(RAW_MEMBER_KEY), user_id: 'u_member', active_organization_id: ORG_ALPHA, revoked: false },
            { id: 'key_exmember', key: hashApiKey(RAW_EXMEMBER_KEY), user_id: 'u_exmember', active_organization_id: ORG_ALPHA, revoked: false },
            { id: 'key_orgless', key: hashApiKey(RAW_ORGLESS_KEY), user_id: 'u_orgless', revoked: false },
        ],
        // `u_exmember`'s key is stamped `org_alpha` while its only current
        // `sys_member` row is for `org_beta` — the credential outlived the
        // membership that backed it, which is the whole scenario.
        sys_member: [
            { id: 'mem_1', user_id: 'u_member', organization_id: ORG_ALPHA, role: 'member' },
            { id: 'mem_2', user_id: 'u_exmember', organization_id: ORG_BETA, role: 'member' },
        ],
        sys_user: [
            { id: 'u_member', email: 'u_member@example.com' },
            { id: 'u_exmember', email: 'u_exmember@example.com' },
            { id: 'u_orgless', email: 'u_orgless@example.com' },
        ],
        sys_user_position: [],
        // RBAC opened SYMMETRICALLY for all three principals through one
        // permission set: if they held different capabilities, RBAC could be
        // what separates the arms; with one shared grant, only the organization
        // wall can be.
        sys_user_permission_set: [
            { user_id: 'u_member', permission_set_id: 'ps_shared' },
            { user_id: 'u_exmember', permission_set_id: 'ps_shared' },
            { user_id: 'u_orgless', permission_set_id: 'ps_shared' },
        ],
        sys_permission_set: [
            { id: 'ps_shared', name: 'shared_access', system_permissions: ['manage_metadata', 'studio.access'] },
        ],
        [OBJECT]: [
            { id: REC_ALPHA, name: 'Alpha Ltd', organization_id: ORG_ALPHA },
            // The other organization, seeded so "the wall is live" is a control
            // rather than an assumption.
            { id: REC_BETA, name: 'Beta Ltd', organization_id: ORG_BETA },
        ],
        sys_share_link: [],
    };
}

function makeEngine(tables: Record<string, any[]>) {
    return {
        async find(object: string, opts: any) {
            const rows = (tables[object] ?? []).filter((r) => matchesWhere(r, opts?.where ?? {}));
            const walled = object === OBJECT ? rows.filter((r) => layer0Admits(r, opts?.context)) : rows;
            return typeof opts?.limit === 'number' ? walled.slice(0, opts.limit) : walled;
        },
        async insert(object: string, row: any) {
            (tables[object] ??= []).push(row);
            return row;
        },
        getSchema(object: string) {
            return object === OBJECT
                ? {
                    name: OBJECT,
                    publicSharing: {
                        enabled: true,
                        allowedAudiences: ['link_only'],
                        allowedPermissions: ['view'],
                    },
                }
                : { name: object };
        },
    };
}

type TenancyArm = 'isolated' | 'group' | 'unregistered' | 'factory-throws';

/**
 * A real kernel, carrying the `tenancy` wiring fact this seam reads. Real
 * because the classification under measurement is the REGISTRY's — the branded
 * "never registered" rejection versus the unbranded "registered and failed to
 * construct" one (#13905) — and a double imitating both would be asserting
 * about itself.
 */
function kernelWith(tenancy: TenancyArm): ObjectKernel {
    // `gracefulShutdown: false` — a fixture kernel must not hook the test
    // runner's process signals.
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
    if (tenancy === 'isolated' || tenancy === 'group') {
        kernel.registerService('tenancy', { posture: tenancy });
    } else if (tenancy === 'factory-throws') {
        kernel.registerServiceFactory('tenancy', () => {
            throw new Error('tenancy backend unavailable');
        });
    }
    // 'unregistered' → nothing: the branded not-registered rejection, and the
    // ABLATION handle. It removes exactly the one thing this seam reads.
    return kernel;
}

interface Session {
    user: { id: string; email?: string };
    session: { userId: string; activeOrganizationId?: string | null };
}

interface Harness {
    http: MockHttp;
    /** Every `sys_share_link` row the fixture holds, in insertion order. */
    store: () => any[];
    warnings: () => string[];
}

/**
 * Boot the REAL plugin. The assembly under test is a closure inside its
 * `kernel:ready` handler, so nothing short of starting the plugin exercises the
 * production wiring. `enforce: false` keeps this to the share-link surface —
 * the RLS middleware and the rule subsystem are other cards' code and would
 * only add noise (the share-link service is registered in that posture too, by
 * design).
 */
async function boot(opts: { tenancy: TenancyArm; session?: () => Session | undefined }): Promise<Harness> {
    const tables = fixtureTables();
    const engine = makeEngine(tables);
    const http = new MockHttp();
    const kernel = kernelWith(opts.tenancy);
    const hooks: Record<string, Array<() => Promise<void> | void>> = {};

    // The host the plugin is started against. ⛔ Not typed `any`: the slot
    // lookups this double serves are exactly the ones `check:slot-lookup`
    // exists to keep contracted, and a wholesale `any` here would switch that
    // off for the file. The cast is narrowed to the ONE place the shape is
    // handed over, so the object itself stays checked.
    const ctx = {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        hook: (event: string, handler: () => Promise<void> | void) => {
            (hooks[event] ??= []).push(handler);
        },
        getService: <T>(name: string): T => {
            if (name === 'objectql') return engine as unknown as T;
            // The CANONICAL slot name (#4251 B5); the plugin reads it first.
            if (name === 'http.server') return http as unknown as T;
            if (name === 'auth') {
                // No session path unless an arm asks for one: this matrix is
                // about credentials, and a session that silently authenticated
                // would make every API-key arm unreadable.
                return { api: { getSession: async () => opts.session?.() } } as unknown as T;
            }
            // Everything else off the REAL registry, including the two throws
            // the sync accessor draws its line with.
            return kernel.getService<T>(name);
        },
        registerService: vi.fn(),
        getKernel: () => kernel,
    };

    const plugin = new SharingServicePlugin({ enforce: false });
    await plugin.start(ctx as unknown as PluginContext);
    for (const handler of hooks['kernel:ready'] ?? []) await handler();

    return {
        http,
        store: () => (tables.sys_share_link ?? []).map((r) => ({ ...r })),
        warnings: () => warnSpy.mock.calls.map((c: unknown[]) => c.map(String).join(' ')),
    };
}

interface Captured { status: number; body: any }

async function drive(
    http: MockHttp,
    key: string,
    opts: { params?: Record<string, string>; body?: any; query?: any; headers?: any } = {},
): Promise<Captured> {
    const handler = http.routes.get(key);
    if (!handler) throw new Error(`no handler for ${key}`);
    const captured: Captured = { status: 200, body: undefined };
    const res: IHttpResponse = {
        json: vi.fn((data: any) => { captured.body = data; }) as any,
        send: vi.fn() as any,
        status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
        header: vi.fn(() => res) as any,
    };
    const req: IHttpRequest = {
        params: opts.params ?? {},
        query: opts.query ?? {},
        body: opts.body,
        headers: opts.headers ?? {},
        method: 'POST',
        path: BASE,
    };
    await handler(req, res);
    return captured;
}

const apiKey = (raw?: string) => (raw ? { 'x-api-key': raw } : {});
const cookie = { cookie: 'better-auth.session_token=t' };

/** Mint a link on a record — the WRITE under measurement. */
const post = (h: Harness, headers: any, recordId = REC_ALPHA) =>
    drive(h.http, `POST ${BASE}`, { headers, body: { object: OBJECT, recordId } });

/** List the caller's own links — the READ. */
const get = (h: Harness, headers: any) =>
    drive(h.http, `GET ${BASE}`, { headers, query: { object: OBJECT } });

const errorCode = (res: Captured) => res.body?.error?.code ?? res.body?.code;

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

describe('[#15349] §1 — the door can serve, and the door can refuse', () => {
    it('CONTROL · writes REACH: a CURRENT member mints a link, read back FROM THE STORE', async () => {
        const h = await boot({ tenancy: 'isolated' });
        const res = await post(h, apiKey(RAW_MEMBER_KEY));
        expect(res.status).toBe(201);
        const landed = h.store();
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ object_name: OBJECT, record_id: REC_ALPHA, created_by: 'u_member' });
    });

    it('CONTROL · reads REACH: the same member lists the link it minted', async () => {
        const h = await boot({ tenancy: 'isolated' });
        await post(h, apiKey(RAW_MEMBER_KEY));
        const res = await get(h, apiKey(RAW_MEMBER_KEY));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].record_id).toBe(REC_ALPHA);
    });

    it('CONTROL · the WALL is live: the member cannot link-share the other organization\'s record', async () => {
        const h = await boot({ tenancy: 'isolated' });
        const res = await post(h, apiKey(RAW_MEMBER_KEY), REC_BETA);
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('FORBIDDEN');
        expect(h.store()).toHaveLength(0);
    });

    it('CONTROL · the door refuses: no credential is 401 on both verbs, and nothing lands', async () => {
        const h = await boot({ tenancy: 'isolated' });
        const read = await get(h, {});
        expect(read.status).toBe(401);
        expect(errorCode(read)).toBe('UNAUTHENTICATED');
        const write = await post(h, {});
        expect(write.status).toBe(401);
        expect(h.store()).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// §2 — THE SUBJECT. The ex-member's org-stamped key under `isolated`.
// ---------------------------------------------------------------------------

describe('[#15349] §2 — an ex-member\'s org-stamped API key under `isolated`', () => {
    it('REPAIRED: the mint is 401 and NO LINK LANDS — read back from the store', async () => {
        const h = await boot({ tenancy: 'isolated' });
        const res = await post(h, apiKey(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(401);
        expect(errorCode(res)).toBe('UNAUTHENTICATED');
        // The measured defect was a capability token that LANDED on a record
        // inside the organization its minter had left. The store is the
        // authority on whether it did.
        expect(h.store()).toHaveLength(0);
    });

    it('REPAIRED: the listing is 401 — was 200', async () => {
        const h = await boot({ tenancy: 'isolated' });
        const res = await get(h, apiKey(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(401);
        expect(errorCode(res)).toBe('UNAUTHENTICATED');
    });

    it('the wire says nothing else — a holder of someone else\'s key learns nothing the generic 401 does not say', async () => {
        const h = await boot({ tenancy: 'isolated' });
        const res = await post(h, apiKey(RAW_EXMEMBER_KEY));
        expect(JSON.stringify(res.body)).not.toMatch(/membership|organization_membership_ended|org_alpha|key_exmember/i);
    });

    it('the refusal IS said out loud on the server side, naming reason / key / principal / organization', async () => {
        const h = await boot({ tenancy: 'isolated' });
        await post(h, apiKey(RAW_EXMEMBER_KEY));
        const lines = h.warnings().filter((l) => l.includes('API key refused'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('organization_membership_ended');
        expect(lines[0]).toContain('key=key_exmember');
        expect(lines[0]).toContain('principal=u_exmember');
        expect(lines[0]).toContain(`organization=${ORG_ALPHA}`);
        // ⛔ NEVER the credential — neither the raw key nor its at-rest hash.
        expect(lines[0]).not.toContain(RAW_EXMEMBER_KEY);
        expect(lines[0]).not.toContain(hashApiKey(RAW_EXMEMBER_KEY));
    });
});

// ---------------------------------------------------------------------------
// §3 — The organization-less key.
// ---------------------------------------------------------------------------

describe('[#15349] §3 — an organization-less key under `isolated`', () => {
    it('REPAIRED: the mint is 401 and nothing lands', async () => {
        const h = await boot({ tenancy: 'isolated' });
        const res = await post(h, apiKey(RAW_ORGLESS_KEY));
        expect(res.status).toBe(401);
        expect(h.store()).toHaveLength(0);
    });

    it('its refusal is its own line, with its own reason', async () => {
        const h = await boot({ tenancy: 'isolated' });
        await post(h, apiKey(RAW_ORGLESS_KEY));
        const lines = h.warnings().filter((l) => l.includes('API key refused'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('organization_required');
        expect(lines[0]).toContain('key=key_orgless');
    });

    it('a REFUSAL is not a key scanner\'s log: an unknown key is silent', async () => {
        const h = await boot({ tenancy: 'isolated' });
        const res = await post(h, apiKey('osk_not_a_real_key'));
        expect(res.status).toBe(401);
        expect(h.warnings().filter((l) => l.includes('API key refused'))).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// §4 — THE ABLATION, held permanently. Remove the `tenancy` service — the one
// wiring fact this seam reads — and the measured leak returns. Everything else
// (the engine, the keys, the routes, the store) is byte-identical to §2.
// ---------------------------------------------------------------------------

describe('[#15349] §4 — ablation: with no `tenancy` service, the measured leak returns', () => {
    it('the ex-member MINTS A LINK on the other organization\'s record again — 201, read back from the store', async () => {
        const h = await boot({ tenancy: 'unregistered' });
        const res = await post(h, apiKey(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(201);
        const landed = h.store();
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ object_name: OBJECT, record_id: REC_ALPHA, created_by: 'u_exmember' });
    });

    it('the ex-member reads again — the listing is 200', async () => {
        const h = await boot({ tenancy: 'unregistered' });
        const res = await get(h, apiKey(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(200);
    });

    it('the organization-less key is admitted again — 201', async () => {
        const h = await boot({ tenancy: 'unregistered' });
        // Org-less ⇒ no tenant ⇒ the Layer-0 model DENIES the visibility read,
        // so this arm's measurable is the ADMISSION (403 from enforcement, not
        // 401 from the door), which is precisely the distinction the posture
        // restores.
        const res = await post(h, apiKey(RAW_ORGLESS_KEY));
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('FORBIDDEN');
    });

    it('and NOTHING is said about any of it — no refusal line, because no refusal was decided', async () => {
        const h = await boot({ tenancy: 'unregistered' });
        await post(h, apiKey(RAW_EXMEMBER_KEY));
        await post(h, apiKey(RAW_ORGLESS_KEY));
        expect(h.warnings().filter((l) => l.includes('API key refused'))).toHaveLength(0);
    });

    it('NARROWNESS: the member control is UNCHANGED by the ablation — the wiring is what moved, not the fixture', async () => {
        const h = await boot({ tenancy: 'unregistered' });
        const res = await post(h, apiKey(RAW_MEMBER_KEY));
        expect(res.status).toBe(201);
        expect(h.store()).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// §5 — #13906 decision 1 option A: a `tenancy` service that was REGISTERED and
// FAILED TO BUILD is an OUTAGE, not an absent posture.
// ---------------------------------------------------------------------------

describe('[#15349] §5 — a registered `tenancy` that cannot be built is 503, never a quiet `undefined`', () => {
    it('the ex-member gets SERVICE_UNAVAILABLE — ⛔ not the 401 a refusal would give, ⛔ not the 201 the ablation gives', async () => {
        const h = await boot({ tenancy: 'factory-throws' });
        const res = await post(h, apiKey(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(503);
        expect(errorCode(res)).toBe('SERVICE_UNAVAILABLE');
        expect(h.store()).toHaveLength(0);
    });

    it('the outage is NOT selective: a HEALTHY member is refused the same way — admission was never decided', async () => {
        const h = await boot({ tenancy: 'factory-throws' });
        const res = await post(h, apiKey(RAW_MEMBER_KEY));
        expect(res.status).toBe(503);
        expect(errorCode(res)).toBe('SERVICE_UNAVAILABLE');
        expect(h.store()).toHaveLength(0);
    });

    it('and an ANONYMOUS caller sees the outage too — ⛔ the 401 is not allowed to swallow it', async () => {
        // [#13279] The failure this asserts against: degrading the outage to
        // `{}` answers 401, byte-identical to a genuine anonymous caller.
        const h = await boot({ tenancy: 'factory-throws' });
        const res = await post(h, {});
        expect(res.status).toBe(503);
    });
});

// ---------------------------------------------------------------------------
// §6 — The SESSION arm (#15409, maintainer ruling 2026-09-05 option B). The
// same posture input gates it, so this door was carrying that hole too.
// ---------------------------------------------------------------------------

const exMemberSession = (): Session => ({
    user: { id: 'u_exmember', email: 'u_exmember@example.com' },
    session: { userId: 'u_exmember', activeOrganizationId: ORG_ALPHA },
});
const memberSession = (): Session => ({
    user: { id: 'u_member', email: 'u_member@example.com' },
    session: { userId: 'u_member', activeOrganizationId: ORG_ALPHA },
});

describe('[#15349] §6 — an ex-member\'s browser SESSION claim', () => {
    it('REPAIRED: the stale claim is DROPPED — 403, nothing lands, and the person stays signed in (⛔ not 401)', async () => {
        const h = await boot({ tenancy: 'isolated', session: exMemberSession });
        const res = await post(h, cookie);
        // Option B, ruled: a session is a PERSON who may hold legitimate
        // memberships elsewhere, so the claim is dropped rather than the
        // principal refused. With no active organization Layer 0 is already
        // fail-closed, which is what answers here.
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('FORBIDDEN');
        expect(h.store()).toHaveLength(0);
    });

    it('ABLATION: with no `tenancy` service the same session mints the link again — 201, read back from the store', async () => {
        const h = await boot({ tenancy: 'unregistered', session: exMemberSession });
        const res = await post(h, cookie);
        expect(res.status).toBe(201);
        expect(h.store()).toHaveLength(1);
        expect(h.store()[0]).toMatchObject({ record_id: REC_ALPHA, created_by: 'u_exmember' });
    });

    it('CONTROL: a CURRENT member\'s session is untouched in BOTH wirings — 201 either way', async () => {
        const wired = await boot({ tenancy: 'isolated', session: memberSession });
        expect((await post(wired, cookie)).status).toBe(201);
        expect(wired.store()).toHaveLength(1);
        const ablated = await boot({ tenancy: 'unregistered', session: memberSession });
        expect((await post(ablated, cookie)).status).toBe(201);
    });
});

// ---------------------------------------------------------------------------
// §7 — `group`, MEASURED rather than assumed unaffected.
//
// The two guards do not answer alike under it, and the asymmetry is in the
// resolver, not here: `organization_membership_ended` keys on
// `postureEnforcesWall` (true for `group`), while `organization_required` adds
// `&& !postureUsesUnionScope` — under `group` an organization-less key already
// reads the union of its owner's memberships, so refusing it would break
// working deployments for no security gain.
// ---------------------------------------------------------------------------

describe('[#15349] §7 — under `group`', () => {
    it('the ex-member\'s stamped key IS refused — `group` is NOT unaffected', async () => {
        const h = await boot({ tenancy: 'group' });
        const res = await post(h, apiKey(RAW_EXMEMBER_KEY));
        expect(res.status).toBe(401);
        expect(h.store()).toHaveLength(0);
        const lines = h.warnings().filter((l) => l.includes('API key refused'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('organization_membership_ended');
    });

    it('the organization-less key is admitted, by design — no `organization_required` refusal under a union posture', async () => {
        const h = await boot({ tenancy: 'group' });
        await post(h, apiKey(RAW_ORGLESS_KEY));
        expect(h.warnings().filter((l) => l.includes('organization_required'))).toHaveLength(0);
    });

    it('CONTROL: the current member is unaffected under `group` — 201', async () => {
        const h = await boot({ tenancy: 'group' });
        const res = await post(h, apiKey(RAW_MEMBER_KEY));
        expect(res.status).toBe(201);
        expect(h.store()).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// §8 — The `.testkit.ts` seam, which resolves through the SAME resolver
// (`exec-context-seam.testkit.ts`). Triage flagged it beside this door and did
// not judge it: it is not a live door, but it was equally posture-less, so a
// test written through it could not reproduce a posture-conditional verdict at
// all — the kit's own failure mode, one level up. Now it can, and these two
// cases are what stop the new parameter from being a phantom.
// ---------------------------------------------------------------------------

describe('[#15349] §8 — the seam testkit can reproduce a posture-conditional verdict', () => {
    it('with a wall-enforcing posture, an unbacked session claim is DROPPED — no tenant on the envelope', async () => {
        const ctx: any = await bootRequestContext(
            // The ex-member shape: the session still names `org_alpha`, the
            // `sys_member` rows say `org_beta`.
            { userId: 'u_exmember', activeOrganizationId: ORG_ALPHA, memberships: [{ organization_id: ORG_BETA }] },
            { tenancyPosture: 'isolated' },
        );
        expect(ctx.userId).toBe('u_exmember');
        expect(ctx.tenantId).toBeUndefined();
        expect(ctx.accessible_org_ids).toEqual([ORG_BETA]);
    });

    it('DEFAULT (no posture, a `tenancy`-less host): the same claim survives — byte-identical to before', async () => {
        const ctx: any = await bootRequestContext(
            { userId: 'u_exmember', activeOrganizationId: ORG_ALPHA, memberships: [{ organization_id: ORG_BETA }] },
        );
        expect(ctx.tenantId).toBe(ORG_ALPHA);
    });

    it('CONTROL: a backed claim survives under the same wall-enforcing posture', async () => {
        const ctx: any = await bootRequestContext(
            { userId: 'u_member', activeOrganizationId: ORG_ALPHA },
            { tenancyPosture: 'isolated' },
        );
        expect(ctx.tenantId).toBe(ORG_ALPHA);
    });
});
