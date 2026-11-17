// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26474] `POST /automation/:name/toggle` hands the service who asked.
 *
 * The flow door called `toggleFlow(name, enabled)` with no caller, so the
 * activation-ledger row it writes, and that row's audit entry, named nobody.
 * `IAutomationService.toggleFlow` now declares `caller` (`{ userId }`, #26545):
 * a door that serves a person passes that person's id, and nothing else — no
 * positions, permissions or tenant, since the door has already judged the
 * caller's authority and the write itself runs elevated.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
// Paid at collection, not inside a clocked case: the dispatcher's package domain
// reaches it through a dynamic import (check:test-source-alias).
import '@objectstack/metadata';

function makeDispatcher() {
    const toggleFlow = vi.fn(async (_name: string, _on: boolean, _caller?: { userId?: string }) => undefined);
    const services: Record<string, unknown> = {
        automation: {
            getFlow: async (name: string) => (name === 'welcome_flow' ? { name, trigger: { type: 'manual' } } : null),
            toggleFlow,
        },
    };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), toggleFlow };
}

/** The toggle is a `manage_metadata` write (commit 266436a7f); the caller holds it. */
const ctxOf = (executionContext: Record<string, unknown>) => ({
    request: {},
    executionContext: { systemPermissions: ['manage_metadata'], ...executionContext },
}) as any;

describe('#26474 — the flow toggle door passes its caller to toggleFlow', () => {
    it('names the signed-in user, in both directions', async () => {
        const { dispatcher, toggleFlow } = makeDispatcher();
        const ctx = ctxOf({ userId: 'u_admin' });

        const off = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: false }, ctx);
        expect(off.response?.status).toBe(200);
        expect(toggleFlow).toHaveBeenLastCalledWith('welcome_flow', false, { userId: 'u_admin' });

        const on = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: true }, ctx);
        expect(on.response?.status).toBe(200);
        expect(toggleFlow).toHaveBeenLastCalledWith('welcome_flow', true, { userId: 'u_admin' });
    });

    it('passes the id and nothing else of the caller\'s context', async () => {
        const { dispatcher, toggleFlow } = makeDispatcher();
        const ctx = ctxOf({ userId: 'u_admin', positions: ['admin'], tenantId: 'org_1', isSystem: false });

        await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: false }, ctx);

        const caller = toggleFlow.mock.calls.at(-1)?.[2];
        expect(caller).toEqual({ userId: 'u_admin' });
    });
});

/**
 * [ADR-0126 §7.2] The 200 answer is the engine's state read back through
 * `getFlowRuntimeStates` (the reading `GET /_status` serves), never the
 * request echoed: the switch moves only the ledger bit, so a flow its own
 * status keeps off read `{enabled: true}` here and `enabled: false` there.
 * The stand-in's state is set apart from what toggleFlow was asked, so an echo
 * and a read-back answer differently.
 */
describe('[ADR-0126 §7.2] the toggle door answers the engine state, not the request', () => {
    function dispatcherWithState(stateEnabled: boolean | undefined, readsState = true) {
        const toggleFlow = vi.fn(async () => undefined);
        const getFlowRuntimeStates = vi.fn(() =>
            stateEnabled === undefined ? [] : [{ name: 'welcome_flow', enabled: stateEnabled, bound: stateEnabled }],
        );
        const services: Record<string, unknown> = {
            automation: {
                getFlow: async (name: string) => (name === 'welcome_flow' ? { name, trigger: { type: 'manual' } } : null),
                toggleFlow,
                ...(readsState ? { getFlowRuntimeStates } : {}),
            },
        };
        const resolve = (name: string) => services[name];
        const kernel: any = {
            getService: resolve,
            getServiceAsync: async (name: string) => resolve(name),
            context: { getService: resolve },
        };
        return { dispatcher: new HttpDispatcher(kernel), toggleFlow, getFlowRuntimeStates };
    }

    it('enable requested, the engine reads the flow off: 200 { enabled: false }, as GET /_status reads it', async () => {
        const { dispatcher, toggleFlow } = dispatcherWithState(false);
        const ctx = ctxOf({ userId: 'u_admin' });

        const on = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: true }, ctx);
        const status = await dispatcher.handleAutomation('/_status', 'GET', undefined, ctx);

        expect(toggleFlow).toHaveBeenLastCalledWith('welcome_flow', true, { userId: 'u_admin' });
        expect(on.response?.status).toBe(200);
        expect(on.response?.body?.data).toEqual({ name: 'welcome_flow', enabled: false });
        expect(status.response?.body?.data?.flows?.[0]?.enabled).toBe(on.response?.body?.data?.enabled);
    });

    it('disable requested, the engine reads the flow on: 200 { enabled: true }', async () => {
        const { dispatcher } = dispatcherWithState(true);

        const off = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: false }, ctxOf({ userId: 'u_admin' }));

        expect(off.response?.status).toBe(200);
        expect(off.response?.body?.data).toEqual({ name: 'welcome_flow', enabled: true });
    });

    it('CONTROL — engine state agrees with the request: the answer is that state', async () => {
        const { dispatcher, getFlowRuntimeStates } = dispatcherWithState(true);

        const on = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: true }, ctxOf({ userId: 'u_admin' }));

        expect(on.response?.body?.data).toEqual({ name: 'welcome_flow', enabled: true });
        expect(getFlowRuntimeStates).toHaveBeenCalled();
    });

    it('a service that does not implement the read keeps the legacy answer, the request echoed', async () => {
        const { dispatcher } = dispatcherWithState(undefined, false);

        const off = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: false }, ctxOf({ userId: 'u_admin' }));

        expect(off.response?.status).toBe(200);
        expect(off.response?.body?.data).toEqual({ name: 'welcome_flow', enabled: false });
    });
});
