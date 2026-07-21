// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression coverage for #3361: the per-request, admin-gated `Server-Timing`
// path (#2408) never emitted on the standard `os serve`/`dev` server. The data
// and metadata routes there are owned by the RestServer (it shadows the Hono
// plugin's CRUD), and its identity resolver `resolveExecCtx` never opened the
// perf-disclosure gate — so an admin sending `X-OS-Debug-Timing` got no header.
//
// These tests drive the REAL resolution pipeline (`computeExecCtx` →
// `resolveAuthzContext` → `derivePosture`) inside an ambient disclosure gate and
// assert it opens for an admin/service principal and STAYS CLOSED for a member
// or an anonymous caller. That is the exact end-to-end wiring no single-layer
// unit test exercised (the CI gap the issue calls out).

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import { runWithPerfDisclosure, type PerfDisclosureGate } from '@objectstack/observability';

const makeServer = () => ({
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn(), close: vi.fn(),
});

/**
 * A fake data engine that returns just enough rows for `resolveAuthzContext` to
 * derive a posture: an UNSCOPED `admin_full_access` grant for `admin1` (→
 * PLATFORM_ADMIN) and a plain `member_default` grant for `member1` (→ MEMBER).
 * Every other object read resolves empty.
 */
const makeQl = () => ({
    find: async (object: string, opts: any) => {
        const where = opts?.where ?? {};
        if (object === 'sys_user') return [{ id: where.id, email: `${where.id}@example.com` }];
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
        // sys_member, sys_user_position, sys_position, sys_position_permission_set,
        // sys_setting (localization) — nothing to contribute.
        return [];
    },
});

/** A fake auth service whose session is keyed off the request's `cookie` header. */
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

function makeRest() {
    return new RestServer(
        makeServer() as any,
        {} as any,                              // protocol — unused by resolveExecCtx
        { api: { requireAuth: true } } as any,  // config
        undefined,                              // kernelManager
        undefined,                              // envRegistry
        undefined,                              // defaultEnvironmentIdProvider
        async () => makeAuth(),                 // authServiceProvider
        async () => makeQl(),                   // objectQLProvider
    );
}

/** Resolve the exec context for `cookie` inside a fresh disclosure gate. */
async function resolveInGate(cookie?: string) {
    const rest = makeRest();
    const gate: PerfDisclosureGate = { allowed: false };
    const req = { method: 'GET', headers: cookie ? { cookie } : {} };
    const ctx = await runWithPerfDisclosure(gate, () => (rest as any).resolveExecCtx(undefined, req));
    return { ctx, gate };
}

describe('RestServer resolveExecCtx — per-request Server-Timing disclosure gate (#3361)', () => {
    it('opens the gate for a PLATFORM_ADMIN principal', async () => {
        const { ctx, gate } = await resolveInGate('admin');
        expect(ctx?.userId).toBe('admin1');
        expect(ctx?.posture).toBe('PLATFORM_ADMIN');
        expect(gate.allowed).toBe(true);
        expect(gate.privileged).toBe(true);
    });

    it('leaves the gate CLOSED for an ordinary member principal', async () => {
        const { ctx, gate } = await resolveInGate('member');
        expect(ctx?.userId).toBe('member1');
        expect(ctx?.posture).toBe('MEMBER');
        expect(gate.allowed).toBe(false);
        expect(gate.privileged).toBeFalsy();
    });

    it('leaves the gate CLOSED for an anonymous caller', async () => {
        const { ctx, gate } = await resolveInGate(undefined);
        expect(ctx).toBeUndefined();
        expect(gate.allowed).toBe(false);
    });

    it('is a no-op when there is no ambient gate (perf-tuning off)', async () => {
        // Resolving an admin OUTSIDE runWithPerfDisclosure must not throw —
        // allowPerfDisclosure() no-ops when no gate is active.
        const rest = makeRest();
        const ctx = await (rest as any).resolveExecCtx(undefined, { method: 'GET', headers: { cookie: 'admin' } });
        expect(ctx?.posture).toBe('PLATFORM_ADMIN');
    });
});
