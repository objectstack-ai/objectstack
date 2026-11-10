// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 row R4] The three activation doors over a ledger that already
 * holds two rows naming no package for the item they switch.
 *
 * ## What was wrong
 *
 * The rows are what a database can carry once the old `(metadata_type, name)`
 * key is retired for `(metadata_type, package_id, name)` and while the
 * package-less index does not stand (it refuses to build over them; the boot
 * backfill reports them and binds neither). The doors all write through
 * `ObjectStoreMetadataActivationStore.setActive`, which updated the FIRST row
 * its `(metadata_type, name)` read found and gave it the write's package. One
 * click therefore bound one row of the pair, the index's next build no longer
 * saw a pair, and the duplicate was never reported again, while which switch
 * applied stayed a matter of storage order. Measured on this rig with the
 * store's guard ablated back to taking the first row: each door answered
 * `200`, and the first row of the pair gained the package the door named.
 *
 * ## What is pinned
 *
 * Each door answers `409 RESOURCE_CONFLICT`, the ADR-0150 answer to a
 * request that names one item where more than one stands, with both row ids in
 * the message, and the table is read back unchanged: no row gained a package
 * and no switch moved. Then the operator's remedy, followed: one row deleted
 * in the database, the same request answers `200` and writes the row left.
 * The envelope, the ids and the rows are asserted, never the sentence.
 *
 * ## The rig
 *
 * A REAL store: better-sqlite3 `:memory:`, the real `ObjectQL` engine with the
 * real `sys_metadata_activation` object and its declared key, and no
 * package-less index (this rig boots no kernel, so nothing builds it, as on the
 * database above). Every request goes through the route the dispatcher plugin
 * mounts, answered by the plugin's own exits, with the identity step the one
 * stubbed seam (`dispatcher-plugin.package-customizations-mount.test.ts`):
 *
 *  - `POST /security/_activation/:type/:name` and
 *    `POST /actions/_activation/:object/:action` catch the store's throw and
 *    answer it through `errorFromThrown`;
 *  - `POST /automation/:name/toggle` lets it leave `dispatch()` and answers it
 *    through the throw-transparent exit. Its service is a stand-in that writes
 *    through the real store with the package the loader names, as the engine's
 *    `toggleFlow` does (runtime does not depend on service-automation; the
 *    engine's own half, that a refused write moves nothing in process, is
 *    pinned in that package's `flow-activation-ledger.test.ts`).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ObjectStoreMetadataActivationStore } from '@objectstack/core';
import { ObjectQL, ObjectStoreActionActivationStore } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMetadataActivation } from '@objectstack/platform-objects/system';

import { createDispatcherPlugin } from '../dispatcher-plugin.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import { bindTestSecurityCatalog } from '../security/security-catalog.testkit.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const PREFIX = '/api/v1';
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const LEDGER = 'sys_metadata_activation';
const SYSTEM = { isSystem: true, positions: [], permissions: [] };

/** The package the loader names for the flow, as `packagedFlowOwner` does. */
const FLOW_PACKAGE = 'com.example.app183';
const FLOW = 'app183_switch';
const POSITION = 'sales_rep';
const POSITION_PACKAGE = 'crm';
const ACTION_OBJECT = 'udoc';
const ACTION = 'approve_doc';

const UDOC = {
    name: ACTION_OBJECT,
    label: 'Doc',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
    actions: [{ name: ACTION, label: 'Approve', type: 'script', target: ACTION }],
};

const liveEngines: ObjectQL[] = [];
afterAll(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});
afterEach(() => { vi.restoreAllMocks(); });

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
    };
}

function makeRes() {
    const res: any = {
        statusCode: undefined as number | undefined,
        body: undefined as any,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: any) { res.body = b; return res; },
        end() { return res; },
    };
    return res;
}

interface Rig {
    engine: ObjectQL;
    handlers: Record<string, (req: any, res: any) => any>;
}

async function boot(): Promise<Rig> {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const o of [UDOC, SysMetadataActivation]) engine.registry.registerObject(o as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as any);
    bindTestSecurityCatalog(engine, {
        positions: [{ name: POSITION, permissionSets: ['sales_access'], _packageId: POSITION_PACKAGE }],
        permissions: [
            { name: 'sales_access', systemPermissions: ['cap_sales'] },
            { name: 'admin_full_access', systemPermissions: ['manage_metadata'] },
        ],
    });
    const ql = engine as any;
    ql.registerAction(ACTION_OBJECT, ACTION, async () => ({ ok: true }));
    const actionStore = new ObjectStoreActionActivationStore(ql);
    await actionStore.probe();
    ql.setActionActivationStore(actionStore);

    // Two rows naming no package for each item, stored before the package-less
    // index stood. Inserted through the engine, as the 18.3 store wrote them.
    for (const [metadataType, name] of [['flow', FLOW], ['position', POSITION], ['action', ACTION]] as const) {
        for (const [suffix, active] of [['a', false], ['b', true]] as const) {
            await engine.insert(LEDGER, { id: `${metadataType}_${suffix}`, metadata_type: metadataType, name, package_id: null, active }, { context: SYSTEM });
        }
    }

    const automation = {
        getFlow: async (name: string) => (name === FLOW ? { name, label: 'Switch', type: 'autolaunched', nodes: [], edges: [] } : null),
        // The engine's durable write, with the loader's package (see the module doc).
        toggleFlow: async (name: string, enabled: boolean) => {
            await new ObjectStoreMetadataActivationStore(ql, 'flow').setActive({ name, packageId: FLOW_PACKAGE, active: enabled });
        },
    };
    const services: Record<string, unknown> = { objectql: engine, data: engine, automation };
    const service = (name: string) => services[name];
    const kernel = { getService: service, getServiceAsync: async (name: string) => service(name) };
    const { server, handlers } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: PREFIX, securityHeaders: false });
    await plugin.start?.({
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? server : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {},
        on: () => {},
    } as any);
    return { engine, handlers };
}

/** The ledger rows of one item, in storage order, as the table holds them. */
async function ledgerRows(engine: ObjectQL, metadataType: string, name: string) {
    const rows = await engine.find(LEDGER, { where: { metadata_type: metadataType, name }, context: SYSTEM } as any);
    return (rows as any[]).map((r) => ({ id: r.id, package_id: r.package_id ?? null, active: r.active === true || r.active === 1 }));
}

/** The operator's remedy, in the database: delete the row that should not apply. */
async function deleteLedgerRow(engine: ObjectQL, id: string) {
    await (engine as any).getDriverForObject(LEDGER).execute(`DELETE FROM ${LEDGER} WHERE id = ?`, [id]);
}

interface Door {
    readonly label: string;
    readonly metadataType: string;
    readonly name: string;
    /** The package the door's write names: on all three, the package that ships the item. */
    readonly writesPackage: string;
    readonly route: string;
    readonly params: Record<string, string>;
}

const DOORS: readonly Door[] = [
    {
        label: 'POST /automation/:name/toggle (flow)',
        metadataType: 'flow', name: FLOW, writesPackage: FLOW_PACKAGE,
        route: `POST ${PREFIX}/automation/:name/toggle`, params: { name: FLOW },
    },
    {
        label: 'POST /security/_activation/:type/:name (catalog)',
        metadataType: 'position', name: POSITION, writesPackage: POSITION_PACKAGE,
        route: `POST ${PREFIX}/security/_activation/:type/:name`, params: { type: 'position', name: POSITION },
    },
    {
        label: 'POST /actions/_activation/:object/:action (action)',
        // The object's registering package ships the action (`shippingPackageOf`).
        metadataType: 'action', name: ACTION, writesPackage: TEST_PACKAGE_ID,
        route: `POST ${PREFIX}/actions/:object/:action/:recordId`, params: { object: '_activation', action: ACTION_OBJECT, recordId: ACTION },
    },
];

describe('the activation doors refuse a switch over two package-less rows for its item, and write nothing', () => {
    let rig: Rig;

    beforeAll(async () => {
        rig = await boot();
    }, 60_000);

    const send = async (door: Door, enabled: boolean) => {
        vi.spyOn(HttpDispatcher.prototype as any, 'timedResolveExecutionContext').mockResolvedValue({
            userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata'],
        });
        const handler = rig.handlers[door.route];
        expect(handler, `${door.route} must be mounted`).toBeTypeOf('function');
        const res = makeRes();
        await handler({ params: door.params, query: {}, headers: {}, body: { enabled } }, res);
        return res as { statusCode: number | undefined; body: any };
    };

    for (const door of DOORS) {
        it(`${door.label}: 409 RESOURCE_CONFLICT naming both rows; then, one row deleted, the switch writes the row left`, async () => {
            const before = await ledgerRows(rig.engine, door.metadataType, door.name);
            expect(before.map((r) => r.package_id)).toEqual([null, null]);

            for (const enabled of [false, true]) {
                const res = await send(door, enabled);

                // Nothing was written: no row gained a package, no switch moved.
                // Read first, so a regression's failure shows the row it bound.
                expect(await ledgerRows(rig.engine, door.metadataType, door.name), JSON.stringify(res.body)).toEqual(before);
                expect(res.statusCode, JSON.stringify(res.body)).toBe(409);
                expect(res.body?.error?.code).toBe('RESOURCE_CONFLICT');
                expect(res.body?.error?.httpStatus).toBe(409);
                expect(res.body?.error?.message).toContain(`${door.metadataType}_a`);
                expect(res.body?.error?.message).toContain(`${door.metadataType}_b`);
            }

            await deleteLedgerRow(rig.engine, `${door.metadataType}_a`);
            const res = await send(door, false);

            expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
            expect(await ledgerRows(rig.engine, door.metadataType, door.name)).toEqual([
                { id: `${door.metadataType}_b`, package_id: door.writesPackage, active: false },
            ]);
        });
    }
});
