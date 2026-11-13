// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /meta/:type/:name/history` and `POST /meta/:type/:name/rollback` take
 * `?package=` — the `/layers?package=` spelling — naming whose versions of a
 * by-package name (ADR-0150 D3/D4) the door reads or restores. Which slot a
 * package names, and the `409` for a bare name two holders' rows hold, is the
 * protocol's to judge (`historySlotOf`); the real-boot pins live in
 * `history-rollback-two-holders.dogfood.test.ts`. This file pins the route's
 * half, both ways round as route rule 5 asks:
 *
 *  - PRESERVATION: the request the protocol received carries `packageId`, and
 *    the `all`/empty spellings `/layers` folds to "no package" send none;
 *  - REFUSAL: a repeated `?package=` is a located 400 and the protocol is never
 *    called; the protocol's package-scoped refusal is rendered `409` with
 *    `details.candidates` naming every holder, as the plain read renders it.
 */

import { describe, it, expect, vi } from 'vitest';
// The route modules load ObjectQL lazily; pay that load at collection, never in a clocked case.
import '@objectstack/objectql';
import { PackageScopedNameRefusedError, packageScopedRefusalMessage, type PackageScopedRefusal } from '@objectstack/core';
import { RestServer, META_ITEM_HISTORY_PARAMS, META_ITEM_ROLLBACK_PARAMS } from './rest-server.js';

const ITEM = '/api/v1/meta/:type/:name';
const PARAMS = { type: 'flow', name: 'shared_flow' };

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any) { return this; }),
        send: vi.fn(function (this: any) { return this; }),
        end: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        header: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    };
    return res;
}

function twoHolderRefusal(): PackageScopedNameRefusedError {
    const base: Omit<PackageScopedRefusal, 'message'> = {
        status: 'refused',
        reason: 'ambiguous-in-environment',
        type: 'flow',
        name: 'shared_flow',
        callerPackageId: null,
        candidates: [
            { kind: 'package', packageId: 'com.acme.alpha.custom' },
            { kind: 'package', packageId: 'com.acme.beta.custom' },
        ],
    };
    return new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
}

function boot(options: { refuse?: boolean } = {}) {
    const answer = (value: unknown) => vi.fn(() => (options.refuse ? Promise.reject(twoHolderRefusal()) : Promise.resolve(value)));
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'flow', name: 'shared_flow', item: { name: 'shared_flow' }, lock: 'none' }),
        historyMetaItem: answer({ events: [] }),
        rollbackMetaItem: answer({ success: true, version: 'v', seq: 2, restoredFromVersion: 1 }),
    };
    const server = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const rest = new RestServer(server as any, protocol, { api: { requireAuth: false }, metadata: { enableCache: false } } as any);
    // `isSystem` clears the capability and authoring gates that run before the query is read.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();
    const drive = async (method: string, path: string, query: Record<string, unknown>, body: unknown = {}) => {
        const found = (rest as any).getRoutes().find((r: any) => r.method === method && r.path === path);
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const res = mockRes();
        await found.handler({ method, path, params: PARAMS, query, headers: {}, body } as any, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
    return { protocol, drive };
}

const DOORS = [
    { door: 'GET /history', method: 'GET', path: `${ITEM}/history`, call: 'historyMetaItem', body: {} },
    { door: 'POST /rollback', method: 'POST', path: `${ITEM}/rollback`, call: 'rollbackMetaItem', body: { toVersion: 1 } },
] as const;

describe('the history and rollback doors take `?package=`, the `/layers` spelling', () => {
    it('both doors declare `package` in their closed query set', () => {
        expect(META_ITEM_HISTORY_PARAMS).toContain('package');
        expect(META_ITEM_ROLLBACK_PARAMS).toContain('package');
    });

    it('GET /history: PRESERVATION — the package reaches `historyMetaItem` beside the paging pair', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('GET', `${ITEM}/history`, { package: 'com.acme.alpha.custom', sinceSeq: '3', limit: '10' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.historyMetaItem.mock.calls[0][0]).toEqual({
            type: 'flow', name: 'shared_flow', sinceSeq: 3, limit: 10, packageId: 'com.acme.alpha.custom',
        });
    });

    it('POST /rollback: PRESERVATION — the package reaches `rollbackMetaItem` beside `toVersion`', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('POST', `${ITEM}/rollback`, { package: 'com.acme.alpha.custom' }, { toVersion: 3 });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.rollbackMetaItem.mock.calls[0][0]).toMatchObject({
            type: 'flow', name: 'shared_flow', toVersion: 3, packageId: 'com.acme.alpha.custom',
        });
    });

    for (const { door, method, path, call, body } of DOORS) {
        it(`${door}: CONTROL — no package, \`all\` and the empty string send no \`packageId\``, async () => {
            for (const query of [{}, { package: 'all' }, { package: '' }]) {
                const { protocol, drive } = boot();
                const answer = await drive(method, path, query, body);
                expect(answer.status, `${JSON.stringify(query)}: ${JSON.stringify(answer.body)}`).toBe(200);
                expect(Object.keys(protocol[call].mock.calls[0][0]), JSON.stringify(query)).not.toContain('packageId');
            }
        });

        it(`${door}: REFUSAL — a repeated \`?package=\` is a located 400 and the protocol is never called`, async () => {
            const { protocol, drive } = boot();
            const answer = await drive(method, path, { package: ['com.acme.alpha.custom', 'com.acme.beta.custom'] }, body);
            expect(answer.status).toBe(400);
            expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
            expect(answer.body?.error?.message).toContain('"package" query parameter was supplied 2 times');
            expect(protocol[call]).not.toHaveBeenCalled();
        });

        it(`${door}: REFUSAL — the protocol's two-holder refusal is a 409 naming every holder in \`details.candidates\``, async () => {
            const { drive } = boot({ refuse: true });
            const answer = await drive(method, path, {}, body);
            expect(answer.status, JSON.stringify(answer.body)).toBe(409);
            expect([...(answer.body?.details?.candidates ?? [])].map((c: any) => c.packageId).sort(), JSON.stringify(answer.body))
                .toEqual(['com.acme.alpha.custom', 'com.acme.beta.custom']);
        });
    }
});
