// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23292, ADR-0048] Which `sys_metadata` row the `/automation` definition
 * doors write: `POST /`, `PUT /:name` and the copy `POST /:name/clone` writes,
 * all through `registerAndSaveFlow`, which saves through the protocol's
 * `saveMetaItem` naming no package.
 *
 * ## Why no package is named
 *
 * A row is keyed by its package, so one flow name can hold one row per
 * package. A save that names none is resolved by the protocol: the one
 * package's row when the flow's active rows are bound to exactly one, else the
 * package-unbound row; a name two packages hold is refused
 * `409 RESOURCE_CONFLICT`, because choosing one of them is the driver-order
 * coin toss that refusal exists to stop. The door could only name a package it
 * already holds, and none of the three does:
 *
 *  - `POST /` and `PUT /:name` take a definition and a path. The one
 *    package-shaped thing either reaches is a `_packageId` stamp: on the
 *    caller's body (the caller's bytes; read as an address, the body would be
 *    a package selector the door never declared), or on the definition the
 *    engine holds. For a name two packages hold, the latter is the contender
 *    the boot bind armed by arrival order. Measured below in both seed orders:
 *    the protocol's execution view lists the two rows in opposite orders, so
 *    the engine holds a different package's stamp in each.
 *  - The clone writes a NEW name, and drops the source's protection envelope
 *    `_packageId` included (ADR-0126 §7.1): the source's package is not the
 *    target's.
 *
 * So what this pins is the protocol's resolution, reached through the door:
 *
 *  - a flow one package holds is saved to that package's row only;
 *  - a flow no package holds is saved to the package-unbound row;
 *  - a flow two packages hold is refused `409 RESOURCE_CONFLICT` at each of
 *    the three call sites, in either seed order, whichever contender the
 *    engine holds: neither row changes, no package-unbound row is minted, and
 *    the engine is put back as it was (the definition it held re-registered,
 *    or the new name withdrawn).
 *
 * ## The rig
 *
 * A REAL store: better-sqlite3 `:memory:`, the real `ObjectQL` engine with the
 * real `sys_metadata*` objects, and a real `ObjectStackProtocolImplementation`,
 * so every verdict is the protocol's and every claim is read back from the
 * rows. The two packages are installed writable bases, and the two-package
 * state is reached through the dispatcher's own `PUT /meta/flow/:name?package=`
 * door. Every request goes through `HttpDispatcher.dispatch()`, the identity
 * step the one stubbed seam (as `meta-save-actor.test.ts` drives it). The
 * automation engine is a map, as in the sibling door suites: the engine's
 * validation is not the subject, and its double arms the contender the boot
 * bind arms (the first one the protocol's execution view lists).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { HttpDispatcher } from '../http-dispatcher.js';

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const ALPHA = 'com.qa.alpha';
const BETA = 'com.qa.beta';
const SHARED = 'shared_flow';

const AUTHOR = { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata'] };

const flowOf = (name: string, label: string) => ({ name, label, type: 'autolaunched', nodes: [], edges: [] });

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

interface Answer { status: number | undefined; code: unknown }

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
    // Two installed, writable bases: no read-only manifest scope, and no code package booted them.
    engine.registry.installPackage({ id: ALPHA, name: ALPHA, namespace: 'alpha', version: '1.0.0', type: 'app' } as any);
    engine.registry.installPackage({ id: BETA, name: BETA, namespace: 'beta', version: '1.0.0', type: 'app' } as any);
    const protocol = new ObjectStackProtocolImplementation(engine as any);

    const flows = new Map<string, unknown>();
    const registerFlow = vi.fn((name: string, definition: unknown) => { flows.set(name, definition); return definition; });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);
    const services: Record<string, unknown> = {
        protocol,
        automation: { handlerReady: true, registerFlow, unregisterFlow, getFlow },
    };
    const get = (name: string) => services[name] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (name: string) => get(name) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...AUTHOR });

    const call = async (method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<Answer> => {
        const res = await dispatcher.dispatch(method, path, body, query, { request: { headers: {} } } as any);
        return { status: res.response?.status, code: res.response?.body?.error?.code };
    };

    /** Every stored row of a flow, read back from the store, ordered by its package binding. */
    const rows = async (name: string): Promise<Array<Record<string, unknown>>> => {
        const found = (await engine.find('sys_metadata', {
            where: { type: 'flow', name },
            context: { isSystem: true },
        } as any)) ?? [];
        return [...found]
            .map((row: any) => ({ ...row, package_id: row.package_id ?? null }))
            .sort((a, b) => String(a.package_id).localeCompare(String(b.package_id)));
    };
    const bindings = async (name: string) => (await rows(name)).map((row) => row.package_id);
    const labelIn = async (name: string, packageId: string | null) => {
        const row = (await rows(name)).find((r) => r.package_id === packageId);
        return row ? JSON.parse(String(row.metadata)).label : undefined;
    };

    /** The flow as the boot bind arms it: the first contender the protocol's execution view lists. */
    const armFromStore = async (name: string) => {
        const view: any = await protocol.getMetaItemsForExecution({ type: 'flow' });
        const list: any[] = (Array.isArray(view) ? view : view?.items ?? []).map((entry: any) => entry?.item ?? entry);
        const contenders = list.filter((item) => item?.name === name);
        flows.set(name, contenders[0]);
        return { armed: contenders[0], contenders };
    };

    return { call, rows, bindings, labelIn, armFromStore, flows, registerFlow, unregisterFlow };
}

type Rig = Awaited<ReturnType<typeof boot>>;

/** A flow name two packages hold, reached through the `/meta` door naming each package in turn. */
async function twoPackageFlow(order: readonly string[]): Promise<Rig> {
    const rig = await boot();
    for (const packageId of order) {
        const saved = await rig.call('PUT', `/meta/flow/${SHARED}`, flowOf(SHARED, `Saved into ${packageId}`), { package: packageId });
        expect(saved.status, `PUT /meta/flow/${SHARED}?package=${packageId}`).toBe(200);
    }
    return rig;
}

describe('[#23292] a flow one package holds, or none: the door\'s save lands in that one row', () => {
    it('PUT /:name of a flow one package holds saves to that package\'s row only, and mints no package-unbound row', async () => {
        const rig = await boot();
        expect((await rig.call('PUT', '/meta/flow/solo_flow', flowOf('solo_flow', 'Saved into alpha'), { package: ALPHA })).status).toBe(200);
        await rig.armFromStore('solo_flow');

        const answer = await rig.call('PUT', '/automation/solo_flow', flowOf('solo_flow', 'Edited at the door'));

        expect(answer.status).toBe(200);
        expect(await rig.bindings('solo_flow')).toEqual([ALPHA]);
        expect(await rig.labelIn('solo_flow', ALPHA)).toBe('Edited at the door');
    }, 60_000);

    it('POST / of a flow no package holds saves the package-unbound row', async () => {
        const rig = await boot();

        const answer = await rig.call('POST', '/automation', flowOf('plain_flow', 'Created at the door'));

        expect(answer.status).toBe(200);
        expect(await rig.bindings('plain_flow')).toEqual([null]);
        expect(await rig.labelIn('plain_flow', null)).toBe('Created at the door');
    }, 60_000);
});

for (const order of [[ALPHA, BETA], [BETA, ALPHA]] as const) {
    describe(`[#23292] a flow two packages hold (saved into ${order[0]}, then ${order[1]}): refused 409 at every call site`, () => {
        it('the two-package state is reachable through the /meta door, and the engine holds one contender\'s package stamp', async () => {
            const rig = await twoPackageFlow(order);
            expect(await rig.bindings(SHARED)).toEqual([ALPHA, BETA]);

            const { armed, contenders } = await rig.armFromStore(SHARED);
            // Both rows are contenders; the one armed is the first listed, so
            // its stamp names one package of the two. The other seed order
            // lists the other one first: the stamp is a pick, not an address.
            expect(contenders.map((item) => item._packageId).sort()).toEqual([ALPHA, BETA]);
            expect([ALPHA, BETA]).toContain(armed._packageId);
        }, 60_000);

        it('PUT /:name: 409 RESOURCE_CONFLICT, neither row changes, and the engine gets back the definition it held', async () => {
            const rig = await twoPackageFlow(order);
            const { armed } = await rig.armFromStore(SHARED);
            const before = await rig.rows(SHARED);
            const edited = flowOf(SHARED, 'Edited at the door');

            const answer = await rig.call('PUT', `/automation/${SHARED}`, edited);

            expect(answer).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            expect(await rig.rows(SHARED)).toEqual(before);
            // Registered first, then put back: the refusal came from the save.
            expect(rig.registerFlow.mock.calls.map(([, definition]) => definition)).toEqual([edited, armed]);
            expect(rig.flows.get(SHARED)).toBe(armed);
        }, 60_000);

        it('POST / onto the name the engine holds (an overwrite): 409, neither row changes, the held definition is back', async () => {
            const rig = await twoPackageFlow(order);
            const { armed } = await rig.armFromStore(SHARED);
            const before = await rig.rows(SHARED);

            const answer = await rig.call('POST', '/automation', flowOf(SHARED, 'Posted at the door'));

            expect(answer).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            expect(await rig.rows(SHARED)).toEqual(before);
            expect(rig.flows.get(SHARED)).toBe(armed);
        }, 60_000);

        it('POST / of the name while the engine holds none: 409, neither row changes, and the name is withdrawn', async () => {
            const rig = await twoPackageFlow(order);
            const before = await rig.rows(SHARED);

            const answer = await rig.call('POST', '/automation', flowOf(SHARED, 'Posted at the door'));

            expect(answer).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            expect(await rig.rows(SHARED)).toEqual(before);
            expect(rig.registerFlow).toHaveBeenCalledTimes(1);
            expect(rig.unregisterFlow).toHaveBeenCalledWith(SHARED);
            expect(rig.flows.has(SHARED)).toBe(false);
        }, 60_000);

        it('POST /:name/clone onto the name: 409, neither row changes, and the clone is withdrawn', async () => {
            const rig = await twoPackageFlow(order);
            rig.flows.set('source_flow', flowOf('source_flow', 'Source'));
            const before = await rig.rows(SHARED);

            const answer = await rig.call('POST', '/automation/source_flow/clone', { name: SHARED, label: 'The clone' });

            expect(answer).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            expect(await rig.rows(SHARED)).toEqual(before);
            expect(rig.unregisterFlow).toHaveBeenCalledWith(SHARED);
            expect(rig.flows.has(SHARED)).toBe(false);
        }, 60_000);
    });
}
