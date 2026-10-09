// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The trigger door × a flow declared `runAs: 'system'`: a caller that is not
 * the system principal may not start one whose `type` is self-triggered
 * (`autolaunched`, `record_change`, `schedule`). The maintainer's ruling
 * (letter B) on the defect class "a self-triggered flow declared to run as
 * system could be started by any signed-in member through the trigger door".
 *
 * These are the DOOR-side pins, driven with a scripted automation service so
 * each one isolates the door's decision: `getFlow` serves the declaration the
 * door reads, and `execute` is a spy, so "never dispatched" is a fact about the
 * engine call rather than an inference from a status code. Both spellings of
 * the door run every case — they answer through one function, and a pin that
 * covered only the canonical one would let the legacy spelling (the one the SDK
 * calls) drift unnoticed.
 *
 * The end-to-end half — the real kernel, a real member, a real engine, the
 * elevated write that did or did not land, and a parent flow's `subflow` node
 * still reaching its elevated child — is `@objectstack/verify`'s
 * `automation-trigger-elevated-door.test.ts`, through `flows.run`.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';

/** A signed-in, non-system caller. */
const MEMBER = { request: {}, executionContext: { userId: 'user_1' } } as any;
/** The system principal: the in-process caller a job or an internal dispatch is. */
const SYSTEM = { request: {}, executionContext: { isSystem: true } } as any;

/** Both spellings of the same door. `path` takes the flow name. */
const ROUTES: Array<{ label: string; path: (flow: string) => string }> = [
    { label: 'POST /:name/trigger', path: (f) => `/${f}/trigger` },
    { label: 'legacy POST /trigger/:name', path: (f) => `/trigger/${f}` },
];

const REFUSED_TYPES = ['autolaunched', 'record_change', 'schedule'] as const;
const DOOR_TYPES = ['screen', 'api'] as const;

/**
 * An automation service holding exactly the flow declarations it is given
 * (`getFlow`, the probe the door reads), with `execute` as a spy answering a
 * completed run.
 */
function makeDispatcher(flows: Array<{ name: string; type: string; runAs?: string }>, opts: { omitGetFlow?: boolean } = {}) {
    const byName = new Map(flows.map((f) => [f.name, f]));
    const execute = vi.fn(async (_name: string, _context?: unknown) => ({ success: true, output: {} }));
    const getFlow = vi.fn(async (name: string) => byName.get(name) ?? null);
    const automation: Record<string, unknown> = opts.omitGetFlow ? { execute } : { execute, getFlow };
    const services: Record<string, unknown> = { automation };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), execute };
}

describe('a non-system caller is refused an elevated self-triggered flow at the trigger door', () => {
    for (const route of ROUTES) {
        for (const type of REFUSED_TYPES) {
            it(`${route.label}: type '${type}', runAs 'system' → 403 PERMISSION_DENIED, never dispatched`, async () => {
                const { dispatcher, execute } = makeDispatcher([{ name: 'elevated_flow', type, runAs: 'system' }]);

                const res = await dispatcher.handleAutomation(route.path('elevated_flow'), 'POST', {}, MEMBER);

                expect(res.handled).toBe(true);
                expect(res.response?.status).toBe(403);
                expect(res.response?.body?.success).toBe(false);
                expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
                expect(res.response?.body?.error?.httpStatus).toBe(403);
                // The refusal happens BEFORE dispatch: the engine was never
                // asked, so no run record and no node ran.
                expect(execute).not.toHaveBeenCalled();
            });
        }

        it(`${route.label}: the refusal discloses nothing of the flow — one answer for every refused type`, async () => {
            const messages: string[] = [];
            for (const type of REFUSED_TYPES) {
                const name = `secret_${type}_flow`;
                const { dispatcher } = makeDispatcher([{ name, type, runAs: 'system' }]);
                const res = await dispatcher.handleAutomation(route.path(name), 'POST', {}, MEMBER);
                // A refusal first — so the absence checks below cannot pass
                // over an answer that carries no message at all.
                expect(res.response?.status).toBe(403);
                const message = String(res.response?.body?.error?.message ?? '');
                expect(message.length).toBeGreaterThan(0);
                // Neither the flow's name, its type nor its run-as declaration.
                expect(message).not.toContain(name);
                expect(message).not.toContain(type);
                expect(message).not.toMatch(/runAs|'system'/);
                expect(res.response?.body?.error?.details).toBeUndefined();
                messages.push(message);
            }
            // Byte-identical across the three types: the answer carries no bit
            // the refusal itself does not.
            expect(new Set(messages).size).toBe(1);
        });
    }
});

describe('what stays exactly as it was', () => {
    for (const route of ROUTES) {
        for (const type of REFUSED_TYPES) {
            it(`${route.label}: the system principal still starts a '${type}' flow declared runAs 'system'`, async () => {
                const { dispatcher, execute } = makeDispatcher([{ name: 'elevated_flow', type, runAs: 'system' }]);

                const res = await dispatcher.handleAutomation(route.path('elevated_flow'), 'POST', {}, SYSTEM);

                expect(res.response?.status).toBe(200);
                expect(res.response?.body?.success).toBe(true);
                expect(execute).toHaveBeenCalledTimes(1);
                expect(execute.mock.calls[0]?.[0]).toBe('elevated_flow');
            });

            it(`${route.label}: a member still starts a '${type}' flow that does not declare runAs 'system'`, async () => {
                const { dispatcher, execute } = makeDispatcher([
                    { name: 'user_flow', type, runAs: 'user' },
                    // The scripted service may serve a declaration with no `runAs`
                    // at all (the parsed default is 'user'): not elevated either.
                    { name: 'bare_flow', type },
                ]);

                const asUser = await dispatcher.handleAutomation(route.path('user_flow'), 'POST', {}, MEMBER);
                const bare = await dispatcher.handleAutomation(route.path('bare_flow'), 'POST', {}, MEMBER);

                expect(asUser.response?.status).toBe(200);
                expect(bare.response?.status).toBe(200);
                expect(execute).toHaveBeenCalledTimes(2);
            });
        }

        for (const type of DOOR_TYPES) {
            it(`${route.label}: a member still starts a '${type}' flow declared runAs 'system' — a door its author designed`, async () => {
                const { dispatcher, execute } = makeDispatcher([{ name: 'door_flow', type, runAs: 'system' }]);

                const res = await dispatcher.handleAutomation(route.path('door_flow'), 'POST', {}, MEMBER);

                expect(res.response?.status).toBe(200);
                expect(res.response?.body?.success).toBe(true);
                expect(execute).toHaveBeenCalledTimes(1);
            });
        }

        it(`${route.label}: an unknown name still answers 404 — existence is asked first`, async () => {
            const { dispatcher, execute } = makeDispatcher([]);

            const res = await dispatcher.handleAutomation(route.path('no_such_flow'), 'POST', {}, MEMBER);

            expect(res.response?.status).toBe(404);
            expect(execute).not.toHaveBeenCalled();
        });

        it(`${route.label}: a service that cannot be asked for the declaration dispatches as before`, async () => {
            const { dispatcher, execute } = makeDispatcher([], { omitGetFlow: true });

            const res = await dispatcher.handleAutomation(route.path('any_flow'), 'POST', {}, MEMBER);

            expect(res.response?.status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(1);
        });
    }
});
