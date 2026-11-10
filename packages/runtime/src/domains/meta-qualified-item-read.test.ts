// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0150 D5, epic #31527 child G1 (#31691): the runtime dispatcher's `/meta`
 * domain serves the qualified by-name read — `GET /meta/:type/:ns/:name` and
 * `GET /meta/:type/_env/:name` — and answers the exact qualifier
 * (`?package=X`) and a bare name two packages hold as `409 RESOURCE_CONFLICT`
 * naming every holder.
 *
 * Driven over the real dispatcher, the real `ObjectStackProtocolImplementation`
 * and the real `SchemaRegistry`.
 *
 * BASE (main f30369003, measured on this fixture before the change):
 *  - `GET /meta/page/beta/home` and `/meta/page/_env/home`: `404 ROUTE_NOT_FOUND`
 *    (no three-segment item route);
 *  - `GET /meta/page/home?package=gamma` (gamma holds nothing): alpha's page;
 *  - `GET /meta/page/home` (two holders, no package): the protocol's 409 was
 *    swallowed and the by-name service read answered instead.
 *
 * The rule the seat ruled for a literal in the last position (Q1 = A): a
 * sub-resource literal keeps its route, so `/meta/app/alpha/published` is the
 * app `alpha`'s published read, never the item `published` of namespace
 * `alpha`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@objectstack/metadata';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PACKAGE_SCOPED_READ_TYPES, SchemaRegistry } from '@objectstack/objectql';
import { defineStack } from '@objectstack/spec';
import { HttpDispatcher } from '../http-dispatcher.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const C = 'com.acme.gamma';

let registry: SchemaRegistry;
let dispatcher: HttpDispatcher;

const ctx = (): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u1', systemPermissions: ['manage_metadata'] },
});

const ship = (type: string, name: string, packageId: string) =>
    registry.registerItem(type, { name, label: `${packageId.split('.').pop()} ${type}` }, 'name' as never, packageId);
const envItem = (type: string, name: string) =>
    registry.registerItem(type, { name, label: `env ${type}`, _provenance: 'org' }, 'name' as never);

const read = async (path: string, query?: Record<string, unknown>, context: any = ctx()) => {
    const answered = await dispatcher.handleMetadata(path, context, 'GET', undefined, query);
    const response = answered?.response as { status?: number; body?: any } | undefined;
    return { status: response?.status, body: response?.body };
};
const labelOf = (answer: { body?: any }) => answer.body?.data?.item?.label ?? answer.body?.item?.label;

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
    const services: Record<string, unknown> = { protocol, objectql: engine };
    const resolve = (name: string) => services[name] ?? null;
    dispatcher = new HttpDispatcher({
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    } as never);
});

describe('GET /meta/:type/:ns/:name — an installed namespace names its package exactly', () => {
    it('each holder of a two-holder name is reached by its namespace (BASE: 404 ROUTE_NOT_FOUND)', async () => {
        ship('page', 'home', A);
        ship('page', 'home', B);
        const alpha = await read('/page/alpha/home');
        expect(alpha.status, JSON.stringify(alpha.body)).toBe(200);
        expect(labelOf(alpha)).toBe('alpha page');
        expect(labelOf(await read('/page/beta/home'))).toBe('beta page');
    });

    it('a namespace that holds nothing of the name: 409 naming the holders', async () => {
        ship('page', 'home', A);
        ship('page', 'home', B);
        const answer = await read('/page/gamma/home');
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(answer.body?.error?.message).toContain(`package "${A}"`);
        expect(answer.body?.error?.message).toContain(`package "${B}"`);
    });

    it('`?package=` beside a qualified path is refused 400: two qualifiers, neither picked', async () => {
        ship('page', 'home', A);
        const answer = await read('/page/alpha/home', { package: B });
        expect([answer.status, answer.body?.error?.code]).toEqual([400, 'VALIDATION_ERROR']);
    });

    it('CONTROL — a middle segment that is no installed namespace answers what it did: 404 ROUTE_NOT_FOUND', async () => {
        ship('page', 'home', A);
        const answer = await read('/page/nowhere/home');
        expect(answer.status).toBe(404);
    });
});

describe('GET /meta/:type/_env/:name — the environment named exactly', () => {
    it('the environment\'s own item is served', async () => {
        envItem('page', 'local');
        ship('page', 'other', A);
        const answer = await read('/page/_env/local');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('env page');
    });

    it('a name only packages hold: 409 naming them, never the package\'s item', async () => {
        ship('page', 'solo', A);
        const answer = await read('/page/_env/solo');
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(answer.body?.error?.message).toContain('is not held by the environment');
        expect(answer.body?.error?.message).toContain(`package "${A}"`);
    });
});

describe('the bare read and `?package=` on this transport', () => {
    it('a bare name two packages hold: 409 naming both, never the by-name service read\'s first match', async () => {
        ship('dashboard', 'sales', A);
        ship('dashboard', 'sales', B);
        const answer = await read('/dashboard/sales');
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    });

    it('`?package=` of a package that holds nothing: 409 (BASE: alpha\'s page)', async () => {
        ship('page', 'home', A);
        const answer = await read('/page/home', { package: C });
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    });

    it('CONTROL — one holder, bare and `?package=` of the holder, answer as before', async () => {
        ship('page', 'solo', A);
        expect(labelOf(await read('/page/solo'))).toBe('alpha page');
        expect(labelOf(await read('/page/solo', { package: A }))).toBe('alpha page');
    });
});

describe('ruling Q1 — a sub-resource literal in the last position keeps its route', () => {
    it('`/meta/app/alpha/published` is the app `alpha`\'s published read, not the item `published` of namespace alpha', async () => {
        ship('app', 'alpha', A);
        ship('app', 'published', A);
        const answer = await read('/app/alpha/published');
        // The published read's own answer for an app with no published row — never the item `published`.
        expect(labelOf(answer)).not.toBe('alpha app');
        expect(answer.body?.data?.item?.name ?? answer.body?.item?.name).not.toBe('published');
    });

    it('the item `published` of namespace alpha is reached by `?package=`', async () => {
        ship('app', 'published', A);
        const answer = await read('/app/published', { package: A });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('alpha app');
    });
});

describe('anonymous parity with `RestServer` — the qualified read names no public-audience route', () => {
    const anonymous = (): any => ({ request: {}, environmentId: 'platform', executionContext: {} });

    it('an anonymous qualified read is denied as `RestServer` denies it, before the address is read', async () => {
        ship('page', 'home', A);
        const bare = await read('/page/home', undefined, anonymous());
        const qualified = await read('/page/alpha/home', undefined, anonymous());
        expect([qualified.status, qualified.body?.error?.code]).toEqual([bare.status, bare.body?.error?.code]);
        expect(qualified.status).toBe(401);
        // Two qualifiers: still the deny, never the 400 that reads the namespace.
        expect((await read('/page/alpha/home', { package: B }, anonymous())).status).toBe(401);
    });

    it('a public-audience type keeps the deny on the qualified shape: only `/meta/book/:name` is exempt', async () => {
        ship('book', 'guide', A);
        expect((await read('/book/alpha/guide', undefined, anonymous())).status).toBe(401);
        expect((await read('/book/_env/guide', undefined, anonymous())).status).toBe(401);
    });
});

describe('a package already installed under an address-literal namespace (ADR-0150 D5)', () => {
    it('keeps booting and is read by `?package=` (BASE before the fix: the boot\'s install refused it 422)', async () => {
        const HOOKS = 'com.acme.hooks';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            // This registry is never sealed: every install is the cold boot's.
            registry.installPackage({ id: HOOKS, name: HOOKS, version: '1.0.0', type: 'app', namespace: 'hooks' } as never, 'code');
        } finally {
            warn.mockRestore();
        }
        ship('page', 'home', HOOKS);
        const answer = await read('/page/home', { package: HOOKS });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('hooks page');
    });

    it('a config built by `defineStack` under `hooks` loads with a warning, boots, and is read by `?package=`', async () => {
        // The server's load of an `objectstack.config.ts`: a strict `defineStack`
        // call. It warns (the author's doors, `os validate` / `os build`, refuse),
        // so a deployment holding such a package keeps booting after an upgrade.
        const HOOKS = 'com.acme.hooks-config';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let stack: ReturnType<typeof defineStack> | undefined;
        try {
            stack = defineStack({
                manifest: { id: HOOKS, name: 'hooks_config', version: '1.0.0', type: 'app', namespace: 'hooks' },
                objects: [{ name: 'hooks_task', label: 'Task', fields: { title: { type: 'text' } } }],
            });
            // The boot registers the stack's package (this registry is never sealed).
            registry.installPackage(stack.manifest as never, 'code');
            const warned = warn.mock.calls.map((c) => String(c[0]));
            expect(warned.some((line) => line.startsWith(`defineStack: package '${HOOKS}': Namespace 'hooks' spells a literal segment`))).toBe(true);
        } finally {
            warn.mockRestore();
        }
        expect(stack?.manifest?.namespace).toBe('hooks');
        ship('page', 'home', HOOKS);
        const answer = await read('/page/home', { package: HOOKS });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('hooks-config page');
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
        const answer = await read('/page/sys/home');
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(answer.body?.error?.message).toContain(`package "${SYS_ONE}"`);
        expect(answer.body?.error?.message).toContain(`package "${SYS_TWO}"`);
    });

    it('CONTROL — one owner holds the name: its item is served', async () => {
        installSys();
        ship('page', 'home', SYS_TWO);
        const answer = await read('/page/sys/home');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('sys_two page');
    });

    // [#21087] The type-level read admission judges the qualified path before
    // its address is read, as `RestServer`'s guarded registrar does: a caller
    // refused the type learns neither that the name exists nor who holds it.
    const asCaller = (systemPermissions: string[]): any =>
        ({ ...ctx(), executionContext: { userId: 'u_member', systemPermissions } });

    it('a caller refused the type: 403 PERMISSION_DENIED, never the 409 naming the holders', async () => {
        installSys();
        ship('datasource', 'warehouse', SYS_ONE);
        ship('datasource', 'warehouse', SYS_TWO);
        const answer = await read('/datasource/sys/warehouse', undefined, asCaller([]));
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([403, 'PERMISSION_DENIED']);
        expect(JSON.stringify(answer.body)).not.toContain(SYS_ONE);
        const twoQualifiers = await read('/datasource/sys/warehouse', { package: SYS_ONE }, asCaller([]));
        expect([twoQualifiers.status, twoQualifiers.body?.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    });

    it('CONTROL — a caller the type admits: the 409 naming both', async () => {
        installSys();
        ship('datasource', 'warehouse', SYS_ONE);
        ship('datasource', 'warehouse', SYS_TWO);
        const answer = await read('/datasource/sys/warehouse', undefined, asCaller(['manage_platform_settings', 'manage_metadata']));
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    });
});

/**
 * [#32183, ADR-0150 D3] A disabled package holds no name: every by-name read
 * on this transport judges the holders the list serves. Iterates the live
 * `PACKAGE_SCOPED_READ_TYPES`, so a type added there is pinned here.
 *
 * BASE (main de141e32, measured on this fixture for all 13 types): two
 * holders with one disabled answered the bare read, `?package=gamma`,
 * `/:type/gamma/:name` and `_env` with 409 naming both packages; a name only a
 * disabled package holds answered `_env` and `?package=gamma` with 409 naming
 * it; two co-owners of a shareable namespace, one disabled, answered 409
 * `ambiguous-in-namespace`.
 */
describe('#32183 — a disabled package holds no name: the by-name read judges the served holders', () => {
    const listedHolders = async (type: string, name: string): Promise<unknown[]> => {
        const { body } = await read(`/${type}`);
        const items = body?.data?.items ?? body?.items ?? (Array.isArray(body?.data) ? body.data : []);
        return (items as any[]).filter((i) => i?.name === name).map((i) => i?._packageId ?? i?.packageId ?? null);
    };
    const refusedNaming = (answer: { status?: number; body?: any }, named: string[], unnamed: string[]) => {
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        for (const id of named) expect(answer.body?.error?.message).toContain(`package "${id}"`);
        for (const id of unnamed) expect(JSON.stringify(answer.body)).not.toContain(id);
    };

    for (const type of PACKAGE_SCOPED_READ_TYPES) {
        it(`${type}: two holders, one disabled — the enabled holder answers; the disabled one is named nowhere`, async () => {
            ship(type, 'shared', A);
            ship(type, 'shared', B);
            registry.disablePackage(B);
            const bare = await read(`/${type}/shared`);
            expect(bare.status, JSON.stringify(bare.body)).toBe(200);
            expect(labelOf(bare)).toBe(`alpha ${type}`);
            expect(labelOf(await read(`/${type}/shared`, { package: A }))).toBe(`alpha ${type}`);
            expect(labelOf(await read(`/${type}/alpha/shared`))).toBe(`alpha ${type}`);
            refusedNaming(await read(`/${type}/shared`, { package: C }), [A], [B]);
            refusedNaming(await read(`/${type}/gamma/shared`), [A], [B]);
            refusedNaming(await read(`/${type}/_env/shared`), [A], [B]);
        });

        it(`${type}: only a disabled holder — no holder: 404 on every address, never a 409 naming it`, async () => {
            ship(type, 'solo', B);
            registry.disablePackage(B);
            for (const [path, query] of [
                [`/${type}/solo`, undefined],
                [`/${type}/_env/solo`, undefined],
                [`/${type}/solo`, { package: C }],
                [`/${type}/gamma/solo`, undefined],
            ] as const) {
                const answer = await read(path, query);
                expect([answer.status, path, query], JSON.stringify(answer.body)).toEqual([404, path, query]);
                expect(JSON.stringify(answer.body)).not.toContain(B);
            }
        });

        it(`${type}: only disabled holders — the layered view serves none of their layers, at any address`, async () => {
            ship(type, 'solo', B);
            ship(type, 'pair', B);
            ship(type, 'pair', C);
            registry.disablePackage(B);
            registry.disablePackage(C);
            for (const [name, query] of [['solo', undefined], ['solo', { package: C }], ['solo', { package: A }], ['pair', undefined]] as const) {
                const layers = await read(`/${type}/${name}/layers`, query);
                expect([layers.status, name, query], JSON.stringify(layers.body)).toEqual([404, name, query]);
                for (const label of [`beta ${type}`, `gamma ${type}`]) expect(JSON.stringify(layers.body ?? null)).not.toContain(label);
                const plain = await read(`/${type}/${name}`, query);
                expect([plain.status, name, query], JSON.stringify(plain.body)).toEqual([404, name, query]);
                for (const id of [B, C]) expect(JSON.stringify(plain.body ?? null)).not.toContain(id);
            }
            // CONTROL: enabled, the same layered read serves the holder's code layer.
            registry.enablePackage(B);
            const served = await read(`/${type}/solo/layers`);
            expect(served.status, JSON.stringify(served.body)).toBe(200);
        });

        it(`${type}: parity — the bare read and the list agree on the holders, through disable and enable`, async () => {
            ship(type, 'shared', A);
            ship(type, 'shared', B);
            ship(type, 'solo', B);
            const agree = async (name: string) => {
                const listed = await listedHolders(type, name);
                const bare = await read(`/${type}/${name}`);
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
        for (const path of ['/page/sys/home', '/page/home']) {
            const answer = await read(path);
            expect([answer.status, path], JSON.stringify(answer.body)).toEqual([200, path]);
            expect(labelOf(answer)).toBe('sys_one page');
        }
    });
});
