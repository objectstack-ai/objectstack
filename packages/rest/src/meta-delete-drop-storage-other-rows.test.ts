// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23415, ADR-0048] `DELETE /meta/object/:name?package=P&dropStorage=true`
 * drops the object's table only with the object's LAST stored row.
 *
 * A `sys_metadata` row is keyed by its package, so one object can hold one
 * row per package, and every such row serves the object over the ONE table
 * its name maps to. The delete door names the row it removes (`?package=`),
 * and `?dropStorage=true` asks it to drop the table too. The drop used to ask
 * only about the type, the state and the `sys_` prefix: a delete of package
 * P's row dropped the table while package Q's row of the object stayed stored
 * and served, so Q's object kept its definition and lost its records.
 * Measured on a booted showcase before the fix: the delete answered `200`
 * with a receipt saying Q's row remains, and the next `GET /data` of the
 * object answered `500` because its table was gone.
 *
 * Now such a delete is refused `409 RESOURCE_CONFLICT` before anything is
 * written: P's row, Q's row, the table and its records all stay. The refusal
 * names the way out (the delete without `dropStorage`, or the other rows
 * first and the drop with the last one). The last row's delete with
 * `dropStorage=true` still drops the table, and a per-package delete without
 * `dropStorage` is unchanged.
 *
 * Driven at the HTTP door on the real stack: a better-sqlite3 `:memory:`
 * engine whose tables are real, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` and the real routes, on both kernel
 * topologies. The stub is the auth boundary (`resolveExecCtx`).
 *
 * ⚠️ `@objectstack/metadata-protocol` resolves through `exports` to its
 * **`dist/`** (`check-test-source-alias.mjs`, `KNOWN_UNALIASED_TEST_IMPORTS`):
 * rebuild it before reading a result here after touching `protocol.ts`.
 *
 * Every refusal pin asserts the ADR-0112 `code` and the HTTP status, and reads
 * the store and the table to show the refused delete changed nothing.
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
const P = 'com.probe.p';
const Q = 'com.probe.q';
const NAME = 'probe_ticket';

const ticket = (label: string) => ({
    name: NAME,
    label,
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: { title: { name: 'title', type: 'text' as const, label: 'Title' } },
});

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

/** `environmentId` absent boots a control-plane kernel; set, an environment kernel. */
async function boot(environmentId?: string) {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    const driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any, undefined, environmentId);
    const config = { api: { requireAuth: false }, metadata: { enableCache: false } };
    const rest: any = new RestServer(createMockServer() as any, protocol as any, config as any);
    rest.resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();

    const call = async (method: string, query: Record<string, string>, body?: unknown) => {
        const found = rest.getRoutes().find((r: any) => r.method === method && r.path === `${META}/:type/:name`);
        if (!found) throw new Error(`${method} ${META}/:type/:name is not registered`);
        const res = makeRes();
        await found.handler({
            method, headers: {}, path: `${META}/object/${NAME}`,
            params: { type: 'object', name: NAME }, query, ...(body !== undefined ? { body } : {}),
        }, res);
        return res;
    };

    /** `PUT /meta/object/probe_ticket?package=…` — a publish, which creates the table. */
    const save = (packageId: string) => call('PUT', { package: packageId }, ticket(`Ticket ${packageId}`));
    /** `DELETE /meta/object/probe_ticket?…`. */
    const remove = (query: Record<string, string>) => call('DELETE', query);

    /** The object's stored active rows, by binding — the store, not the door's word for it. */
    const storedPackages = async () => {
        const rows = await engine.find('sys_metadata', { where: { type: 'object', name: NAME, state: 'active' } });
        return (rows ?? []).map((r: any) => (r.package_id ?? null) as string | null)
            .sort((a, b) => String(a).localeCompare(String(b)));
    };
    /** Whether the object's physical table exists — the database, not the registry. */
    const hasTable = () => (driver as any).knex.schema.hasTable(NAME) as Promise<boolean>;
    /** The object's records, read straight from the table. */
    const records = async () => ((await (driver as any).knex(NAME).select('title')) as Array<{ title: string }>)
        .map((r) => r.title);
    const insertRecord = (title: string) =>
        engine.insert(NAME, { title }, { context: { isSystem: true } } as any);

    /**
     * A package-less row of the object as it exists at rest — the save door
     * resolves a package-less save of an item a package holds to that
     * package's row, so such a row is only ever a stored one.
     */
    const seedUnboundRow = async () => {
        const body = ticket('Ticket unbound');
        const now = new Date().toISOString();
        await engine.insert('sys_metadata', {
            id: 'seed_active_unbound', type: 'object', name: NAME,
            package_id: null, state: 'active', metadata: JSON.stringify(body), checksum: hashSpec(body, 'object'),
            version: 1, created_at: now, updated_at: now,
        }, { context: { isSystem: true } } as any);
    };

    return { save, remove, storedPackages, hasTable, records, insertRecord, seedUnboundRow };
}

const ok = (res: any) => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    return res.body;
};

/** The refusal: the ADR-0112 `code` and the status, both asserted. */
const refusedConflict = (res: any) => {
    expect(res.statusCode, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('RESOURCE_CONFLICT');
    return res.body;
};

/** Two packages' rows of the object, its table and one record — the card's setup. */
async function twoPackageObject(environmentId?: string) {
    const h = await boot(environmentId);
    // The registry holds one owner per object name, so the second package's
    // write-through is refused (and logged) at save time; the row is stored.
    ok(await h.save(P));
    ok(await h.save(Q));
    await h.insertRecord('kept');
    expect(await h.storedPackages()).toEqual([P, Q]);
    expect(await h.hasTable()).toBe(true);
    expect(await h.records()).toEqual(['kept']);
    return h;
}

describe('[#23415] DELETE ?package=P&dropStorage=true of an object another row still holds', () => {
    for (const [kernel, environmentId] of [['control-plane', undefined], ['environment', 'env_test']] as const) {
        it(`${kernel} kernel: refused 409 RESOURCE_CONFLICT before anything is written — both rows, the table and Q's record stay`, async () => {
            const h = await twoPackageObject(environmentId);

            const body = refusedConflict(await h.remove({ package: P, dropStorage: 'true' }));
            // The refusal names the row that keeps serving the object.
            expect(String(body.error), JSON.stringify(body)).toContain(Q);

            expect(await h.storedPackages()).toEqual([P, Q]);
            expect(await h.hasTable()).toBe(true);
            expect(await h.records()).toEqual(['kept']);
        }, 60_000);
    }

    it('a package-less row left beside the deleted package\'s row counts as a row that remains', async () => {
        const h = await boot();
        ok(await h.save(P));
        await h.seedUnboundRow();
        await h.insertRecord('kept');
        expect(await h.storedPackages()).toEqual([P, null]);

        refusedConflict(await h.remove({ package: P, dropStorage: 'true' }));

        expect(await h.storedPackages()).toEqual([P, null]);
        expect(await h.hasTable()).toBe(true);
        expect(await h.records()).toEqual(['kept']);
    }, 60_000);

    it('the way out: without dropStorage the delete removes P\'s row and keeps the table (unchanged); the last row\'s delete WITH dropStorage drops it', async () => {
        const h = await twoPackageObject();

        // A per-package delete without `dropStorage`: as before — P's row
        // goes, the receipt names Q's, the table and its record stay.
        const kept = ok(await h.remove({ package: P }));
        expect(kept.reset).toBe(true);
        expect(String(kept.message)).toContain(Q);
        expect(await h.storedPackages()).toEqual([Q]);
        expect(await h.hasTable()).toBe(true);
        expect(await h.records()).toEqual(['kept']);

        // CONTROL: the object's last row, with `dropStorage` — the table goes.
        const dropped = ok(await h.remove({ package: Q, dropStorage: 'true' }));
        expect(dropped.reset).toBe(true);
        expect(await h.storedPackages()).toEqual([]);
        expect(await h.hasTable()).toBe(false);
    }, 60_000);

    it('CONTROL: an object one package holds — `?package=P&dropStorage=true` deletes its row and drops its table', async () => {
        const h = await boot();
        ok(await h.save(P));
        await h.insertRecord('gone');

        ok(await h.remove({ package: P, dropStorage: 'true' }));

        expect(await h.storedPackages()).toEqual([]);
        expect(await h.hasTable()).toBe(false);
    }, 60_000);
});
