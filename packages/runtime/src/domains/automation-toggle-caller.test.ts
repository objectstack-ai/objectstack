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
