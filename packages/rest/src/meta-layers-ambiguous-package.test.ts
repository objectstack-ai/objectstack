// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28337, ADR-0048] The layered view naming no package, of a name two packages
 * hold, on `RestServer`: refused with the package-less writes' own refusal.
 *
 * A `sys_metadata` row is keyed `(org, type, name, package_id)`. When the
 * active rows of one name are bound to two or more packages, a save or a delete
 * naming no package is refused `409 RESOURCE_CONFLICT` with the `?package=`
 * prescription, naming the holders (`packagelessAddressAmbiguityRefusal`).
 * The layered view — `GET /meta/:type/:name/layers` and the deprecated
 * `?layers=true` — answered the same request `200` with ONE holder's overlay,
 * picked silently, so the Studio editor (which loads the layered view and saves
 * what it loaded) and an agent could not tell a second holder existed, and the
 * save that followed was refused. Now both spellings refuse it exactly where the
 * writes do, with the same code, status and holder list; `?package=` still reads
 * each holder's stack.
 *
 * The protocol and the registry are the REAL ones; only `sys_metadata` is held
 * in memory (the harness of `meta-disabled-package-doors.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const PKG_A = 'app.alpha_demo';
const PKG_B = 'app.beta_demo';

const rowKey = (w: Record<string, unknown>) =>
    [w.type, w.name, w.organization_id ?? '', w.package_id ?? '', w.state ?? 'active'].join('|');

const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null) return row[k] === null || row[k] === undefined;
        return whereValueMatches(row[k], v);
    });

/**
 * In-memory `sys_metadata` carrying a REAL `SchemaRegistry`. `services`: the
 * kernel services the protocol reads (a `metadata` service copy), none by default.
 */
function makeHarness(services?: Map<string, unknown>) {
    const registry = new SchemaRegistry({ multiTenant: false });
    (registry as any).logLevel = 'silent';
    const rows = new Map<string, any>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        registry,
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table !== 'sys_metadata') return null;
            return findRow(o.where)?.row ?? null;
        },
        async find(table: string, o: { where: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = Array.from(rows.values()).filter((r) => matchesWhere(r, o.where));
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: `rec_${++nextId}` };
            const row = { id: `r_${++nextId}`, ...(data as any) };
            rows.set(rowKey(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(rowKey(merged), merged);
            return { id: merged.id };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const found = findRow(((o as any)?.where ?? {}) as Record<string, unknown>);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async syncObjectSchema() { /* no physical storage in this double */ },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, services ? () => services as Map<string, any> : undefined, 'env_test');
    return { protocol, registry, rows };
}

/** `twin_dash` stored in BOTH packages; `solo_dash` stored in one. */
async function seed(protocol: any, registry: SchemaRegistry) {
    for (const [pkg, label] of [[PKG_A, 'alpha copy'], [PKG_B, 'beta copy']] as const) {
        registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        await protocol.saveMetaItem({ type: 'dashboard', name: 'twin_dash', packageId: pkg, item: { name: 'twin_dash', label, widgets: [] } });
    }
    await protocol.saveMetaItem({ type: 'dashboard', name: 'solo_dash', packageId: PKG_A, item: { name: 'solo_dash', label: 'solo', widgets: [] } });
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.headers = {} as Record<string, string>;
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

/** An author: the save door admits them, so the writes reach the protocol. */
const AUTHOR = { userId: 'u_author', systemPermissions: ['manage_metadata', 'studio.access'] };

async function setup() {
    const h = makeHarness();
    await seed(h.protocol, h.registry);
    const server = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const rest = new RestServer(server as any, h.protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => AUTHOR;
    (rest as any).objectQLProvider = async () => ({ registry: h.registry });
    rest.registerRoutes();
    const call = async (
        method: string, pattern: string, path: string, params: Record<string, string>,
        query: Record<string, string> = {}, body: unknown = {},
    ) => {
        const route = rest.getRoutes().find((r: any) => r.method === method && r.path === `${META}${pattern}`);
        if (!route) throw new Error(`${method} ${pattern} is not registered`);
        const res = makeRes();
        await route.handler({ method, path: `${META}${path}`, params, query, body, headers: {} }, res);
        return { status: res.statusCode as number, body: res.body, headers: res.headers as Record<string, string> };
    };
    const at = (name: string) => ({ type: 'dashboard', name });
    return {
        ...h,
        layers: (name: string, query: Record<string, string> = {}) =>
            call('GET', '/:type/:name/layers', `/dashboard/${name}/layers`, at(name), query),
        layersFlag: (name: string, query: Record<string, string> = {}) =>
            call('GET', '/:type/:name', `/dashboard/${name}`, at(name), { ...query, layers: 'true' }),
        put: (name: string, item: Record<string, unknown>, query: Record<string, string> = {}) =>
            call('PUT', '/:type/:name', `/dashboard/${name}`, at(name), query, item),
        remove: (name: string, query: Record<string, string> = {}) =>
            call('DELETE', '/:type/:name', `/dashboard/${name}`, at(name), query),
    };
}

/** The refusal's machine fields, wherever this transport's envelope carries them. */
const codeOf = (r: { body: any }) => r.body?.code ?? r.body?.error?.code;
const messageOf = (r: { body: any }) => {
    const m = r.body?.error?.message ?? r.body?.message ?? r.body?.error;
    return typeof m === 'string' ? m : '';
};

describe('[#28337] RestServer: the layered view of a name two packages hold, naming no package', () => {
    it('both spellings answer the package-less writes\' 409 RESOURCE_CONFLICT, naming both holders and ?package=', async () => {
        const host = await setup();
        const save = await host.put('twin_dash', { name: 'twin_dash', label: 'edited', widgets: [] });
        const remove = await host.remove('twin_dash');
        // The writes' answer, unchanged: the refusal this read now shares.
        expect({ status: save.status, code: codeOf(save) }).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
        expect({ status: remove.status, code: codeOf(remove) }).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });

        for (const read of [host.layers, host.layersFlag]) {
            const refused = await read('twin_dash');
            expect({ status: refused.status, code: codeOf(refused) }).toEqual({ status: save.status, code: codeOf(save) });
            // One envelope shape for the read and the writes on this transport, and
            // [#32622, ADR-0150 D5] the read's holders as `details.candidates` beside it.
            expect(Object.keys(refused.body ?? {}).sort()).toEqual([...Object.keys(save.body ?? {}), 'details'].sort());
            expect(refused.body?.details?.candidates).toEqual([
                { kind: 'package', packageId: PKG_A },
                { kind: 'package', packageId: PKG_B },
            ]);
            expect(save.body?.details, 'the writes\' answer does not move').toBeUndefined();
            const message = messageOf(refused);
            expect(message.startsWith('Name the package this layered read is for, then send it again')).toBe(true);
            expect(message).toContain('?package=');
            expect(message).toContain(`'${PKG_A}'`);
            expect(message).toContain(`'${PKG_B}'`);
            // Neither holder's layers ride the refusal.
            expect(JSON.stringify(refused.body)).not.toContain('alpha copy');
            expect(JSON.stringify(refused.body)).not.toContain('beta copy');
        }
        // Nothing was written or removed by any of it.
        expect([...host.rows.values()].filter((r) => r.name === 'twin_dash').map((r) => r.package_id).sort())
            .toEqual([PKG_A, PKG_B]);
    }, 60_000);

    it('?package= reads each holder\'s stack, on both spellings', async () => {
        const host = await setup();
        for (const [pkg, label] of [[PKG_A, 'alpha copy'], [PKG_B, 'beta copy']] as const) {
            for (const read of [host.layers, host.layersFlag]) {
                const served = await read('twin_dash', { package: pkg });
                expect(served.status, JSON.stringify(served.body)).toBe(200);
                expect(served.body?.overlay).toMatchObject({ name: 'twin_dash', label });
                expect(served.body?.effective).toMatchObject({ name: 'twin_dash', label });
            }
        }
    }, 60_000);

    it('a name one package holds answers as before, naming its package or not', async () => {
        const host = await setup();
        for (const read of [host.layers, host.layersFlag]) {
            const plain = await read('solo_dash');
            expect(plain.status, JSON.stringify(plain.body)).toBe(200);
            expect(plain.body?.effective).toMatchObject({ name: 'solo_dash', label: 'solo' });
            expect((await read('solo_dash', { package: PKG_A })).body).toEqual(plain.body);
        }
    }, 60_000);
});

/**
 * [#32622, #32914, ADR-0150 D3/D5] A name two packages REGISTER (code, no
 * stored row), read naming no package. The plain read refuses it
 * `409 RESOURCE_CONFLICT` naming both as `details.candidates` (#32201). The
 * layered read answered two ways by composition: with an engine wired, the
 * door's owner step asked the plain read first and answered its refusal by the
 * sentence alone; with none, the door served the holder that registered first,
 * and so did the protocol's layered read in process, whatever the metadata
 * service held. Now the layered read itself refuses as the plain read does,
 * and the door carries the candidates, on both spellings.
 */
describe('[#32622, #32914] a name two packages register, read naming no package', () => {
    const ORDERS = [['alpha first', [PKG_A, PKG_B]], ['beta first', [PKG_B, PKG_A]]] as const;
    /** The composition the door runs in: an engine wired for the door chain or not, and the metadata service's copy. */
    const SHAPES = [
        ['engine wired, no service copy', { wired: true, copy: false }],
        ['no engine wired, no service copy', { wired: false, copy: false }],
        ['no engine wired, a service copy of the first holder', { wired: false, copy: true }],
    ] as const;

    async function registered(order: readonly string[], shape: { wired: boolean; copy: boolean }) {
        // The partial copy: a `metadata` service holding the first holder's body only.
        const copyOf = (pkg: string) => ({ name: 'sales', label: `${pkg} code`, widgets: [], _packageId: pkg });
        const services = shape.copy
            ? new Map<string, unknown>([['metadata', { get: async (type: string, name: string) => (type === 'dashboard' && name === 'sales' ? copyOf(order[0]) : undefined) }]])
            : undefined;
        const h = makeHarness(services);
        for (const pkg of order) {
            h.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
            h.registry.registerItem('dashboard', { name: 'sales', label: `${pkg} code`, widgets: [] } as any, 'name' as any, pkg);
        }
        h.registry.installPackage({ id: 'app.solo_demo', name: 'app.solo_demo', version: '1.0.0' } as any, 'code');
        h.registry.registerItem('dashboard', { name: 'solo', label: 'solo code', widgets: [] } as any, 'name' as any, 'app.solo_demo');
        const server = {
            get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
            listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
        };
        const rest = new RestServer(server as any, h.protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => AUTHOR;
        if (shape.wired) (rest as any).objectQLProvider = async () => ({ registry: h.registry });
        rest.registerRoutes();
        const get = async (pattern: string, path: string, name: string, query: Record<string, string> = {}) => {
            const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `${META}${pattern}`);
            if (!route) throw new Error(`GET ${pattern} is not registered`);
            const res = makeRes();
            await route.handler({ method: 'GET', path: `${META}${path}`, params: { type: 'dashboard', name }, query, body: {}, headers: {} }, res);
            return { status: res.statusCode as number, body: res.body };
        };
        return {
            ...h,
            plain: (name: string) => get('/:type/:name', `/dashboard/${name}`, name),
            spellings: (name: string, query: Record<string, string> = {}) => [
                ['/layers', () => get('/:type/:name/layers', `/dashboard/${name}/layers`, name, query)],
                ['?layers=true', () => get('/:type/:name', `/dashboard/${name}`, name, { ...query, layers: 'true' })],
            ] as const,
        };
    }

    const candidatesOf = (body: any) => [...(body?.details?.candidates ?? [])].map((c: any) => `${c.kind}:${c.packageId}`).sort();
    const BOTH = [`package:${PKG_A}`, `package:${PKG_B}`];

    for (const [shapeLabel, shape] of SHAPES) {
        it.each(ORDERS)(`${shapeLabel}, %s: both spellings answer the plain read's 409 with details.candidates, serving neither holder`, async (_label, order) => {
            const host = await registered(order, shape);
            const plain = await host.plain('sales');
            expect([plain.status, codeOf(plain)], JSON.stringify(plain.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            expect(candidatesOf(plain.body)).toEqual(BOTH);
            for (const [spelling, read] of host.spellings('sales')) {
                const refused = await read();
                expect([refused.status, codeOf(refused)], `${spelling}: ${JSON.stringify(refused.body)}`).toEqual([409, 'RESOURCE_CONFLICT']);
                expect(candidatesOf(refused.body), spelling).toEqual(BOTH);
                for (const pkg of order) expect(JSON.stringify(refused.body), spelling).not.toContain(`${pkg} code`);
            }
        }, 60_000);
    }

    it.each(ORDERS)('in process, %s: the layered read refuses naming both, with or without a service copy', async (_label, order) => {
        for (const [shapeLabel, shape] of SHAPES) {
            const host = await registered(order, shape);
            const refused: any = await host.protocol.getMetaItemLayered({ type: 'dashboard', name: 'sales' }).then(
                (served) => ({ served }),
                (error) => error,
            );
            expect([refused?.code, refused?.status], `${shapeLabel}: ${JSON.stringify(refused?.served ?? refused?.message)}`)
                .toEqual(['RESOURCE_CONFLICT', 409]);
            expect([...(refused?.refusal?.candidates ?? [])].map((c: any) => `${c.kind}:${c.packageId}`).sort(), shapeLabel).toEqual(BOTH);
            // Each holder's layers stay readable at its package.
            for (const pkg of order) {
                const scoped: any = await host.protocol.getMetaItemLayered({ type: 'dashboard', name: 'sales', packageId: pkg });
                expect(scoped.code?.label, `${shapeLabel}, ${pkg}`).toBe(`${pkg} code`);
            }
        }
    }, 60_000);

    it('CONTROL: a name one package registers is served, in process and on both spellings', async () => {
        for (const [shapeLabel, shape] of SHAPES) {
            const host = await registered([PKG_A, PKG_B], shape);
            const layered: any = await host.protocol.getMetaItemLayered({ type: 'dashboard', name: 'solo' });
            expect(layered.effective?.label, shapeLabel).toBe('solo code');
            for (const [spelling, read] of host.spellings('solo')) {
                const served = await read();
                expect([served.status, served.body?.effective?.label], `${shapeLabel} ${spelling}: ${JSON.stringify(served.body)}`)
                    .toEqual([200, 'solo code']);
            }
            for (const [spelling, read] of host.spellings('sales', { package: PKG_B })) {
                const served = await read();
                expect([served.status, served.body?.code?.label], `${shapeLabel} ${spelling} ?package=`).toEqual([200, `${PKG_B} code`]);
            }
        }
    }, 60_000);
});
