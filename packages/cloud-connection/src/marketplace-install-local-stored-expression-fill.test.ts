// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35390, #32527 ruling 6816429574 letter A] The managed install or upgrade
 * door fills the stored computed fields the version it makes live adds or
 * changes: every existing row, every organization, under `preserveAudit`,
 * each field reported on the answer's `advisories` (the metadata doors' rule
 * ids and element shape). A version that changes no stored computed field, a
 * refused install and a fresh table fill and report nothing.
 *
 * Real here: an `ObjectKernel` with the SQL driver on SQLite (`:memory:`) and
 * `ObjectQLPlugin` (the `manifest` service over the real `SchemaRegistry`, the
 * engine whose `captureStoredExpressions` walks and writes the rows). The
 * door's side readers (binder, translations, seeds) are recorders, as in the
 * hot-resync suite: none of them is under test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The first load of the runtime's dist paid at module top, never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`): the plugin reaches the
// same module through a dynamic `import()` for its handler binder.
import '@objectstack/runtime';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

type Handler = (c: any) => Promise<any>;
type Row = Record<string, any>;

const VENDOR = 'com.acme.leads';
const TABLE = 'acme_lead';
const STAMP = '2026-01-01T00:00:00.000Z';
const cel = (source: string) => ({ dialect: 'cel', source });
const FULL_NAME = cel("record.first_name + ' ' + record.last_name");

const lead = (fields: Row): Row => ({
    name: TABLE,
    label: 'Lead',
    fields: { first_name: { type: 'text' }, last_name: { type: 'text' }, organization_id: { type: 'text' }, ...fields },
});
const vendor = (version: string, fields: Row): Row => ({ id: VENDOR, namespace: 'acme', version, type: 'app', objects: [lead(fields)] });

/** v1 reads the name on the fly; v2 stores it. */
const V1 = vendor('1.0.0', { full_name: { type: 'formula', returnType: 'text', expression: FULL_NAME } });
const V2 = vendor('2.0.0', { full_name: { type: 'text', expression: FULL_NAME } });
/** v3 keeps v2's stored field as it is and adds a second one. */
const V3 = vendor('3.0.0', {
    full_name: { type: 'text', expression: FULL_NAME },
    first_upper: { type: 'text', expression: cel('record.first_name.upperAscii()') },
});

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeC(body: any) {
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json: vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 })),
    };
}

let dir: string;
let kernel: ObjectKernel | undefined;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-stored-fill-')); });
afterEach(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    kernel = undefined;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * Boot the real engine and mount the door over it. `refuseVersion`: the
 * `manifest` service refuses that version's register (an inline manifest's
 * register throw is a refusal: `422 PLUGIN_REGISTER_FAILED`).
 */
async function bootDoor(opts: { refuseVersion?: string } = {}) {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await kernel.use({
        name: 'test.stored-fill.driver',
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) { ctx.registerService('driver.default', driver); },
    } as Plugin);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';
    const manifest = kernel.getService<{ register(m: unknown, o?: unknown): Promise<unknown> }>('manifest');

    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const services: Record<string, unknown> = {
        manifest: {
            register: async (m: any, o?: unknown) => {
                if (opts.refuseVersion !== undefined && m?.version === opts.refuseVersion) {
                    throw new Error(`object ${TABLE}: refused by the engine`);
                }
                return manifest.register(m, o);
            },
        },
        auth: installerAuthService(),
        objectql: withInstallerGrants({
            convertPackageBodyForward: (body: unknown) => ql.convertPackageBodyForward(body),
            registry: ql.registry,
            get manifests() { return (ql as unknown as { manifests: Map<string, unknown> }).manifests; },
            syncSchemas: () => ql.syncSchemas(),
            getDriverForObject: (name: string) => ql.getDriverForObject(name),
            captureStoredExpressions: (object: string) => ql.captureStoredExpressions(object),
        }),
    };
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            if (!(name in services)) throw new Error(`no ${name}`);
            return services[name];
        },
        logger,
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    const p = plugin as unknown as Record<string, unknown>;
    p.bindArtifactHandlers = async () => undefined;
    p.applySideEffects = async () => ({ translationsLoaded: 0, seeded: { mode: 'none' } });
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();

    const install = (body: Row) => rawApp.routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest: body }));
    const knex = () => driver.getKnex();
    /** Rows written straight into the table, as rows a running tenant already holds, in two organizations. */
    const seedRows = async () => {
        await knex()(TABLE).insert([
            { id: 'l1', first_name: 'Ada', last_name: 'Lovelace', organization_id: 'org_a', updated_at: STAMP },
            { id: 'l2', first_name: 'Alan', last_name: 'Turing', organization_id: 'org_a', updated_at: STAMP },
            { id: 'l3', first_name: 'Grace', last_name: 'Hopper', organization_id: 'org_b', updated_at: STAMP },
        ]);
    };
    const rows = async (): Promise<Record<string, Row>> => {
        const all = (await knex()(TABLE).select('*')) as Row[];
        return Object.fromEntries(all.map((r) => [String(r.id), r]));
    };
    return { ql, driver, install, seedRows, rows, logger };
}

const ok = (res: any) => {
    expect(res.status, JSON.stringify(res.payload)).toBe(200);
    expect(res.payload.data.hotLoaded, JSON.stringify(res.payload)).toBe(true);
    return res.payload.data;
};

describe('a managed upgrade fills the stored computed fields it makes live (#35390)', () => {
    it('v1 formula → v2 stored: every existing row of both organizations is filled once, updated_at kept, reported per field', async () => {
        const door = await bootDoor();
        ok(await door.install(V1));
        await door.seedRows();

        const data = ok(await door.install(V2));

        const after = await door.rows();
        expect(Object.fromEntries(Object.entries(after).map(([id, r]) => [id, [r.organization_id, r.full_name, r.updated_at]]))).toEqual({
            l1: ['org_a', 'Ada Lovelace', STAMP],
            l2: ['org_a', 'Alan Turing', STAMP],
            l3: ['org_b', 'Grace Hopper', STAMP],
        });
        expect(data.advisories).toEqual([expect.objectContaining({
            rule: 'stored-expression-filled',
            severity: 'info',
            path: `objects.${TABLE}.fields.full_name`,
            message: expect.stringContaining('3 rows of 3 written'),
        })]);
    }, 60_000);

    it('an upgrade adding a stored field fills it; the unchanged stored field beside it is neither re-walked nor reported', async () => {
        const door = await bootDoor();
        ok(await door.install(V2));
        await door.seedRows();
        // The v2 rows hold their stored value as any write of v2 stores it.
        for (const [id, name] of [['l1', 'Ada Lovelace'], ['l2', 'Alan Turing'], ['l3', 'Grace Hopper']]) {
            await door.driver.getKnex()(TABLE).where({ id }).update({ full_name: name });
        }

        const data = ok(await door.install(V3));

        const after = await door.rows();
        expect(Object.values(after).map((r) => [r.id, r.first_upper, r.updated_at])).toEqual([
            ['l1', 'ADA', STAMP], ['l2', 'ALAN', STAMP], ['l3', 'GRACE', STAMP],
        ]);
        expect(data.advisories.map((a: Row) => [a.rule, a.path])).toEqual([
            ['stored-expression-filled', `objects.${TABLE}.fields.first_upper`],
        ]);
    }, 60_000);

    it('CONTROL: an upgrade that changes no stored computed field writes no row and the answer carries no `advisories`', async () => {
        const door = await bootDoor();
        ok(await door.install(V2));
        await door.seedRows();
        const update = vi.spyOn(door.ql, 'update');

        const data = ok(await door.install({ ...V2, version: '2.0.1' }));

        expect(update.mock.calls.filter(([object]) => object === TABLE)).toEqual([]);
        expect(data).not.toHaveProperty('advisories');
        expect(Object.values(await door.rows()).map((r) => r.full_name)).toEqual([null, null, null]);
    }, 60_000);

    it('CONTROL: a refused upgrade fills nothing — the register refusal answers 422 and no row is written', async () => {
        const door = await bootDoor({ refuseVersion: '2.0.0' });
        ok(await door.install(V1));
        await door.seedRows();
        const update = vi.spyOn(door.ql, 'update');

        const res = await door.install(V2);

        expect(res.status, JSON.stringify(res.payload)).toBe(422);
        expect(res.payload.error.code).toBe('PLUGIN_REGISTER_FAILED');
        expect(update.mock.calls.filter(([object]) => object === TABLE)).toEqual([]);
    }, 60_000);

    it('CONTROL: a fresh install over an empty new table fills nothing and the answer carries no `advisories`', async () => {
        const door = await bootDoor();
        const data = ok(await door.install(V2));
        expect(data).not.toHaveProperty('advisories');
    }, 60_000);

    it('a composed artifact (ADR-0130 D4): the unit that turns the formula into a stored field has its rows filled', async () => {
        const SUITE = 'com.acme.suite';
        const unit = (id: string, version: string, objects: Row[]) => ({
            manifest: { id, name: id, version, type: 'module', namespace: 'acme', objects },
        });
        const composed = (version: string, fullName: Row) => ({
            id: SUITE,
            name: 'Suite',
            version,
            type: 'app',
            packages: [
                unit(`${SUITE}.notes`, version, [{ name: 'acme_note', label: 'Note', fields: { text: { type: 'text' } } }]),
                unit(`${SUITE}.leads`, version, [lead({ full_name: fullName })]),
            ],
        });
        const door = await bootDoor();
        ok(await door.install(composed('1.0.0', { type: 'formula', returnType: 'text', expression: FULL_NAME })));
        await door.seedRows();

        const data = ok(await door.install(composed('2.0.0', { type: 'text', expression: FULL_NAME })));

        expect(Object.values(await door.rows()).map((r) => r.full_name)).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
        expect(data.advisories.map((a: Row) => [a.rule, a.path])).toEqual([
            ['stored-expression-filled', `objects.${TABLE}.fields.full_name`],
        ]);
    }, 60_000);

    it('a fresh install whose object already holds rows (a re-install over kept data) fills them', async () => {
        const door = await bootDoor();
        // The table exists with rows before this package was ever installed here.
        await door.driver.syncSchema(TABLE, lead({}) as any);
        await door.seedRows();

        const data = ok(await door.install(V2));

        expect(Object.values(await door.rows()).map((r) => [r.full_name, r.updated_at])).toEqual([
            ['Ada Lovelace', STAMP], ['Alan Turing', STAMP], ['Grace Hopper', STAMP],
        ]);
        expect(data.advisories.map((a: Row) => a.rule)).toEqual(['stored-expression-filled']);
    }, 60_000);
});
