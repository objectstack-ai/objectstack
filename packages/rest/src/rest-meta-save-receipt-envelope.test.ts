// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5265 — the corrected save receipt crosses the REST boundary intact.
 *
 * The protocol-side pins live in
 * `packages/metadata-protocol/src/protocol.save-receipt-wording.test.ts`. This
 * file answers the other half: the sentence a client actually reads. Nothing
 * here is hand-built — a REAL better-sqlite3 `:memory:` engine, a REAL
 * `ObjectStackProtocolImplementation`, and the REAL `PUT /meta/:type/:name`
 * route, whose handler ends in `res.json(result)`.
 *
 * Two things it proves that a protocol-level test cannot:
 *
 *   1. `message` is forwarded verbatim — the route does not reshape, rename or
 *      re-derive it, so the truthful sentence is the one that reaches Studio's
 *      toast rather than a REST-layer paraphrase.
 *   2. It is nowhere near #5423's 500-character bound, so no truncation path
 *      can silently eat the org dimension or the `[seq=…]` cursor off the end.
 *
 * The showcase repro from the issue is replayed literally: `PUT
 * /api/v1/meta/view/rc5_probe_view` on a fresh environment, which is a
 * first-ever creation and therefore an overlay of nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// The REAL overlay store definitions the protocol writes to — not a mirror.
// `@objectstack/platform-objects` is already a production dependency of this
// package, and a hand-declared `sys_metadata` would only reset the drift clock
// #5785 stopped (an import-job mirror that had silently fallen three columns
// behind the object it mirrored).
import { SysMetadata, SysMetadataHistoryObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from './rest-server';

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
    return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
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

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(makeSqliteDriver(), true);
    await engine.init();
    engine.registry.registerObject(TASK as any);
    engine.registry.registerObject(SysMetadata as any);
    engine.registry.registerObject(SysMetadataHistoryObject as any);
    // Real DDL, `sys_metadata` included — the overlay store the PUT writes to.
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    // [#6603] this route now demands `manage_metadata` — an authoring capability, not just a session.
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    const route = rest.getRoutes()
        .find((r: any) => r.method === 'PUT' && r.path === '/api/v1/meta/:type/:name');
    if (!route) throw new Error('PUT /api/v1/meta/:type/:name is not registered');
    return { engine, protocol, route };
}

const putMeta = async (route: any, type: string, name: string, body: unknown) => {
    const res = makeRes();
    await route.handler({ params: { type, name }, query: {}, headers: {}, body } as any, res);
    return res;
};

const VIEW = (name: string) => ({
    name,
    label: 'Probe',
    object: 'task',
    columns: [{ field: 'name', label: 'Name' }],
});

describe('[#5265] PUT /meta receipt reaches the envelope truthfully', () => {
    it('a first-ever create is not announced as a customization overlay', async () => {
        const { route } = await boot();

        const res = await putMeta(route, 'view', 'rc5_probe_view', VIEW('rc5_probe_view'));

        expect(res._json?.success).toBe(true);
        // The exact sentence the issue measured, corrected. Asserted whole, so
        // a REST-layer paraphrase or a dropped suffix is a failure here.
        expect(res._json.message).toBe(
            `Saved view 'rc5_probe_view' (env-wide, state=active) [seq=${res._json.seq}]`,
        );
        expect(res._json.message).not.toContain('customization overlay');
    }, 60_000);

    it('the receipt survives the envelope whole — well under the #5423 bound', async () => {
        const { route } = await boot();

        const res = await putMeta(route, 'view', 'rc5_probe_view', VIEW('rc5_probe_view'));

        // #5423 replaces a client-facing message above 500 characters. Both
        // receipt shapes are an order of magnitude below that, so the org
        // dimension and the `[seq=…]` cursor can never be cut off the end.
        expect(res._json.message.length).toBeLessThan(200);
        expect(res._json.message.endsWith(`[seq=${res._json.seq}]`)).toBe(true);
        // And it really is the envelope's own field, not a nested echo.
        expect(JSON.parse(JSON.stringify(res._json)).message).toBe(res._json.message);
    }, 60_000);

    it('a second save of the same item keeps the same truthful shape', async () => {
        // Deliberate: the receipt does NOT split created-vs-updated (the only
        // available fact, `parentVersion === null`, is scoped to (state,
        // packageId) and would mislabel a first draft of a live item). The
        // neutral verb is therefore expected to repeat, and that is pinned so
        // nobody "improves" it into a claim the write path cannot back.
        const { route } = await boot();

        const first = await putMeta(route, 'view', 'rc5_probe_view', VIEW('rc5_probe_view'));
        const second = await putMeta(route, 'view', 'rc5_probe_view', {
            ...VIEW('rc5_probe_view'), label: 'Probe (edited)',
        });

        expect(first._json.message).toBe(
            `Saved view 'rc5_probe_view' (env-wide, state=active) [seq=${first._json.seq}]`,
        );
        expect(second._json.message).toBe(
            `Saved view 'rc5_probe_view' (env-wide, state=active) [seq=${second._json.seq}]`,
        );
        expect(second._json.seq).toBeGreaterThan(first._json.seq);
    }, 60_000);
});
