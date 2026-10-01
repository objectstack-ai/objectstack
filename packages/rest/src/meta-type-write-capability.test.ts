// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21124] A `datasource` definition is written on the `/meta` surface only by
 * a holder of the capability the datasource admin door requires for the same
 * create / update / remove — `metaTypeWriteRefusal` over
 * `META_TYPE_WRITE_CAPABILITIES` (`./meta-item-read-gate.ts`), asked by
 * `RestServer`'s guarded registrar before any `/meta` handler runs. The
 * write-side twin of `meta-type-read-capability.test.ts`.
 *
 * Three batteries:
 *
 *  1. **The predicate** — which verbs it judges, how it folds a type segment,
 *     who it admits, what it answers the rest, and which types have a row.
 *  2. **Every write door, both sides, over a real in-memory store** — the door
 *     list is read off the route table (every non-`GET` route under
 *     `/meta/:type`), so a door added later is judged here without being
 *     named. A caller without the capability is refused (status + ADR-0112
 *     code) with the STORE UNCHANGED and no protocol call made — the same
 *     answer for a name that exists and one that does not — while a holder
 *     still writes, and an unlisted type is untouched.
 *  3. **Agreement with the datasource admin door** — the same principals,
 *     resolved through the platform's one `resolveAuthzContext` over one grant
 *     store: every principal the `/meta` door admits to write a datasource is
 *     admitted by `POST /datasources` too.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveAuthzContext } from '@objectstack/core';
import { registerDatasourceAdminRoutes } from '@objectstack/service-datasource';
import { PLATFORM_CAPABILITY_NAMES } from '@objectstack/spec/security';
// Explicit `.js` extension: NodeNext resolution (see the sibling meta tests).
import { RestServer } from './rest-server.js';
import {
    META_TYPE_READ_CAPABILITIES,
    META_TYPE_WRITE_CAPABILITIES,
    metaTypeWriteRefusal,
} from './meta-item-read-gate.js';
import { FEDERATION_WRITE_CAPABILITY } from './external-datasource-routes.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WAREHOUSE = {
    name: 'warehouse',
    label: 'Warehouse',
    driver: 'postgres',
    config: { host: 'warehouse-db.fixture.internal', port: 5432, database: 'wh', user: 'reporting' },
};
const WAREHOUSE_EDIT = { ...WAREHOUSE, label: 'Warehouse (edited)', config: { ...WAREHOUSE.config, host: 'other-host.fixture.internal' } };
const LEADS_VIEW = { name: 'all_leads', label: 'All leads', object: 'lead', columns: ['name'] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');

// ── Callers ───────────────────────────────────────────────────────────────────

/**
 * Callers below the capability. `author` matters most: it holds every
 * AUTHORING capability the `/meta` surface knows, so the write doors' own
 * admission (`metaWriteCapabilityVerdict`) admits it — a refusal it receives
 * can only come from the type-level gate.
 */
const REFUSED = {
    member: { userId: 'u_member', systemPermissions: [] as string[] },
    author: { userId: 'u_author', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
    'other-grant': { userId: 'u_org_admin', systemPermissions: ['manage_org_users'] },
} as const;

/** A holder — with `manage_metadata` too, which the write doors' own admission still asks for. */
const HOLDER = { userId: 'u_settings', systemPermissions: ['manage_platform_settings', 'manage_metadata'] };

// ── Harness ───────────────────────────────────────────────────────────────────

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

/**
 * A RestServer whose caller is `ctx`, over a protocol backed by a REAL
 * in-memory store: every write method mutates `store`, so "nothing persisted"
 * is read off the store itself, and `calls()` counts every protocol call made.
 */
function boot(ctx: Record<string, unknown> | undefined) {
    const store: Record<string, Record<string, any>> = {
        datasource: { warehouse: clone(WAREHOUSE) },
        view: { all_leads: clone(LEADS_VIEW) },
    };
    const bucket = (type: unknown) => (store[singular(type)] ??= {});
    const protocol = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: Object.keys(store), entries: [] }),
        getMetaItems: vi.fn(async ({ type }: any) => Object.values(bucket(type)).map(clone)),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({ type: singular(type), name, item: clone(bucket(type)[name]), lock: 'none' })),
        saveMetaItem: vi.fn(async ({ type, name, item }: any) => {
            bucket(type)[name] = clone(item);
            return { success: true, type: singular(type), name };
        }),
        deleteMetaItem: vi.fn(async ({ type, name }: any) => {
            delete bucket(type)[name];
            return { success: true, type: singular(type), name };
        }),
        publishMetaItem: vi.fn(async ({ type, name }: any) => {
            bucket(type)[name] = { ...(bucket(type)[name] ?? {}), _published: true };
            return { success: true, type: singular(type), name, version: 2 };
        }),
        rollbackMetaItem: vi.fn(async ({ type, name }: any) => {
            bucket(type)[name] = { ...(bucket(type)[name] ?? {}), _rolledBack: true };
            return { success: true, type: singular(type), name, version: 3 };
        }),
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol as any, {} as any);
    rest.resolveExecCtx = async () => (ctx ? clone(ctx) : undefined);
    rest.registerRoutes();
    const calls = (): number => Object.values(protocol).reduce((n, fn: any) => n + (fn?.mock?.calls?.length ?? 0), 0);
    return { rest, protocol, store, calls };
}

const META = '/api/v1/meta';

/** Every non-`GET` route the server registers under `/meta/:type` — the write doors, read off the route table. */
function typedWriteDoors(rest: any): Array<{ method: string; path: string }> {
    return rest.getRoutes()
        .filter((r: any) => r.method !== 'GET' && typeof r.path === 'string' && r.path.startsWith(`${META}/:type`))
        .map((r: any) => ({ method: r.method as string, path: r.path as string }));
}

/** Each door, plus the save's draft mode — every request shape that writes one type. */
function writeShapes(rest: any): Array<{ label: string; method: string; path: string; query: Record<string, string> }> {
    const shapes = typedWriteDoors(rest).map((d) => ({ label: `${d.method} ${d.path.slice(META.length)}`, ...d, query: {} as Record<string, string> }));
    shapes.push({ label: `PUT /:type/:name?mode=draft`, method: 'PUT', path: `${META}/:type/:name`, query: { mode: 'draft' } });
    return shapes;
}

async function drive(rest: any, method: string, routePath: string, type: string, name: string, query: Record<string, string> = {}, body: unknown = WAREHOUSE_EDIT) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === routePath);
    if (!route) throw new Error(`${method} ${routePath} is not registered`);
    const res = makeRes();
    const concrete = routePath.replace(':type', type).replace(':name', name);
    await route.handler({ method, path: concrete, params: { type, name }, query, body: clone(body), headers: {} }, res);
    return res;
}

const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.code ?? res.body?.error?.code });

// ── 1. The predicate ──────────────────────────────────────────────────────────

describe('[#21124] metaTypeWriteRefusal — the type-level write admission', () => {
    it('the one row names a declared platform capability (matched, never minted)', () => {
        expect(META_TYPE_WRITE_CAPABILITIES).toEqual({ datasource: 'manage_platform_settings' });
        for (const capability of Object.values(META_TYPE_WRITE_CAPABILITIES)) {
            expect(PLATFORM_CAPABILITY_NAMES.has(capability)).toBe(true);
        }
    });

    it('external_catalog has a read row but no write row — its own write door asks only the authoring capability', () => {
        expect(META_TYPE_READ_CAPABILITIES.external_catalog).toBe('manage_platform_settings');
        expect(FEDERATION_WRITE_CAPABILITY).toBe('manage_metadata');
        expect(Object.prototype.hasOwnProperty.call(META_TYPE_WRITE_CAPABILITIES, 'external_catalog')).toBe(false);
        expect(metaTypeWriteRefusal('PUT', 'external_catalog', REFUSED.author)).toBeUndefined();
    });

    it.each(['PUT', 'POST', 'PATCH', 'DELETE', 'put', 'delete'])('judges %s on datasource and datasources — 403 PERMISSION_DENIED naming the capability', (verb) => {
        for (const type of ['datasource', 'datasources']) {
            const refusal = metaTypeWriteRefusal(verb, type, REFUSED.author);
            expect(refusal).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
            expect(refusal?.message).toContain('manage_platform_settings');
        }
    });

    it.each(['GET', 'HEAD', 'OPTIONS', '', undefined])('does not judge %j — reads keep the read admission', (verb) => {
        expect(metaTypeWriteRefusal(verb, 'datasource', REFUSED.member)).toBeUndefined();
    });

    it('admits a holder of the capability', () => {
        expect(metaTypeWriteRefusal('PUT', 'datasource', HOLDER)).toBeUndefined();
        expect(metaTypeWriteRefusal('DELETE', 'datasources', { userId: 'u', systemPermissions: ['manage_platform_settings'] })).toBeUndefined();
    });

    it('refuses the authoring capabilities and an unrelated grant alike', () => {
        for (const caller of Object.values(REFUSED)) {
            expect(metaTypeWriteRefusal('PUT', 'datasource', caller)).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
        }
    });

    it('reads the held set alone — `isSystem` is no second policy beside the capability', () => {
        expect(metaTypeWriteRefusal('PUT', 'datasource', { userId: 'u', isSystem: true, systemPermissions: [] }))
            .toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
    });

    it('answers a caller with no identity 401 UNAUTHENTICATED — the shared anonymous-deny code', () => {
        expect(metaTypeWriteRefusal('PUT', 'datasource', undefined)).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
        expect(metaTypeWriteRefusal('PUT', 'datasource', { systemPermissions: ['manage_platform_settings'] })).toMatchObject({ status: 401 });
    });

    it.each(['view', 'views', 'object', 'app', 'flow', 'external_catalog', '', '_migrate-stored'])('leaves an unlisted segment %j alone', (type) => {
        expect(metaTypeWriteRefusal('PUT', type, REFUSED.member)).toBeUndefined();
    });
});

// ── 2. Every write door, both sides ───────────────────────────────────────────

describe('[#21124] every /meta write door of a datasource admits the capability and nothing less', () => {
    it('the door census is non-empty and covers the doors this pin was written against', () => {
        const { rest } = boot(HOLDER);
        const doors = typedWriteDoors(rest).map((d) => `${d.method} ${d.path.slice(META.length)}`);
        for (const known of ['PUT /:type/:name', 'DELETE /:type/:name', 'POST /:type/:name/publish', 'POST /:type/:name/rollback']) {
            expect(doors).toContain(known);
        }
    });

    for (const spelling of ['datasource', 'datasources']) {
        for (const [who, ctx] of Object.entries(REFUSED)) {
            it(`${spelling} × ${who}: every write shape refuses 403 PERMISSION_DENIED with the store unchanged and no protocol call`, async () => {
                const { rest, store, calls } = boot(ctx);
                const before = clone(store);
                for (const shape of writeShapes(rest)) {
                    for (const name of ['warehouse', 'new_ds']) {
                        const res = await drive(rest, shape.method, shape.path, spelling, name, shape.query);
                        expect({ shape: shape.label, name, ...envelope(res) })
                            .toEqual({ shape: shape.label, name, status: 403, code: 'PERMISSION_DENIED' });
                    }
                }
                expect(store).toEqual(before);
                expect(calls()).toBe(0);
            });
        }

        it(`${spelling}: the refusal is byte-identical for a name that exists and one that does not`, async () => {
            const { rest } = boot(REFUSED.author);
            for (const shape of writeShapes(rest)) {
                const present = await drive(rest, shape.method, shape.path, spelling, 'warehouse', shape.query);
                const absent = await drive(rest, shape.method, shape.path, spelling, 'no_such_item', shape.query);
                expect({ shape: shape.label, status: absent.statusCode, body: absent.body })
                    .toEqual({ shape: shape.label, status: present.statusCode, body: present.body });
            }
        });
    }

    it('a holder still saves, publishes, rolls back and resets — each reaching the store', async () => {
        const { rest, store, protocol } = boot(HOLDER);
        const saved = await drive(rest, 'PUT', `${META}/:type/:name`, 'datasource', 'warehouse');
        expect(saved.statusCode).toBe(200);
        expect(store.datasource.warehouse.label).toBe('Warehouse (edited)');
        const created = await drive(rest, 'PUT', `${META}/:type/:name`, 'datasource', 'new_ds', {}, { ...WAREHOUSE, name: 'new_ds' });
        expect(created.statusCode).toBe(200);
        expect(store.datasource.new_ds?.name).toBe('new_ds');
        await drive(rest, 'POST', `${META}/:type/:name/publish`, 'datasource', 'warehouse', {}, {});
        expect(protocol.publishMetaItem).toHaveBeenCalledTimes(1);
        await drive(rest, 'POST', `${META}/:type/:name/rollback`, 'datasource', 'warehouse', {}, { version: 1 });
        expect(protocol.rollbackMetaItem).toHaveBeenCalledTimes(1);
        const reset = await drive(rest, 'DELETE', `${META}/:type/:name`, 'datasource', 'new_ds', {}, {});
        expect(reset.statusCode).toBe(200);
        expect(store.datasource.new_ds).toBeUndefined();
    });

    it('the authoring admission still runs after this one — the capability alone does not write', async () => {
        const { rest, store, calls } = boot({ userId: 'u_ops', systemPermissions: ['manage_platform_settings'] });
        const before = clone(store);
        const res = await drive(rest, 'PUT', `${META}/:type/:name`, 'datasource', 'warehouse');
        expect(res.statusCode).toBe(403);
        expect(res.body?.error?.code).toBe('FORBIDDEN');
        expect(store).toEqual(before);
        expect(calls()).toBe(0);
    });

    it('control — an unlisted type is still written by the author the datasource rows refuse', async () => {
        const { rest, store } = boot(REFUSED.author);
        const res = await drive(rest, 'PUT', `${META}/:type/:name`, 'view', 'all_leads', {}, { ...LEADS_VIEW, label: 'Leads (edited)' });
        expect(res.statusCode).toBe(200);
        expect(store.view.all_leads.label).toBe('Leads (edited)');
    });
});

// ── 3. Agreement with the datasource admin door ───────────────────────────────

/**
 * The principals, by credential, over ONE grant store both doors resolve
 * through `resolveAuthzContext` — the admin door from its plugin context, the
 * `/meta` door through the execution context built from the same call.
 */
const PRINCIPALS: Record<string, { userId: string; sets: string[] }> = {
    'Bearer operator-author': { userId: 'u_operator_author', sets: ['ps_datasource_operator', 'ps_metadata_author'] },
    'Bearer operator': { userId: 'u_operator', sets: ['ps_datasource_operator'] },
    'Bearer member': { userId: 'u_member', sets: [] },
    'Bearer author': { userId: 'u_author', sets: ['ps_metadata_author'] },
    'Bearer org-admin': { userId: 'u_org_admin', sets: ['ps_org_user_admin'] },
};
const SETS: Record<string, string[]> = {
    ps_datasource_operator: ['manage_platform_settings'],
    ps_metadata_author: ['manage_metadata', 'studio.access', 'setup.access'],
    ps_org_user_admin: ['manage_org_users'],
};

const GRANT_TABLES: Record<string, any[]> = {
    sys_user_permission_set: Object.values(PRINCIPALS).flatMap((p) => p.sets.map((setId) => ({
        id: `ups_${p.userId}_${setId}`, user_id: p.userId, permission_set_id: setId, organization_id: null,
    }))),
    sys_permission_set: Object.entries(SETS).map(([id, caps]) => ({
        id, name: id, system_permissions: JSON.stringify(caps), object_permissions: '{}',
    })),
};

const grantsEngine = {
    async find(object: string, opts: any) {
        const rows = GRANT_TABLES[object] ?? [];
        const where = opts?.where ?? {};
        const matched = rows.filter((r) =>
            Object.entries(where).every(([k, v]) => {
                if (k.startsWith('$')) throw new Error(`grants double: unsupported operator ${k}`);
                if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
                return r[k] === v;
            }),
        );
        return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
};

const authService = {
    api: {
        getSession: async ({ headers }: { headers: Headers }) => {
            const principal = PRINCIPALS[headers?.get?.('authorization') ?? ''];
            return principal ? { user: { id: principal.userId } } : null;
        },
    },
};

async function resolveFor(credential: string) {
    const authz = await resolveAuthzContext({
        ql: grantsEngine as any,
        headers: new Headers({ authorization: credential }),
        getSession: async (h: any) => authService.api.getSession({ headers: h }),
    });
    return authz.userId ? { userId: authz.userId, systemPermissions: authz.systemPermissions } : undefined;
}

/** The admin door's `POST /datasources` (create), mounted on a capturing server with no service wired. */
function adminCreateDoor() {
    const routes = new Map<string, (req: any, res: any) => Promise<unknown>>();
    const capture = (verb: string) => (path: string, h: any) => { routes.set(`${verb} ${path}`, h); };
    const server: any = { get: capture('GET'), post: capture('POST'), put: capture('PUT'), patch: capture('PATCH'), delete: capture('DELETE'), use: () => undefined };
    const ctx: any = {
        getService: (name: string) => {
            if (name === 'auth') return authService;
            if (name === 'objectql' || name === 'data') return grantsEngine;
            throw new Error(`no service: ${name}`);
        },
    };
    registerDatasourceAdminRoutes(server, ctx, '/api/v1');
    const handler = routes.get('POST /api/v1/datasources');
    if (!handler) throw new Error('POST /api/v1/datasources is not registered');
    return async (credential: string) => {
        const res = makeRes();
        await handler({ method: 'POST', params: {}, headers: { authorization: credential }, query: {}, body: clone(WAREHOUSE) }, res);
        return res;
    };
}

/** Admitted = past the door's authorization (whatever it answers next); refused = its 401/403. */
const admitted = (res: any): boolean => res.statusCode !== 401 && res.statusCode !== 403;

describe('[#21124] no principal writes a datasource through /meta that the datasource admin door would refuse', () => {
    for (const credential of Object.keys(PRINCIPALS)) {
        it(credential, async () => {
            const admin = await adminCreateDoor()(credential);
            const { rest, store } = boot(await resolveFor(credential));
            const before = clone(store);
            const meta = await drive(rest, 'PUT', `${META}/:type/:name`, 'datasource', 'new_ds', {}, { ...WAREHOUSE, name: 'new_ds' });
            if (admitted(meta)) expect(admitted(admin)).toBe(true);
            else expect(store).toEqual(before);
        });
    }

    it('the agreement is not vacuous — the operator-author writes through both, the authoring-only principal through neither', async () => {
        const door = adminCreateDoor();
        const byBoth: string[] = [];
        for (const credential of Object.keys(PRINCIPALS)) {
            const { rest } = boot(await resolveFor(credential));
            const meta = await drive(rest, 'PUT', `${META}/:type/:name`, 'datasource', 'new_ds', {}, { ...WAREHOUSE, name: 'new_ds' });
            if (admitted(meta) && admitted(await door(credential))) byBoth.push(credential);
        }
        expect(byBoth).toEqual(['Bearer operator-author']);
        const author = await door('Bearer author');
        expect({ status: author.statusCode, code: author.body?.error?.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    });
});
