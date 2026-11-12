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
import { ObjectStackProtocolImplementation, publishedItemReader, runBuildProbes } from '@objectstack/metadata-protocol';
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
            await read('/queue/status', { package: C }),
            await read('/queue/gamma/status'),
            await read('/queue/_env/status'),
        ]) {
            expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            expect(answer.body?.error?.message).toContain(`package "${A}"`);
        }
    });

    it('CONTROL: the bare read and the holder\'s own reads answer as before', async () => {
        ship('queue', 'status', A);
        expect(labelOf(await read('/queue/status'))).toBe('alpha queue');
        expect(labelOf(await read('/queue/status', { package: A }))).toBe('alpha queue');
        expect(labelOf(await read('/queue/alpha/status'))).toBe('alpha queue');
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
 *
 * Contract review M1 (branch head 340f7cbc, measured): with the disabled holder
 * registered first, bare `/layers` served its code layer as `code` and
 * `effective`, while the plain read served the enabled holder.
 */
describe('#32183 — a disabled package holds no name: the by-name read judges the served holders', () => {
    /**
     * `permission` joined the live list (#32162), and the security catalog's
     * item seam refuses a second package holder of a set at registration.
     * Lift that one seam, as the objectql exact-qualifier pins do, so the
     * two-holder state (the one #31698 PR-2 opens) is reached.
     */
    const admitSecondPermissionHolder = (type: string) => {
        if (type === 'permission') {
            vi.spyOn(registry as unknown as { securityCatalogHoldersOtherThan: () => unknown[] }, 'securityCatalogHoldersOtherThan')
                .mockReturnValue([]);
        }
    };
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
        // [contract review M1, S2] Both registration orders: a reader that takes
        // the first registered holder serves the disabled one's body when it
        // registered first.
        it.each([['enabled first', [A, B]], ['disabled first', [B, A]]] as const)(`${type}: two holders, one disabled (%s) — the enabled holder answers, its layers too; the disabled one is named nowhere`, async (_order, order) => {
            admitSecondPermissionHolder(type);
            for (const id of order) ship(type, 'shared', id);
            registry.disablePackage(B);
            const bare = await read(`/${type}/shared`);
            expect(bare.status, JSON.stringify(bare.body)).toBe(200);
            expect(labelOf(bare)).toBe(`alpha ${type}`);
            // The bare layered view reads the served holder's stack, never the first registered one's.
            const layers = await read(`/${type}/shared/layers`);
            const layered = layers.body?.data ?? layers.body;
            expect(layers.status, JSON.stringify(layers.body)).toBe(200);
            expect([layered?.code?.label, layered?.effective?.label]).toEqual([`alpha ${type}`, `alpha ${type}`]);
            expect(JSON.stringify(layers.body)).not.toContain(`beta ${type}`);
            expect(labelOf(await read(`/${type}/shared`, { package: A }))).toBe(`alpha ${type}`);
            expect(labelOf(await read(`/${type}/alpha/shared`))).toBe(`alpha ${type}`);
            refusedNaming(await read(`/${type}/shared`, { package: C }), [A], [B]);
            refusedNaming(await read(`/${type}/gamma/shared`), [A], [B]);
            refusedNaming(await read(`/${type}/_env/shared`), [A], [B]);
        });

        // [ruling (c), the owed exact-qualifier hunk] The disabled holder's own
        // address, its namespace and its pair are admitted (admission asks every
        // holder) and answer the withheld item's 404: never its body, never a
        // refusal naming the enabled holder. BASE (main f0f729e7): 404; the
        // interim head (#32327's source change alone): 409 naming alpha.
        it.each([['enabled first', [A, B]], ['disabled first', [B, A]]] as const)(`${type}: two holders, one disabled (%s) — the disabled holder's address, namespace and pair answer 404, naming no package`, async (_order, order) => {
            admitSecondPermissionHolder(type);
            for (const id of order) ship(type, 'shared', id);
            registry.disablePackage(B);
            for (const [path, query] of [
                [`/${type}/shared`, { package: B }],
                [`/${type}/beta/shared`, undefined],
                [`/${type}/shared`, { package: `${B}.custom` }],
            ] as const) {
                const answer = await read(path, query);
                expect([answer.status, path, query], JSON.stringify(answer.body)).toEqual([404, path, query]);
                expect(JSON.stringify(answer.body ?? null)).not.toContain(A);
                expect(JSON.stringify(answer.body ?? null)).not.toContain(`beta ${type}`);
            }
            // CONTROL — the enabled holder's pair serves its item, in both
            // orders. [#32501] Registered second, the pair address's envelope
            // was looked up at the pair id and fell back to the first holder
            // that ships the name, the disabled one, so it answered 404.
            expect(labelOf(await read(`/${type}/shared`, { package: `${A}.custom` }))).toBe(`alpha ${type}`);
        });

        // [epic ruling R4-B2] `_env` is held at `main`'s answer: with no served
        // holder it judges every holder, so it refuses naming the disabled one.
        it(`${type}: only a disabled holder — no holder: 404 on every package address, never a 409 naming it; \`_env\` refuses naming it, as on main`, async () => {
            ship(type, 'solo', B);
            registry.disablePackage(B);
            for (const [path, query] of [
                [`/${type}/solo`, undefined],
                [`/${type}/solo`, { package: C }],
                [`/${type}/gamma/solo`, undefined],
            ] as const) {
                const answer = await read(path, query);
                expect([answer.status, path, query], JSON.stringify(answer.body)).toEqual([404, path, query]);
                expect(JSON.stringify(answer.body)).not.toContain(B);
            }
            refusedNaming(await read(`/${type}/_env/solo`), [B], [A]);
        });

        it(`${type}: only disabled holders — the layered view serves none of their layers, at any address`, async () => {
            admitSecondPermissionHolder(type);
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
            admitSecondPermissionHolder(type);
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

/**
 * ADR-0150 D3/D5, epic #31527 (#32076): on an engine whose registry has no
 * package-scoped resolver slice, the protocol refuses a by-name read of a type
 * ADR-0150 addresses by `(package, name)` with a DECLARED `501
 * NOT_IMPLEMENTED`. This transport answers that refusal with its sentence —
 * never a miss for the by-name `MetadataService` read to answer with a first
 * match. The registry is this file's `SchemaRegistry`, read through a view
 * that hides the five slice reads.
 *
 * BASE (main ff04ad81, this fixture): each read below answered `200` with the
 * first match.
 */
describe('a composition with no package-scoped resolver: the protocol\'s 501 is the answer', () => {
    const SLICE = new Set([
        'readsByPackage', 'packageScopedHoldersOf', 'getEnvironmentScopedItem', 'getPackageScopedItem', 'resolveItem',
    ]);
    /** The by-name service read the dispatcher falls through to on a miss: it answers a first match. */
    let serviceGetItem: ReturnType<typeof vi.fn>;

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
        serviceGetItem = vi.fn(async (_type: string, name: string) => ({ name, label: 'first match' }));
        const services: Record<string, unknown> = { protocol, objectql: engine, metadata: { getItem: serviceGetItem } };
        const resolve = (name: string) => services[name] ?? null;
        dispatcher = new HttpDispatcher({
            getService: resolve,
            getServiceAsync: async (name: string) => resolve(name),
            context: { getService: resolve },
        } as never);
    });

    const expect501 = (answer: { status?: number; body?: any }) => {
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([501, 'NOT_IMPLEMENTED']);
        expect(answer.body?.error?.message).toContain('has no package-scoped resolver');
        expect(serviceGetItem, 'the by-name service read is never asked').not.toHaveBeenCalled();
    };

    it('a bare name: 501 with its sentence, never the service read\'s first match (BASE: 200 first match)', async () => {
        ship('page', 'home', A);
        expect501(await read('/page/home'));
    });

    it('`?package=` and the qualified path: 501 (BASE: 200 first match)', async () => {
        ship('page', 'home', A);
        ship('page', 'home', B);
        expect501(await read('/page/home', { package: C }));
        expect501(await read('/page/beta/home'));
    });

    it('the environment address: 501', async () => {
        ship('page', 'home', A);
        expect501(await read('/page/_env/home'));
    });

    it('CONTROL — a type ADR-0150 does not address by package (view) is served as before', async () => {
        registry.registerItem('view', { name: 'all', label: 'alpha view' }, 'name' as never, A);
        const answer = await read('/view/all');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(labelOf(answer)).toBe('alpha view');
    });
});

/**
 * [#32201, ADR-0150 D5] Every `/meta` read form's `409 RESOURCE_CONFLICT`
 * carries its holders as `details.candidates` — the `PackageScopedHolder` list
 * the `/automation` and `/actions` doors answer — and keeps the message it had.
 *
 * BASE (main 6440802a): each of these answered 409 with the holders in the
 * message only, and no `details`.
 */
describe('#32201 — the 409 carries `details.candidates` on every read form', () => {
    const conflictOf = (answer: { status?: number; body?: any }) =>
        [answer.status, answer.body?.error?.code, answer.body?.error?.details?.candidates];
    const pkg = (packageId: string) => ({ kind: 'package', packageId });

    it('bare `GET /meta/:type/:name`, a name two packages hold: both holders', async () => {
        ship('dashboard', 'sales', A);
        ship('dashboard', 'sales', B);
        const answer = await read('/dashboard/sales');
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A), pkg(B)]]);
        expect(answer.body?.error?.message).toContain(`package "${A}"`);
    });

    it('exact qualifier `?package=` of a package that holds nothing: the holder', async () => {
        ship('page', 'home', A);
        const answer = await read('/page/home', { package: C });
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A)]]);
    });

    it('qualified `/meta/:type/:ns/:name`, a namespace that holds nothing of the name: both holders', async () => {
        ship('page', 'home', A);
        ship('page', 'home', B);
        const answer = await read('/page/gamma/home');
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A), pkg(B)]]);
    });

    it('`/meta/:type/_env/:name`, a name only a package holds: the package', async () => {
        ship('page', 'solo', A);
        const answer = await read('/page/_env/solo');
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A)]]);
        expect(answer.body?.error?.message).toContain('is not held by the environment');
    });

    it('a shareable namespace both owners hold (ADR-0150 D2, the address read\'s own refusal): both owners', async () => {
        const SYS_ONE = 'com.acme.sys_one';
        const SYS_TWO = 'com.acme.sys_two';
        for (const id of [SYS_ONE, SYS_TWO]) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: 'sys' } as never, 'code');
        }
        ship('page', 'home', SYS_ONE);
        ship('page', 'home', SYS_TWO);
        const answer = await read('/page/sys/home');
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
    const conflictOf = (answer: { status?: number; body?: any }) => [answer.status, answer.body?.error?.code, answer.body?.error?.details?.candidates];

    it('two packages, two objects: 409 naming both, each with its object', async () => {
        shipAction(A, 'account');
        shipAction(B, 'contact');
        const answer = await read('/action/approve');
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A), pkg(B)]]);
        expect(String(answer.body?.error?.message ?? '')).toContain(`package "${A}" binds it to object "account"`);
        expect(String(answer.body?.error?.message ?? '')).toContain(`package "${B}" binds it to object "contact"`);
    });

    it('two packages, one object: 409 naming both', async () => {
        shipAction(A, 'account');
        shipAction(B, 'account');
        const answer = await read('/action/approve');
        expect(conflictOf(answer), JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT', [pkg(A), pkg(B)]]);
    });

    it('CONTROL — `?package=` reaches the package\'s own action', async () => {
        shipAction(A, 'account');
        shipAction(B, 'contact');
        const qualified = await read('/action/approve', { package: A });
        expect(qualified.status, JSON.stringify(qualified.body)).toBe(200);
        expect(labelOf(qualified)).toBe('alpha');
    });

    it('CONTROL — one package holding the name answers the bare read', async () => {
        shipAction(A, 'account');
        const single = await read('/action/approve');
        expect(single.status, JSON.stringify(single.body)).toBe(200);
        expect(labelOf(single)).toBe('alpha');
    });
});

/**
 * [#32310, ADR-0150 D3] The caller arm on the dispatcher's item read: the
 * same reading `RestServer` reads (`metaCallerPackageQuery`), so
 * `GET /meta/dataset/:name?callerPackage=P` resolves the name FROM P and reads
 * the resolved holder at its exact address, on a host that mounts only the
 * dispatcher.
 *
 * BASE (main 351c22c9): `callerPackage` was outside the item read's closed
 * set, so the read answered `400` "not supported by this endpoint".
 */
describe('[#32310] GET /meta/dataset/:name?callerPackage= on the dispatcher (ADR-0150 D3)', () => {
    const P = 'com.acme.app';
    beforeEach(() => {
        registry.installPackage({
            id: P, name: P, version: '1.0.0', type: 'app', namespace: 'app',
            dependencies: { [A]: '^1.0.0', [B]: '^1.0.0' },
        } as never, 'code');
    });

    it('P\'s own dataset first; else the dependency\'s', async () => {
        ship('dataset', 'pipeline', A);
        const dep = await read('/dataset/pipeline', { callerPackage: P });
        expect(dep.status, JSON.stringify(dep.body)).toBe(200);
        expect(labelOf(dep)).toBe('alpha dataset');
        ship('dataset', 'pipeline', P);
        expect(labelOf(await read('/dataset/pipeline', { callerPackage: P }))).toBe('app dataset');
    });

    it('two holders in the closure, and a holder outside it: 409 naming the candidates', async () => {
        ship('dataset', 'twin', A);
        ship('dataset', 'twin', B);
        ship('dataset', 'far', C);
        const twin = await read('/dataset/twin', { callerPackage: P });
        expect([twin.status, twin.body?.error?.code], JSON.stringify(twin.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(twin.body?.error?.message).toContain(`package "${A}"`);
        expect(twin.body?.error?.message).toContain(`package "${B}"`);
        const far = await read('/dataset/far', { callerPackage: P });
        expect([far.status, far.body?.error?.code], JSON.stringify(far.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(far.body?.error?.message).toContain(`held outside the declared dependency closure of package "${P}"`);
    });

    it('refused 400 beside `?package=`, blank, `all`, on another type (also beside a layered member), and beside a qualified path', async () => {
        ship('dataset', 'pipeline', A);
        ship('page', 'home', A);
        for (const [path, query] of [
            ['/dataset/pipeline', { callerPackage: P, package: A }],
            ['/page/home', { callerPackage: P }],
            ['/dataset/alpha/pipeline', { callerPackage: P }],
            // `all` names no package to `?package=`; read through, it was the bare read.
            ['/dataset/pipeline', { callerPackage: 'all' }],
            ['/dataset/pipeline', { callerPackage: '' }],
            // Rule 4 is asked before rule 3 (a member on the layered view).
            ['/page/home', { layers: 'true', member: 'm', callerPackage: P }],
            ['/dataset/pipeline', { layers: 'true', member: 'm', callerPackage: P, package: A }],
        ] as const) {
            const answer = await read(path, { ...query });
            expect([answer.status, answer.body?.error?.code], `${path} ${JSON.stringify(answer.body)}`).toEqual([400, 'VALIDATION_ERROR']);
            expect(answer.body?.error?.message, path).toContain('?callerPackage=');
        }
    });

    it('a protocol with no caller resolution fails closed: 503, never the bare read', async () => {
        ship('dataset', 'pipeline', A);
        const proto = ObjectStackProtocolImplementation.prototype as unknown as Record<string, unknown>;
        const original = Object.getOwnPropertyDescriptor(proto, 'resolveCallerPackageAddress')!;
        Object.defineProperty(proto, 'resolveCallerPackageAddress', { value: undefined, configurable: true });
        try {
            const answer = await read('/dataset/pipeline', { callerPackage: P });
            expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([503, 'SERVICE_UNAVAILABLE']);
        } finally {
            Object.defineProperty(proto, 'resolveCallerPackageAddress', original);
        }
    });

    it('an uninstalled caller package answers what `?package=` naming it answers', async () => {
        ship('dataset', 'pipeline', A);
        const viaArm = await read('/dataset/pipeline', { callerPackage: 'com.acme.ghost' });
        const viaQualifier = await read('/dataset/pipeline', { package: 'com.acme.ghost' });
        expect([viaArm.status, viaArm.body?.error?.code]).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(viaArm.body).toEqual(viaQualifier.body);
    });

    it('CONTROL: the bare read and `?package=` answer as before', async () => {
        ship('dataset', 'pipeline', A);
        expect(labelOf(await read('/dataset/pipeline'))).toBe('alpha dataset');
        expect(labelOf(await read('/dataset/pipeline', { package: A }))).toBe('alpha dataset');
    });
});

/**
 * [#32183 × #32310, ADR-0150 D3] The caller arm (`?callerPackage=`) is a D3
 * resolution, so it judges the served holders: a disabled package holds no
 * name for it either. It reads `packageScopedHoldersOf` from the exact
 * qualifier's module, which this change does not edit; the move comes from
 * the source.
 *
 * BASE (main f0f729e7, the arm's first release): two closure holders, one
 * disabled, were refused naming both; a name the closure reached only through
 * a disabled package resolved to it and answered that package's withheld 404.
 */
describe('#32183 × #32310 — the caller arm judges the served holders', () => {
    const P = 'com.acme.app';
    beforeEach(() => {
        registry.installPackage({
            id: P, name: P, version: '1.0.0', type: 'app', namespace: 'app',
            dependencies: { [A]: '^1.0.0', [B]: '^1.0.0' },
        } as never, 'code');
    });

    it.each([['enabled first', [A, B]], ['disabled first', [B, A]]] as const)('two holders in the closure, one disabled (%s): the enabled holder\'s dataset; re-enabled, 409 naming both', async (_order, order) => {
        for (const id of order) ship('dataset', 'twin', id);
        registry.disablePackage(B);
        const served = await read('/dataset/twin', { callerPackage: P });
        expect(served.status, JSON.stringify(served.body)).toBe(200);
        expect(labelOf(served)).toBe('alpha dataset');
        expect(JSON.stringify(served.body)).not.toContain('beta dataset');
        registry.enablePackage(B);
        const refused = await read('/dataset/twin', { callerPackage: P });
        expect([refused.status, refused.body?.error?.code], JSON.stringify(refused.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(refused.body?.error?.message).toContain(`package "${A}"`);
        expect(refused.body?.error?.message).toContain(`package "${B}"`);
    });

    it('the closure reaches the name only through a disabled package, an enabled one outside holds it: 409 outside-closure naming the enabled holder only', async () => {
        ship('dataset', 'far', B);
        ship('dataset', 'far', C);
        registry.disablePackage(B);
        const answer = await read('/dataset/far', { callerPackage: P });
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(answer.body?.error?.message).toContain(`held outside the declared dependency closure of package "${P}"`);
        expect(answer.body?.error?.message).toContain(`package "${C}"`);
        expect(JSON.stringify(answer.body)).not.toContain(B);
    });

    it('[ruling (c)] P\'s own holding, disabled, beside an enabled dependency: P\'s withheld 404, never the dependency\'s dataset (interim: 409 naming alpha)', async () => {
        ship('dataset', 'own', A);
        ship('dataset', 'own', P);
        registry.disablePackage(P);
        const answer = await read('/dataset/own', { callerPackage: P });
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([404, 'RESOURCE_NOT_FOUND']);
        expect(JSON.stringify(answer.body)).not.toContain(A);
    });

    it('a name only a disabled closure package holds: 404, naming no package', async () => {
        ship('dataset', 'gone', B);
        registry.disablePackage(B);
        const answer = await read('/dataset/gone', { callerPackage: P });
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([404, 'RESOURCE_NOT_FOUND']);
        expect(JSON.stringify(answer.body)).not.toContain(B);
    });
});

/**
 * [#32250, ADR-0150 D5; Refs #32622] The dispatcher's layered read of a name
 * two packages register answers the read's `409 RESOURCE_CONFLICT` naming both
 * holders as `details.candidates`, as the item read does. The refusal leaves
 * through `errorFromThrown`, which composes `details` from
 * `resolveThrownHttpError`. Only this cell of #32622 is covered here: a stored
 * row's layered refusal, and the REST `/layers` door, are not.
 */
describe('#32250 — the dispatcher /layers 409 names the holders', () => {
    it('a name two packages register: 409 RESOURCE_CONFLICT with both as details.candidates', async () => {
        ship('dashboard', 'sales', A);
        ship('dashboard', 'sales', B);
        const answer = await read('/dashboard/sales/layers');
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(answer.body?.error?.details?.candidates).toEqual([
            { kind: 'package', packageId: A },
            { kind: 'package', packageId: B },
        ]);
    });

    it('CONTROL — one holder: its layers are served', async () => {
        ship('dashboard', 'sales', A);
        const answer = await read('/dashboard/sales/layers');
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    });
});

/**
 * [ADR-0150 D3, #31700] A dataset name is held once per NAMESPACE now, so two
 * namespaces may each hold `qa_ds`. A publish's runtime probes
 * (`publishPackageDrafts` → `runBuildProbes`) read each widget's dataset
 * through `publishedItemReader`: resolved FROM the publishing package by the
 * caller arm (`resolveCallerPackageAddress`, #32310 above), then read at the
 * holder's exact address. So publishing either package probes ITS OWN
 * dataset. Over the real protocol and the real registry.
 *
 * BASE (main f0f729e7): the probes read the dataset by its bare name, which
 * two holders refuse (`409 RESOURCE_CONFLICT`), so neither package's widget
 * was probed and each receipt carried `widget_not_probed`.
 */
describe('[#31700] a publish probes the dataset its own package resolves (ADR-0150 D3)', () => {
    let protocol: ObjectStackProtocolImplementation;
    const dataset = (packageId: string) => ({
        name: 'qa_ds',
        label: `${packageId} dataset`,
        object: `${packageId.split('.').pop()}_item`,
        measures: [{ name: 'total', aggregate: 'count' }],
    });
    const dashboard = (name: string) => ({ name, label: name, widgets: [{ id: 'w', dataset: 'qa_ds', values: ['total'] }] });

    beforeEach(() => {
        for (const id of [A, B]) registry.registerItem('dataset', dataset(id), 'name' as never, id);
        registry.registerItem('dashboard', dashboard('board_alpha'), 'name' as never, A);
        registry.registerItem('dashboard', dashboard('board_beta'), 'name' as never, B);
        protocol = new ObjectStackProtocolImplementation({
            registry,
            find: vi.fn().mockResolvedValue([{ id: 'r1' }]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        } as never);
    });

    async function probePublishOf(packageId: string | undefined, board: string) {
        const queried: string[] = [];
        const report = await runBuildProbes({
            engine: { find: async () => [{ id: 'r1' }] },
            getItem: publishedItemReader(protocol as never, packageId),
            analytics: {
                queryDataset: async (body: any) => {
                    queried.push(body.label);
                    return { rows: [{ total: 1 }] };
                },
            },
            published: [{ type: 'dashboard', name: board }],
        });
        return { report, queried };
    }

    it('two namespaces each hold `qa_ds`: publishing either package probes its own dataset', async () => {
        for (const [packageId, board] of [[A, 'board_alpha'], [B, 'board_beta']] as const) {
            const { report, queried } = await probePublishOf(packageId, board);
            expect(report.issues, packageId).toEqual([]);
            expect(report.checked.widgets, packageId).toBe(1);
            expect(queried, packageId).toEqual([`${packageId} dataset`]);
        }
    });

    it('CONTROL — the bare read of the name is still refused naming both holders, as the probes read it before', async () => {
        const { report, queried } = await probePublishOf(undefined, 'board_alpha');
        expect(queried).toEqual([]);
        expect(report.issues).toHaveLength(1);
        expect(report.issues[0]).toMatchObject({ code: 'widget_not_probed', ref: { type: 'dataset', name: 'qa_ds' } }); // adr0112-ok: D6c build-probe diagnostics code
        expect(report.issues[0]!.message).toContain(`2 holders (${A}, ${B})`);
    });
});

/**
 * [#32365, ADR-0150 D3/D5] The bare `GET /meta/action/:name`, its `/layers`
 * and its `/published` on the dispatcher, judged over every holder as on
 * `RestServer`: the platform's package-less item (no stored row behind it)
 * beside a package's is refused naming both; beside two packages' it is named
 * with them; one enabled holder answers though a disabled package registered
 * first.
 *
 * BASE (main 89d815c5): 200 with the platform's item; 409 naming the two
 * packages only; 200 with no item.
 */
describe('#32365 — the bare action read weighs the package-less holder on the dispatcher', () => {
    const shipAction = (packageId: string | undefined, objectName: string) => registry.registerItem('action', {
        name: 'approve', label: packageId?.split('.').pop() ?? 'platform', type: 'script', objectName, target: 'approve',
        body: { language: 'js', source: 'return 1;', capabilities: [] },
    }, 'name' as never, packageId);
    const pkg = (packageId: string) => ({ kind: 'package', packageId });
    const conflictOf = (answer: { status?: number; body?: any }) => [answer.status, answer.body?.error?.code, answer.body?.error?.details?.candidates];
    const DOORS = ['/action/approve', '/action/approve/layers', '/action/approve/published'];
    // Each holder is read from the refusal's text, and, since #32250 carried a
    // thrown refusal's candidates through `resolveThrownHttpError`, from its
    // `details.candidates` on all three doors (before it, the item read only).
    const PLATFORM = 'the platform (registered by a plugin or the host, owned by no package)';
    const refusalOf = (answer: { status?: number; body?: any }) => {
        const message = String(answer.body?.error?.message ?? '');
        return [answer.status, answer.body?.error?.code, [A, B].filter((id) => message.includes(`package "${id}"`)), message.includes(PLATFORM)];
    };

    it('the platform\'s item on `contact` beside A\'s on `account`: 409 naming A and the platform, on the item read, `/layers` and `/published`', async () => {
        shipAction(A, 'account');
        shipAction(undefined, 'contact');
        for (const door of DOORS) {
            const answer = await read(door);
            expect(refusalOf(answer), `${door} ${JSON.stringify(answer.body)}`).toEqual([409, 'RESOURCE_CONFLICT', [A], true]);
            expect(conflictOf(answer)[2], door).toEqual([pkg(A), { kind: 'platform' }]);
        }
    });

    it('beside two packages\' on two objects: 409 naming both packages and the package-less holder, on all three doors', async () => {
        shipAction(A, 'account');
        shipAction(B, 'contact');
        shipAction(undefined, 'lead');
        for (const door of DOORS) {
            const answer = await read(door);
            expect(refusalOf(answer), `${door} ${JSON.stringify(answer.body)}`).toEqual([409, 'RESOURCE_CONFLICT', [A, B], true]);
            expect(conflictOf(answer)[2], door).toEqual([pkg(A), pkg(B), { kind: 'platform' }]);
        }
    });

    it('a disabled package registered before the one enabled holder: the item read answers the enabled holder', async () => {
        shipAction(B, 'contact');
        shipAction(A, 'account');
        registry.disablePackage(B);
        const answer = await read('/action/approve');
        expect([answer.status, labelOf(answer)], JSON.stringify(answer.body)).toEqual([200, 'alpha']);
    });
});

/**
 * [#32501, ADR-0150 D5, epic red line 2] An exact address reads one package,
 * and its answer names that package: its envelope (`_packageId`) and, on
 * `/layers`, its body. Never the package that registered the name first.
 *
 * BASE (main 874166b6 and #32183's head 6655b742, line-identical, every live
 * type but `permission`, which the probe did not lift the security seam for):
 *  - `?package=<base>.custom`, two enabled holders, the other registered first:
 *    200, the base's body under the OTHER holder's `_packageId`;
 *  - the same with the other holder disabled: 404 (the face withheld the
 *    item by the misstamped envelope);
 *  - `/layers?package=<base>.custom`: `code` and `effective` were the first
 *    registered holder's body;
 *  - `?package=<App>.custom` and its `/layers`, two enabled modules of the App
 *    holding the name: the first registered module's item.
 *
 * Re-measured on main 2f80f2897 (#32497 landed): the `/layers` code layer at
 * `?package=<base>.custom` already answers the base's (#32497 judges it
 * through `exactQualifierItem`), so that half of the two-holder pin holds on
 * `main`; its plain-read envelope does not. Every other line stands.
 */
describe('#32501 — a pair address reads the package it names, never the first registered holder', () => {
    const P = 'com.acme.app';
    const M1 = 'com.acme.mone';
    const M2 = 'com.acme.mtwo';
    const admitSecondPermissionHolder = (type: string) => {
        if (type === 'permission') {
            vi.spyOn(registry as unknown as { securityCatalogHoldersOtherThan: () => unknown[] }, 'securityCatalogHoldersOtherThan')
                .mockReturnValue([]);
        }
    };
    const itemOf = (answer: { body?: any }) => answer.body?.data?.item ?? answer.body?.item;
    const layersOf = (answer: { body?: any }) => answer.body?.data ?? answer.body;
    const servedAs = (answer: { status?: number; body?: any }, label: string, packageId: string) => {
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect([itemOf(answer)?.label, itemOf(answer)?._packageId]).toEqual([label, packageId]);
    };
    const refusedNaming = (answer: { status?: number; body?: any }, named: string[]) => {
        expect([answer.status, answer.body?.error?.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        for (const id of named) expect(answer.body?.error?.message).toContain(`package "${id}"`);
    };
    beforeEach(() => {
        registry.installPackage({ id: P, name: P, version: '1.0.0', type: 'app', namespace: 'app' } as never, 'code');
        for (const id of [M1, M2]) {
            registry.installPackage({
                id, name: id, version: '1.0.0', type: 'module', namespace: id.split('.').pop()!, dependencies: { [P]: '^1.0.0' },
            } as never, 'code');
        }
    });

    for (const type of PACKAGE_SCOPED_READ_TYPES) {
        it.each([['alpha first', [A, B]], ['beta first', [B, A]]] as const)(`${type}: two enabled holders (%s) — each pair address wears its base's envelope, on the plain read and /layers`, async (_order, order) => {
            admitSecondPermissionHolder(type);
            for (const id of order) ship(type, 'shared', id);
            for (const [pair, label, base] of [[`${A}.custom`, `alpha ${type}`, A], [`${B}.custom`, `beta ${type}`, B]] as const) {
                servedAs(await read(`/${type}/shared`, { package: pair }), label, base);
                const layers = await read(`/${type}/shared/layers`, { package: pair });
                expect(layers.status, JSON.stringify(layers.body)).toBe(200);
                const layered = layersOf(layers);
                expect([layered?.code?.label, layered?.code?._packageId, layered?.effective?.label, layered?.packageId])
                    .toEqual([label, base, label, base]);
            }
        });

        it.each([['disabled first', [B, A]], ['enabled first', [A, B]]] as const)(`${type}: the other holder disabled (%s) — the enabled base's pair serves its item`, async (_order, order) => {
            admitSecondPermissionHolder(type);
            for (const id of order) ship(type, 'shared', id);
            registry.disablePackage(B);
            const answer = await read(`/${type}/shared`, { package: `${A}.custom` });
            servedAs(answer, `alpha ${type}`, A);
            expect(JSON.stringify(answer.body)).not.toContain(B);
            // …and `/layers` at the same address (was 404 with the disabled holder registered first).
            const layers = await read(`/${type}/shared/layers`, { package: `${A}.custom` });
            expect(layers.status, JSON.stringify(layers.body)).toBe(200);
            expect([layersOf(layers)?.code?.label, layersOf(layers)?.packageId]).toEqual([`alpha ${type}`, A]);
        });

        it.each([['mone first', [M1, M2]], ['mtwo first', [M2, M1]]] as const)(`${type}: two enabled modules of one App hold the name (%s) — the App's pair is refused naming both, on the plain read and /layers`, async (_order, order) => {
            admitSecondPermissionHolder(type);
            for (const id of order) ship(type, 'shared', id);
            refusedNaming(await read(`/${type}/shared`, { package: `${P}.custom` }), [M1, M2]);
            refusedNaming(await read(`/${type}/shared/layers`, { package: `${P}.custom` }), [M1, M2]);
            // CONTROL — each module's own address serves its own item.
            servedAs(await read(`/${type}/shared`, { package: M1 }), `mone ${type}`, M1);
            servedAs(await read(`/${type}/shared`, { package: M2 }), `mtwo ${type}`, M2);
        });

        it(`${type}: one module disabled and registered first — the App's pair serves the enabled module's item, under its envelope`, async () => {
            admitSecondPermissionHolder(type);
            ship(type, 'shared', M2);
            ship(type, 'shared', M1);
            registry.disablePackage(M2);
            servedAs(await read(`/${type}/shared`, { package: `${P}.custom` }), `mone ${type}`, M1);
            // …and `/layers` at the App's pair (was 404).
            const layers = await read(`/${type}/shared/layers`, { package: `${P}.custom` });
            expect(layers.status, JSON.stringify(layers.body)).toBe(200);
            expect([layersOf(layers)?.code?.label, layersOf(layers)?.code?._packageId]).toEqual([`mone ${type}`, M1]);
        });

        it(`${type}: CONTROL — a single holder's pair address answers as before`, async () => {
            ship(type, 'solo', A);
            servedAs(await read(`/${type}/solo`, { package: `${A}.custom` }), `alpha ${type}`, A);
            const layers = layersOf(await read(`/${type}/solo/layers`, { package: `${A}.custom` }));
            expect([layers?.code?.label, layers?.packageId]).toEqual([`alpha ${type}`, A]);
        });
    }
});
