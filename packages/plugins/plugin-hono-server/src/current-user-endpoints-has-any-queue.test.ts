// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #28508: `/auth/me/permissions` carries `hasAnyQueue`, one boolean. It says
// whether the caller's organization has at least one ownership queue, declared
// or `sys_queue`. The console's list toolbar reads it once per session to decide
// whether its "in a queue" toggle can ever return a row. The member's own read
// of `sys_queue` stays refused (the #5491 baseline), so the server answers the
// question for them, and only the boolean is disclosed.
//
// The handler asks the ownership-queue service (`OWNERSHIP_QUEUE_SERVICE`), the
// one place queue resolution and the activation ledger live. It passes the
// caller's organization and asks nothing else. These cases pin the handler's
// half of the contract:
//
//   - the service's answer is carried as it is, for the caller's organization;
//   - no service registered, or a service without the method, answers `false`;
//   - a service that throws answers `false` and logs, rather than failing the
//     whole permissions body;
//   - the key is on every authenticated body (the degraded branch with no
//     SecurityPlugin, and the closed body of the outer catch);
//   - an anonymous caller gets only `{ authenticated: false }`.
//
// The service's own answer (declared, ledger-switched, `sys_queue` rows) is
// pinned in plugin-sharing's `ownership-queue.test.ts`, and the whole path
// through the real HTTP door in `@objectstack/verify`'s
// `me-permissions-has-any-queue.test.ts`.
//
// Same mount shape as `current-user-endpoints-outer-catch-closed.test.ts`: a
// bare Hono app, the real registrar, and a locator that THROWS for an
// unregistered slot, as the kernel's does.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { OWNERSHIP_QUEUE_SERVICE } from '@objectstack/spec/contracts';
import { MePermissionsResponseSchema } from '@objectstack/spec/api';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const USER = 'usr_member';
const ACTIVE_ORG = 'org_active';

type Row = Record<string, any>;

/** The session's organization membership: what the resolver reads to stamp `tenantId`. */
const TABLES: Record<string, Row[]> = {
    sys_user: [{ id: USER, email: 'member@example.com' }],
    sys_member: [{ user_id: USER, organization_id: ACTIVE_ORG, role: 'member' }],
};

/** Scalar equality only; any combinator is refused rather than misread. */
function matches(row: Row, where: Row | undefined): boolean {
    return Object.entries(where ?? {}).every(([key, cond]) => {
        if (key.startsWith('$') || (cond !== null && typeof cond === 'object')) {
            throw new Error(`fake driver: unsupported predicate on ${key}`);
        }
        return (row[key] ?? null) === (cond ?? null);
    });
}

const ql = {
    find: async (object: string, opts: any) => {
        const rows = (TABLES[object] ?? []).filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    registry: { getAllApps: () => [], getAllObjects: () => [] },
    getSchema: () => undefined,
};

type QueueSlot =
    | { kind: 'absent' }
    | { kind: 'no-method' }
    | { kind: 'answers'; value: boolean }
    | { kind: 'throws' };

function mount(
    queue: QueueSlot,
    { security = true, signedIn = true, mergeThrows = false }: { security?: boolean; signedIn?: boolean; mergeThrows?: boolean } = {},
) {
    const hasAnyQueue = vi.fn(async (_organizationId: string | null) => {
        if (queue.kind === 'throws') throw new Error('sys_queue read failed');
        return queue.kind === 'answers' ? queue.value : false;
    });
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => (signedIn
                    ? { user: { id: USER, email: 'member@example.com' }, session: { activeOrganizationId: ACTIVE_ORG } }
                    : null),
            },
        },
        objectql: ql,
        metadata: { list: async () => [] as unknown[] },
    };
    if (security) {
        services.security = {
            resolvePermissionSetsForContext: async () => (mergeThrows
                // The one input `buildEffectiveObjectPermissions` documents it
                // throws on: it lands the handler in its outer catch.
                ? [{ name: 'member_default', objects: { x: null } }]
                : [{ name: 'member_default', systemPermissions: [], objects: {}, fields: {} }]),
        };
    }
    if (queue.kind === 'no-method') services[OWNERSHIP_QUEUE_SERVICE] = { queuesOf: async () => [] };
    else if (queue.kind !== 'absent') services[OWNERSHIP_QUEUE_SERVICE] = { hasAnyQueue };
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
    return { app, warn, hasAnyQueue };
}

/**
 * Read the body, and hold it to the declared contract: every body this file
 * provokes (full, degraded, closed, anonymous) parses through the STRICT
 * `MePermissionsResponseSchema`, so a key the handler sends that the spec does
 * not declare reds here.
 */
async function read(app: Hono) {
    const res = await app.request(`http://localhost${ME_PERMISSIONS}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = MePermissionsResponseSchema.safeParse(body);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    return body;
}

describe('[#28508] /auth/me/permissions carries hasAnyQueue from the ownership-queue service', () => {
    it.each([true, false])('the service answering %s for the caller\'s organization is carried as it is', async (value) => {
        const { app, hasAnyQueue } = mount({ kind: 'answers', value });
        const body = await read(app);
        expect(body.hasAnyQueue).toBe(value);
        // Asked once, for the caller's organization and nothing else.
        expect(hasAnyQueue).toHaveBeenCalledTimes(1);
        expect(hasAnyQueue).toHaveBeenCalledWith(ACTIVE_ORG);
    });

    it('no ownership-queue service registered answers false: with no service, no record can sit in a queue', async () => {
        const { app, warn } = mount({ kind: 'absent' });
        const body = await read(app);
        expect(body.hasAnyQueue).toBe(false);
        // The ordinary state of a stack without plugin-sharing: not a fault.
        expect(warn).not.toHaveBeenCalled();
        // The rest of the body is untouched by the absence.
        expect(body.systemPermissions).toEqual([]);
        expect(body.permissionSets).toEqual(['member_default']);
    });

    it('a registered service that does not carry the method answers false', async () => {
        const body = await read(mount({ kind: 'no-method' }).app);
        expect(body.hasAnyQueue).toBe(false);
    });

    it('a service that throws answers false and logs, and the permissions body still answers in full', async () => {
        const { app, warn } = mount({ kind: 'throws' });
        const body = await read(app);
        expect(body.hasAnyQueue).toBe(false);
        expect(body.permissionSets).toEqual(['member_default']);
        expect(Array.isArray(body.systemPermissions)).toBe(true);
        const lines = warn.mock.calls.map(([line]) => line);
        expect(lines).toContain('[hono] /auth/me/permissions: hasAnyQueue could not be resolved — answering false');
        expect(lines).not.toContain('[hono] /auth/me/permissions failed');
    });

    it('the degraded branch (no SecurityPlugin) carries the key too: the question does not depend on it', async () => {
        const body = await read(mount({ kind: 'answers', value: true }, { security: false }).app);
        expect(body.hasAnyQueue).toBe(true);
        // Still the degraded body: capabilities unknown.
        expect('systemPermissions' in body).toBe(false);
    });

    it('the closed body of the outer catch carries the key, as false: it vouches for nothing it did not finish', async () => {
        const { app, warn } = mount({ kind: 'answers', value: true }, { mergeThrows: true });
        const body = await read(app);
        expect(body.systemPermissions).toEqual([]);
        expect(body.hasAnyQueue).toBe(false);
        expect(warn.mock.calls.map(([line]) => line)).toContain('[hono] /auth/me/permissions failed');
    });

    it('an anonymous caller is told only that it is anonymous, and the service is not asked', async () => {
        const { app, hasAnyQueue } = mount({ kind: 'answers', value: true }, { signedIn: false });
        const body = await read(app);
        expect(body).toEqual({ authenticated: false });
        expect(hasAnyQueue).not.toHaveBeenCalled();
    });

    it('the value on the wire is a boolean and nothing else: no names, no counts', async () => {
        const body = await read(mount({ kind: 'answers', value: true }).app);
        expect(typeof body.hasAnyQueue).toBe('boolean');
        const queueish = Object.keys(body).filter((k) => /queue/i.test(k));
        expect(queueish).toEqual(['hasAnyQueue']);
    });
});
