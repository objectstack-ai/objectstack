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
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
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
