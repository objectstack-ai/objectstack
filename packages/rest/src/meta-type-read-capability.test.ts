// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21087] Datasource-family metadata is read on the `/meta` surface under the
 * capability that family's own door requires — `metaTypeReadRefusal` over
 * `META_TYPE_READ_CAPABILITIES` (`./meta-item-read-gate.ts`), asked by
 * `RestServer`'s guarded registrar before any `/meta` handler runs.
 *
 * Three batteries:
 *
 *  1. **The predicate** — which requests it judges, how it folds a type
 *     segment, who it admits, and what it answers the rest.
 *  2. **Every door, both sides** — the door list is read off the route table
 *     (every `GET` route under `/meta/:type`), so a door added later is judged
 *     here without being named. A caller without the capability is refused
 *     (status + ADR-0112 code) with NOTHING read from the store — the same
 *     answer for a name that exists and one that does not — while a holder is
 *     still served, and an unlisted type is untouched.
 *  3. **Agreement with the datasource admin door** — the same principals,
 *     resolved through the platform's one `resolveAuthzContext` over one grant
 *     store, are admitted or refused alike by `GET /datasources/:name` and by
 *     `GET /meta/datasource/:name`, so the two doors cannot come to name
 *     different capabilities.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveAuthzContext } from '@objectstack/core';
import { registerDatasourceAdminRoutes } from '@objectstack/service-datasource';
import { PLATFORM_CAPABILITY_NAMES } from '@objectstack/spec/security';
// Explicit `.js` extension: NodeNext resolution (see the sibling meta tests).
import { RestServer } from './rest-server.js';
import { META_TYPE_READ_CAPABILITIES, metaTypeReadRefusal } from './meta-item-read-gate.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Strings that exist only inside the gated documents' bodies. */
const TOPOLOGY_MARKER = 'warehouse-db.fixture.internal';
const HANDLE_MARKER = 'sys_secret:sec_fixture_handle';
const REMOTE_TABLE_MARKER = 'fixture_remote_ledger';

const WAREHOUSE = {
    name: 'warehouse',
    label: 'Warehouse',
    driver: 'postgres',
    config: { host: TOPOLOGY_MARKER, port: 5432, database: 'wh', user: 'reporting' },
    external: { credentialsRef: HANDLE_MARKER },
};
const WAREHOUSE_CATALOG = {
    name: 'warehouse_catalog',
    datasource: 'warehouse',
    snapshotAt: '2026-10-01T00:00:00.000Z',
    dialect: 'postgres',
    tables: [{ remoteName: REMOTE_TABLE_MARKER, columns: [{ name: 'id', sqlType: 'uuid', nullable: false, primaryKey: true }] }],
};
const LEADS_VIEW = { name: 'all_leads', label: 'All leads', object: 'lead', columns: ['name'] };

const STORE: Record<string, any[]> = {
    datasource: [WAREHOUSE],
    external_catalog: [WAREHOUSE_CATALOG],
    view: [LEADS_VIEW],
};
const MARKERS = [TOPOLOGY_MARKER, HANDLE_MARKER, REMOTE_TABLE_MARKER];

/** The gated rows, each with an item that exists and the plural spelling a client may use. */
const GATED = [
    { type: 'datasource', plural: 'datasources', name: 'warehouse' },
    { type: 'external_catalog', plural: 'external_catalogs', name: 'warehouse_catalog' },
] as const;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');
const findStored = (type: unknown, name: unknown): any => (STORE[singular(type)] ?? []).find((i: any) => i.name === name);

// ── Callers ───────────────────────────────────────────────────────────────────

/**
 * Callers below the capability. `author` matters most: it holds every
 * AUTHORING capability the `/meta` surface knows (`manage_metadata`,
 * `studio.access`, `setup.access`), so a refusal it receives can only come from
 * the type-level gate — not from the authoring doors' own admission.
 */
const REFUSED = {
    member: { userId: 'u_member', systemPermissions: [] as string[] },
    author: { userId: 'u_author', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
    'other-grant': { userId: 'u_org_admin', systemPermissions: ['manage_org_users'] },
} as const;

/** A holder — with `manage_metadata` too, so the authoring doors (`/history`, `/audit`, `/diff`) admit it as well. */
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

/** Every store read a `/meta` read door can make — the "nothing was read" half of a refusal. */
function protocolDouble() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: Object.keys(STORE), entries: [] }),
        getMetaItems: vi.fn(async ({ type }: any) => clone(STORE[singular(type)] ?? [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const found = findStored(type, name);
            return { type: singular(type), name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        getMetaItemCached: vi.fn(async ({ type, name }: any) => ({
            data: clone(findStored(type, name)),
            etag: { value: `etag-${singular(type)}-${name}`, weak: false },
        })),
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => {
            const found = findStored(type, name);
            const layer = () => (found ? clone(found) : null);
            return { type: singular(type), name, code: layer(), overlay: layer(), effective: layer() };
        }),
        historyMetaItem: vi.fn(async ({ type, name }: any) => ({
            events: [{ seq: 1, op: 'update', ref: { type: singular(type), name }, hash: null, parentHash: null, version: 2, actor: 'u_settings', message: 'revised', ts: '2026-10-01T00:00:00.000Z', source: 'rest' }],
        })),
        auditMetaItem: vi.fn(async ({ type, name }: any) => ({
            events: [{ type: singular(type), name, operation: 'save', allowed: true, actor: 'u_settings', at: '2026-10-01T00:00:00.000Z' }],
        })),
        diffMetaItem: vi.fn(async ({ type, name }: any) => {
            const found = clone(findStored(type, name) ?? {});
            return { type: singular(type), name, fromVersion: 1, toVersion: 2, added: Object.keys(found).filter((k) => k !== 'name').map((k) => ({ path: k, value: found[k] })), removed: [], changed: [] };
        }),
        findReferencesToMeta: vi.fn(async () => ({ references: [{ type: 'object', name: 'wh_order', path: 'datasource', kind: 'object datasource' }] })),
        listDrafts: vi.fn(async () => ({ drafts: [] })),
        findData: vi.fn().mockResolvedValue([]),
    };
}

/** A RestServer whose caller is `ctx`; `reads` counts every store read either seam made. */
function boot(ctx: Record<string, unknown> | undefined) {
    const protocol = protocolDouble();
    const getPublished = vi.fn(async (type: string, name: string) => clone(findStored(type, name)));
    const rest: any = new RestServer(createMockServer() as any, protocol as any, {} as any);
    rest.resolveExecCtx = async () => (ctx ? clone(ctx) : undefined);
    rest.securityServiceProvider = async () => ({
        resolvePermissionSetNames: async () => [],
        getMetadataReadableFields: async () => [],
    });
    rest.serviceExistsProvider = () => true;
    rest.metadataServiceProvider = async () => ({ getPublished });
    rest.registerRoutes();
    const reads = (): number =>
        Object.values(protocol).reduce((n, fn: any) => n + (fn?.mock?.calls?.length ?? 0), 0) + getPublished.mock.calls.length;
    return { rest, protocol, reads };
}

const META = '/api/v1/meta';

/** Every `GET` route the server registers under `/meta/:type` — the doors, read off the route table. */
function typedReadDoors(rest: any): string[] {
    return rest.getRoutes()
        .filter((r: any) => r.method === 'GET' && typeof r.path === 'string' && r.path.startsWith(`${META}/:type`))
        .map((r: any) => r.path as string);
}

/** Each door, plus the item read's switches — every request shape that reads one type. */
function readShapes(rest: any): Array<{ label: string; path: string; query: Record<string, string> }> {
    const shapes = typedReadDoors(rest).map((path) => ({ label: path.slice(META.length), path, query: {} as Record<string, string> }));
    const item = `${META}/:type/:name`;
    const switches: Array<[string, string]> = [['state', 'draft'], ['preview', 'draft'], ['layers', 'true'], ['package', 'crm']];
    for (const [key, value] of switches) {
        shapes.push({ label: `/:type/:name?${key}=${value}`, path: item, query: { [key]: value } });
    }
    return shapes;
}

async function drive(rest: any, routePath: string, type: string, name: string, query: Record<string, string> = {}) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === routePath);
    if (!route) throw new Error(`GET ${routePath} is not registered`);
    const concrete = routePath.replace(':type', type).replace(':name', name);
    const res = makeRes();
    await route.handler({ method: 'GET', path: concrete, params: { type, name }, query, body: {}, headers: {} }, res);
    return res;
}

const envelope = (res: any) => ({ status: res.statusCode, code: res.body?.code ?? res.body?.error?.code });
const text = (res: any): string => JSON.stringify(res.body ?? null);

// ── 1. The predicate ──────────────────────────────────────────────────────────

describe('[#21087] metaTypeReadRefusal — the type-level read admission', () => {
    it('every row names a declared platform capability (matched, never minted)', () => {
        const rows = Object.entries(META_TYPE_READ_CAPABILITIES);
        expect(rows.length).toBeGreaterThan(0);
        for (const [, capability] of rows) expect(PLATFORM_CAPABILITY_NAMES.has(capability)).toBe(true);
        expect(META_TYPE_READ_CAPABILITIES).toEqual({
            datasource: 'manage_platform_settings',
            external_catalog: 'manage_platform_settings',
        });
    });

    it.each(GATED.flatMap((g) => [g.type, g.plural]))('refuses a member a GET of %s — 403 PERMISSION_DENIED naming the capability', (type) => {
        const refusal = metaTypeReadRefusal('GET', type, REFUSED.member);
        expect(refusal).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
        expect(refusal?.message).toContain('manage_platform_settings');
    });

    it('judges HEAD as a read, and a lower-case verb as its upper-case spelling', () => {
        expect(metaTypeReadRefusal('HEAD', 'datasource', REFUSED.member)?.status).toBe(403);
        expect(metaTypeReadRefusal('get', 'datasource', REFUSED.member)?.status).toBe(403);
    });

    it.each(['PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'])('does not judge %s — the write doors keep their own admission', (verb) => {
        expect(metaTypeReadRefusal(verb, 'datasource', REFUSED.member)).toBeUndefined();
    });

    it('admits a holder of the capability', () => {
        expect(metaTypeReadRefusal('GET', 'datasource', HOLDER)).toBeUndefined();
        expect(metaTypeReadRefusal('GET', 'external_catalog', { userId: 'u', systemPermissions: ['manage_platform_settings'] })).toBeUndefined();
    });

    it('reads the held set alone — `isSystem` is no second policy beside the capability', () => {
        expect(metaTypeReadRefusal('GET', 'datasource', { userId: 'u', isSystem: true, systemPermissions: [] }))
            .toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
        expect(metaTypeReadRefusal('GET', 'datasource', { isSystem: true })).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    });

    it('refuses the authoring capabilities and an unrelated grant alike', () => {
        for (const caller of Object.values(REFUSED)) {
            expect(metaTypeReadRefusal('GET', 'datasource', caller)).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
        }
    });

    it('answers a caller with no identity 401 UNAUTHENTICATED — the shared anonymous-deny code', () => {
        expect(metaTypeReadRefusal('GET', 'datasource', undefined)).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
        expect(metaTypeReadRefusal('GET', 'datasource', { systemPermissions: ['manage_platform_settings'] })).toMatchObject({ status: 401 });
    });

    it.each(['view', 'views', 'object', 'app', 'flow', 'book', 'doc', '', 'types', '_drafts'])('leaves an unlisted segment %j alone', (type) => {
        expect(metaTypeReadRefusal('GET', type, REFUSED.member)).toBeUndefined();
    });
});

// ── 2. Every door, both sides ─────────────────────────────────────────────────

describe('[#21087] every /meta read door of a datasource-family type admits the capability and nothing less', () => {
    it('the door census is non-empty and covers the doors this pin was written against', () => {
        const { rest } = boot(HOLDER);
        const doors = typedReadDoors(rest).map((p) => p.slice(META.length));
        for (const known of ['/:type', '/:type/:name', '/:type/:name/published', '/:type/:name/layers', '/:type/:name/history', '/:type/:name/audit', '/:type/:name/diff', '/:type/:name/references']) {
            expect(doors).toContain(known);
        }
    });

    for (const gated of GATED) {
        for (const spelling of [gated.type, gated.plural]) {
            for (const [who, ctx] of Object.entries(REFUSED)) {
                it(`${spelling} × ${who}: every read shape refuses 403 PERMISSION_DENIED and reads nothing`, async () => {
                    const { rest, reads } = boot(ctx);
                    for (const shape of readShapes(rest)) {
                        const res = await drive(rest, shape.path, spelling, gated.name, shape.query);
                        expect({ shape: shape.label, ...envelope(res) }).toEqual({ shape: shape.label, status: 403, code: 'PERMISSION_DENIED' });
                        for (const marker of MARKERS) expect(text(res)).not.toContain(marker);
                    }
                    // The refusal is decided before any handler runs: no store read, on any door.
                    expect(reads()).toBe(0);
                });
            }

            it(`${spelling}: the refusal is byte-identical for a name that exists and one that does not`, async () => {
                const { rest } = boot(REFUSED.member);
                for (const shape of readShapes(rest)) {
                    const present = await drive(rest, shape.path, spelling, gated.name, shape.query);
                    const absent = await drive(rest, shape.path, spelling, 'no_such_item', shape.query);
                    expect({ shape: shape.label, status: absent.statusCode, body: absent.body })
                        .toEqual({ shape: shape.label, status: present.statusCode, body: present.body });
                }
            });

            it(`${spelling} × holder: every read shape is still served`, async () => {
                const { rest, reads } = boot(HOLDER);
                for (const shape of readShapes(rest)) {
                    const before = reads();
                    const res = await drive(rest, shape.path, spelling, gated.name, shape.query);
                    expect({ shape: shape.label, status: res.statusCode }).toEqual({ shape: shape.label, status: 200 });
                    expect(reads()).toBeGreaterThan(before);
                }
            });
        }
    }

    it('the plain read serves the holder the document itself', async () => {
        const { rest } = boot(HOLDER);
        const res = await drive(rest, `${META}/:type/:name`, 'datasource', 'warehouse');
        expect(res.statusCode).toBe(200);
        expect(text(res)).toContain(TOPOLOGY_MARKER);
    });

    it('control — an unlisted type is served to the same refused callers', async () => {
        for (const ctx of Object.values(REFUSED)) {
            const { rest, protocol } = boot(ctx);
            const list = await drive(rest, `${META}/:type`, 'view', '');
            expect(list.statusCode).toBe(200);
            const item = await drive(rest, `${META}/:type/:name`, 'view', 'all_leads');
            expect(item.statusCode).toBe(200);
            expect(text(item)).toContain('All leads');
            expect(protocol.getMetaItems).toHaveBeenCalled();
        }
    });
});

// ── 3. Agreement with the datasource admin door ───────────────────────────────

/**
 * The principals, by credential. Their grants live in ONE store both doors
 * resolve through the platform's `resolveAuthzContext` — the admin door from
 * its plugin context, the `/meta` door through the execution context this
 * fixture builds from the same call — so the two doors are compared on one
 * identity and one grant aggregation, never on two notions of who is asking.
 */
const PRINCIPALS: Record<string, { userId: string; sets: string[] }> = {
    'Bearer holder': { userId: 'u_holder', sets: ['ps_datasource_operator'] },
    'Bearer member': { userId: 'u_member', sets: [] },
    'Bearer author': { userId: 'u_author', sets: ['ps_metadata_author'] },
    'Bearer org-admin': { userId: 'u_org_admin', sets: ['ps_org_user_admin'] },
};
const SETS: Record<string, string[]> = {
    // Deliberately not `admin_full_access`: a single-capability set can only
    // pass a gate that reads the capability itself.
    ps_datasource_operator: ['manage_platform_settings'],
    ps_metadata_author: ['manage_metadata', 'studio.access', 'setup.access'],
    ps_org_user_admin: ['manage_org_users'],
};

/**
 * The grant store, as rows: the minimal in-memory ObjectQL `@objectstack/core`'s
 * own resolver suite drives (`resolve-authz-context.test.ts`) — `===` and `$in`
 * matching, an unsupported operator refused loudly, and the caller's `limit`
 * applied by presence after the filter.
 */
const GRANT_TABLES: Record<string, any[]> = {
    sys_user_permission_set: Object.values(PRINCIPALS).flatMap((p) => p.sets.map((setId) => ({
        id: `ups_${p.userId}_${setId}`, user_id: p.userId, permission_set_id: setId, organization_id: null,
    }))),
    sys_permission_set: Object.entries(SETS).map(([id, caps]) => ({
        id, name: id, system_permissions: JSON.stringify(caps), object_permissions: '{}',
    })),
};

function bounded<T>(rows: T[], opts: any): T[] {
    return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
}

const grantsEngine = {
    async find(object: string, opts: any) {
        const rows = GRANT_TABLES[object] ?? [];
        const where = opts?.where ?? {};
        return bounded(
            rows.filter((r) =>
                Object.entries(where).every(([k, v]) => {
                    if (k.startsWith('$')) throw new Error(`grants double: unsupported operator ${k}`);
                    if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
                    return r[k] === v;
                }),
            ),
            opts,
        );
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

/** The admin door's `GET /datasources/:name`, mounted on a capturing server with no service wired. */
function adminDoor() {
    const routes = new Map<string, (req: any, res: any) => Promise<unknown>>();
    const server: any = {
        get: (path: string, h: any) => { routes.set(`GET ${path}`, h); },
        post: () => undefined, put: () => undefined, patch: () => undefined, delete: () => undefined, use: () => undefined,
    };
    const ctx: any = {
        getService: (name: string) => {
            if (name === 'auth') return authService;
            if (name === 'objectql' || name === 'data') return grantsEngine;
            throw new Error(`no service: ${name}`);
        },
    };
    registerDatasourceAdminRoutes(server, ctx, '/api/v1');
    const handler = routes.get('GET /api/v1/datasources/:name');
    if (!handler) throw new Error('GET /api/v1/datasources/:name is not registered');
    return async (credential: string) => {
        const res = makeRes();
        await handler({ method: 'GET', params: { name: 'warehouse' }, headers: { authorization: credential }, query: {} }, res);
        return res;
    };
}

/** Admitted = past the door's authorization (whatever the door answers next); refused = its 401/403 and code. */
const verdict = (res: any) => (res.statusCode === 401 || res.statusCode === 403
    ? { admitted: false, status: res.statusCode, code: res.body?.error?.code }
    : { admitted: true });

describe('[#21087] the /meta door and the datasource admin door admit the same principals', () => {
    for (const credential of Object.keys(PRINCIPALS)) {
        it(credential, async () => {
            const admin = await adminDoor()(credential);
            const { rest } = boot(await resolveFor(credential));
            const meta = await drive(rest, `${META}/:type/:name`, 'datasource', 'warehouse');
            expect(verdict(meta)).toEqual(verdict(admin));
        });
    }

    it('the agreement is not vacuous — one principal is admitted by both, the rest refused by both', async () => {
        const door = adminDoor();
        const admitted: string[] = [];
        for (const credential of Object.keys(PRINCIPALS)) {
            if (verdict(await door(credential)).admitted) admitted.push(credential);
        }
        expect(admitted).toEqual(['Bearer holder']);
    });
});
