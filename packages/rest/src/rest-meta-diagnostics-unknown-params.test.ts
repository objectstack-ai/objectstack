// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27514] `GET /api/v1/meta/diagnostics` refuses a query value it cannot
 * honour, instead of answering a silent all-clear.
 *
 * The door tells an author, an agent or CI whether metadata is healthy, so a
 * `200` with zero issues is a verdict. Measured on `main` before this change,
 * through the route below, each of these answered one:
 *
 * | query                       | answered                                         |
 * | :-------------------------- | :----------------------------------------------- |
 * | `?type=zzz_unknown`         | `200 {scannedTypes: 1, stats: {zzz_unknown: …}}` |
 * | `?severity=bogus`           | `200`, read as the error sweep                   |
 * | `?package=com.nope.missing` | `200`, zeros for all 30 swept types              |
 * | `?type=views`               | `200`, stats and entries keyed `views`, not `view` |
 *
 * and the route's two existing 400s spoke two envelopes: `{ error: '…', code }`
 * for the [#8924] near-miss spelling (`?type=viewes`), `{ error: { code,
 * message } }` for a repeated parameter (#6877).
 *
 * The protocol is a REAL `ObjectStackProtocolImplementation` over a REAL
 * `SchemaRegistry`, one package installed and one view registered under it,
 * and every case drives the REAL route handler. Each refusal asserts the
 * ADR-0112 pair (`status` and the NESTED `body.error.code`); the preservation
 * cases assert the answer itself, because "still 200" is what the defect
 * looked like.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const PACKAGE_ID = 'com.example.pkg';

function createMockServer() {
    const noop = () => {};
    return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
    const res: any = {
        write: () => true, end: () => {},
        header: () => res, setHeader: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return res;
}

function boot(seed: (registry: SchemaRegistry) => void = () => {}) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.installPackage({ id: PACKAGE_ID, name: 'pkg', version: '1.0.0', type: 'app' } as never, 'code');
    registry.registerItem('view', { name: 'pkg_view', label: 'View', object: 'account', type: 'grid' }, 'name', PACKAGE_ID);
    seed(registry);
    const protocol = new ObjectStackProtocolImplementation(
        {
            registry,
            find: async () => [],
            findOne: async (object: string, query?: unknown) => {
                assertEngineFindOnePredicate(object, query as never);
                return null;
            },
        } as never,
        () => new Map(),
        undefined,
    );
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_admin', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/diagnostics');
    if (!route) throw new Error('GET /api/v1/meta/diagnostics is not registered');
    const diagnostics = async (query: Record<string, string | string[]>) => {
        const res = makeRes();
        await route.handler({ method: 'GET', params: {}, query, headers: {} } as any, res);
        return { status: res._status ?? 200, body: res._json };
    };
    return { diagnostics };
}

/** The route's one refusal envelope: ADR-0112 nested, the code a ledgered member. */
function expectRefusal(answer: { status: number; body: any }, code: string) {
    expect(answer.status).toBe(400);
    expect(answer.body?.error?.code).toBe(code);
    expect(typeof answer.body?.error?.message).toBe('string');
}

describe('[#27514] an unknown value is refused, not swept into an all-clear', () => {
    it('?type= naming no metadata type answers 400 INVALID_REQUEST', async () => {
        const { diagnostics } = boot();
        expectRefusal(await diagnostics({ type: 'zzz_unknown' }), 'INVALID_REQUEST');
    });

    it('?severity= outside error|warning answers 400 INVALID_REQUEST', async () => {
        const { diagnostics } = boot();
        expectRefusal(await diagnostics({ severity: 'bogus' }), 'INVALID_REQUEST');
    });

    it('?package= naming no installed package, with no item bound to it, answers 400 INVALID_REQUEST', async () => {
        const { diagnostics } = boot();
        expectRefusal(await diagnostics({ package: 'com.nope.missing' }), 'INVALID_REQUEST');
    });
});

describe('[#27514] the route answers every refusal in one envelope', () => {
    it('the [#8924] near-miss spelling answers nested, still naming the spellings it reached for', async () => {
        const { diagnostics } = boot();
        const answer = await diagnostics({ type: 'viewes' });
        expectRefusal(answer, 'INVALID_REQUEST');
        expect(answer.body.error.message).toContain("'view'");
    });

    it('the repeated-parameter refusal (#6877) keeps the same nested shape', async () => {
        const { diagnostics } = boot();
        expectRefusal(await diagnostics({ type: ['view', 'object'] }), 'VALIDATION_ERROR');
    });
});

describe('[#27514] an alias keys the answer canonically', () => {
    it('?type=views answers exactly what ?type=view answers', async () => {
        const { diagnostics } = boot();
        const alias = await diagnostics({ type: 'views' });
        const canonical = await diagnostics({ type: 'view' });
        expect(alias.status).toBe(200);
        expect(Object.keys(alias.body.stats)).toEqual(['view']);
        expect(alias.body.stats.view).toEqual({ count: 1, locked: 0, packages: [PACKAGE_ID] });
        expect(alias.body.entries.map((e: any) => e.type)).toEqual(['view']);
        expect(alias.body).toEqual(canonical.body);
    });
});

describe('[#27514] preservation: what the door could already serve still answers 200', () => {
    it('severity=warning, an empty severity, and no severity all answer', async () => {
        const { diagnostics } = boot();
        const severities: Array<Record<string, string>> = [{ severity: 'warning' }, { severity: 'error' }, { severity: '' }, {}];
        for (const query of severities) {
            const answer = await diagnostics({ type: 'view', ...query });
            expect(answer.status).toBe(200);
            expect(answer.body.stats.view.count).toBe(1);
        }
    });

    it('an installed package answers its items, and package=all sweeps every package', async () => {
        const { diagnostics } = boot();
        const scoped = await diagnostics({ package: PACKAGE_ID, type: 'view' });
        expect(scoped.status).toBe(200);
        expect(scoped.body.stats.view.count).toBe(1);
        const all = await diagnostics({ package: 'all' });
        expect(all.status).toBe(200);
        expect(all.body.scannedItems).toBe(1);
    });

    it('an installed package with no items answers its honest zeros', async () => {
        const { diagnostics } = boot((registry) => {
            registry.installPackage({ id: 'com.example.empty', name: 'empty', version: '1.0.0', type: 'app' } as never, 'code');
        });
        const answer = await diagnostics({ package: 'com.example.empty' });
        expect(answer.status).toBe(200);
        expect(answer.body.scannedItems).toBe(0);
    });

    it('items bound to a package that is not installed are still swept', async () => {
        const { diagnostics } = boot((registry) => {
            registry.registerItem('view', { name: 'orphan_view', label: 'Orphan', object: 'account', type: 'grid' }, 'name', 'com.example.gone');
        });
        const answer = await diagnostics({ package: 'com.example.gone', type: 'view' });
        expect(answer.status).toBe(200);
        expect(answer.body.stats.view).toEqual({ count: 1, locked: 0, packages: ['com.example.gone'] });
    });

    it('a type this deployment carries live, outside the static contract, still answers', async () => {
        const { diagnostics } = boot((registry) => {
            registry.registerItem('zzz_plugin_kind', { name: 'k1' }, 'name');
        });
        const answer = await diagnostics({ type: 'zzz_plugin_kind' });
        expect(answer.status).toBe(200);
        expect(answer.body.scannedTypes).toBe(1);
    });
});
