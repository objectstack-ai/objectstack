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

/** [#34602] What the service's `objectsUsingQueues` does: answer a list, throw, or not exist. */
type ObjectsSlot = { kind: 'answers'; value: unknown } | { kind: 'throws' } | { kind: 'no-method' };

function mount(
    queue: QueueSlot,
    {
        security = true, signedIn = true, mergeThrows = false,
        objects = {}, objectsUsingQueues: objectsSlot = { kind: 'answers', value: [] },
        member = true, activeOrganization = ACTIVE_ORG, tenancy,
    }: {
        security?: boolean; signedIn?: boolean; mergeThrows?: boolean;
        /** [#34602] false: the person holds no membership row, so the resolver's set is empty. */
        member?: boolean;
        /** [#34602] The session's claimed organization; null = none active. */
        activeOrganization?: string | null;
        /** [#34602] The kernel's `tenancy` service; absent = the `single` shape. */
        tenancy?: Record<string, unknown>;
        /** The member set's object grants, merged by the real `buildEffectiveObjectPermissions`. */
        objects?: Record<string, Row>;
        objectsUsingQueues?: ObjectsSlot;
    } = {},
) {
    const hasAnyQueue = vi.fn(async (_organizationId: string | null) => {
        if (queue.kind === 'throws') throw new Error('sys_queue read failed');
        return queue.kind === 'answers' ? queue.value : false;
    });
    const objectsUsingQueues = vi.fn(async (_organizationId: string | null): Promise<unknown> => {
        if (objectsSlot.kind === 'throws') throw new Error('crm_case read failed');
        return objectsSlot.kind === 'answers' ? objectsSlot.value : [];
    });
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => (signedIn
                    ? { user: { id: USER, email: 'member@example.com' }, session: { activeOrganizationId: activeOrganization } }
                    : null),
            },
        },
        objectql: member
            ? ql
            : { ...ql, find: async (object: string, opts: any) => (object === 'sys_member' ? [] : ql.find(object, opts)) },
        metadata: { list: async () => [] as unknown[] },
    };
    if (tenancy) services.tenancy = tenancy;
    if (security) {
        services.security = {
            resolvePermissionSetsForContext: async () => (mergeThrows
                // The one input `buildEffectiveObjectPermissions` documents it
                // throws on: it lands the handler in its outer catch.
                ? [{ name: 'member_default', objects: { x: null } }]
                : [{ name: 'member_default', systemPermissions: [], objects, fields: {} }]),
        };
    }
    if (queue.kind === 'no-method') services[OWNERSHIP_QUEUE_SERVICE] = { queuesOf: async () => [] };
    else if (queue.kind !== 'absent') {
        services[OWNERSHIP_QUEUE_SERVICE] = objectsSlot.kind === 'no-method' ? { hasAnyQueue } : { hasAnyQueue, objectsUsingQueues };
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
    return { app, warn, hasAnyQueue, objectsUsingQueues };
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
        // [#34602] `objectsUsingQueues` names objects, never a queue.
        expect(queueish).toEqual(['hasAnyQueue', 'objectsUsingQueues']);
    });
});

// [#34602] `objectsUsingQueues`: the objects on which the "in a queue" filter can
// find something (a record sits in a queue now, or an active assignment rule
// routes the object into one). The service's answer, for the caller's
// organization, asked only when `hasAnyQueue` is true, and narrowed on the full
// body to the objects the caller may read. The service's own union is pinned in
// plugin-sharing's `ownership-queue.test.ts`.
describe('[#34602] /auth/me/permissions carries objectsUsingQueues, narrowed to readable objects', () => {
    const READABLE = { crm_case: { allowRead: true }, crm_lead: { allowRead: true }, crm_secret: { allowRead: false } };

    it('the service\'s answer for the caller\'s organization is carried, minus the objects the caller may not read', async () => {
        const { app, objectsUsingQueues } = mount(
            { kind: 'answers', value: true },
            { objects: READABLE, objectsUsingQueues: { kind: 'answers', value: ['crm_secret', 'crm_case', 'crm_unknown'] } },
        );
        const body = await read(app);
        expect(body.objectsUsingQueues).toEqual(['crm_case']);
        expect(objectsUsingQueues).toHaveBeenCalledTimes(1);
        expect(objectsUsingQueues).toHaveBeenCalledWith(ACTIVE_ORG);
    });

    it('with no queue at all the service is not asked: an organization without queues pays no read for it', async () => {
        const { app, objectsUsingQueues } = mount(
            { kind: 'answers', value: false },
            { objects: READABLE, objectsUsingQueues: { kind: 'answers', value: ['crm_case'] } },
        );
        const body = await read(app);
        expect(body.objectsUsingQueues).toEqual([]);
        expect(objectsUsingQueues).not.toHaveBeenCalled();
    });

    it('no service, or a service without the method, answers []', async () => {
        expect((await read(mount({ kind: 'absent' }, { objects: READABLE }).app)).objectsUsingQueues).toEqual([]);
        const noMethod = await read(mount({ kind: 'answers', value: true }, { objects: READABLE, objectsUsingQueues: { kind: 'no-method' } }).app);
        expect(noMethod.objectsUsingQueues).toEqual([]);
        expect(noMethod.hasAnyQueue).toBe(true);
    });

    it('a service that throws answers [] and logs, and the body still answers in full', async () => {
        const { app, warn } = mount({ kind: 'answers', value: true }, { objects: READABLE, objectsUsingQueues: { kind: 'throws' } });
        const body = await read(app);
        expect(body.objectsUsingQueues).toEqual([]);
        expect(body.hasAnyQueue).toBe(true);
        expect(body.permissionSets).toEqual(['member_default']);
        const lines = warn.mock.calls.map(([line]) => line);
        expect(lines).toContain('[hono] /auth/me/permissions: objectsUsingQueues could not be resolved — answering []');
        expect(lines).not.toContain('[hono] /auth/me/permissions failed');
    });

    it('an answer that is not a list of names is carried as [] — the strict contract never sees a stray value', async () => {
        const body = await read(mount({ kind: 'answers', value: true }, { objects: READABLE, objectsUsingQueues: { kind: 'answers', value: 'crm_case' } }).app);
        expect(body.objectsUsingQueues).toEqual([]);
    });

    it('the degraded branch (no SecurityPlugin) carries the answer unnarrowed: it serves no object grant to narrow by', async () => {
        const body = await read(mount(
            { kind: 'answers', value: true },
            { security: false, objectsUsingQueues: { kind: 'answers', value: ['crm_lead', 'crm_case'] } },
        ).app);
        expect(body.objectsUsingQueues).toEqual(['crm_case', 'crm_lead']);
        expect('systemPermissions' in body).toBe(false);
    });

    it('a person outside every organization is answered [] without asking: an environment-wide read would name other organizations\' objects', async () => {
        const { app, objectsUsingQueues, hasAnyQueue } = mount(
            { kind: 'answers', value: true },
            { member: false, objects: READABLE, objectsUsingQueues: { kind: 'answers', value: ['crm_case', 'crm_lead'] } },
        );
        const body = await read(app);
        expect(body.tenantId).toBeNull();
        expect(body.objectsUsingQueues).toEqual([]);
        expect(objectsUsingQueues).not.toHaveBeenCalled();
        // `hasAnyQueue` keeps its #28508 behaviour in this change.
        expect(hasAnyQueue).toHaveBeenCalledWith(null);
        expect(body.hasAnyQueue).toBe(true);
    });

    it.each(['isolated', 'group'])('under %s, a member with no active organization is answered [] and the service is never asked with null', async (posture) => {
        const { app, objectsUsingQueues } = mount(
            { kind: 'answers', value: true },
            { activeOrganization: null, tenancy: { posture }, objects: READABLE, objectsUsingQueues: { kind: 'answers', value: ['crm_case'] } },
        );
        const body = await read(app);
        expect(body.tenantId).toBeNull();
        expect(body.objectsUsingQueues).toEqual([]);
        expect(objectsUsingQueues).not.toHaveBeenCalled();
        // `hasAnyQueue` keeps its #28508 behaviour in this change.
        expect(body.hasAnyQueue).toBe(true);
    });

    it.each([
        ['under single', { posture: 'single' }],
        ['with no tenancy service (the single shape)', undefined],
    ])('%s, a member with no active organization keeps the environment-wide read', async (_label, tenancy) => {
        const { app, objectsUsingQueues } = mount(
            { kind: 'answers', value: true },
            { activeOrganization: null, tenancy, objects: READABLE, objectsUsingQueues: { kind: 'answers', value: ['crm_case', 'crm_secret'] } },
        );
        const body = await read(app);
        expect(body.tenantId).toBeNull();
        expect(objectsUsingQueues).toHaveBeenCalledWith(null);
        expect(body.objectsUsingQueues).toEqual(['crm_case']);
    });

    it('under a walled posture, a member WITH an active organization is asked for it as before', async () => {
        const { app, objectsUsingQueues } = mount(
            { kind: 'answers', value: true },
            { tenancy: { posture: 'isolated' }, objects: READABLE, objectsUsingQueues: { kind: 'answers', value: ['crm_case'] } },
        );
        expect((await read(app)).objectsUsingQueues).toEqual(['crm_case']);
        expect(objectsUsingQueues).toHaveBeenCalledWith(ACTIVE_ORG);
    });

    it('a tenancy service that cannot answer its posture is no posture decided: [] with no active organization, logged', async () => {
        const tenancy = { get posture(): string { throw new Error('tenancy store down'); } };
        const { app, objectsUsingQueues, warn } = mount(
            { kind: 'answers', value: true },
            { activeOrganization: null, tenancy, objects: READABLE, objectsUsingQueues: { kind: 'answers', value: ['crm_case'] } },
        );
        expect((await read(app)).objectsUsingQueues).toEqual([]);
        expect(objectsUsingQueues).not.toHaveBeenCalled();
        expect(warn.mock.calls.map(([line]) => line)).toContain(
            '[hono] /auth/me/permissions: the tenancy posture could not be read — objectsUsingQueues answers [] with no active organization',
        );
    });

    it('the closed body of the outer catch carries []', async () => {
        const body = await read(mount(
            { kind: 'answers', value: true },
            { mergeThrows: true, objectsUsingQueues: { kind: 'answers', value: ['crm_case'] } },
        ).app);
        expect(body.objectsUsingQueues).toEqual([]);
        expect(body.systemPermissions).toEqual([]);
    });
});
