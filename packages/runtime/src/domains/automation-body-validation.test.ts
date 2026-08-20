// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3899 ③ — the automation domain's silent-semantics bodies.
 *
 * Neither route carries a catalog `requestSchema` (the flow name rides the
 * path; the definitions have no wire schema), so they sit outside the
 * request-schema gate — but they were two of the issue's four worked examples
 * of the failure mode the gate exists for: a malformed body that does not 400
 * but EXECUTES DIFFERENT SEMANTICS.
 *
 *   - `POST /automation` ran `registerFlow(body?.name, body)`, so a definition
 *     with a missing/mistyped `name` registered under the key `undefined` —
 *     200, body echoed, flow unreachable forever.
 *   - `POST /automation/:name/toggle` read `body?.enabled ?? true`, so
 *     `{"enable": false}` — one letter off from "switch it OFF" — switched the
 *     flow ON and answered 200 `{enabled: true}`.
 *
 * The thrown shape here is the same duck-typed validation failure both HTTP
 * error exits map to `400 VALIDATION_FAILED` (`dispatcher-validation-error
 * .test.ts`, #3918).
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails } from '../validation-failure.js';

function makeDispatcher() {
    const spies = {
        registerFlow: vi.fn(),
        toggleFlow: vi.fn(async () => undefined),
        execute: vi.fn(async () => ({ success: true })),
    };
    const services: Record<string, unknown> = { automation: spies };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), spies };
}

/**
 * [#10145] The caller carries `manage_metadata` — the ADR-0066 D1 authoring
 * capability the `/automation` definition writes (`POST /`, `PUT /:name`,
 * `DELETE /:name`) now demand, the same gate the sibling `/meta` and
 * `/packages` writes already carry.
 *
 * The cases below are about BODY VALIDATION — which malformed shapes are
 * refused, with which field codes. They were written when any
 * authenticated session could register a flow, i.e. their `{ userId: 'user_1' }`
 * stub encoded exactly the premise the gate destroys, so without a capability
 * they would now stop at the 403 before reaching the behaviour each one is named
 * after. Only the CALLER changes here; every mechanism, assertion and expected
 * value is untouched. The gate itself is pinned in
 * `automation-write-capability-gate.test.ts`.
 */
const CTX = { request: {}, executionContext: { userId: 'user_1', systemPermissions: ['manage_metadata'] } } as any;

async function expectValidationFailure(run: Promise<unknown>, label: string) {
    let thrown: unknown;
    try {
        await run;
    } catch (e) {
        thrown = e;
    }
    expect(thrown, `${label} was accepted instead of rejected`).toBeDefined();
    const details = validationFailureDetails(thrown);
    expect(details?.code).toBe('VALIDATION_FAILED');
    expect(details?.fields.length).toBeGreaterThan(0);
    return thrown as Error;
}

describe('#3899 ③ — POST /automation (registerFlow) requires a named definition', () => {
    it.each([
        ['missing name', { trigger: { type: 'manual' } }],
        ['empty name', { name: '   ' }],
        ['non-string name', { name: 42 }],
        ['array body', [{ name: 'f1' }]],
        ['string body', 'garbage'],
        ['null body', null],
    ])('rejects %s — a flow must never register under the key `undefined`', async (_label, body) => {
        const { dispatcher, spies } = makeDispatcher();
        await expectValidationFailure(
            dispatcher.handleAutomation('', 'POST', body, CTX),
            JSON.stringify(body),
        );
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('registers a named definition under its name', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const body = { name: 'welcome_flow', trigger: { type: 'manual' } };
        const result = await dispatcher.handleAutomation('', 'POST', body, CTX);
        expect(result.response?.status).toBe(200);
        expect(spies.registerFlow).toHaveBeenCalledWith('welcome_flow', body);
    });
});

describe('#3899 ③ — POST /automation/:name/toggle is { enabled?: boolean }, strictly', () => {
    it('rejects the one-letter-off key that used to ENABLE a flow being switched off', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const thrown = await expectValidationFailure(
            dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enable: false }, CTX),
            '{"enable": false}',
        );
        // The rejection names the offending key — the caller sent `enable`.
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([{ field: 'enable' }]);
        expect(spies.toggleFlow).not.toHaveBeenCalled();
    });

    it.each([
        ['string enabled', { enabled: 'false' }],
        ['numeric enabled', { enabled: 0 }],
        ['array body', [true]],
    ])('rejects %s — a truthy non-boolean must not silently enable', async (_label, body) => {
        const { dispatcher, spies } = makeDispatcher();
        await expectValidationFailure(
            dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', body, CTX),
            JSON.stringify(body),
        );
        expect(spies.toggleFlow).not.toHaveBeenCalled();
    });

    it('honours an explicit disable', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const result = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', { enabled: false }, CTX);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data ?? result.response?.body).toMatchObject({ enabled: false });
        expect(spies.toggleFlow).toHaveBeenCalledWith('welcome_flow', false);
    });

    it('keeps the documented legacy shape: an empty body enables', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const result = await dispatcher.handleAutomation('/welcome_flow/toggle', 'POST', undefined, CTX);
        expect(result.response?.status).toBe(200);
        expect(spies.toggleFlow).toHaveBeenCalledWith('welcome_flow', true);
    });
});

describe('#3899 ③ — PUT /automation/:name requires a definition object', () => {
    it.each([
        ['string body', 'garbage'],
        ['array body', [{}]],
        ['null body', null],
        ['array definition', { definition: ['not-a-flow'] }],
    ])('rejects %s', async (_label, body) => {
        const { dispatcher, spies } = makeDispatcher();
        await expectValidationFailure(
            dispatcher.handleAutomation('/welcome_flow', 'PUT', body, CTX),
            JSON.stringify(body),
        );
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('accepts a bare definition and the pre-existing { definition } envelope alike', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const definition = { trigger: { type: 'manual' } };

        const bare = await dispatcher.handleAutomation('/welcome_flow', 'PUT', definition, CTX);
        expect(bare.response?.status).toBe(200);
        expect(spies.registerFlow).toHaveBeenLastCalledWith('welcome_flow', definition);

        const wrapped = await dispatcher.handleAutomation('/welcome_flow', 'PUT', { definition }, CTX);
        expect(wrapped.response?.status).toBe(200);
        expect(spies.registerFlow).toHaveBeenLastCalledWith('welcome_flow', definition);
    });
});
