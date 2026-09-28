// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20408] The dispatcher's `/meta` doors scope a caller's metadata to the
 * organization `RestServer` scopes it to — the VETTED active organization on
 * the caller's execution context, never the raw session claim.
 *
 * ## The defect
 *
 * `handleMetadataRequest` took its organization from
 * `deps.resolveActiveOrganizationId`, which reads `session.activeOrganizationId`
 * off the auth service AS STORED. `RestServer` reads `ctx.tenantId` off the
 * execution context — the value `resolveAuthzContext` VETS: under a
 * wall-enforcing posture a session claim naming an organization its owner no
 * longer belongs to is DROPPED there, and the request resolves with no active
 * organization at all. The dispatcher never saw the drop, so a member removed
 * from an organization kept that organization's metadata partition on this
 * transport, for the rest of the session's lifetime:
 *
 *  - its org-scoped overlays of an org-overridable type (`view`, `dashboard`,
 *    `report`, `translation`, `email_template`) were served to them by the item
 *    read, the list, `/published` and the `?state=draft` read;
 *  - `GET /meta/_drafts` listed that organization's pending drafts;
 *  - `PUT /meta/:type/:name` wrote INTO that organization's partition.
 *
 * `RestServer` answers the same caller the env-wide rows, and lands the write
 * env-wide. Each row below drives `dispatch()` — the `createHonoApp`
 * catch-all's delegate — and `RestServer` over the same services, with the REAL
 * identity resolution on both (`resolveExecutionContext` →
 * `resolveAuthzContext`, `RestServer.computeExecCtx` → the same resolver): only
 * the caller's stored session claim and their `sys_member` rows differ between
 * the arms, so only the organization source can separate the transports.
 *
 * ## The protocol double
 *
 * It applies the read gate the real `metadata-protocol` applies to
 * `getMetaItem`, `getMetaItems` and `getMetaItemLayered`
 * (`organizationIdForMetaRead` over the folded type): an organization reaches a
 * read only for an org-overridable type. So a transport that hands down a raw
 * organization for `object` is answered what one that pre-gates it is — the
 * `object` control below — and the difference measured is the organization
 * VALUE, not where the gate runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { organizationIdForMetaRead } from '@objectstack/metadata-core';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

// ── The metadata store: env-wide rows and each organization's overlays ────────

const ENV_WIDE: Record<string, Record<string, any>> = {
    view: { lead_all: { name: 'lead_all', label: 'All leads', object: 'lead', viewKind: 'list' } },
    object: { invoice: { name: 'invoice', label: 'Invoice', fields: { amount: { type: 'number', label: 'Amount' } } } },
};
const ORG_OVERLAYS: Record<string, Record<string, Record<string, any>>> = {
    org_alpha: {
        view: { lead_all: { name: 'lead_all', label: 'Alpha pipeline', object: 'lead', viewKind: 'list' } },
        // A phantom row of a NON-overridable type: the protocol's gate never reads it.
        object: { invoice: { name: 'invoice', label: 'Invoice (alpha phantom)', fields: { amount: { type: 'number', label: 'Amount' } } } },
    },
    org_beta: {
        view: { lead_all: { name: 'lead_all', label: 'Beta pipeline', object: 'lead', viewKind: 'list' } },
    },
};
/** Each organization's pending drafts, as `listDrafts` answers them. */
const ORG_DRAFTS: Record<string, any[]> = {
    org_alpha: [{ type: 'view', name: 'alpha_board', label: 'Alpha board (draft)' }],
    org_beta: [{ type: 'view', name: 'beta_board', label: 'Beta board (draft)' }],
};
const ENV_DRAFTS: any[] = [{ type: 'view', name: 'env_board', label: 'Env board (draft)' }];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function protocolDouble() {
    const gate = (type: string, organizationId: unknown) =>
        organizationIdForMetaRead(canonicalMetaUrlType(type), typeof organizationId === 'string' ? organizationId : undefined);
    const resolve = (type: string, name: string, organizationId: unknown) => {
        const t = canonicalMetaUrlType(type);
        const org = gate(type, organizationId);
        const overlay = org ? ORG_OVERLAYS[org]?.[t]?.[name] : undefined;
        return { overlay, env: ENV_WIDE[t]?.[name] };
    };
    return {
        getMetaTypes: vi.fn(async () => ({ types: Object.keys(ENV_WIDE) })),
        getMetaItem: vi.fn(async ({ type, name, organizationId, state }: any) => {
            const { overlay, env } = resolve(type, name, organizationId);
            if (state === 'draft') {
                // The pending draft row is the overlay's, when this scope has one.
                if (!overlay) throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
                return { type: canonicalMetaUrlType(type), name, item: { ...clone(overlay), label: `${overlay.label} (draft)` } };
            }
            const item = overlay ?? env;
            return { type: canonicalMetaUrlType(type), name, item: item ? clone(item) : undefined };
        }),
        getMetaItems: vi.fn(async ({ type, organizationId }: any) => {
            const t = canonicalMetaUrlType(type);
            const org = gate(type, organizationId);
            const merged = new Map<string, any>(Object.entries(ENV_WIDE[t] ?? {}).map(([n, v]) => [n, clone(v)]));
            if (org) for (const [n, v] of Object.entries(ORG_OVERLAYS[org]?.[t] ?? {})) merged.set(n, clone(v));
            return { type: t, items: [...merged.values()] };
        }),
        // The overlay layer is a strict `state: 'active'` lookup, org-scoped first,
        // then env-wide — the env-wide rows here are env-wide overlay rows.
        getMetaItemLayered: vi.fn(async ({ type, name, organizationId }: any) => {
            const { overlay, env } = resolve(type, name, organizationId);
            const active = overlay ?? env;
            return { type: canonicalMetaUrlType(type), name, code: null, overlay: active ? clone(active) : null, effective: clone(active ?? null) };
        }),
        listDrafts: vi.fn(async ({ organizationId }: any) => ({
            items: clone(typeof organizationId === 'string' ? ORG_DRAFTS[organizationId] ?? [] : ENV_DRAFTS),
        })),
        saveMetaItem: vi.fn(async ({ type, name, organizationId }: any) => ({
            success: true, type, name, organizationId: organizationId ?? null,
        })),
    };
}

// ── Identity: sessions and the permission store, in the shipped shapes ────────

/**
 * `u_exmember`'s session is stamped `org_alpha` while its only current
 * `sys_member` row is `org_beta` — the session outlived the membership that
 * backed it. `u_member` is a current `org_alpha` member. Both hold ONE shared
 * permission set, so RBAC cannot separate any two arms: only the organization
 * claim can.
 */
function makeQl() {
    const tables: Record<string, any[]> = {
        sys_api_key: [],
        sys_member: [
            { user_id: 'u_member', organization_id: 'org_alpha', role: 'member' },
            { user_id: 'u_exmember', organization_id: 'org_beta', role: 'member' },
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
    /**
     * Equality plus `$in` — the two shapes the shared resolver issues — and a
     * loud refusal of every other shape, so a combinator this double does not
     * implement can never read as a field that happened not to match.
     */
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
    return {
        find: async (object: string, q: any = {}) => {
            const rows = (tables[object] ?? []).filter((row: any) => matches(row, q?.where));
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
    };
}

interface SessionRow { id: string; token: string; userId: string; activeOrganizationId: string | null }

function makeSessions(): Record<string, SessionRow> {
    return {
        sid_member: { id: 'ses_member', token: 'tok_member', userId: 'u_member', activeOrganizationId: 'org_alpha' },
        // ⭐ THE SUBJECT: the claim outlived the membership.
        sid_exmember: { id: 'ses_exmember', token: 'tok_exmember', userId: 'u_exmember', activeOrganizationId: 'org_alpha' },
    };
}

function authService(sessions: Record<string, SessionRow>) {
    return {
        api: {
            getSession: async ({ headers }: any) => {
                const cookie: string | undefined = typeof headers?.get === 'function' ? headers.get('cookie') ?? undefined : headers?.cookie;
                const sid = cookie?.split('os_session=')[1]?.split(';')[0];
                const row = sid ? sessions[sid] : undefined;
                if (!row) return undefined;
                return { user: { id: row.userId, email: `${row.userId}@example.com` }, session: { ...row } };
            },
        },
    };
}

const TENANCY = { posture: 'isolated' };

const COOKIE = { member: 'os_session=sid_member', exmember: 'os_session=sid_exmember' } as const;
type Who = keyof typeof COOKIE;

// ── The two transports, over the same services ────────────────────────────────

interface Answer { status: number; code?: string; data: any }

function bootDispatcher(sessions = makeSessions()) {
    const protocol = protocolDouble();
    const ql = makeQl();
    const services: Record<string, unknown> = { protocol, auth: authService(sessions), objectql: ql, tenancy: TENANCY };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    const call = async (method: string, who: Who, path: string, query: Record<string, string> = {}, body?: unknown): Promise<Answer> => {
        const res = await dispatcher.dispatch(method, path, body, query, { request: { headers: { cookie: COOKIE[who] } } } as any);
        const b: any = res.response?.body;
        return { status: res.response?.status ?? 0, code: b?.error?.code, data: b?.data };
    };
    return { call, protocol };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn(() => res);
    return res;
}

/** The single-kernel wiring (`rest-api-plugin.ts`), with the REAL `computeExecCtx`. */
function bootRest(sessions = makeSessions()) {
    const protocol = protocolDouble();
    const ql = makeQl();
    const server: any = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const rest: any = new RestServer(
        server, protocol as any, {} as any,
        undefined, undefined, undefined,
        async () => authService(sessions),
        async () => ql,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        async () => TENANCY,
    );
    rest.registerRoutes();
    const META = '/api/v1/meta';
    const call = async (method: string, who: Who, path: string, query: Record<string, string> = {}, body?: unknown): Promise<Answer> => {
        const segs = path.replace(/^\/meta\//, '').split('/');
        const [routePath, params] = segs[0] === '_drafts'
            ? [`${META}/_drafts`, {}]
            : segs.length === 1
                ? [`${META}/:type`, { type: segs[0] }]
                : segs.length === 2
                    ? [`${META}/:type/:name`, { type: segs[0], name: segs[1] }]
                    : [`${META}/:type/:name/${segs[2]}`, { type: segs[0], name: segs[1] }];
        const route = rest.getRoutes().find((r: any) => r.method === method && r.path === routePath);
        if (!route) throw new Error(`${method} ${routePath} is not registered`);
        const res = makeRes();
        await route.handler({ method, path: `${META}${path.replace(/^\/meta/, '')}`, params, query, body: body ?? {}, headers: { cookie: COOKIE[who] } }, res);
        const status = res.statusCode;
        return { status, code: res.body?.code ?? res.body?.error?.code, data: res.body };
    };
    return { call, protocol };
}

const itemsOf = (data: any): any[] => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []);
const labelOf = (data: any, name: string) => itemsOf(data).find((i: any) => i?.name === name)?.label;

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

// ── Controls: the rig separates the organizations, and the resolver drops the claim ──

describe('[#20408] controls: the rig can tell the organizations apart', () => {
    it('a CURRENT member reads its own organization\'s overlay on both transports', async () => {
        for (const boot of [bootDispatcher, bootRest]) {
            const { call } = boot();
            const item = await call('GET', 'member', '/meta/view/lead_all');
            expect({ status: item.status, label: item.data?.item?.label }).toEqual({ status: 200, label: 'Alpha pipeline' });
            expect(labelOf((await call('GET', 'member', '/meta/view')).data, 'lead_all')).toBe('Alpha pipeline');
            const published = await call('GET', 'member', '/meta/view/lead_all/published');
            expect({ status: published.status, label: published.data?.label }).toEqual({ status: 200, label: 'Alpha pipeline' });
        }
    });

    it('the protocol double gates a non-overridable type: the phantom org row of `object` is never read', async () => {
        for (const boot of [bootDispatcher, bootRest]) {
            const { call } = boot();
            expect((await call('GET', 'member', '/meta/object/invoice')).data?.item?.label).toBe('Invoice');
        }
    });

    it('the ex-member, switched to an organization they ARE in, reads that organization on both transports', async () => {
        for (const boot of [bootDispatcher, bootRest]) {
            const sessions = makeSessions();
            sessions.sid_exmember.activeOrganizationId = 'org_beta';
            const { call } = boot(sessions);
            expect((await call('GET', 'exmember', '/meta/view/lead_all')).data?.item?.label).toBe('Beta pipeline');
        }
    });
});

// ── The subject: a claim the resolver dropped ─────────────────────────────────

describe('[#20408] a session claim the resolver DROPPED scopes nothing, on either transport', () => {
    it('RestServer (the reference) answers the ex-member the env-wide rows', async () => {
        const { call } = bootRest();
        expect((await call('GET', 'exmember', '/meta/view/lead_all')).data?.item?.label).toBe('All leads');
        expect(labelOf((await call('GET', 'exmember', '/meta/view')).data, 'lead_all')).toBe('All leads');
        expect((await call('GET', 'exmember', '/meta/view/lead_all', { preview: 'draft' })).data?.item?.label).toBe('All leads');
        expect((await call('GET', 'exmember', '/meta/view/lead_all/published')).data?.label).toBe('All leads');
    });

    for (const [label, path, query, read] of [
        ['the item read', '/meta/view/lead_all', {}, (a: Answer) => a.data?.item?.label],
        ['the list', '/meta/view', {}, (a: Answer) => labelOf(a.data, 'lead_all')],
        ['the ?preview=draft item read', '/meta/view/lead_all', { preview: 'draft' }, (a: Answer) => a.data?.item?.label],
        ['/published', '/meta/view/lead_all/published', {}, (a: Answer) => a.data?.label],
    ] as const) {
        it(`${label}: the dispatcher serves the env-wide row, never the left organization's overlay`, async () => {
            const { call } = bootDispatcher();
            const res = await call('GET', 'exmember', path, query as Record<string, string>);
            expect(res.status).toBe(200);
            expect((read as (a: Answer) => unknown)(res)).toBe('All leads');
            expect(JSON.stringify(res.data)).not.toContain('Alpha');
        });
    }

    it('?state=draft: the dispatcher answers what RestServer answers — no pending draft in the env-wide scope, never the left organization\'s', async () => {
        const dispatcher = await bootDispatcher().call('GET', 'exmember', '/meta/view/lead_all', { state: 'draft' });
        const rest = await bootRest().call('GET', 'exmember', '/meta/view/lead_all', { state: 'draft' });
        expect({ status: rest.status, code: rest.code }).toEqual({ status: 404, code: 'NO_DRAFT' });
        expect({ status: dispatcher.status, code: dispatcher.code }).toEqual({ status: rest.status, code: rest.code });
        expect(JSON.stringify(dispatcher.data ?? null)).not.toContain('Alpha');
    });

    it('GET /meta/_drafts: the dispatcher lists what RestServer lists — never the left organization\'s drafts', async () => {
        const dispatcher = await bootDispatcher().call('GET', 'exmember', '/meta/_drafts');
        const rest = await bootRest().call('GET', 'exmember', '/meta/_drafts');
        expect(itemsOf(rest.data).map((d: any) => d.name)).toEqual(['env_board']);
        expect(itemsOf(dispatcher.data).map((d: any) => d.name)).toEqual(itemsOf(rest.data).map((d: any) => d.name));
    });

    it('PUT /meta/view/lead_all: the dispatcher lands the write where RestServer lands it — env-wide, never in the left organization', async () => {
        const body = { name: 'lead_all', label: 'Rewritten', object: 'lead', viewKind: 'list' };
        const d = bootDispatcher();
        const r = bootRest();
        const dispatcher = await d.call('PUT', 'exmember', '/meta/view/lead_all', {}, body);
        const rest = await r.call('PUT', 'exmember', '/meta/view/lead_all', {}, body);
        expect(rest.status).toBe(200);
        expect(dispatcher.status).toBe(rest.status);
        const landed = (p: ReturnType<typeof protocolDouble>) => p.saveMetaItem.mock.calls.map(([req]: any[]) => req.organizationId);
        expect(landed(r.protocol)).toEqual([undefined]);
        expect(landed(d.protocol)).toEqual(landed(r.protocol));
    });
});
