// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8796 — the resume body's OUTER envelope is a closed set.
 *
 * `POST /automation/:name/runs/:runId/resume` assembles its engine signal
 * field-by-field from the body — deliberately (#3801: never spread the body, or
 * a caller could forge the service-authority marker). What was missing was the
 * other half: nothing told the caller that the keys it sent were not among the
 * ones read. Measured on GA: `{"nodeId":"ask","values":{…}}` — no key of which
 * the route reads — answered HTTP 200 `success:true` with the screen submission
 * treated as EMPTY; the run completed and the submitted value never reached the
 * flow. Maintainer ruling 2026-08-15 (Option A, on #8796): an unknown top-level
 * key is refused, located, naming the offending key(s) and the accepted set —
 * exactly `inputs` / `variables` / `output` / `branchLabel`.
 *
 * The refusal is thrown as the same duck-typed validation failure the toggle
 * arm's closed set throws; both HTTP error exits map it to `400
 * VALIDATION_FAILED` + `details.fields[]` (#3918,
 * `dispatcher-validation-error.test.ts` pins that mapping end-to-end for both
 * exits). It is deliberately NOT `FLOW_FAILED`: the console treats 400
 * `FLOW_FAILED` as terminal — the engine consumed the suspension and ran
 * (#8684, objectui PR #4899) — while this refusal never reaches the engine and
 * the suspension stays live, so the caller can retry with a corrected body. It
 * sits with `INVALID_SIGNAL` / `INVALID_SCREEN_INPUT` on the retryable side.
 *
 * Both halves of the closed-set policy are pinned here (Route & surface
 * ownership rule 5): the refusal pin includes THE SERVICE WAS NEVER CALLED, and
 * the preservation pin asserts the arguments the service actually received for
 * a body made only of accepted keys.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails } from '../validation-failure.js';

function makeDispatcher() {
    const spies = {
        resume: vi.fn(async () => ({ success: true, output: {}, durationMs: 7 })),
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

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;

const RESUME = '/flow_a/runs/run_1/resume';

async function expectRefusal(run: Promise<unknown>, label: string) {
    let thrown: unknown;
    try {
        await run;
    } catch (e) {
        thrown = e;
    }
    expect(thrown, `${label} was accepted instead of refused`).toBeDefined();
    const details = validationFailureDetails(thrown);
    expect(details?.code).toBe('VALIDATION_FAILED');
    expect(details?.fields.length).toBeGreaterThan(0);
    return thrown as Error;
}

describe('#8796 — the resume body refuses an unknown top-level key', () => {
    it('refuses the measured GA body — both keys named, engine never consulted', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const thrown = await expectRefusal(
            dispatcher.handleAutomation(
                RESUME, 'POST',
                { nodeId: 'ask', values: { resolution: 'submitted via the wrong key' } },
                CTX,
            ),
            '{"nodeId":"ask","values":{…}}',
        );
        // Located: every offending key is named, each as its own field entry.
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([
            { field: 'nodeId', code: 'unknown_field' },
            { field: 'values', code: 'unknown_field' },
        ]);
        // The message names the offending keys AND the accepted set, so a
        // guessed `values` is corrected at authoring time.
        expect(thrown.message).toMatch(/`nodeId`/);
        expect(thrown.message).toMatch(/`values`/);
        expect(thrown.message).toMatch(/`inputs`/);
        expect(thrown.message).toMatch(/`variables`/);
        expect(thrown.message).toMatch(/`output`/);
        expect(thrown.message).toMatch(/`branchLabel`/);
        // The refusal pin's load-bearing half: the request never reached the
        // engine, so the suspension was not consumed and a corrected retry is
        // legitimate.
        expect(spies.resume).not.toHaveBeenCalled();
    });

    it('refuses a single guessed key and stays off FLOW_FAILED — the retryable side', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const thrown = await expectRefusal(
            dispatcher.handleAutomation(RESUME, 'POST', { values: { x: 1 } }, CTX),
            '{"values":{…}}',
        );
        // ⚠️ #8684 hazard pin: the console treats 400 FLOW_FAILED as terminal
        // (the wizard closes). This refusal leaves the suspension intact, so
        // it must never wear that code.
        expect((thrown as any).code).toBe('VALIDATION_FAILED');
        expect((thrown as any).code).not.toBe('FLOW_FAILED');
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([{ field: 'values' }]);
        expect(spies.resume).not.toHaveBeenCalled();
    });

    it('refuses a half-wrong body — a valid `inputs` does not buy an unknown sibling through', async () => {
        // Option B (refuse only when NOTHING is recognized) was explicitly
        // declined: the half-wrong body must not be silently half-dropped.
        const { dispatcher, spies } = makeDispatcher();
        const thrown = await expectRefusal(
            dispatcher.handleAutomation(
                RESUME, 'POST',
                { inputs: { resolution: 'real value' }, values: { resolution: 'stray' } },
                CTX,
            ),
            '{"inputs":{…},"values":{…}}',
        );
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([{ field: 'values' }]);
        // Ordering (#3899): the envelope refusal precedes every engine verdict
        // — permission, signal, screen-input — because the engine is never
        // consulted on an illegal body.
        expect(spies.resume).not.toHaveBeenCalled();
    });

    it('refuses a non-empty array body — indices are not accepted keys', async () => {
        const { dispatcher, spies } = makeDispatcher();
        await expectRefusal(
            dispatcher.handleAutomation(RESUME, 'POST', [{ inputs: {} }], CTX),
            '[{"inputs":{}}]',
        );
        expect(spies.resume).not.toHaveBeenCalled();
    });

    it('escapes dispatch() as the recognized validation-failure shape', async () => {
        // dispatch()'s catch rethrows non-permission errors on purpose — the
        // HTTP envelope is built by the error exits #3918 pinned
        // (`dispatcher-validation-error.test.ts`, both exits: 400,
        // `error.code: 'VALIDATION_FAILED'`, `details.fields[]`). This pins
        // that the refusal arrives at those exits as the shape they recognise,
        // with the service still never called.
        const { dispatcher, spies } = makeDispatcher();
        (dispatcher as any).timedResolveExecutionContext = async () => ({ userId: 'user_1' });
        let thrown: unknown;
        try {
            await dispatcher.dispatch(
                'POST', '/automation/flow_a/runs/run_1/resume',
                { nodeId: 'ask', values: {} }, {}, {} as any,
            );
        } catch (e) {
            thrown = e;
        }
        expect(thrown, 'the refusal must reach the HTTP error exits').toBeDefined();
        expect(validationFailureDetails(thrown)?.code).toBe('VALIDATION_FAILED');
        expect(spies.resume).not.toHaveBeenCalled();
    });
});

describe('#8796 — a body made only of accepted keys is unaffected', () => {
    it('forwards all four accepted keys exactly as before', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const result = await dispatcher.handleAutomation(
            RESUME, 'POST',
            {
                inputs: { new_assignee: 'ada' },
                output: { comment: 'ok' },
                branchLabel: 'approve',
            },
            CTX,
        );
        expect(result.response?.status).toBe(200);
        // The preservation pin: the arguments the service actually received —
        // #3801's field-by-field assembly, byte-for-byte what it always sent.
        expect(spies.resume).toHaveBeenCalledWith('run_1', {
            variables: { new_assignee: 'ada' },
            output: { comment: 'ok' },
            branchLabel: 'approve',
        });
    });

    it('keeps the `variables` alias working', async () => {
        const { dispatcher, spies } = makeDispatcher();
        const result = await dispatcher.handleAutomation(
            RESUME, 'POST', { variables: { note: 'hi' } }, CTX,
        );
        expect(result.response?.status).toBe(200);
        expect(spies.resume).toHaveBeenCalledWith('run_1', { variables: { note: 'hi' } });
    });

    it.each([
        ['empty object', {}],
        ['undefined body', undefined],
        ['null body', null],
    ])('still accepts %s as an empty submission', async (_label, body) => {
        // An empty submission is a legal one (a screen whose declared fields
        // are all optional) — the closed set refuses unknown KEYS, it does not
        // demand keys exist.
        const { dispatcher, spies } = makeDispatcher();
        const result = await dispatcher.handleAutomation(RESUME, 'POST', body, CTX);
        expect(result.response?.status).toBe(200);
        expect(spies.resume).toHaveBeenCalledWith('run_1', {});
    });
});
