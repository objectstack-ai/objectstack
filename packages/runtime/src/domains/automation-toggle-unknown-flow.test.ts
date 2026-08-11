// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7535 — `POST /automation/:name/toggle` against a flow that does not exist.
 *
 * It answered **500 INTERNAL_ERROR**. The engine's `toggleFlow` throws a plain
 * `Error("Flow '<name>' not found")` for an unregistered name; the error
 * carries no `.status`, so both dispatcher error exits fell back to 500 — the
 * server-fault bucket — for a mistake that is entirely the caller's.
 *
 * The consequence is not cosmetic. Clients and retry layers branch on the
 * class: 5xx means "the server broke, try again", 4xx means "your request was
 * wrong, don't". A typo'd flow name presented as a transient server fault, so
 * a retry-on-5xx client re-sent a request that can never succeed.
 *
 * The bar is the neighbour on the same endpoint: `{ enabled?: boolean }` is
 * strict, and `{"enable": false}` — one letter off — is a LOCATED 400 naming
 * the offending key rather than a silent enable (#3899). The missing-flow arm
 * now answers in kind: 404 in the house envelope, naming the flow.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails } from '../validation-failure.js';

/**
 * An automation service holding exactly the flows it is given — the shape the
 * real engine presents: `getFlow` resolves `null` for an unknown name and
 * `toggleFlow` THROWS for one (`engine.ts`: `if (!this.flows.has(name)) throw`).
 * Modelling the throw is the point: a fake that quietly succeeded would pass
 * whether or not the handler ever checks.
 */
function makeDispatcher(flowNames: string[] = ['welcome_flow']) {
    const flows = new Map<string, { name: string; trigger: { type: string } }>(
        flowNames.map((n) => [n, { name: n, trigger: { type: 'manual' } }]),
    );
    const enabled = new Map<string, boolean>();
    const spies = {
        getFlow: vi.fn(async (name: string) => flows.get(name) ?? null),
        toggleFlow: vi.fn(async (name: string, on: boolean) => {
            if (!flows.has(name)) throw new Error(`Flow '${name}' not found`);
            enabled.set(name, on);
        }),
    };
    const services: Record<string, unknown> = { automation: spies };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), spies, enabled };
}

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;

describe('#7535 — toggling a flow that does not exist is 404, not 500', () => {
    it('answers 404 in the house error envelope, naming the unknown flow', async () => {
        const { dispatcher, spies } = makeDispatcher();

        const result = await dispatcher.handleAutomation(
            '/definitely_not_a_flow/toggle',
            'POST',
            { enabled: false },
            CTX,
        );

        expect(result.handled).toBe(true);
        // The class, which is the whole defect: a caller mistake, not a fault.
        expect(result.response?.status).toBe(404);

        const error = result.response?.body?.error;
        expect(result.response?.body?.success).toBe(false);
        // House envelope (`error-envelope.ts`): a SEMANTIC code, never the
        // number, plus the status mirrored onto the body.
        expect(error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(error?.httpStatus).toBe(404);
        // Named, the way the body rejection names the offending key (#3899) —
        // a bare "not found" leaves the caller to guess which of path, flow or
        // route the server could not resolve.
        expect(error?.message).toContain('definitely_not_a_flow');

        // Refused before the service was asked to mutate anything.
        expect(spies.toggleFlow).not.toHaveBeenCalled();
    });

    it('does not reach 500 by any other route — no retry-on-5xx client is provoked', async () => {
        const { dispatcher } = makeDispatcher();
        for (const body of [{ enabled: true }, { enabled: false }, undefined]) {
            const result = await dispatcher.handleAutomation('/nope/toggle', 'POST', body, CTX);
            expect(result.response?.status, JSON.stringify(body ?? null)).toBe(404);
        }
    });

    it('still toggles a real flow, in both directions', async () => {
        const { dispatcher, spies, enabled } = makeDispatcher();

        const off = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: false }, CTX);
        expect(off.response?.status).toBe(200);
        expect(off.response?.body?.data ?? off.response?.body).toMatchObject({ name: 'welcome_flow', enabled: false });
        expect(spies.toggleFlow).toHaveBeenLastCalledWith('welcome_flow', false);
        expect(enabled.get('welcome_flow')).toBe(false);

        const on = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: true }, CTX);
        expect(on.response?.status).toBe(200);
        expect(spies.toggleFlow).toHaveBeenLastCalledWith('welcome_flow', true);
        expect(enabled.get('welcome_flow')).toBe(true);

        // The documented legacy shape: a bodyless toggle enables.
        const legacy = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', undefined, CTX);
        expect(legacy.response?.status).toBe(200);
        expect(spies.toggleFlow).toHaveBeenLastCalledWith('welcome_flow', true);
    });

    it('leaves #3899 strict-body validation intact — a bad body is still a located 400', async () => {
        const { dispatcher, spies } = makeDispatcher();

        let thrown: any;
        try {
            await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enable: false }, CTX);
        } catch (e) {
            thrown = e;
        }
        expect(thrown, '{"enable": false} was accepted').toBeDefined();
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([{ field: 'enable' }]);
        expect(spies.toggleFlow).not.toHaveBeenCalled();
    });

    it('checks the body BEFORE the registry — a malformed body never triggers a lookup', async () => {
        // Order matters for more than tidiness: #3899's guarantee is that
        // nothing reaches the service until the body is legal. An existence
        // probe running first would consult the registry on a request the
        // handler is about to refuse anyway.
        const { dispatcher, spies } = makeDispatcher();

        await expect(
            dispatcher.handleAutomation('/definitely_not_a_flow/toggle', 'POST', { enabled: 'false' }, CTX),
        ).rejects.toThrow();

        expect(spies.getFlow).not.toHaveBeenCalled();
        expect(spies.toggleFlow).not.toHaveBeenCalled();
    });

    it('an implementation without `getFlow` is unchanged — the probe is optional on the contract', async () => {
        // `getFlow?` is optional on `IAutomationService`. A service that omits
        // it cannot be asked whether a flow exists, so the toggle proceeds
        // exactly as it did before rather than this inventing a 404.
        const toggleFlow = vi.fn(async () => undefined);
        const services: Record<string, unknown> = { automation: { toggleFlow } };
        const resolve = (name: string) => services[name];
        const kernel: any = {
            getService: resolve,
            getServiceAsync: async (name: string) => resolve(name),
            context: { getService: resolve },
        };
        const dispatcher = new HttpDispatcher(kernel);

        const result = await dispatcher.handleAutomation('/whatever/toggle', 'POST', { enabled: false }, CTX);
        expect(result.response?.status).toBe(200);
        expect(toggleFlow).toHaveBeenCalledWith('whatever', false);
    });
});
