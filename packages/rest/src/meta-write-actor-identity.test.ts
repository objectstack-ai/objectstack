// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7749 — a bearer-authenticated admin's metadata write is attributed to that
 * admin, not to `system`.
 *
 * ## The defect
 *
 * Five `/meta` write sites in `rest-server.ts` resolved the acting identity as
 *
 * ```
 * req.headers['x-actor'] ?? req.headers['X-Actor'] ?? req.user?.id ?? req.userId
 * ```
 *
 * and nothing on this transport ever sets `req.user` / `req.userId` — REST
 * resolves identity through `resolveExecCtx`, onto the returned
 * ExecutionContext, never back onto the raw request. So an ordinary
 * console/API `PUT /api/v1/meta/<type>/<name>` produced `actor === undefined`
 * and the protocol's defaults took over. The trail could not answer "who
 * changed this" for any client that did not hand-set a non-standard header.
 *
 * ## Why this file boots the real stack
 *
 * The two defaults that swallowed the identity live DOWNSTREAM of REST and
 * they differ — `sys_metadata_audit.actor` falls back to the sentinel string
 * `'system'` (`recordMetadataAudit`), `sys_metadata_history.recorded_by` falls
 * back to SQL `NULL` (#4556). A mock protocol asserting "REST passed an
 * `actor` field" would prove neither row, and a fix that satisfied only one of
 * them would pass. So nothing here is hand-built: a REAL better-sqlite3
 * `:memory:` engine, the REAL `sys_metadata*` object definitions, a REAL
 * `ObjectStackProtocolImplementation`, the REAL route — and the assertions
 * read the persisted ROWS, not the call arguments.
 *
 * ## What is pinned
 *
 *  1. authenticated admin, no `X-Actor` → BOTH rows carry the admin's id;
 *  2. an internal system write (`isSystem`, no principal) still records
 *     `'system'` / `NULL` — the fix must not stamp a real user onto machine
 *     writes, and an anonymous caller is still refused outright;
 *  3. an explicit `X-Actor` behaves exactly as it did before, so this change
 *     stays separable from the precedence question the issue raises (the
 *     header still outranks the session identity — deliberately unchanged
 *     here, see `resolveMetaWriteActor`).
 *
 * The final case closes the loop the other three stub: that a bearer token
 * really does land on `resolveExecCtx().userId` for this route, driven through
 * a real `authServiceProvider` with no stub in the identity path at all.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// The REAL stores the protocol writes to — not a mirror. A hand-declared
// `sys_metadata_audit` would only reset the drift clock #5785 stopped.
import {
    SysMetadata,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
} from '@objectstack/platform-objects/metadata';
import { RestServer } from './rest-server.js';

const ADMIN = 'usr_admin_7749';

/**
 * `registry.registerObject` takes `(schema, packageId, …)`. Passed explicitly
 * rather than left off: the argument is REQUIRED by the signature, and omitting
 * it is one of the type errors `check:type-check-debt` freezes for this package
 * — a new test must not add to that pile (#5278).
 */
const TEST_PACKAGE_ID = 'objectstack-test';

/** The real backend, constructed the canonical way (`examples/app-crm`). */
function makeSqliteDriver() {
    return new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

function createMockServer() {
    const noop = () => {};
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => {}, close: async () => {},
    };
}

function makeRes() {
    const res: any = {
        write: () => true, end: () => {},
        header: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return res;
}

const TASK = {
    name: 'task', label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const VIEW = (name: string) => ({
    name,
    label: 'Actor probe',
    object: 'task',
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
    columns: [{ field: 'name', label: 'Name' }],
});

/**
 * Boot the real stack.
 *
 * `execCtx` stands in for the auth boundary ONLY — "better-auth says this
 * bearer belongs to X" — which is the same seam every neighbouring `/meta`
 * test uses for the `manage_metadata` capability gate (#6603). Everything
 * downstream of it, which is where #7749 lived, is real. The last test in this
 * file removes even that stub.
 */
async function boot(execCtx: unknown, opts: { authServiceProvider?: any } = {}) {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(makeSqliteDriver(), true);
    await engine.init();
    engine.registry.registerObject(TASK as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    // Real DDL — the audit and history tables the assertions read are
    // physically there, with their real column types.
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(
        createMockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
        undefined, // kernelManager
        undefined, // envRegistry
        undefined, // defaultEnvironmentIdProvider
        opts.authServiceProvider, // authServiceProvider
    );
    if (execCtx !== undefined) {
        (rest as any).resolveExecCtx = async () => execCtx;
    }
    rest.registerRoutes();
    const route = rest.getRoutes()
        .find((r: any) => r.method === 'PUT' && r.path === '/api/v1/meta/:type/:name');
    if (!route) throw new Error('PUT /api/v1/meta/:type/:name is not registered');
    return { engine, protocol, rest, route };
}

const putMeta = async (route: any, name: string, headers: Record<string, unknown> = {}) => {
    const res = makeRes();
    await route.handler(
        { params: { type: 'view', name }, query: {}, headers, body: VIEW(name) } as any,
        res,
    );
    return res;
};

/** The `sys_metadata_audit` row this save recorded — the compliance trail. */
async function auditActor(engine: any, name: string) {
    const rows = await engine.find('sys_metadata_audit', {
        where: { name }, context: { isSystem: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    return rows[rows.length - 1].actor;
}

/** The `sys_metadata_history` row this save recorded — the version trail. */
async function historyActor(engine: any, name: string) {
    const rows = await engine.find('sys_metadata_history', {
        where: { name }, context: { isSystem: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    return rows[rows.length - 1].recorded_by;
}

describe('[#7749] PUT /meta/:type/:name records the authenticated caller as the actor', () => {
    it('a bearer-authenticated admin with NO X-Actor is named in BOTH the audit and the history row', async () => {
        const { engine, route } = await boot({
            userId: ADMIN, systemPermissions: ['manage_metadata'],
        });

        const res = await putMeta(route, 'actor_probe_view');
        expect(res._json?.success).toBe(true);

        // The whole point of the card. Before the fix these read `'system'`
        // and `null` respectively — two different defaults for one missing
        // value, which is why both are asserted, together, in one object: a
        // fix that satisfied only one of them would otherwise pass on the
        // strength of the first assertion alone.
        expect({
            audit: await auditActor(engine, 'actor_probe_view'),
            history: await historyActor(engine, 'actor_probe_view'),
        }).toEqual({ audit: ADMIN, history: ADMIN });
    }, 60_000);

    it('an internal system write (no principal) still records `system` / NULL', async () => {
        // The machine-write shape: `isSystem` clears the capability gate, and
        // there is NO user behind it. The fix must not invent one.
        const { engine, route } = await boot({ isSystem: true });

        const res = await putMeta(route, 'system_probe_view');
        expect(res._json?.success).toBe(true);

        expect(await auditActor(engine, 'system_probe_view')).toBe('system');
        expect(await historyActor(engine, 'system_probe_view')).toBeFalsy();
    }, 60_000);

    it('an anonymous caller is still refused outright — no row, no attribution', async () => {
        // No stub and no auth service: `resolveExecCtx` yields undefined for an
        // anonymous request, exactly as it does in production
        // (`resolveAuthzContext` → no principal → no context).
        const { engine, route } = await boot(undefined);

        const res = await putMeta(route, 'anon_probe_view');

        // 401 (not 403): the `/meta` umbrella auth gate refuses before the
        // `manage_metadata` capability gate is even reached.
        expect(res._status).toBe(401);
        const rows = await engine.find('sys_metadata_audit', {
            where: { name: 'anon_probe_view' }, context: { isSystem: true },
        });
        expect(rows).toHaveLength(0);
    }, 60_000);

    it('an explicit X-Actor still wins over the session identity — precedence unchanged', async () => {
        // ⚠️ Pinned as-is, NOT endorsed: with the producer fixed this ordering
        // is live for the first time, so an authenticated caller can attribute
        // a write to somebody else. Changing whose name lands in an audit row
        // is a security-semantics decision for the audit contract, tracked
        // separately on #7749 — this test exists to keep that decision
        // separable from this fix, and it is the test to CHANGE when the
        // maintainer rules on the ordering.
        const { engine, route } = await boot({
            userId: ADMIN, systemPermissions: ['manage_metadata'],
        });

        const res = await putMeta(route, 'header_probe_view', { 'x-actor': 'user_42' });
        expect(res._json?.success).toBe(true);

        expect(await auditActor(engine, 'header_probe_view')).toBe('user_42');
        expect(await historyActor(engine, 'header_probe_view')).toBe('user_42');
    }, 60_000);

    it('the identity comes from the REAL bearer→session→execCtx chain, no stub', async () => {
        // No `resolveExecCtx` override: the route runs the production identity
        // resolution (`resolveExecCtx` → `resolveAuthzContext` → better-auth
        // `getSession`) against a real auth service that honours the bearer
        // token. This is the link the card said was missing — the token IS
        // validated, its identity just never reached the handler.
        const authServiceProvider = async () => ({
            api: {
                getSession: async ({ headers }: any) => (
                    headers?.get?.('authorization') === `Bearer token-for-${ADMIN}`
                        ? { user: { id: ADMIN }, session: { userId: ADMIN } }
                        : null
                ),
            },
        });
        const { rest } = await boot(undefined, { authServiceProvider });

        const authed = await (rest as any).resolveExecCtx(undefined, {
            headers: { authorization: `Bearer token-for-${ADMIN}` },
        });
        expect(authed?.userId).toBe(ADMIN);

        // …and the shared producer turns exactly that into the recorded actor.
        const actor = await (rest as any).resolveMetaWriteActor(undefined, {
            headers: { authorization: `Bearer token-for-${ADMIN}` },
        });
        expect(actor).toBe(ADMIN);

        // A request with no credentials resolves to nobody — so the write path
        // falls through to the protocol's `'system'` / NULL defaults.
        const anon = await (rest as any).resolveMetaWriteActor(undefined, { headers: {} });
        expect(anon).toBeUndefined();
    }, 60_000);
});
