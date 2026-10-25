// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `DELETE /automation/:name` for a flow that does not exist is `404
 * RESOURCE_NOT_FOUND`, the answer `POST /automation/:name/trigger` gives the
 * same name.
 *
 * It answered `200 { name, deleted: true }`: the engine's `unregisterFlow` is a
 * no-op for a name it does not hold, and the metadata protocol's
 * `deleteMetaItem` answers a name with no row `{ success: true, reset: false,
 * "… nothing to delete." }` — so the door reported a removal of something that
 * was never there. The door now asks the trigger door's `flowIsUnknown` probe,
 * and answers 404 only when the store removed nothing either: a flow whose row
 * is stored but which the engine does not hold (one that failed to register)
 * is still deletable here, as before.
 *
 * The protocol double answers in the real `deleteMetaItem`'s two receipt shapes
 * (`packages/metadata-protocol/src/protocol.ts`): `reset: false` when no row is
 * found, `reset: true` when a row was deleted.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';

const AUTHOR = () => ({
    request: {},
    executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata'] },
}) as any;

const NOTHING_TO_DELETE = (name: string) => ({ success: true, reset: false, message: `No flow '${name}' found — nothing to delete.` });
const ROW_DELETED = { success: true, reset: true };

function makeDispatcher(opts: { engine?: string[]; stored?: string[] } = {}) {
    const flows = new Map((opts.engine ?? ['welcome_flow']).map((n) => [n, { name: n, nodes: [], edges: [] }]));
    const stored = new Set(opts.stored ?? opts.engine ?? ['welcome_flow']);
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const registerFlow = vi.fn((name: string, def: any) => { flows.set(name, def); return def; });
    const execute = vi.fn(async () => ({ success: true, output: {} }));
    const deleteMetaItem = vi.fn(async ({ name }: { name: string }) => {
        if (!stored.has(name)) return NOTHING_TO_DELETE(name);
        stored.delete(name);
        return ROW_DELETED;
    });
    const services: Record<string, unknown> = {
        automation: { handlerReady: true, getFlow, unregisterFlow, registerFlow, execute },
        protocol: { deleteMetaItem, getMetaItems: async () => ({ items: [] }) },
    };
    const resolve = (name: string) => services[name];
    const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
    return { dispatcher: new HttpDispatcher(kernel), getFlow, unregisterFlow, deleteMetaItem, stored };
}

describe('DELETE /automation/:name — an unknown flow is 404, never 200 deleted', () => {
    it('answers 404 RESOURCE_NOT_FOUND naming the flow', async () => {
        const { dispatcher, getFlow } = makeDispatcher();

        const result = await dispatcher.handleAutomation('/no_such_flow_xyz', 'DELETE', undefined, AUTHOR(), undefined);

        expect(result.response?.status).toBe(404);
        expect(result.response?.body?.success).toBe(false);
        expect(result.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(result.response?.body?.error?.message).toContain('no_such_flow_xyz');
        expect(getFlow).toHaveBeenCalledWith('no_such_flow_xyz');
    });

    it('gives the trigger door\'s answer for the same name — status, code and message', async () => {
        const { dispatcher } = makeDispatcher();

        const removed = await dispatcher.handleAutomation('/no_such_flow_xyz', 'DELETE', undefined, AUTHOR(), undefined);
        const trigger = await dispatcher.handleAutomation('/no_such_flow_xyz/trigger', 'POST', {}, AUTHOR());

        expect(trigger.response?.status).toBe(404);
        const answer = (r: any) => ({ status: r.response?.status, code: r.response?.body?.error?.code, message: r.response?.body?.error?.message });
        expect(answer(removed)).toEqual(answer(trigger));
    });

    it('control: a flow the engine holds is still removed, 200 deleted', async () => {
        const { dispatcher, unregisterFlow, stored } = makeDispatcher();

        const result = await dispatcher.handleAutomation('/welcome_flow', 'DELETE', undefined, AUTHOR(), undefined);

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data).toMatchObject({ name: 'welcome_flow', deleted: true });
        expect(unregisterFlow).toHaveBeenCalledWith('welcome_flow');
        expect(stored.has('welcome_flow')).toBe(false);
    });

    it('control: a stored flow the engine does not hold is still deleted from the store, 200 deleted', async () => {
        const { dispatcher, deleteMetaItem, stored } = makeDispatcher({ engine: [], stored: ['broken_flow'] });

        const result = await dispatcher.handleAutomation('/broken_flow', 'DELETE', undefined, AUTHOR(), undefined);

        expect(result.response?.status).toBe(200);
        expect(deleteMetaItem).toHaveBeenCalledWith({ type: 'flow', name: 'broken_flow' });
        expect(stored.has('broken_flow')).toBe(false);
    });
});
