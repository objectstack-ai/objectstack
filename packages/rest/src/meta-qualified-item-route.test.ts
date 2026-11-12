// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0150 D5, epic #31527 child G1 (#31691): `RestServer` serves the
 * qualified by-name read `GET /meta/:type/:ns/:name` (and `_env`) through the
 * item read's own handler, registered after every literal three-segment
 * sibling so each keeps its route (ruling Q1 on #31691).
 *
 * Driven over the real `RestServer` route table, the real
 * `ObjectStackProtocolImplementation` and the real `SchemaRegistry`.
 *
 * BASE (main f30369003): no route matched `GET /meta/:type/:ns/:name`, so the
 * qualified path answered the host's unmatched 404; `?package=gamma` for a
 * page only alpha ships served alpha's page.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PACKAGE_SCOPED_READ_TYPES, SchemaRegistry } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const C = 'com.acme.gamma';
const ITEM = '/api/v1/meta/:type/:name';
const QUALIFIED = '/api/v1/meta/:type/:ns/:name';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(),
        setHeader: vi.fn(),
    };
    return res;
}

let registry: SchemaRegistry;
let rest: RestServer;

const ship = (type: string, name: string, packageId: string) =>
    registry.registerItem(type, { name, label: `${packageId.split('.').pop()} ${type}` }, 'name' as never, packageId);
const envItem = (type: string, name: string) =>
    registry.registerItem(type, { name, label: `env ${type}`, _provenance: 'org' }, 'name' as never);

const routes = (): Array<{ method: string; path: string; handler: (req: any, res: any) => Promise<void> }> =>
    (rest as any).getRoutes();

async function drive(path: string, params: Record<string, string>, query: Record<string, unknown> = {}) {
    const route = routes().find((r) => r.method === 'GET' && r.path === path);
    if (!route) throw new Error(`route not registered: GET ${path}`);
    const res = mockRes();
    await route.handler({ method: 'GET', params, query, headers: {}, body: {}, path: '/api/v1/meta/x' }, res);
    const body = res.json.mock.calls.at(-1)?.[0];
    return { status: res.statusCode as number, body };
}
/** The thrown-error answer's code and message, as `handleRouteError` writes them. */
const codeOf = (answer: { body?: any }) => answer.body?.code ?? answer.body?.error?.code;
const messageOf = (answer: { body?: any }) => String(answer.body?.error?.message ?? answer.body?.error ?? '');
const labelOf = (answer: { body?: any }) => answer.body?.item?.label ?? answer.body?.data?.item?.label;

beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    for (const id of [A, B, C]) {
        registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! } as never, 'code');
    }
    const engine = {
        registry,
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue([]),
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never);
    rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ isSystem: true });
    rest.registerRoutes();
});

describe('the route table', () => {
    it('the qualified route is registered once, AFTER every literal three-segment `/meta` sibling', () => {
        const table = routes().map((r) => `${String(r.method).toUpperCase()} ${r.path}`);
        const at = table.indexOf(`GET ${QUALIFIED}`);
        expect(at, table.join('\n')).toBeGreaterThan(-1);
        expect(table.filter((r) => r === `GET ${QUALIFIED}`)).toHaveLength(1);
        const literalSiblings = table.filter((r) => /^GET \/api\/v1\/meta\/(:type|book)\/:name\/[a-z]+$/.test(r));
        expect(literalSiblings.length).toBeGreaterThan(5);
        for (const sibling of literalSiblings) expect(table.indexOf(sibling), sibling).toBeLessThan(at);
    });
});

describe('GET /meta/:type/:ns/:name', () => {
    it('each holder of a two-holder name is reached by its namespace', async () => {
        ship('page', 'home', A);
        ship('page', 'home', B);
        const alpha = await drive(QUALIFIED, { type: 'page', ns: 'alpha', name: 'home' });
        expect(alpha.status, JSON.stringify(alpha.body)).toBe(200);
        expect(labelOf(alpha)).toBe('alpha page');
        expect(labelOf(await drive(QUALIFIED, { type: 'page', ns: 'beta', name: 'home' }))).toBe('beta page');
    });

    it('a namespace that holds nothing of the name: 409 RESOURCE_CONFLICT naming the holders', async () => {
        ship('page', 'home', A);
        ship('page', 'home', B);
        const answer = await drive(QUALIFIED, { type: 'page', ns: 'gamma', name: 'home' });
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(messageOf(answer)).toContain(`package "${A}"`);
        expect(messageOf(answer)).toContain(`package "${B}"`);
    });

    it('`_env`: the environment\'s own item; a name only a package holds is 409', async () => {
        envItem('page', 'local');
        ship('page', 'solo', A);
        expect(labelOf(await drive(QUALIFIED, { type: 'page', ns: '_env', name: 'local' }))).toBe('env page');
        const refused = await drive(QUALIFIED, { type: 'page', ns: '_env', name: 'solo' });
        expect([refused.status, codeOf(refused)], JSON.stringify(refused.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    });

    it('`?package=` beside a qualified path is refused 400', async () => {
        ship('page', 'home', A);
        const answer = await drive(QUALIFIED, { type: 'page', ns: 'alpha', name: 'home' }, { package: B });
        expect([answer.status, answer.body?.error?.code]).toEqual([400, 'VALIDATION_ERROR']);
    });

    it('CONTROL — no installed namespace, or a sub-resource literal last: the host\'s unmatched 404, as before', async () => {
        ship('page', 'home', A);
        expect((await drive(QUALIFIED, { type: 'page', ns: 'nowhere', name: 'home' })).status).toBe(404);
        const literal = await drive(QUALIFIED, { type: 'page', ns: 'alpha', name: 'tree' });
        expect([literal.status, literal.body?.error?.code]).toEqual([404, 'ENDPOINT_NOT_FOUND']);
    });
});

describe('GET /meta/:type/:name?package=X — the exact qualifier on this transport', () => {
    it('a package that holds nothing: 409 (BASE: alpha\'s page)', async () => {
        ship('page', 'home', A);
        const answer = await drive(ITEM, { type: 'page', name: 'home' }, { package: C });
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    });

    it('CONTROL — the holder\'s own read answers as before', async () => {
        ship('page', 'home', A);
        expect(labelOf(await drive(ITEM, { type: 'page', name: 'home' }, { package: A }))).toBe('alpha page');
    });
});

/**
 * Seat ruling (c) of #32076 (claim amendment 6764879174): a covered type the
 * registry still reads through `getItem` (`readsByPackage` answers `false`; a
 * queue here) is judged by the exact qualifier too.
 */
describe('a covered type the registry reads through `getItem`: the exact qualifier on this transport', () => {
    it('`?package=`, the qualified path and `_env` of a name only alpha holds: 409 naming it (BASE: 200, alpha\'s queue)', async () => {
        // The premise: this registry reads a queue through `getItem`, so the 409 is ruling (c)'s, not G1's.
        expect(registry.readsByPackage('queue')).toBe(false);
        ship('queue', 'status', A);
        for (const answer of [
            await drive(ITEM, { type: 'queue', name: 'status' }, { package: C }),
            await drive(QUALIFIED, { type: 'queue', ns: 'gamma', name: 'status' }),
            await drive(QUALIFIED, { type: 'queue', ns: '_env', name: 'status' }),
        ]) {
            expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            expect(messageOf(answer)).toContain(`package "${A}"`);
        }
    });

    it('CONTROL: the bare read and the holder\'s own reads answer as before', async () => {
        ship('queue', 'status', A);
        expect(labelOf(await drive(ITEM, { type: 'queue', name: 'status' }))).toBe('alpha queue');
        expect(labelOf(await drive(ITEM, { type: 'queue', name: 'status' }, { package: A }))).toBe('alpha queue');
        expect(labelOf(await drive(QUALIFIED, { type: 'queue', ns: 'alpha', name: 'status' }))).toBe('alpha queue');
    });
});

describe('the anonymous gate judges the qualified shape as no public-audience route', () => {
    // `RestServer`'s anonymous deny exempts only the item, list and book-tree
    // shapes of `book`/`doc`; the runtime dispatcher keeps the same deny for
    // the qualified path (it is not rewritten for an anonymous caller).
    const isPublic = (path: string, type: string): boolean =>
        (RestServer as any).isPublicAudienceRead({ path, method: 'GET' }, { method: 'GET', params: { type } });

    it('`GET /meta/book/:ns/:name` keeps the deny', () => {
        expect(isPublic(QUALIFIED, 'book')).toBe(false);
    });

    it('CONTROL — `GET /meta/book/:name` is the exempt item read', () => {
        expect(isPublic(ITEM, 'book')).toBe(true);
    });
});

describe('a shareable namespace two packages share (ADR-0150 D2)', () => {
    const SYS_ONE = 'com.acme.sys_one';
    const SYS_TWO = 'com.acme.sys_two';
    const installSys = () => {
        for (const id of [SYS_ONE, SYS_TWO]) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: 'sys' } as never, 'code');
        }
    };

    it('both owners hold the name: 409 naming both, never the first owner\'s item', async () => {
        installSys();
        ship('page', 'home', SYS_ONE);
        ship('page', 'home', SYS_TWO);
        const answer = await drive(QUALIFIED, { type: 'page', ns: 'sys', name: 'home' });
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(messageOf(answer)).toContain(`package "${SYS_ONE}"`);
        expect(messageOf(answer)).toContain(`package "${SYS_TWO}"`);
    });

    it('CONTROL — one owner holds the name: its item is served', async () => {
        installSys();
        ship('page', 'home', SYS_TWO);
        const answer = await drive(QUALIFIED, { type: 'page', ns: 'sys', name: 'home' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('sys_two page');
    });

    // [#21087] The guarded registrar's type-level read admission runs before
    // this route's handler: a caller refused the type learns neither that the
    // name exists nor who holds it. The runtime dispatcher answers the same.
    const asCaller = (systemPermissions: string[]) => {
        (rest as any).resolveExecCtx = async () => ({ userId: 'u_member', systemPermissions });
    };

    it('a caller refused the type: 403 PERMISSION_DENIED, never the 409 naming the holders', async () => {
        installSys();
        ship('datasource', 'warehouse', SYS_ONE);
        ship('datasource', 'warehouse', SYS_TWO);
        asCaller([]);
        const answer = await drive(QUALIFIED, { type: 'datasource', ns: 'sys', name: 'warehouse' });
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([403, 'PERMISSION_DENIED']);
        expect(JSON.stringify(answer.body)).not.toContain(SYS_ONE);
    });

    it('CONTROL — a caller the type admits: the 409 naming both', async () => {
        installSys();
        ship('datasource', 'warehouse', SYS_ONE);
        ship('datasource', 'warehouse', SYS_TWO);
        asCaller(['manage_platform_settings', 'manage_metadata']);
        const answer = await drive(QUALIFIED, { type: 'datasource', ns: 'sys', name: 'warehouse' });
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    });
});

/**
 * [#32183, ADR-0150 D3] A disabled package holds no name: every by-name read
 * on this transport judges the holders the list serves, as the runtime
 * dispatcher's `/meta` domain does. Iterates the live
 * `PACKAGE_SCOPED_READ_TYPES`, so a type added there is pinned here.
 *
 * BASE (main de141e32, measured on this fixture for all 13 types): two
 * holders with one disabled answered the bare read, `?package=gamma`,
 * `/:type/gamma/:name` and `_env` with 409 naming both packages; a name only a
 * disabled package holds answered `_env` and `?package=gamma` with 409 naming
 * it.
 *
 * Contract review M1 (branch head 340f7cbc, measured): with the disabled holder
 * registered first, bare `/layers` served its code layer as `code` and
 * `effective`, while the plain read served the enabled holder.
 */
describe('#32183 — a disabled package holds no name: the by-name read judges the served holders', () => {
    const LIST = '/api/v1/meta/:type';
    const LAYERS = '/api/v1/meta/:type/:name/layers';
    // A signed-in caller: a `book` read asks for one (`meta-item-read-gate.ts`, the docs sign-in gate).
    // The engine is wired, so the layered view's disabled-package step (1b) can ask its registry.
    beforeEach(() => {
        (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
        (rest as any).objectQLProvider = async () => ({ registry });
    });
    const listedHolders = async (type: string, name: string): Promise<unknown[]> => {
        const { body } = await drive(LIST, { type });
        const items = body?.data?.items ?? body?.items ?? (Array.isArray(body?.data) ? body.data : []);
        return (items as any[]).filter((i) => i?.name === name).map((i) => i?._packageId ?? i?.packageId ?? null);
    };
    const refusedNaming = (answer: { status: number; body?: any }, named: string[], unnamed: string[]) => {
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        for (const id of named) expect(messageOf(answer)).toContain(`package "${id}"`);
        for (const id of unnamed) expect(JSON.stringify(answer.body)).not.toContain(id);
    };

    for (const type of PACKAGE_SCOPED_READ_TYPES) {
        // [contract review M1, S2] Both registration orders: a reader that takes
        // the first registered holder serves the disabled one's body when it
        // registered first.
        it.each([['enabled first', [A, B]], ['disabled first', [B, A]]] as const)(`${type}: two holders, one disabled (%s) — the enabled holder answers, its layers too; the disabled one is named nowhere`, async (_order, order) => {
            for (const id of order) ship(type, 'shared', id);
            registry.disablePackage(B);
            const bare = await drive(ITEM, { type, name: 'shared' });
            expect(bare.status, JSON.stringify(bare.body)).toBe(200);
            expect(labelOf(bare)).toBe(`alpha ${type}`);
            // The bare layered view reads the served holder's stack, never the first registered one's.
            const layers = await drive(LAYERS, { type, name: 'shared' });
            expect(layers.status, JSON.stringify(layers.body)).toBe(200);
            expect([layers.body?.code?.label, layers.body?.effective?.label]).toEqual([`alpha ${type}`, `alpha ${type}`]);
            expect(JSON.stringify(layers.body)).not.toContain(`beta ${type}`);
            expect(labelOf(await drive(ITEM, { type, name: 'shared' }, { package: A }))).toBe(`alpha ${type}`);
            expect(labelOf(await drive(QUALIFIED, { type, ns: 'alpha', name: 'shared' }))).toBe(`alpha ${type}`);
            refusedNaming(await drive(ITEM, { type, name: 'shared' }, { package: C }), [A], [B]);
            refusedNaming(await drive(QUALIFIED, { type, ns: 'gamma', name: 'shared' }), [A], [B]);
            refusedNaming(await drive(QUALIFIED, { type, ns: '_env', name: 'shared' }), [A], [B]);
        });

        it(`${type}: only a disabled holder — no holder: 404 on every address, never a 409 naming it`, async () => {
            ship(type, 'solo', B);
            registry.disablePackage(B);
            for (const [path, params, query] of [
                [ITEM, { type, name: 'solo' }, {}],
                [QUALIFIED, { type, ns: '_env', name: 'solo' }, {}],
                [ITEM, { type, name: 'solo' }, { package: C }],
                [QUALIFIED, { type, ns: 'gamma', name: 'solo' }, {}],
            ] as const) {
                const answer = await drive(path, params, query);
                expect([answer.status, params, query], JSON.stringify(answer.body)).toEqual([404, params, query]);
                expect(JSON.stringify(answer.body ?? null)).not.toContain(B);
            }
        });

        it(`${type}: only disabled holders — the layered view serves none of their layers, at any address`, async () => {
            ship(type, 'solo', B);
            ship(type, 'pair', B);
            ship(type, 'pair', C);
            registry.disablePackage(B);
            registry.disablePackage(C);
            for (const [name, query] of [['solo', {}], ['solo', { package: C }], ['solo', { package: A }], ['pair', {}]] as const) {
                const layers = await drive(LAYERS, { type, name }, query);
                expect([layers.status, name, query], JSON.stringify(layers.body)).toEqual([404, name, query]);
                for (const label of [`beta ${type}`, `gamma ${type}`]) expect(JSON.stringify(layers.body ?? null)).not.toContain(label);
                const plain = await drive(ITEM, { type, name }, query);
                expect([plain.status, name, query], JSON.stringify(plain.body)).toEqual([404, name, query]);
                for (const id of [B, C]) expect(JSON.stringify(plain.body ?? null)).not.toContain(id);
            }
            // CONTROL: enabled, the same layered read serves the holder's code layer.
            registry.enablePackage(B);
            const served = await drive(LAYERS, { type, name: 'solo' });
            expect(served.status, JSON.stringify(served.body)).toBe(200);
        });

        it(`${type}: parity — the bare read and the list agree on the holders, through disable and enable`, async () => {
            ship(type, 'shared', A);
            ship(type, 'shared', B);
            ship(type, 'solo', B);
            const agree = async (name: string) => {
                const listed = await listedHolders(type, name);
                const bare = await drive(ITEM, { type, name });
                if (listed.length === 0) expect([bare.status, name], JSON.stringify(bare.body)).toEqual([404, name]);
                else if (listed.length === 1) {
                    expect(bare.status, JSON.stringify(bare.body)).toBe(200);
                    expect(labelOf(bare)).toBe(`${String(listed[0]).split('.').pop()} ${type}`);
                } else refusedNaming(bare, listed as string[], []);
                return listed;
            };
            expect(await agree('shared')).toEqual([A, B]);
            expect(await agree('solo')).toEqual([B]);
            registry.disablePackage(B);
            expect(await agree('shared')).toEqual([A]);
            expect(await agree('solo')).toEqual([]);
            registry.enablePackage(B);
            expect(await agree('shared')).toEqual([A, B]);
            expect(await agree('solo')).toEqual([B]);
        });
    }

    it('two co-owners of a shareable namespace, one disabled: the enabled co-owner answers its address and the bare read', async () => {
        const SYS_ONE = 'com.acme.sys_one';
        const SYS_TWO = 'com.acme.sys_two';
        for (const id of [SYS_ONE, SYS_TWO]) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: 'sys' } as never, 'code');
        }
        ship('page', 'home', SYS_ONE);
        ship('page', 'home', SYS_TWO);
        registry.disablePackage(SYS_TWO);
        for (const answer of [
            await drive(QUALIFIED, { type: 'page', ns: 'sys', name: 'home' }),
            await drive(ITEM, { type: 'page', name: 'home' }),
        ]) {
            expect(answer.status, JSON.stringify(answer.body)).toBe(200);
            expect(labelOf(answer)).toBe('sys_one page');
        }
    });
});

/**
 * ADR-0150 D3/D5, epic #31527 (#32076): on an engine whose registry has no
 * package-scoped resolver slice, the protocol refuses a by-name read of a type
 * ADR-0150 addresses by `(package, name)` with a DECLARED `501
 * NOT_IMPLEMENTED`; this transport answers it with its sentence (the 5xx
 * boundary keeps a declared refusal's text). The registry is this file's
 * `SchemaRegistry`, read through a view that hides the five slice reads.
 *
 * BASE (main ff04ad81, this fixture): each read below answered `200` with
 * alpha's item, the first registered.
 */
describe('a composition with no package-scoped resolver: the protocol\'s 501, with its sentence', () => {
    const SLICE = new Set([
        'readsByPackage', 'packageScopedHoldersOf', 'getEnvironmentScopedItem', 'getPackageScopedItem', 'resolveItem',
    ]);

    beforeEach(() => {
        const view = new Proxy(registry, {
            get(target, prop) {
                if (typeof prop === 'string' && SLICE.has(prop)) return undefined;
                const value = Reflect.get(target, prop, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const engine = {
            registry: view,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        const protocol = new ObjectStackProtocolImplementation(engine as never);
        rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ isSystem: true });
        rest.registerRoutes();
    });

    const expect501 = (answer: { status: number; body?: any }) => {
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([501, 'NOT_IMPLEMENTED']);
        expect(messageOf(answer)).toContain('has no package-scoped resolver');
    };

    it('a bare name, `?package=`, the qualified path and `_env`: 501 (BASE: 200, alpha\'s page)', async () => {
        ship('page', 'home', A);
        ship('page', 'home', B);
        expect501(await drive(ITEM, { type: 'page', name: 'home' }));
        expect501(await drive(ITEM, { type: 'page', name: 'home' }, { package: C }));
        expect501(await drive(QUALIFIED, { type: 'page', ns: 'beta', name: 'home' }));
        expect501(await drive(QUALIFIED, { type: 'page', ns: '_env', name: 'home' }));
    });

    it('CONTROL — a type ADR-0150 does not address by package (view) is served as before', async () => {
        registry.registerItem('view', { name: 'all', label: 'alpha view' }, 'name' as never, A);
        const answer = await drive(ITEM, { type: 'view', name: 'all' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('alpha view');
    });
});

/**
 * [#32201, ADR-0150 D5] Every `/meta` read form's `409 RESOURCE_CONFLICT` on
 * this transport carries its holders as `details.candidates` (the
 * `PackageScopedHolder` list the runtime dispatcher answers), beside the flat
 * body's `error` and `code`, which stay as they were.
 *
 * BASE (main 6440802a): `{ error: '<the sentence>', code: 'RESOURCE_CONFLICT' }`
 * and no `details` on each.
 */
describe('#32201 — the 409 carries `details.candidates` on every read form', () => {
    const conflictOf = (answer: { status: number; body?: any }) =>
        [answer.status, codeOf(answer), answer.body?.details?.candidates];
    const pkg = (packageId: string) => ({ kind: 'package', packageId });

    it('bare `GET /meta/:type/:name`, a name two packages hold: both holders', async () => {
        ship('dashboard', 'sales', A);
        ship('dashboard', 'sales', B);
        const answer = await drive(ITEM, { type: 'dashboard', name: 'sales' });
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A), pkg(B)]]);
        // The flat body's members stay: the sentence is still `error`.
        expect(typeof answer.body?.error).toBe('string');
        expect(messageOf(answer)).toContain(`package "${A}"`);
    });

    it('exact qualifier `?package=` of a package that holds nothing: the holder', async () => {
        ship('page', 'home', A);
        const answer = await drive(ITEM, { type: 'page', name: 'home' }, { package: C });
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A)]]);
    });

    it('qualified `/meta/:type/:ns/:name`, a namespace that holds nothing of the name: both holders', async () => {
        ship('page', 'home', A);
        ship('page', 'home', B);
        const answer = await drive(QUALIFIED, { type: 'page', ns: 'gamma', name: 'home' });
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A), pkg(B)]]);
    });

    it('`/meta/:type/_env/:name`, a name only a package holds: the package', async () => {
        ship('page', 'solo', A);
        const answer = await drive(QUALIFIED, { type: 'page', ns: '_env', name: 'solo' });
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A)]]);
        expect(messageOf(answer)).toContain('is not held by the environment');
    });

    it('a shareable namespace both owners hold (ADR-0150 D2, the address read\'s own refusal): both owners', async () => {
        const SYS_ONE = 'com.acme.sys_one';
        const SYS_TWO = 'com.acme.sys_two';
        for (const id of [SYS_ONE, SYS_TWO]) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: 'sys' } as never, 'code');
        }
        ship('page', 'home', SYS_ONE);
        ship('page', 'home', SYS_TWO);
        const answer = await drive(QUALIFIED, { type: 'page', ns: 'sys', name: 'home' });
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(SYS_ONE), pkg(SYS_TWO)]]);
    });
});

/**
 * [#32244, ADR-0150 D3] The bare `GET /meta/action/:name` of an action name two
 * packages hold on any object key — each on its own object, or both on one —
 * answers `409 RESOURCE_CONFLICT` naming every holder (`details.candidates`)
 * with its object (the message), on this transport too. `?package=` and a
 * name one package holds answer as before.
 *
 * BASE (main 9bff554e): 200 with the first registered package's action.
 */
describe('#32244 — the bare read of an action name two packages hold answers 409', () => {
    const shipAction = (packageId: string, objectName: string) => registry.registerItem('action', {
        name: 'approve', label: packageId.split('.').pop(), type: 'script', objectName, target: 'approve',
        body: { language: 'js', source: 'return 1;', capabilities: [] },
    }, 'name' as never, packageId);
    const pkg = (packageId: string) => ({ kind: 'package', packageId });
    const conflictOf = (answer: { status?: number; body?: any }) => [answer.status, codeOf(answer), answer.body?.details?.candidates];

    it('two packages, two objects: 409 naming both, each with its object', async () => {
        shipAction(A, 'account');
        shipAction(B, 'contact');
        const answer = await drive(ITEM, { type: 'action', name: 'approve' });
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A), pkg(B)]]);
        expect(messageOf(answer)).toContain(`package "${A}" binds it to object "account"`);
        expect(messageOf(answer)).toContain(`package "${B}" binds it to object "contact"`);
    });

    it('two packages, one object: 409 naming both', async () => {
        shipAction(A, 'account');
        shipAction(B, 'account');
        const answer = await drive(ITEM, { type: 'action', name: 'approve' });
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A), pkg(B)]]);
    });

    it('CONTROL — `?package=` reaches the package\'s own action', async () => {
        shipAction(A, 'account');
        shipAction(B, 'contact');
        const qualified = await drive(ITEM, { type: 'action', name: 'approve' }, { package: A });
        expect(qualified.status, JSON.stringify(qualified.body)).toBe(200);
        expect(labelOf(qualified)).toBe('alpha');
    });

    it('CONTROL — one package holding the name answers the bare read', async () => {
        shipAction(A, 'account');
        const single = await drive(ITEM, { type: 'action', name: 'approve' });
        expect(single.status, JSON.stringify(single.body)).toBe(200);
        expect(labelOf(single)).toBe('alpha');
    });

    it('[review 6781770671 S2] the layered read `/layers` of a name the registry counts two holders of: 409 naming both with their objects', async () => {
        shipAction(A, 'account');
        shipAction(B, 'contact');
        const answer = await drive('/api/v1/meta/:type/:name/layers', { type: 'action', name: 'approve' });
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(messageOf(answer)).toContain(`package "${A}" binds it to object "account"`);
        expect(messageOf(answer)).toContain(`package "${B}" binds it to object "contact"`);
    });

    it('[review 6781770671 S2] the published read `/published` of such a name: 409 too, never one package\'s action', async () => {
        shipAction(A, 'account');
        shipAction(B, 'contact');
        const answer = await drive('/api/v1/meta/:type/:name/published', { type: 'action', name: 'approve' });
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(messageOf(answer)).toContain(`package "${B}" binds it to object "contact"`);
    });

    it('CONTROL — `/layers` and `/published` of a name one package holds answer as before', async () => {
        shipAction(A, 'account');
        const layers = await drive('/api/v1/meta/:type/:name/layers', { type: 'action', name: 'approve' });
        expect([layers.status, layers.body?.code?.label], JSON.stringify(layers.body)).toEqual([200, 'alpha']);
        // This harness wires no metadata service, so a read the judge passes
        // reaches the code-store fallback and answers its 501, never the 409.
        const published = await drive('/api/v1/meta/:type/:name/published', { type: 'action', name: 'approve' });
        expect([published.status, codeOf(published)], JSON.stringify(published.body)).toEqual([501, 'NOT_IMPLEMENTED']);
    });
});

/**
 * [#32310, ADR-0150 D3] The caller arm on this transport's `/meta` item read:
 * `GET /meta/dataset/:name?callerPackage=P` resolves the name FROM P (its own
 * dataset, else the unique holder in its declared closure plus `sys`, else
 * `409` naming the candidates) and reads that holder at its exact address.
 * Real route table, real protocol, real registry.
 *
 * BASE (main 351c22c9): `?callerPackage=` was outside the item read's closed
 * set, so every such read answered `400` "not supported by this endpoint".
 */
describe('[#32310] GET /meta/dataset/:name?callerPackage= (ADR-0150 D3)', () => {
    const P = 'com.acme.app';
    beforeEach(() => {
        registry.installPackage({
            id: P, name: P, version: '1.0.0', type: 'app', namespace: 'app',
            dependencies: { [A]: '^1.0.0', [B]: '^1.0.0' },
        } as never, 'code');
    });

    it('P\'s own dataset answers first, though a dependency holds the name too', async () => {
        ship('dataset', 'pipeline', A);
        ship('dataset', 'pipeline', P);
        const answer = await drive(ITEM, { type: 'dataset', name: 'pipeline' }, { callerPackage: P });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('app dataset');
    });

    it('a dependency\'s dataset is served to P (`?package=P` refuses it)', async () => {
        ship('dataset', 'pipeline', A);
        const answer = await drive(ITEM, { type: 'dataset', name: 'pipeline' }, { callerPackage: P });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('alpha dataset');
        expect(answer.body?.item?._packageId ?? answer.body?.data?.item?._packageId).toBe(A);
        const exact = await drive(ITEM, { type: 'dataset', name: 'pipeline' }, { package: P });
        expect([exact.status, codeOf(exact)]).toEqual([409, 'RESOURCE_CONFLICT']);
    });

    it('two holders in P\'s closure: 409 RESOURCE_CONFLICT naming both, with their candidates', async () => {
        ship('dataset', 'pipeline', A);
        ship('dataset', 'pipeline', B);
        const answer = await drive(ITEM, { type: 'dataset', name: 'pipeline' }, { callerPackage: P });
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(messageOf(answer)).toContain(`declared dependency closure of package "${P}"`);
        expect(answer.body?.details?.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    });

    it('a holder outside P\'s closure: 409 naming it', async () => {
        ship('dataset', 'pipeline', C);
        const answer = await drive(ITEM, { type: 'dataset', name: 'pipeline' }, { callerPackage: P });
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(messageOf(answer)).toContain(`held outside the declared dependency closure of package "${P}"`);
        expect(answer.body?.details?.candidates).toEqual([{ kind: 'package', packageId: C }]);
    });

    it('an uninstalled caller package answers what `?package=` naming it answers, never the bare read', async () => {
        ship('dataset', 'pipeline', A);
        const viaArm = await drive(ITEM, { type: 'dataset', name: 'pipeline' }, { callerPackage: 'com.acme.ghost' });
        const viaQualifier = await drive(ITEM, { type: 'dataset', name: 'pipeline' }, { package: 'com.acme.ghost' });
        expect([viaArm.status, codeOf(viaArm)]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(viaArm.body).toEqual(viaQualifier.body);
    });

    it('refused 400 beside `?package=`, blank, `all`, on another type (also beside a layered member), and beside a qualified path — each naming both addresses', async () => {
        ship('dataset', 'pipeline', A);
        ship('page', 'home', A);
        for (const [path, params, query] of [
            [ITEM, { type: 'dataset', name: 'pipeline' }, { callerPackage: P, package: A }],
            [ITEM, { type: 'dataset', name: 'pipeline' }, { callerPackage: '' }],
            // `all` names no package to `?package=`; read through, it was the bare read.
            [ITEM, { type: 'dataset', name: 'pipeline' }, { callerPackage: 'all' }],
            [ITEM, { type: 'page', name: 'home' }, { callerPackage: P }],
            // Rule 4 is asked before rule 3 (a member on the layered view), so
            // the arm's own refusal answers, never a resolution.
            [ITEM, { type: 'page', name: 'home' }, { layers: 'true', member: 'm', callerPackage: P }],
            [ITEM, { type: 'dataset', name: 'pipeline' }, { layers: 'true', member: 'm', callerPackage: P, package: A }],
            [ITEM, { type: 'dataset', name: 'pipeline' }, { layers: 'true', member: 'm', callerPackage: '' }],
            [ITEM, { type: 'datasets', name: 'pipeline' }, { callerPackage: P, package: A }],
            [QUALIFIED, { type: 'dataset', ns: 'alpha', name: 'pipeline' }, { callerPackage: P }],
        ] as const) {
            const answer = await drive(path, params as never, query as never);
            const at = `${path} ${JSON.stringify(params)} ${JSON.stringify(query)}`;
            expect([answer.status, codeOf(answer)], at).toEqual([400, 'VALIDATION_ERROR']);
            expect(messageOf(answer), at).toContain('?callerPackage=');
            // The other address: `?package=`, or the qualified path's namespace segment.
            expect(messageOf(answer), at).toContain(path === QUALIFIED ? "namespace 'alpha'" : '?package=');
        }
    });

    it('a protocol with no caller resolution fails closed: 503, never the bare read', async () => {
        ship('dataset', 'pipeline', A);
        const proto = ObjectStackProtocolImplementation.prototype as unknown as Record<string, unknown>;
        const original = Object.getOwnPropertyDescriptor(proto, 'resolveCallerPackageAddress')!;
        Object.defineProperty(proto, 'resolveCallerPackageAddress', { value: undefined, configurable: true });
        try {
            const answer = await drive(ITEM, { type: 'dataset', name: 'pipeline' }, { callerPackage: P });
            expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([503, 'SERVICE_UNAVAILABLE']);
        } finally {
            Object.defineProperty(proto, 'resolveCallerPackageAddress', original);
        }
    });

    it('CONTROL: the bare read and `?package=` answer as before', async () => {
        ship('dataset', 'pipeline', A);
        expect(labelOf(await drive(ITEM, { type: 'dataset', name: 'pipeline' }))).toBe('alpha dataset');
        expect(labelOf(await drive(ITEM, { type: 'dataset', name: 'pipeline' }, { package: A }))).toBe('alpha dataset');
    });
});
