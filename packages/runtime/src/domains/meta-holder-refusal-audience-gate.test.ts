// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling 6917064203 on #34398 · #34247] The audience gate answers before any
 * refusal that names holders.
 *
 * An exact `?package=X` read of a doc X holds no item of, while another
 * package holds the name, is refused by the protocol `409 RESOURCE_CONFLICT`
 * `not-held-by-qualifier`, its candidates naming the holders. That refusal is
 * the answer only for a caller the ADR-0046 §6.7 docs audience admits to the
 * name: a member the gate refuses is answered the gate's `403
 * PERMISSION_DENIED`, an anonymous caller the gate's `401 UNAUTHENTICATED`,
 * and neither answer names a holder. Both transports (the dispatcher and
 * `RestServer`) ask the one question, `gateHolderNamingRefusal` in
 * `@objectstack/rest`, on the plain read and on `/layers`.
 *
 * The protocol is a double that throws the protocol's own refusal shape; the
 * gate, its audience resolution and both transports are the real ones.
 */

import { describe, it, expect, vi } from 'vitest';
// The dispatcher's reach loads `@objectstack/metadata` lazily; paid here, at
// collection, never inside a case's clocked window (check:test-source-alias).
import '@objectstack/metadata';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';
import { PackageScopedNameRefusedError } from '@objectstack/core';
const THROW: { name?: string } = {};

// ── Fixtures (the #20193 parity rig's docs) ───────────────────────────────────

const DOC_SECRET = 'Rotate the tenant signing keys before every release.';
const BOOK_SECRET = 'Restricted spine: the incident playbooks.';

const ADMIN_GUIDE = {
    name: 'admin_guide',
    label: 'Admin Guide',
    description: BOOK_SECRET,
    audience: { permissionSet: 'crm_admin' },
    _packageId: 'crm',
    groups: [{ key: 'admin', label: 'Admin', include: 'crm_admin_*' }],
};
const HELP_CENTER = {
    name: 'help_center',
    label: 'Help Centre',
    audience: 'org',
    _packageId: 'crm',
    groups: [{ key: 'start', label: 'Start', include: 'crm_intro' }],
};
const DOCS = [
    { name: 'crm_intro', label: 'Getting started', content: 'Welcome aboard.', _packageId: 'crm' },
    { name: 'crm_admin_runbook', label: 'Admin runbook', content: DOC_SECRET, _packageId: 'crm' },
];
const STORE: Record<string, any[]> = { book: [ADMIN_GUIDE, HELP_CENTER], doc: DOCS };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');
const find = (type: unknown, name: unknown): any =>
    (STORE[singular(type)] ?? []).find((i: any) => i.name === name);

// ── Callers ───────────────────────────────────────────────────────────────────

interface Caller {
    ctx: { userId?: string; isSystem: false; systemPermissions: string[] };
    holdings: string[];
    readableFields: string[];
}
const CALLERS: Record<'holder' | 'non-holder' | 'anonymous', Caller> = {
    holder: {
        ctx: { userId: 'u_holder', isSystem: false, systemPermissions: [] },
        holdings: ['crm_admin'],
        readableFields: [],
    },
    'non-holder': {
        ctx: { userId: 'u_member', isSystem: false, systemPermissions: [] },
        holdings: [],
        readableFields: [],
    },
    anonymous: { ctx: { isSystem: false, systemPermissions: [] }, holdings: [], readableFields: [] },
};
type CallerName = keyof typeof CALLERS;

/**
 * The protocol's refusal of `?package=sales` for a doc `sales` ships none of
 * while `crm` ships it (`notHeldByQualifierRefusal` in
 * `@objectstack/metadata-protocol`): `PackageScopedNameRefusedError`, reason
 * `not-held-by-qualifier`, naming the holder.
 */
function refuseIfAsked(type: unknown, name: unknown): void {
    if (singular(type) !== 'doc' || name !== THROW.name) return;
    const base = {
        status: 'refused' as const, reason: 'not-held-by-qualifier' as const, type: 'doc', name: String(name),
        callerPackageId: 'sales', candidates: [{ kind: 'package' as const, packageId: 'crm' }],
    };
    throw new PackageScopedNameRefusedError({ ...base, message: `doc "${String(name)}" is not held by package "sales"` } as never);
}

/** One protocol double, the same shape both transports read. */
function protocolDouble() {
    return {
        getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORE) })),
        getMetaItems: vi.fn(async ({ type }: any) => clone(STORE[singular(type)] ?? [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            refuseIfAsked(type, name);
            const found = find(type, name);
            return { type: singular(type), name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => {
            refuseIfAsked(type, name);
            const found = find(type, name);
            const layer = () => (found ? clone(found) : null);
            return { type: singular(type), name, code: layer(), overlay: layer(), effective: layer() };
        }),
    };
}

const securityFor = (caller: Caller) => ({
    resolvePermissionSetNames: async () => caller.holdings,
    getMetadataReadableFields: async () => caller.readableFields,
});

// ── The two transports ────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; body: any; served?: any }

/** The dispatcher, exactly as `createHonoApp` builds it: `new HttpDispatcher(kernel)`. */
function bootDispatcher(callerName: CallerName) {
    const caller = CALLERS[callerName];
    const protocol = protocolDouble();
    const services: Record<string, unknown> = {
        protocol,
        security: securityFor(caller),
        metadata: { getPublished: async (type: string, name: string) => clone(find(type, name)) },
    };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through; a context handed in is
    // overwritten by it, so the principal is supplied here (as the sibling
    // dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(caller.ctx);
    const read = async (path: string): Promise<Answer> => {
        const res = await dispatcher.dispatch('GET', path, undefined, { package: 'sales' }, { request: { headers: {} } } as any);
        const status = res.response?.status ?? 0;
        const body = res.response?.body;
        const data = body?.data;
        const served = status === 200 ? data?.item : undefined;
        return { status, code: body?.error?.code, body, served };
    };
    return { read, protocol };
}

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.send = vi.fn(() => res);
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

/** `RestServer` over the same protocol double and the same caller — the reference answer. */
function bootRest(callerName: CallerName) {
    const caller = CALLERS[callerName];
    const rest: any = new RestServer(createMockServer() as any, protocolDouble() as any, {} as any);
    if (caller.ctx.userId) {
        const ctx = caller.ctx;
        rest.resolveExecCtx = async () => clone(ctx);
    }
    rest.securityServiceProvider = async () => securityFor(caller);
    // ADR-0057 D10 — `tenancy` is an optional service this deployment lacks.
    rest.serviceExistsProvider = (name: string) => name !== 'tenancy';
    rest.metadataServiceProvider = async () => ({
        getPublished: async (type: string, name: string) => clone(find(type, name)),
    });
    rest.registerRoutes();
    const META = '/api/v1/meta';
    const read = async (type: string, name: string, suffix = ''): Promise<Answer> => {
        const routePath = `${META}/:type/:name${suffix}`;
        const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === routePath);
        if (!route) throw new Error(`GET ${routePath} is not registered`);
        const res = makeRes();
        await route.handler({ method: 'GET', path: `${META}/${type}/${name}${suffix}`, params: { type, name }, query: { package: 'sales' }, body: {}, headers: {} }, res);
        const served = res.statusCode === 200 ? res.body?.item : undefined;
        return { status: res.statusCode, code: res.body?.code ?? res.body?.error?.code, body: res.body, served };
    };
    return { read };
}

const DOORS = ['', '/layers'] as const;
const PATH = (name: string, suffix: string) => `/meta/doc/${name}${suffix}`;

/** Each transport's answer to `GET /meta/doc/NAME[SUFFIX]?package=sales`, for one caller. */
async function answersFor(callerName: CallerName, name: string): Promise<Array<Answer & { door: string }>> {
    const answers: Array<Answer & { door: string }> = [];
    THROW.name = name;
    try {
        for (const suffix of DOORS) {
            answers.push({ door: `dispatcher ${PATH(name, suffix)}`, ...(await bootDispatcher(callerName).read(PATH(name, suffix))) });
            answers.push({ door: `rest ${PATH(name, suffix)}`, ...(await bootRest(callerName).read('doc', name, suffix)) });
        }
    } finally {
        THROW.name = undefined;
    }
    return answers;
}

const namesHolders = (a: Answer): boolean => JSON.stringify(a.body ?? null).includes('candidates');

describe('[#34247] the audience gate answers before the not-held-by-qualifier refusal, both transports', () => {
    it('a member the docs audience refuses is answered the gate\'s 403 at `?package=` of a package holding none, on the plain read and /layers, never the refusal naming holders', async () => {
        for (const answer of await answersFor('non-holder', 'crm_admin_runbook')) {
            expect([answer.status, answer.code, namesHolders(answer), answer.door], JSON.stringify(answer.body))
                .toEqual([403, 'PERMISSION_DENIED', false, answer.door]);
            expect(JSON.stringify(answer.body ?? null), answer.door).not.toContain(DOC_SECRET);
        }
    });

    it('an anonymous caller is answered the gate\'s 401 at the same address, never the refusal naming holders', async () => {
        for (const answer of await answersFor('anonymous', 'crm_admin_runbook')) {
            expect([answer.status, answer.code, namesHolders(answer), answer.door], JSON.stringify(answer.body))
                .toEqual([401, 'UNAUTHENTICATED', false, answer.door]);
        }
    });

    it('CONTROL: a caller the gate admits is answered the 409 naming the holders', async () => {
        for (const answer of await answersFor('holder', 'crm_admin_runbook')) {
            expect([answer.status, answer.code, namesHolders(answer), answer.door], JSON.stringify(answer.body))
                .toEqual([409, 'RESOURCE_CONFLICT', true, answer.door]);
            expect(JSON.stringify(answer.body), answer.door).toContain('crm');
        }
    });

    it('CONTROL: a doc every member may read (the `org` audience) is the 409 naming the holders to a member', async () => {
        for (const answer of await answersFor('non-holder', 'crm_intro')) {
            expect([answer.status, answer.code, namesHolders(answer), answer.door], JSON.stringify(answer.body))
                .toEqual([409, 'RESOURCE_CONFLICT', true, answer.door]);
        }
    });
});
