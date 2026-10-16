// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23775, ruling B] `PUT /api/v1/meta/flow/:name` — a NEW flow carrying a
 * spelling retired from the authoring funnel is refused at the REST door, and a
 * stored row that carries one keeps re-saving.
 *
 * The protocol decides it (`saveMetaItem`'s flow branch, the predicate
 * `flowSaveReplaysRetired`; its pins are
 * `packages/metadata-protocol/src/protocol.save-flow-canonicalization.test.ts`).
 * This file answers what a protocol test cannot: the real `/meta` route relays
 * the refusal as an author reads it — `422`, `INVALID_METADATA`, and the
 * located `issues` naming the key the spelling moved to — and lets a legacy
 * row through on both of Studio's save modes.
 *
 * The spelling is the card's example: a `wait` node's loose `config.duration`,
 * which the loader lifted to `waitEventConfig.timerDuration` until 18
 * (`flow-node-wait-event-config-lift`, retired from the load path).
 *
 * Driven at the HTTP door on the real stack: a better-sqlite3 `:memory:`
 * engine, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` and the real routes. No automation
 * service is registered, so the door's own fallback judges the flow — the
 * same verdict an engine host reaches (#21982). The stub is the auth boundary
 * (`resolveExecCtx`).
 *
 * ⚠️ `@objectstack/metadata-protocol` resolves through `exports` to its
 * **`dist/`** (`check-test-source-alias.mjs`, `KNOWN_UNALIASED_TEST_IMPORTS`):
 * rebuild it before reading a result here after touching `protocol.ts`.
 *
 * Every refusal pin asserts the ADR-0112 `code`, the HTTP status and the
 * located issue, and reads the store to show the refused write did not land.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { hashSpec } from '@objectstack/metadata-core';
import { RestServer } from './rest-server.js';

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const META = '/api/v1/meta';
const FLOW = { type: 'flow', name: 'settle_order' };

/** A flow whose second node is the `wait` under test. */
const waitFlow = (wait: Record<string, unknown>, label = 'Settle Order') => ({
    name: FLOW.name,
    label,
    type: 'autolaunched',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'wait', label: 'Hold', ...wait },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'end' },
    ],
});
/** The card's literal shape: the loose key alone, no block. */
const looseOnly = (label?: string) => waitFlow({ config: { duration: 'PT1M' } }, label);
/** The loose key beside a declared block. */
const looseBesideBlock = () => waitFlow({ waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' }, config: { duration: 'PT9M' } });
/** The canonical spelling. */
const canonical = () => waitFlow({ waitEventConfig: { eventType: 'timer', timerDuration: 'PT1M' } });

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
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    res.send = () => res;
    res.end = () => res;
    res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.setHeader = () => {};
    res.write = () => true;
    return res;
}

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const config = { api: { requireAuth: false }, metadata: { enableCache: false } };
    const rest: any = new RestServer(createMockServer() as any, protocol as any, config as any);
    // An author: `manage_metadata` saves and reads drafts.
    rest.resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();

    const route = (method: string, path: string) => {
        const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
        if (!found) throw new Error(`${method} ${path} is not registered`);
        return found;
    };
    const call = async (method: string, routePath: string, req: Record<string, unknown>) => {
        const res = makeRes();
        await route(method, routePath).handler({ method, headers: {}, query: {}, params: {}, ...req }, res);
        return res;
    };
    const path = `${META}/${FLOW.type}/${FLOW.name}`;

    /** `GET /meta/flow/settle_order`. */
    const read = (query: Record<string, string> = {}) =>
        call('GET', `${META}/:type/:name`, { path, params: FLOW, query });
    /** `PUT /meta/flow/settle_order`. */
    const save = (body: unknown, query: Record<string, string> = {}) =>
        call('PUT', `${META}/:type/:name`, { path, params: FLOW, query, body });

    /** The stored bodies of the flow at one lifecycle — the store, not the door's word for it. */
    const stored = async (state: 'active' | 'draft') => {
        const rows = await engine.find('sys_metadata', { where: { type: FLOW.type, name: FLOW.name, state } });
        return (rows ?? []).map((r: any) => JSON.parse(String(r.metadata)) as Record<string, any>);
    };

    /**
     * A row as it exists at rest from before the retirement — the only way a
     * retired spelling is still stored, since the door refuses it on a new
     * flow — written straight to the store, stamped as `put` stamps a row.
     */
    const seed = async (state: 'active' | 'draft', body: Record<string, unknown>) => {
        const now = new Date().toISOString();
        await engine.insert('sys_metadata', {
            id: `seed_${state}`, type: FLOW.type, name: FLOW.name,
            package_id: null, state, metadata: JSON.stringify(body), checksum: hashSpec(body, FLOW.type),
            version: 1, created_at: now, updated_at: now,
        }, { context: { isSystem: true } } as any);
    };

    return { read, save, stored, seed };
}

const ok = (res: any) => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    return res.body;
};

/** A refusal: the ADR-0112 `code`, the status and the located issues, all asserted. */
const refusedInvalid = (res: any): Array<{ path: string; message: string }> => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('INVALID_METADATA');
    return (res.body.issues ?? []) as Array<{ path: string; message: string }>;
};

describe('[#23775] PUT /meta/flow/:name — a retired spelling on a NEW flow is refused, a stored one re-saves', () => {
    it('a new flow with the loose key beside its block: 422 INVALID_METADATA at `config.duration`, naming `waitEventConfig.timerDuration`; nothing stored', async () => {
        const h = await boot();

        const issues = refusedInvalid(await h.save(looseBesideBlock()));

        expect(issues.map((i) => i.path)).toEqual(['nodes.1.config.duration']);
        expect(issues[0]!.message).toContain('waitEventConfig.timerDuration');
        expect(await h.stored('active')).toEqual([]);
    });

    it('a new flow with the loose key alone (the card\'s shape): 422 INVALID_METADATA at the block the lift wrote, naming it; nothing stored', async () => {
        const h = await boot();

        const issues = refusedInvalid(await h.save(looseOnly()));

        expect(issues.map((i) => i.path)).toEqual(['nodes.1.waitEventConfig']);
        expect(issues[0]!.message).toContain('timerDuration');
        expect(await h.stored('active')).toEqual([]);
    });

    it('draft mode does not change it: a new draft with the retired spelling is refused the same way', async () => {
        const h = await boot();

        const issues = refusedInvalid(await h.save(looseBesideBlock(), { mode: 'draft' }));

        expect(issues.map((i) => i.path)).toEqual(['nodes.1.config.duration']);
        expect(await h.stored('draft')).toEqual([]);
    });

    it('a new flow in the canonical spelling saves', async () => {
        const h = await boot();

        ok(await h.save(canonical()));

        expect(await h.stored('active')).toEqual([canonical()]);
    });

    it('a stored legacy row re-saves, and is served', async () => {
        const h = await boot();
        await h.seed('active', looseOnly());

        ok(await h.save(looseOnly('Settle Order (edited)')));

        expect((await h.stored('active')).map((b) => b.label)).toEqual(['Settle Order (edited)']);
        expect(ok(await h.read()).item.label).toBe('Settle Order (edited)');
    });

    it('Studio\'s first draft over a stored legacy row saves: the active row the draft overlays makes it a re-save', async () => {
        const h = await boot();
        await h.seed('active', looseOnly());

        ok(await h.save(looseOnly('Settle Order (draft)'), { mode: 'draft' }));

        expect((await h.stored('draft')).map((b) => b.label)).toEqual(['Settle Order (draft)']);
    });
});
