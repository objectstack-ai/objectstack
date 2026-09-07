// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15409 — maintainer ruling 2026-09-05, option B] The SESSION row of the
 * #15256 matrix, at REST level, on the single-kernel wiring under a live
 * `isolated` posture.
 *
 * ## What was measured, before this guard existed
 *
 * On a real `objectstack serve` of cloud's `apps/objectos-ee` — 44 plugins, the
 * REAL cloud-private `@objectstack/organizations`, `Tenancy: isolated`,
 * `SqlDriver(better-sqlite3)` on a FILE — a browser session whose
 * `activeOrganizationId` pointed at an organization its owner had LEFT:
 *
 * | after the membership ended | GET | POST | the row, read back from the sqlite file |
 * |:--|:--|:--|:--|
 * | direct `sys_member` DELETE | 200, total 3 | 201 | `organization_id: org_alpha`, `created_by: u_exmember` |
 * | better-auth's own `/organization/remove-member`, driven by the org OWNER | 200, total 4 | 201 | `organization_id: org_alpha`, `created_by: u_victim` |
 *
 * The second row is the one that makes this everyday: the product's own
 * offboarding path returned 200 and really deleted the `sys_member` row, and
 * the removed member's session came out of it still stamped with that
 * organization, still `revoked_at: null`, still served — for up to the session
 * lifetime, 7 days by default.
 *
 * ⭐ The resolver HAD the fact: `get-session` returned positions
 * `["user","org_member"]` while the membership was intact and `["user"]` on the
 * very next request, off the same `sys_member` read that builds
 * `accessible_org_ids`, while still serving that organization's rows. The
 * framework's only tenant-claim-vs-membership comparison was `keyPrincipal`-
 * gated, so a session never reached it.
 *
 * ## Option B, and what that makes this file assert
 *
 * The ruled repair DROPS the unbacked claim; it does ⛔ NOT refuse the
 * principal. So the ex-member's request here is **not** a 401 — it is an
 * authenticated request carrying NO active organization, which Layer 0 already
 * fails closed on. That is the whole difference between B and A, and §3 pins it
 * from the outside: the same person, same session, switched to an organization
 * they really are in, still works.
 *
 * ## Why the fixture is shaped the way it is
 *
 * Carried over from the cloud reading, unchanged in intent:
 *
 *  1. **Data must be shown to REACH.** A rig that serves nobody has measured
 *     nothing, so a current member runs every route in §1 and must get rows.
 *  2. **The write is read back FROM THE STORE**, never from the response body.
 *     `store()` is the fixture's table; the assertions count rows in it.
 *  3. **RBAC is opened SYMMETRICALLY** — one permission set held identically by
 *     both principals — so RBAC cannot be what separates any two arms. Only the
 *     organization claim can be.
 *  4. **A second organization is seeded** that the member must never see, so a
 *     wall that silently stopped applying reddens here rather than passes.
 *
 * ## Layer 0 is modelled, not mocked away
 *
 * `protocol.findData` / `createData` implement `tenant-layer.ts`'s `isolated`
 * branch as it is written there — `!organizationId ⇒ RLS_DENY_FILTER`,
 * otherwise `organization_id = organizationId` — plus ADR-0123 D2's other half
 * on the write side: under an authenticated context with no active
 * organization, tenant-scoped READS resolve to nothing and tenant-scoped WRITES
 * are REFUSED rather than landing a row with a NULL organization that no
 * reader, including its author, could ever see. Both halves already shipped;
 * this card adds neither.
 *
 * ⛔ `resolveExecCtx` is NOT stubbed: the whole subject is what that method
 * derives, so the real `computeExecCtx` → `resolveAuthzContext` chain runs.
 *
 * ⚠️ This suite resolves `@objectstack/core` through the workspace link, i.e.
 * its `dist/` — it is in `check-test-source-alias.mjs`'s
 * `KNOWN_UNALIASED_TEST_IMPORTS` for `@objectstack/rest`. Rebuild
 * `@objectstack/core` before reading a verdict from it, and rebuild BOTH legs
 * of any ablation: an unbuilt ablation leaves this file GREEN against the old
 * behaviour, which is the direction that fails silently.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashApiKey, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE } from '@objectstack/core';
import { RestServer } from './rest-server.js';

const DATA_COLLECTION = '/api/v1/data/:object';
const OBJECT = 'sys_business_unit';

/** Cookie values — the fixture's session lookup key. */
const COOKIE_MEMBER = 'os_session=sid_member';
const COOKIE_EXMEMBER = 'os_session=sid_exmember';
const COOKIE_BOGUS = 'os_session=sid_not_a_real_session';

/**
 * The `sys_session.token` values. Separate columns from the row `id`, which is
 * exactly why the drop's log line may name the id and never these: that field's
 * own comment in `sys-session.object.ts` records a replay-proven impersonation.
 */
const TOKEN_EXMEMBER = 'sess_token_exmember_never_log_me';

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
    // The other organization — seeded so "the wall is live" is a control rather
    // than an assumption, and so §3 has somewhere legitimate for the ex-member
    // to still work.
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
 * `u_exmember`'s session is stamped `org_alpha` while its only current
 * `sys_member` row is for `org_beta` — the session outlived the membership that
 * backed it, which is the whole scenario. `u_member` is a current `org_alpha`
 * member, and is ALSO the row that makes `org_alpha` a real organization with
 * real peers rather than an empty name.
 */
function makeQl() {
    const tables: Record<string, any[]> = {
        // No API keys on the session arms — an API key sets `userId` and makes
        // the session path unreachable, so a stray one would make every arm
        // below unreadable. §4 wires its own.
        sys_api_key: [],
        sys_member: [
            { user_id: 'u_member', organization_id: 'org_alpha', role: 'member' },
            { user_id: 'u_exmember', organization_id: 'org_beta', role: 'member' },
        ],
        sys_user: [
            { id: 'u_member', email: 'u_member@example.com' },
            { id: 'u_exmember', email: 'u_exmember@example.com' },
        ],
        // RBAC opened SYMMETRICALLY through one permission set — the cloud
        // reading's discipline. With one shared grant, only the organization
        // claim can separate the arms.
        sys_user_permission_set: [
            { user_id: 'u_member', permission_set_id: 'ps_shared' },
            { user_id: 'u_exmember', permission_set_id: 'ps_shared' },
        ],
        sys_permission_set: [
            { id: 'ps_shared', name: 'shared_access', system_permissions: ['manage_metadata', 'studio.access'] },
        ],
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
    /**
     * better-auth's `setActiveOrganization`, modelled: it rewrites
     * `active_organization_id` on the SAME session row — same id, same token,
     * same cookie. This is what "switch organization" is, and §3 uses it to
     * show the principal was never signed out.
     */
    switchActiveOrganization: (cookie: string, org: string | null) => void;
}

/**
 * The single-kernel wiring, byte-faithful to `rest-api-plugin.ts`: no
 * kernelManager, an auth provider and an objectql provider over the lone local
 * kernel, plus the tenancy provider.
 */
function setup(opts: { withExMemberApiKey?: string } = {}): Harness {
    const rows: BusinessUnitRow[] = SEED.map((r) => ({ ...r }));
    let seq = 0;
    const ql = makeQl();

    const sessions: Record<string, SessionRow> = {
        sid_member: { id: 'ses_member', token: 'sess_token_member', userId: 'u_member', activeOrganizationId: 'org_alpha' },
        // ⭐ THE SUBJECT: the claim outlived the membership.
        sid_exmember: { id: 'ses_exmember', token: TOKEN_EXMEMBER, userId: 'u_exmember', activeOrganizationId: 'org_alpha' },
    };

    if (opts.withExMemberApiKey) ql.tables.sys_api_key.push(opts.withExMemberApiKey as any);

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
            // landed with a NULL organization.
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
                return {
                    user: { id: row.userId, email: `${row.userId}@example.com` },
                    session: { ...row },
                };
            },
        },
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
        tenancyServiceProvider,
    );
    rest.registerRoutes();

    return {
        rest,
        store: () => rows.map((r) => ({ ...r })),
        warnings: () => warnSpy.mock.calls.map((c: unknown[]) => c.map(String).join(' ')),
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

function cookieHeaders(cookie?: string, apiKey?: string): Record<string, string> {
    const h: Record<string, string> = {};
    if (cookie) h.cookie = cookie;
    if (apiKey) h['x-api-key'] = apiKey;
    return h;
}

async function callGet(rest: any, cookie?: string, apiKey?: string) {
    const res = makeRes();
    await routeOf(rest, 'GET', DATA_COLLECTION).handler(
        {
            method: 'GET', path: `/api/v1/data/${OBJECT}`, params: { object: OBJECT }, query: {},
            headers: cookieHeaders(cookie, apiKey),
        },
        res,
    );
    return res;
}

async function callPost(rest: any, cookie: string | undefined, name: string, apiKey?: string) {
    const res = makeRes();
    await routeOf(rest, 'POST', DATA_COLLECTION).handler(
        {
            method: 'POST', path: `/api/v1/data/${OBJECT}`, params: { object: OBJECT }, query: {},
            headers: cookieHeaders(cookie, apiKey), body: { name },
        },
        res,
    );
    return res;
}

const dropLines = (h: Harness) => h.warnings().filter((l) => l.includes('Session organization claim dropped'));

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

describe('[#15409] §1 — the rig can serve, and the door can refuse', () => {
    it('CONTROL · data REACHES: a CURRENT member reads its own organization and only that one', async () => {
        const h = setup();
        const res = await callGet(h.rest, COOKIE_MEMBER);
        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(2);
        expect(res.body.value.map((r: BusinessUnitRow) => r.id)).toEqual(['bu_a1', 'bu_a2']);
        // The wall IS live: org_beta's two rows exist in the store and are not served.
        expect(h.store().filter((r) => r.organization_id === 'org_beta')).toHaveLength(2);
    });

    it('CONTROL · writes REACH: a CURRENT member\'s POST lands, read back FROM THE STORE', async () => {
        const h = setup();
        const res = await callPost(h.rest, COOKIE_MEMBER, 'w-member');
        expect(res.statusCode).toBe(201);
        const landed = h.store().filter((r) => r.name === 'w-member');
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ organization_id: 'org_alpha', created_by: 'u_member' });
    });

    it('CONTROL · the door refuses: no cookie is 401 on both verbs, and nothing lands', async () => {
        const h = setup();
        const get = await callGet(h.rest, undefined);
        expect(get.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(get.body?.error?.code ?? get.body?.code).toBe(ANONYMOUS_DENY_CODE);
        const post = await callPost(h.rest, undefined, 'w-anon');
        expect(post.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(h.store()).toHaveLength(SEED.length);
    });

    it('CONTROL · a bogus cookie is 401 too — and is not a drop, because nothing was claimed', async () => {
        const h = setup();
        const res = await callGet(h.rest, COOKIE_BOGUS);
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(dropLines(h)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// §2 — THE SUBJECT ROW. The card's own case, driven end to end.
// ---------------------------------------------------------------------------

describe('[#15409] §2 — a session whose membership ended while it stayed alive', () => {
    it('REPAIRED: GET reads NOTHING from the organization it left — was 200 carrying that organization\'s rows', async () => {
        const h = setup();
        const res = await callGet(h.rest, COOKIE_EXMEMBER);
        expect(res.body.total).toBe(0);
        expect(res.body.value).toEqual([]);
        // The rows are still there — they were not served, not deleted.
        expect(h.store().filter((r) => r.organization_id === 'org_alpha')).toHaveLength(2);
    });

    it('REPAIRED: POST does NOT land in that organization — read back from the store', async () => {
        const h = setup();
        const res = await callPost(h.rest, COOKIE_EXMEMBER, 'w-exmember');
        // 403 `PERMISSION_DENIED` — ADR-0123 D2's EXISTING write refusal for a
        // context with no active organization, in its existing words. ⛔ No new
        // status code and no new error code were added by this card.
        expect(res.statusCode).toBe(403);
        expect(res.body?.error?.code ?? res.body?.code).toBe('PERMISSION_DENIED');
        // The measured defect was a write that LANDED, stamped with the left
        // organization and attributed to the removed user. The STORE is the
        // authority on whether it did — never the response body.
        expect(h.store().filter((r) => r.name === 'w-exmember')).toHaveLength(0);
        expect(h.store().filter((r) => r.created_by === 'u_exmember')).toHaveLength(0);
        expect(h.store()).toHaveLength(SEED.length);
    });

    it('[2A, mirrored] the drop is said OUT LOUD once — session / principal / organization / reason, ⛔ never the token', async () => {
        const h = setup();
        await callGet(h.rest, COOKIE_EXMEMBER);
        const lines = dropLines(h);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('organization_membership_ended');
        expect(lines[0]).toContain('session=ses_exmember');
        expect(lines[0]).toContain('principal=u_exmember');
        expect(lines[0]).toContain('organization=org_alpha');
        // ⛔ THE CREDENTIAL. A leaked `sys_session.token` is `Authorization:
        // Bearer` for that user — its own field comment calls the disclosure
        // impersonation rather than exposure.
        expect(lines[0]).not.toContain(TOKEN_EXMEMBER);
    });

    it('the WIRE is unchanged: no new status code, no reason, no organization travels to the caller', async () => {
        const h = setup();
        const get = await callGet(h.rest, COOKIE_EXMEMBER);
        const post = await callPost(h.rest, COOKIE_EXMEMBER, 'w-exmember-wire');
        for (const body of [get.body, post.body]) {
            expect(JSON.stringify(body ?? {})).not.toMatch(/organization_membership_ended|claim dropped|ses_exmember/i);
        }
        // The 200-shaped empty read and the ADR-0123 D2 write refusal are both
        // states this deployment could already produce for a session that simply
        // has not selected an organization. Nothing here is new vocabulary.
        expect(get.statusCode).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// §3 — ⭐ B, NOT A. The assertion that reddens if B is "simplified" into A.
// ---------------------------------------------------------------------------

describe('[#15409] §3 — the principal is dropped-from-an-org, NOT refused', () => {
    it('the ex-member is STILL AUTHENTICATED — the read is a 200 with nothing in it, not a 401', async () => {
        const h = setup();
        const res = await callGet(h.rest, COOKIE_EXMEMBER);
        // ⛔ If this ever becomes ANONYMOUS_DENY_STATUS, option B has silently
        // become option A: a person signed out of everything because one stored
        // claim went stale.
        expect(res.statusCode).not.toBe(ANONYMOUS_DENY_STATUS);
        expect(res.statusCode).toBe(200);
        expect(res.body?.error?.code ?? res.body?.code).not.toBe(ANONYMOUS_DENY_CODE);
    });

    it('and can still WORK in an organization they really are in — same session, switched', async () => {
        const h = setup();
        // The dropped request first, so the switch is measured on a session that
        // has already met the guard.
        await callGet(h.rest, COOKIE_EXMEMBER);
        // better-auth's `setActiveOrganization`: the SAME session row, same id,
        // same token, same cookie — only the claim moves.
        h.switchActiveOrganization(COOKIE_EXMEMBER, 'org_beta');

        const get = await callGet(h.rest, COOKIE_EXMEMBER);
        expect(get.statusCode).toBe(200);
        expect(get.body.total).toBe(2);
        expect(get.body.value.map((r: BusinessUnitRow) => r.id)).toEqual(['bu_b1', 'bu_b2']);

        const post = await callPost(h.rest, COOKIE_EXMEMBER, 'w-exmember-beta');
        expect(post.statusCode).toBe(201);
        const landed = h.store().filter((r) => r.name === 'w-exmember-beta');
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ organization_id: 'org_beta', created_by: 'u_exmember' });
    });

    it('and the backed claim says NOTHING — one line per drop, not one per request', async () => {
        const h = setup();
        h.switchActiveOrganization(COOKIE_EXMEMBER, 'org_beta');
        await callGet(h.rest, COOKIE_EXMEMBER);
        await callGet(h.rest, COOKIE_MEMBER);
        expect(dropLines(h)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// §4 — The API-key arm is UNTOUCHED (#15256 decision 1A stands).
// ---------------------------------------------------------------------------

describe('[#15409] §4 — an API key is still refused outright, not trimmed', () => {
    /**
     * A key IS its organization binding, so refusing the whole credential is
     * right there. This card changed the SESSION arm only; if someone ever
     * generalises the drop over both, this row goes red — an ex-member's
     * automation would go back to answering 200 with an empty set, the silent
     * empty #15256 exists to remove.
     */
    it('an ex-member\'s org-stamped key is 401, and the session drop line does not fire for it', async () => {
        // The fixture stores the at-rest hash exactly as `sys_api_key` does.
        const raw = 'osk_15409_exmember';
        const h = setup({
            withExMemberApiKey: {
                id: 'key_exmember', key: hashApiKey(raw), user_id: 'u_exmember',
                active_organization_id: 'org_alpha', revoked: false,
            } as any,
        });
        const res = await callGet(h.rest, undefined, raw);
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(res.body?.error?.code ?? res.body?.code).toBe(ANONYMOUS_DENY_CODE);
        expect(h.warnings().filter((l) => l.includes('API key refused'))).toHaveLength(1);
        expect(dropLines(h)).toHaveLength(0);
    });

    it('its POST lands nothing either — the store still holds only the seed', async () => {
        const raw = 'osk_15409_exmember';
        const h = setup({
            withExMemberApiKey: {
                id: 'key_exmember', key: hashApiKey(raw), user_id: 'u_exmember',
                active_organization_id: 'org_alpha', revoked: false,
            } as any,
        });
        const res = await callPost(h.rest, undefined, 'w-exmember-key', raw);
        expect(res.statusCode).toBe(ANONYMOUS_DENY_STATUS);
        expect(h.store()).toHaveLength(SEED.length);
    });
});
