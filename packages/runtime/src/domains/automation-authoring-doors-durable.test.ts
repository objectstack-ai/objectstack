// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20862, ADR-0126 §2, ADR-0131 D6] The `/automation` definition doors persist
 * what they register — through the ONE path the clone door uses
 * (`registerAndSaveFlow`): the engine registers the definition, then the
 * metadata protocol's own `saveMetaItem` saves it as a tenant row, env-wide.
 *
 * ## What this pins, at door level
 *
 *  - `POST /` and `PUT /:name` register the definition AND save that same
 *    definition through the protocol — type `flow`, no organization, no
 *    package, the default (live) save mode — engine first, store second;
 *  - a save that fails relays the store's own refusal and leaves no
 *    registration of its own: a create is withdrawn, and an update puts back
 *    the definition the engine held (it does not take the flow down with it);
 *  - an engine refusal is answered as before and nothing is saved;
 *  - the refusals in front stay in front: a packaged name is refused as a
 *    locked base and a definition claiming a package is refused, and neither
 *    reaches the engine or the store;
 *  - `DELETE /:name` unregisters AND deletes the tenant row, so a flow the
 *    create door saved does not come back at the next boot; a delete that
 *    fails puts the definition back, and the engine's own removal refusal is
 *    raised before the store is touched;
 *  - a composition with no metadata protocol keeps the engine-only
 *    registration and removal it always had — there is no store to persist
 *    into (the clone door's posture).
 *
 * Harness as in `automation-tenant-authored-write.test.ts`: a REAL protocol
 * over a REAL `SchemaRegistry` answers every verdict, with the packaged flow
 * registered the way an artifact loader registers it; the automation service
 * is a spy, and the store behind the protocol's save and delete is spied —
 * whether the saved row survives a cold boot is the showcase pin's subject
 * (`packages/qa/dogfood/test/automation-authoring-doors-durable.dogfood.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const PACKAGED = 'pkg_alert_flow';
const PACKAGE_ID = 'com.example.pkg';
const CUSTOMER = 'customer_flow';
const NEW = 'new_flow';

const definitionOf = (name: string, label = 'Original') =>
    ({ name, label, type: 'autolaunched', nodes: [], edges: [] });

const AUTHOR = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata'] },
} as HttpProtocolContext);

/** A refusal as the store raises one — an ADR-0112 envelope the door must relay as is. */
const storeRefusal = () => Object.assign(new Error('flow/x failed spec validation'), { code: 'INVALID_METADATA', status: 422 });

function boot({ protocol: mode = 'real' }: { protocol?: 'real' | 'absent' } = {}) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.registerItem('flow', definitionOf(PACKAGED), 'name', PACKAGE_ID);

    const flows = new Map<string, unknown>([
        [PACKAGED, definitionOf(PACKAGED)],
        [CUSTOMER, definitionOf(CUSTOMER)],
    ]);
    const registerFlow = vi.fn((name: string, definition: unknown) => {
        flows.set(name, definition);
        return definition;
    });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);

    const protocol = new ObjectStackProtocolImplementation(
        { registry, findOne: async () => null } as never,
        () => new Map(),
        undefined,
    );
    const saveMetaItem = vi.spyOn(protocol, 'saveMetaItem').mockResolvedValue({ success: true } as never);
    const deleteMetaItem = vi.spyOn(protocol, 'deleteMetaItem').mockResolvedValue({ success: true } as never);

    const services: Record<string, unknown> = {
        automation: { handlerReady: true, registerFlow, unregisterFlow, getFlow },
    };
    if (mode === 'real') services.protocol = protocol;
    const resolve = (name: string): unknown => services[name];
    const kernel = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };

    return {
        dispatcher: new HttpDispatcher(kernel as never),
        registerFlow, unregisterFlow, saveMetaItem, deleteMetaItem,
        held: (name: string) => flows.get(name),
    };
}

const statusOf = (response: any): unknown => response?.status;
const errorOf = (response: any): { code?: unknown } => response?.body?.error ?? {};
const dataOf = (response: any): any => response?.body?.data;

describe('[#20862] the create and update doors save what they register', () => {
    it('POST / registers the definition and saves the same definition through the protocol, env-wide, engine first', async () => {
        const h = boot();
        const body = definitionOf(NEW, 'Created');
        const { response } = await h.dispatcher.handleAutomation('', 'POST', body, AUTHOR(), undefined);

        expect(statusOf(response)).toBe(200);
        expect(dataOf(response)?.name).toBe(NEW);
        expect(h.registerFlow).toHaveBeenCalledWith(NEW, body);
        expect(h.saveMetaItem).toHaveBeenCalledTimes(1);
        expect(h.saveMetaItem).toHaveBeenCalledWith({ type: 'flow', name: NEW, item: body });
        expect(h.registerFlow.mock.invocationCallOrder[0]).toBeLessThan(h.saveMetaItem.mock.invocationCallOrder[0]!);
    });

    it('PUT /:name registers the full definition and saves it, the `{ definition }` envelope unwrapped', async () => {
        const h = boot();
        const definition = definitionOf(CUSTOMER, 'Updated');
        const { response } = await h.dispatcher.handleAutomation(`/${CUSTOMER}`, 'PUT', { definition }, AUTHOR(), undefined);

        expect(statusOf(response)).toBe(200);
        expect(h.registerFlow).toHaveBeenCalledWith(CUSTOMER, definition);
        expect(h.saveMetaItem).toHaveBeenCalledWith({ type: 'flow', name: CUSTOMER, item: definition });
        expect(h.held(CUSTOMER)).toEqual(definition);
    });

    it('a create whose save fails relays the store\'s refusal and is withdrawn from the engine', async () => {
        const h = boot();
        h.saveMetaItem.mockRejectedValueOnce(storeRefusal());

        const { response } = await h.dispatcher.handleAutomation('', 'POST', definitionOf(NEW), AUTHOR(), undefined);

        expect(statusOf(response)).toBe(422);
        expect(errorOf(response).code).toBe('INVALID_METADATA');
        expect(h.unregisterFlow).toHaveBeenCalledWith(NEW);
        expect(h.held(NEW)).toBeUndefined();
    });

    it('an update whose save fails relays the refusal and the engine gets back the definition it held', async () => {
        const h = boot();
        const before = h.held(CUSTOMER);
        h.saveMetaItem.mockRejectedValueOnce(storeRefusal());

        const { response } = await h.dispatcher.handleAutomation(
            `/${CUSTOMER}`, 'PUT', definitionOf(CUSTOMER, 'Not kept'), AUTHOR(), undefined,
        );

        expect(statusOf(response)).toBe(422);
        expect(errorOf(response).code).toBe('INVALID_METADATA');
        // Put back, not withdrawn: a refused update must not take the flow down.
        expect(h.unregisterFlow).not.toHaveBeenCalled();
        expect(h.registerFlow).toHaveBeenLastCalledWith(CUSTOMER, before);
        expect(h.held(CUSTOMER)).toBe(before);
    });

    it('an engine refusal is answered as before, and nothing is saved', async () => {
        const h = boot();
        h.registerFlow.mockImplementationOnce(() => { throw new Error("node 'n' (notify): unknown config key `x`"); });

        const { response } = await h.dispatcher.handleAutomation('', 'POST', definitionOf(NEW), AUTHOR(), undefined);

        expect(statusOf(response)).toBe(400);
        expect(errorOf(response).code).toBe('VALIDATION_FAILED');
        expect(h.saveMetaItem).not.toHaveBeenCalled();
    });

    it('the refusals in front stay in front: a packaged name and a claimed package reach neither the engine nor the store', async () => {
        const h = boot();

        const locked = await h.dispatcher.handleAutomation(`/${PACKAGED}`, 'PUT', definitionOf(PACKAGED, 'Edited'), AUTHOR(), undefined);
        expect(statusOf(locked.response)).toBe(403);
        expect(errorOf(locked.response).code).toBe('NOT_OVERRIDABLE');

        const claimed = await h.dispatcher.handleAutomation(
            '', 'POST', { ...definitionOf(NEW), _packageId: PACKAGE_ID, _provenance: 'package' }, AUTHOR(), undefined,
        );
        expect(statusOf(claimed.response)).toBe(422);
        expect(errorOf(claimed.response).code).toBe('INVALID_METADATA');

        expect(h.registerFlow).not.toHaveBeenCalled();
        expect(h.saveMetaItem).not.toHaveBeenCalled();
    });

    it('no metadata protocol in the composition: the definition is registered in the engine only, as before', async () => {
        const h = boot({ protocol: 'absent' });

        const { response } = await h.dispatcher.handleAutomation('', 'POST', definitionOf(NEW), AUTHOR(), undefined);

        expect(statusOf(response)).toBe(200);
        expect(h.held(NEW)).toEqual(definitionOf(NEW));
        expect(h.saveMetaItem).not.toHaveBeenCalled();
    });
});

describe('[#20862] the removal door keeps pace: DELETE removes the tenant row too', () => {
    it('DELETE /:name unregisters the flow, then deletes its row through the protocol, env-wide', async () => {
        const h = boot();

        const { response } = await h.dispatcher.handleAutomation(`/${CUSTOMER}`, 'DELETE', undefined, AUTHOR(), undefined);

        expect(statusOf(response)).toBe(200);
        expect(dataOf(response)).toEqual({ name: CUSTOMER, deleted: true });
        expect(h.unregisterFlow).toHaveBeenCalledWith(CUSTOMER);
        expect(h.deleteMetaItem).toHaveBeenCalledWith({ type: 'flow', name: CUSTOMER });
        expect(h.unregisterFlow.mock.invocationCallOrder[0]).toBeLessThan(h.deleteMetaItem.mock.invocationCallOrder[0]!);
    });

    it('a delete that fails relays the refusal and the engine gets the definition back', async () => {
        const h = boot();
        const before = h.held(CUSTOMER);
        h.deleteMetaItem.mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'ITEM_LOCKED', status: 403 }));

        const { response } = await h.dispatcher.handleAutomation(`/${CUSTOMER}`, 'DELETE', undefined, AUTHOR(), undefined);

        expect(statusOf(response)).toBe(403);
        expect(errorOf(response).code).toBe('ITEM_LOCKED');
        expect(h.registerFlow).toHaveBeenCalledWith(CUSTOMER, before);
        expect(h.held(CUSTOMER)).toBe(before);
    });

    it('the engine\'s own removal refusal is raised before the store is touched', async () => {
        const h = boot();
        h.unregisterFlow.mockImplementationOnce(() => {
            throw Object.assign(new Error('a packaged caller still reaches this subflow'), { code: 'DELETE_RESTRICTED', status: 409 });
        });

        await expect(
            h.dispatcher.handleAutomation(`/${CUSTOMER}`, 'DELETE', undefined, AUTHOR(), undefined),
        ).rejects.toMatchObject({ code: 'DELETE_RESTRICTED', status: 409 });
        expect(h.deleteMetaItem).not.toHaveBeenCalled();
    });

    it('no metadata protocol in the composition: the flow is removed from the engine only, as before', async () => {
        const h = boot({ protocol: 'absent' });

        const { response } = await h.dispatcher.handleAutomation(`/${CUSTOMER}`, 'DELETE', undefined, AUTHOR(), undefined);

        expect(statusOf(response)).toBe(200);
        expect(h.held(CUSTOMER)).toBeUndefined();
        expect(h.deleteMetaItem).not.toHaveBeenCalled();
    });
});
