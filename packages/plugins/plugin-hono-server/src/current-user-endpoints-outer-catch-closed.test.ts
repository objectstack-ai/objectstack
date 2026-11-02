// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #23047 — `/auth/me/permissions`: once the caller is known, the handler has
// two throw paths, and they are the same event for the caller (the server
// failed to compute the answer). They must give the same CLOSED answer.
//
//   1. the permission-set resolution REJECTS — `.catch(() => [])` turns it
//      into "no sets", and the success body reports `systemPermissions: []`;
//   2. anything else inside the handler's `try` throws — the outer `catch`.
//
// Path 2 used to answer `{ authenticated, userId, objects: {}, fields: {} }`:
// no `systemPermissions`, which is the shape a deployment predating ADR-0066
// sends. The console reads that absence as "capabilities unknown" and fails
// OPEN on it (ADR-0066: "unknown is not denied"; objectui#4656 keeps that
// reading for a genuine pre-ADR-0066 server), so a fault offered authoring
// handles the server would then refuse. The `catch` now answers the closed
// body, built by the same builder the success path uses.
//
// The controls pin what must NOT move: path 1 still reports the session's
// positions, the deliberate degraded branch (no SecurityPlugin) still answers
// its open body byte for byte, and a caller with no session is still anonymous.
//
// Same mount shape as `current-user-endpoints-delegated-resolution.test.ts`: a
// bare Hono app, the real registrar, and a locator that THROWS for an
// unregistered slot, as the kernel's does.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const USER = 'usr_member';
const ACTIVE_ORG = 'org_active';
const GRANTED = 'showcase_ops';
const FAILED_LINE = '[hono] /auth/me/permissions failed';

type Row = Record<string, any>;

/** The sets an ordinary resolution hands back. */
const RESOLVED = [
    {
        name: GRANTED,
        systemPermissions: ['showcase.export_data'],
        tabPermissions: { exports: 'visible' },
        objects: { showcase_order: { allowRead: true, allowEdit: true } },
        fields: { 'showcase_order.total': { readable: true, editable: true } },
    },
];

/** `where` matcher: scalar equality plus `$in`; any other combinator is refused. */
function matches(row: Row, where: Row | undefined): boolean {
    return Object.entries(where ?? {}).every(([key, cond]) => {
        if (key.startsWith('$')) throw new Error(`fake driver: unsupported operator ${key}`);
        const value = row[key] ?? null;
        if (cond && typeof cond === 'object' && Array.isArray((cond as any).$in)) {
            return (cond as any).$in.includes(value);
        }
        return value === (cond ?? null);
    });
}

const TABLES: Record<string, Row[]> = {
    sys_user: [{ id: USER, email: 'member@example.com' }],
    sys_member: [{ user_id: USER, organization_id: ACTIVE_ORG, role: 'member' }],
    sys_user_position: [],
    sys_user_permission_set: [
        { id: 'ups1', user_id: USER, permission_set: GRANTED, organization_id: ACTIVE_ORG },
    ],
    sys_position: [],
    sys_position_permission_set: [],
    sys_permission_set: [{ id: 'ps_ops', name: GRANTED }],
};

const ql = {
    find: async (object: string, opts: any) => {
        const rows = (TABLES[object] ?? []).filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    registry: { getAllApps: () => [], getAllObjects: () => [] },
    getSchema: () => undefined,
};

/**
 * What the `security` slot holds:
 *   'resolver'         — an ordinary resolution;
 *   'rejects'          — the resolution REJECTS (path 1, the control);
 *   'merge-throws'     — the resolution succeeds with a set whose `objects`
 *                        value is not an object, the one input
 *                        `buildEffectiveObjectPermissions` documents it throws on;
 *   'throws-sync'      — the method throws SYNCHRONOUSLY, before
 *                        `.catch(() => [])` can attach to anything;
 *   'accessor-throws'  — reading the method off the service throws, inside
 *                        `permissionSetResolver(ctx)`;
 *   'unclaimed'        — no `security` service at all (the degraded branch).
 */
type SecurityState = 'resolver' | 'rejects' | 'merge-throws' | 'throws-sync' | 'accessor-throws' | 'unclaimed';

function mount(security: SecurityState, { signedIn = true }: { signedIn?: boolean } = {}) {
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => (signedIn
                    ? {
                        user: { id: USER, email: 'member@example.com' },
                        session: { activeOrganizationId: ACTIVE_ORG },
                    }
                    : null),
            },
        },
        objectql: ql,
        metadata: { list: async () => [] as unknown[] },
    };
    if (security === 'resolver') {
        services.security = { resolvePermissionSetsForContext: async () => RESOLVED };
    } else if (security === 'rejects') {
        services.security = {
            resolvePermissionSetsForContext: async () => {
                throw new Error('permission-set resolution failed');
            },
        };
    } else if (security === 'merge-throws') {
        services.security = {
            resolvePermissionSetsForContext: async () => [{ name: GRANTED, objects: { showcase_order: null } }],
        };
    } else if (security === 'throws-sync') {
        services.security = {
            resolvePermissionSetsForContext: () => {
                throw new Error('synchronous resolver fault');
            },
        };
    } else if (security === 'accessor-throws') {
        services.security = {
            get resolvePermissionSetsForContext(): never {
                throw new Error('security service accessor fault');
            },
        };
    }
    const warn = vi.fn();
    const app = new Hono();
    registerCurrentUserEndpoints({
        rawApp: app,
        ctx: {
            logger: { debug() {}, warn },
            getService: <T,>(name: string): T => {
                if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services[name] as T;
            },
        },
    });
    return { app, warn };
}

const request = (app: Hono) => app.request(`http://localhost${ME_PERMISSIONS}`);

/** The `[hono] /auth/me/permissions failed` calls the outer catch made. */
const failedCalls = (warn: ReturnType<typeof vi.fn>) => warn.mock.calls.filter(([line]) => line === FAILED_LINE);

describe('[#23047] a throw inside the try, after the caller is known, answers the CLOSED body', () => {
    it.each([
        ['buildEffectiveObjectPermissions throws on a non-object `objects` value', 'merge-throws', undefined],
        ['the resolver throws synchronously, past `.catch(() => [])`', 'throws-sync', 'synchronous resolver fault'],
        ['permissionSetResolver(ctx) throws reading the method', 'accessor-throws', 'security service accessor fault'],
    ] as const)('%s', async (_label, security, message) => {
        const { app, warn } = mount(security);
        const res = await request(app);
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body).toEqual({
            authenticated: true,
            userId: USER,
            tenantId: ACTIVE_ORG,
            positions: [],
            permissionSets: [],
            objects: {},
            fields: {},
            systemPermissions: [],
            tabPermissions: {},
            // [#28508] On the closed body too, as `false`: no ownership-queue
            // service is registered here, and a fault vouches for nothing.
            hasAnyQueue: false,
        });
        // The load-bearing key, stated on its own: present-and-empty is "no
        // capabilities"; absent is "unknown", which the console fails open on.
        expect(Array.isArray(body.systemPermissions)).toBe(true);

        // The log line is unchanged, and the catch reports once.
        const calls = failedCalls(warn);
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toEqual({ err: message ?? expect.any(String) });
    });

    it('carries every key the success body carries — one shape, not a second literal', async () => {
        const success = await (await request(mount('resolver').app)).json();
        const closed = await (await request(mount('throws-sync').app)).json();

        expect(Object.keys(closed).sort()).toEqual(Object.keys(success).sort());
        // The identity half is the session's on both.
        expect(closed.userId).toBe(success.userId);
        expect(closed.tenantId).toBe(success.tenantId);
    });
});

describe('[#23047] controls — what the fix must not move', () => {
    it('the resolver REJECTING still answers systemPermissions: [] with the session positions', async () => {
        const success = await (await request(mount('resolver').app)).json();
        const { app, warn } = mount('rejects');
        const res = await request(app);
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.systemPermissions).toEqual([]);
        expect(body.tabPermissions).toEqual({});
        expect(body.permissionSets).toEqual([]);
        expect(body.objects).toEqual({});
        expect(body.fields).toEqual({});
        // The session's positions, as before — non-empty here, so this control
        // can tell them apart from the outer catch's `[]`.
        expect(body.positions.length).toBeGreaterThan(0);
        expect(body.positions).toEqual(success.positions);
        // This path never reaches the outer catch.
        expect(failedCalls(warn)).toHaveLength(0);
    });

    it('the degraded branch (no SecurityPlugin) answers its open body, byte for byte', async () => {
        const { app, warn } = mount('unclaimed');
        const res = await request(app);
        expect(res.status).toBe(200);

        expect(await res.text()).toBe(
            '{"authenticated":true,"userId":"usr_member","tenantId":"org_active",'
            + '"positions":["org_member","everyone"],"permissionSets":[],"objects":{},"fields":{},'
            // [#28508] The degraded branch carries the queue boolean too; no
            // ownership-queue service is registered in this mount, so `false`.
            + '"hasAnyQueue":false}',
        );
        expect(failedCalls(warn)).toHaveLength(0);
    });

    it('a caller with no session is still anonymous', async () => {
        const res = await request(mount('throws-sync', { signedIn: false }).app);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('{"authenticated":false}');
    });
});
