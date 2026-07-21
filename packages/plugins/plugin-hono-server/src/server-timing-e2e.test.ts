// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// End-to-end regression for #3361 on the STANDALONE Hono CRUD surface (the
// minimal server used when `@objectstack/rest` is not mounted). It drives a real
// request through the perf middleware AND the real `/api/v1/data/:object`
// handler — whose `resolveCtx` resolves the principal — instead of a handler
// that calls `allowPerfDisclosure()` by hand "as the dispatcher would" (the gap
// the existing unit tests left invisible). An admin sending `X-OS-Debug-Timing`
// must get a `Server-Timing` header; a member and an anonymous caller must not.

import { describe, it, expect } from 'vitest';
import { HonoServerPlugin } from './hono-plugin';
import type { PluginContext } from '@objectstack/core';

/**
 * Fake data engine: an UNSCOPED `admin_full_access` grant for `admin1` (the
 * seeded platform admin) vs. a `member_default` grant for `member1`, plus the
 * `widget` rows the data route returns. Every other read resolves empty.
 */
const makeQl = () => ({
    find: async (object: string, opts: any) => {
        const where = opts?.where ?? {};
        if (object === 'sys_user_permission_set') {
            if (where.user_id === 'admin1') return [{ permission_set_id: 'ps_admin', organization_id: null }];
            if (where.user_id === 'member1') return [{ permission_set_id: 'ps_member', organization_id: null }];
            return [];
        }
        if (object === 'sys_permission_set') {
            const ids: string[] = where.id?.$in ?? [];
            return [
                ids.includes('ps_admin') ? { id: 'ps_admin', name: 'admin_full_access' } : null,
                ids.includes('ps_member') ? { id: 'ps_member', name: 'member_default' } : null,
            ].filter(Boolean);
        }
        if (object === 'widget') return [{ id: '1', name: 'w' }];
        // sys_member, sys_user — nothing to contribute.
        return [];
    },
});

/** Fake auth service: session keyed off the request's `cookie` header. */
const makeAuth = () => ({
    api: {
        getSession: async ({ headers }: { headers: any }) => {
            const cookie = headers?.get?.('cookie');
            if (cookie === 'admin') return { user: { id: 'admin1' } };
            if (cookie === 'member') return { user: { id: 'member1' } };
            return undefined;
        },
    },
});

function fakeCtx(services: Record<string, unknown>): PluginContext {
    const map = new Map<string, unknown>(Object.entries(services));
    return {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        registerService: (name: string, svc: unknown) => map.set(name, svc),
        getService: (name: string) => map.get(name),
        hook: () => {},
        getKernel: () => ({}),
    } as unknown as PluginContext;
}

async function setup() {
    // serverTiming left at its default (undefined): global mode OFF, the
    // admin-gated per-request path AVAILABLE — the exact `os serve` posture.
    const plugin = new HonoServerPlugin({ cors: false });
    const ctx = fakeCtx({ objectql: makeQl(), auth: makeAuth() });
    await (plugin as any).init(ctx);
    // Register the real standard CRUD/data endpoints (normally wired on
    // kernel:ready) so `/api/v1/data/:object` runs its real `resolveCtx`.
    (plugin as any).registerDiscoveryAndCrudEndpoints(ctx);
    const app = (plugin as any).server.getRawApp();
    return { app };
}

describe('Hono standalone data route — admin-gated Server-Timing (#3361 e2e)', () => {
    it('emits Server-Timing for a platform admin sending X-OS-Debug-Timing', async () => {
        const { app } = await setup();
        const res = await app.request('/api/v1/data/widget', {
            headers: { cookie: 'admin', 'X-OS-Debug-Timing': '1' },
        });
        expect(res.status).toBe(200);
        const header = res.headers.get('Server-Timing');
        expect(header).toBeTruthy();
        expect(header).toMatch(/(^|, )total;dur=[\d.]+/);
    });

    it('withholds Server-Timing from an ordinary member (same debug header)', async () => {
        const { app } = await setup();
        const res = await app.request('/api/v1/data/widget', {
            headers: { cookie: 'member', 'X-OS-Debug-Timing': '1' },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Server-Timing')).toBeNull();
    });

    it('withholds Server-Timing from an anonymous caller (401, no header)', async () => {
        const { app } = await setup();
        const res = await app.request('/api/v1/data/widget', {
            headers: { 'X-OS-Debug-Timing': '1' },
        });
        // requireAuth defaults on → anonymous is denied, and nothing opened the gate.
        expect(res.status).toBe(401);
        expect(res.headers.get('Server-Timing')).toBeNull();
    });

    it('does NOT emit for an admin when no debug header is sent (opt-in only)', async () => {
        const { app } = await setup();
        const res = await app.request('/api/v1/data/widget', { headers: { cookie: 'admin' } });
        expect(res.status).toBe(200);
        expect(res.headers.get('Server-Timing')).toBeNull();
    });
});
