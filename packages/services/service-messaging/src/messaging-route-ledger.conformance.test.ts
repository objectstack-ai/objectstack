// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Messaging route-ledger conformance — the package-local guard every
 * `*-route-ledger.ts` pairs with. `registerPreferenceOptionsRoutes` is a
 * standalone, synchronous function that calls `http.get` and touches neither
 * argument before a request arrives, so a capturing mock `IHttpServer`
 * enumerates its real surface (the seam the print and settings ledgers use),
 * and the two directions fail here by name on every `pnpm test` of this
 * package.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerPreferenceOptionsRoutes } from './preference-options-routes.js';
import { MESSAGING_ROUTE_LEDGER } from './messaging-route-ledger.js';

function createMockServer() {
    return {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function enumerateMessagingRoutes(): Set<string> {
    const server = createMockServer();
    registerPreferenceOptionsRoutes(server as any, {} as any);
    const keys = new Set<string>();
    for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        for (const call of server[verb].mock.calls) keys.add(`${verb.toUpperCase()} ${call[0]}`);
    }
    return keys;
}

const ledgerKeys = (): Set<string> => new Set(MESSAGING_ROUTE_LEDGER.map((e) => e.route));

describe('messaging route ledger ↔ registerPreferenceOptionsRoutes enumeration', () => {
    it('every mounted messaging route has a ledger entry', () => {
        const ledger = ledgerKeys();
        const missing = [...enumerateMessagingRoutes()].filter((k) => !ledger.has(k));
        expect(missing, `messaging routes with no messaging-route-ledger entry: ${missing.join(', ')}`).toEqual([]);
    });

    it('every ledger entry is really mounted by the registrar', () => {
        const live = enumerateMessagingRoutes();
        const stale = [...ledgerKeys()].filter((k) => !live.has(k));
        expect(stale, `messaging-route-ledger entries the registrar no longer mounts: ${stale.join(', ')}`).toEqual([]);
    });

    it('the ledger is compared against a real enumeration, not an empty one', () => {
        const live = enumerateMessagingRoutes();
        expect(live.size).toBeGreaterThan(0);
        expect(live.size).toBe(ledgerKeys().size);
        expect(MESSAGING_ROUTE_LEDGER.every((e) => e.disposition === 'sdk' || (e.note ?? '').length > 0)).toBe(true);
    });
});
