// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /automation/:name/runs` for a flow that does not exist is `404
 * RESOURCE_NOT_FOUND`, the answer `POST /automation/:name/trigger` gives the
 * same name.
 *
 * It answered `200 { runs: [], hasMore: false }` — the body a flow that exists
 * and has never run gets, so an SDK or AI caller could not tell "no such flow"
 * from "nothing yet". The door now asks the trigger door's own registry probe
 * (`flowIsUnknown`, `../flow-dispatch-status.ts`) before listing, and the
 * parity case below reads both doors side by side, so a future divergence
 * between them fails here.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;

/**
 * An automation slot holding exactly the flows it is given: `getFlow` resolves
 * `null` for an unknown name, as the real engine's does, and `listRunsPage`
 * answers an empty page for ANY name — the engine's run store does, which is
 * how the unknown name used to come back as a confident `[]`.
 */
function makeDispatcher(flowNames: string[] = ['welcome_flow']) {
    const flows = new Map(flowNames.map((n) => [n, { name: n }]));
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);
    const listRunsPage = vi.fn(async (_flowName: string, _options?: Record<string, unknown>) => ({
        runs: [] as unknown[],
        hasMore: false,
    }));
    const execute = vi.fn(async () => ({ success: true, output: {} }));
    const services: Record<string, unknown> = { automation: { getFlow, listRunsPage, execute, handlerReady: true } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), getFlow, listRunsPage, execute };
}

describe('GET /automation/:name/runs — an unknown flow is 404, never an empty page', () => {
    it('answers 404 RESOURCE_NOT_FOUND naming the flow, and never asks the run store', async () => {
        const { dispatcher, getFlow, listRunsPage } = makeDispatcher();

        const result = await dispatcher.handleAutomation('/no_such_flow_xyz/runs', 'GET', undefined, CTX, {});

        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(404);
        expect(result.response?.body?.success).toBe(false);
        expect(result.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(result.response?.body?.error?.message).toContain('no_such_flow_xyz');
        expect(getFlow).toHaveBeenCalledWith('no_such_flow_xyz');
        expect(listRunsPage).not.toHaveBeenCalled();
    });

    it('gives the trigger door\'s answer for the same name — status, code and message', async () => {
        const { dispatcher, execute } = makeDispatcher();

        const runs = await dispatcher.handleAutomation('/no_such_flow_xyz/runs', 'GET', undefined, CTX, {});
        const trigger = await dispatcher.handleAutomation('/no_such_flow_xyz/trigger', 'POST', {}, CTX);

        expect(trigger.response?.status).toBe(404);
        expect(execute).not.toHaveBeenCalled();
        expect({
            status: runs.response?.status,
            code: runs.response?.body?.error?.code,
            message: runs.response?.body?.error?.message,
        }).toEqual({
            status: trigger.response?.status,
            code: trigger.response?.body?.error?.code,
            message: trigger.response?.body?.error?.message,
        });
    });

    it('asks existence before the query: an unknown flow with a bad ?limit is still 404', async () => {
        const { dispatcher, listRunsPage } = makeDispatcher();

        const result = await dispatcher.handleAutomation('/no_such_flow_xyz/runs', 'GET', undefined, CTX, { limit: 'abc' });

        expect(result.response?.status).toBe(404);
        expect(result.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(listRunsPage).not.toHaveBeenCalled();
    });

    it('control: a flow that exists and has never run is still 200 with an empty page', async () => {
        const { dispatcher, listRunsPage } = makeDispatcher();

        const result = await dispatcher.handleAutomation('/welcome_flow/runs', 'GET', undefined, CTX, { limit: '5' });

        expect(result.response?.status).toBe(200);
        const data = result.response?.body?.data ?? result.response?.body;
        expect(data).toMatchObject({ runs: [], hasMore: false });
        expect(listRunsPage).toHaveBeenCalledWith('welcome_flow', expect.objectContaining({ limit: 5 }));
    });
});
