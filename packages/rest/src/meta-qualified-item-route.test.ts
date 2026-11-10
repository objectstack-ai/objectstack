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
import { SchemaRegistry } from '@objectstack/objectql';
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
});
