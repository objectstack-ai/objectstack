// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24546 — a resume body that carries BOTH `inputs` and `variables` is refused,
 * never resolved by dropping one of them.
 *
 * `variables` is an accepted alias of `inputs` on
 * `POST /automation/:name/runs/:runId/resume`, and the signal assembly reads
 * `b.inputs ?? b.variables`. A body carrying both therefore answered HTTP 200
 * `success:true` with the `variables` bag never read — measured on stock
 * showcase through `showcase_reassign_wizard`, whose `collect` screen declares
 * one field, `new_assignee`: the run completed with the `inputs` value, while
 * the `variables` bag held an undeclared `bogus_key` that, sent alone, is
 * refused `400 INVALID_SCREEN_INPUT`. The same silent-drop family the closed
 * key set (commit a4331227b, `automation-resume-envelope.test.ts`) and the
 * value-shape check (#9416, `automation-resume-value-shape.test.ts`) closed,
 * on the one pair of accepted keys that name the same thing.
 *
 * The lane's pick on the card: REFUSE, with the route's own `400
 * VALIDATION_FAILED` envelope (the shape its closed-set and value-shape
 * refusals already answer), naming both keys and the one to keep, with the
 * engine never consulted so the suspension stays parked for the retry.
 *
 * The scripted engine below plays the `collect` screen the card measured: it
 * judges the submitted bag against the declared `new_assignee` and refuses an
 * undeclared key with `INVALID_SCREEN_INPUT`, so each case reads what the
 * engine was actually handed. Its verdicts are the engine's own, pinned where
 * the engine lives (`service-automation`'s `screen-resume-validation.test.ts`);
 * this file pins only the door. Both directions are pinned, because a door that
 * refuses everything ships as green as a correct one: the both-keys body is
 * refused, and each key alone answers exactly as before.
 */

import { describe, it, expect, vi } from 'vitest';

import type { AutomationResult } from '@objectstack/spec/contracts';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';

const DECLARED_FIELDS = ['new_assignee'];

/**
 * The `collect` screen of `showcase_reassign_wizard`, scripted: one declared,
 * required field. An undeclared key is refused the way the engine refuses it;
 * a complete bag completes the run and echoes what was written.
 */
function makeDispatcher() {
    const resume = vi.fn(async (_runId: string, signal: { variables?: Record<string, unknown> }): Promise<AutomationResult> => {
        const bag = signal.variables ?? {};
        const undeclared = Object.keys(bag).filter((k) => !DECLARED_FIELDS.includes(k));
        if (undeclared.length > 0) {
            return {
                success: false,
                code: 'INVALID_SCREEN_INPUT',
                error: `Invalid screen input: Unknown screen field "${undeclared[0]}" — declared fields: 'new_assignee'`,
            } as AutomationResult;
        }
        if (bag.new_assignee === undefined) {
            return {
                success: false,
                code: 'INVALID_SCREEN_INPUT',
                error: 'Invalid screen input: Screen field "new_assignee" is required',
            } as AutomationResult;
        }
        return { success: true, output: { assignee: bag.new_assignee }, durationMs: 7 } as AutomationResult;
    });
    const services: Record<string, unknown> = { automation: { resume } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), resume };
}

const CTX = () => ({ request: {}, executionContext: { userId: 'user_1' } } as any);
const RESUME = '/showcase_reassign_wizard/runs/run_1/resume';

/** The card's measured body: both keys, the `variables` bag carrying an undeclared field. */
const CARD_BODY = {
    inputs: { new_assignee: 'inputs-win@example.com' },
    variables: { new_assignee: 'variables-lost@example.com', bogus_key: 1 },
};

/**
 * Drive the resume route with one body and report the refusal as the wire
 * would: the status is the one both dispatcher error exits derive for a thrown
 * validation failure carrying no `.status` of its own (#3918).
 */
async function refusalFor(body: unknown) {
    const { dispatcher, resume } = makeDispatcher();
    let thrown: unknown;
    let response: unknown;
    try {
        response = (await dispatcher.handleAutomation(RESUME, 'POST', body, CTX())).response;
    } catch (e) {
        thrown = e;
    }
    expect(
        thrown,
        `resume body ${JSON.stringify(body)} was accepted (answered ${JSON.stringify(response)}) instead of refused`,
    ).toBeDefined();
    const details = validationFailureDetails(thrown);
    const status =
        typeof (thrown as any)?.status === 'number' ? (thrown as any).status
        : details ? VALIDATION_FAILED_STATUS
        : 500;
    return { details, status, message: (thrown as Error).message, resume };
}

/** Drive the resume route to its answer and hand back what the engine received. */
async function answerFor(body: unknown) {
    const { dispatcher, resume } = makeDispatcher();
    const result = await dispatcher.handleAutomation(RESUME, 'POST', body, CTX());
    return { status: result.response?.status, error: result.response?.body?.error, resume };
}

// ─────────────────────────────────────────────────────────────────────────────
// Direction 1 — the refusal
// ─────────────────────────────────────────────────────────────────────────────

describe('#24546 — a body carrying both `inputs` and `variables` is refused', () => {
    it('refuses the card\'s measured body — 400 VALIDATION_FAILED, both keys located, engine never consulted', async () => {
        const r = await refusalFor(CARD_BODY);
        // The envelope: the route's own validation-failure shape, the one its
        // closed-set and value-shape refusals answer.
        expect(r.status).toBe(VALIDATION_FAILED_STATUS);
        expect(r.details?.code).toBe('VALIDATION_FAILED');
        // Located: BOTH keys named, each its own entry, with an ADR-0114
        // catalog code (`invalid_value`: rejected for a reason no other
        // member names — the value is well-shaped, its sibling is the problem).
        expect(r.details?.fields).toMatchObject([
            { field: 'inputs', code: 'invalid_value' },
            { field: 'variables', code: 'invalid_value' },
        ]);
        // The message names both keys and the one to keep.
        expect(r.message).toMatch(/`inputs`/);
        expect(r.message).toMatch(/`variables`/);
        expect(r.message).toMatch(/send `inputs` alone/);
        // The load-bearing half: nothing reached the engine, so the
        // suspension was not consumed and a corrected retry is legitimate.
        expect(r.resume).not.toHaveBeenCalled();
    });

    it.each([
        ['identical bags', { inputs: { new_assignee: 'ada' }, variables: { new_assignee: 'ada' } }],
        ['two empty bags', { inputs: {}, variables: {} }],
        ['both keys beside `output` and `branchLabel`', {
            inputs: { new_assignee: 'ada' },
            variables: { new_assignee: 'bob' },
            output: { comment: 'ok' },
            branchLabel: 'approve',
        }],
    ])('refuses %s too — the rule is "both keys present", never "the bags disagree"', async (_label, body) => {
        const r = await refusalFor(body);
        expect(r.status).toBe(VALIDATION_FAILED_STATUS);
        expect(r.details?.code).toBe('VALIDATION_FAILED');
        expect(r.details?.fields).toMatchObject([{ field: 'inputs' }, { field: 'variables' }]);
        expect(r.resume).not.toHaveBeenCalled();
    });

    it('keeps the earlier refusals first — an unknown key, then a mis-shaped value, each unchanged', async () => {
        // Ordering pin: the closed key set (commit a4331227b) and the value
        // shapes (#9416) still report exactly what they reported before, so
        // a body wrong in two ways gets the earlier correction first.
        const unknown = await refusalFor({ ...CARD_BODY, values: { x: 1 } });
        expect(unknown.details?.fields).toMatchObject([{ field: 'values', code: 'unknown_field' }]);

        const misShaped = await refusalFor({ inputs: 'a string', variables: { new_assignee: 'ada' } });
        expect(misShaped.details?.fields).toMatchObject([{ field: 'inputs', code: 'invalid_type' }]);
    });

    it('reads an `undefined` value as ABSENT — no conflict, the same reading as the value-shape check', async () => {
        // `JSON.stringify` drops such a key, so no HTTP caller can produce
        // one; the in-process spelling `{ inputs, variables: maybeUndefined }`
        // means "no variables".
        const { status, resume } = await answerFor({ inputs: { new_assignee: 'ada' }, variables: undefined });
        expect(status).toBe(200);
        expect(resume).toHaveBeenCalledWith('run_1', { variables: { new_assignee: 'ada' } });
    });

    it('escapes dispatch() as the recognized validation-failure shape', async () => {
        // dispatch() rethrows a domain's validation failure to the HTTP error
        // exits #3918 pinned (`dispatcher-validation-error.test.ts`: 400,
        // `error.code: 'VALIDATION_FAILED'`, `details.fields[]`).
        const { dispatcher, resume } = makeDispatcher();
        (dispatcher as any).timedResolveExecutionContext = async () => ({ userId: 'user_1' });
        let thrown: unknown;
        try {
            await dispatcher.dispatch(
                'POST', `/automation${RESUME}`,
                CARD_BODY, {}, {} as any,
            );
        } catch (e) {
            thrown = e;
        }
        expect(thrown, 'the refusal must reach the HTTP error exits').toBeDefined();
        expect(validationFailureDetails(thrown)?.code).toBe('VALIDATION_FAILED');
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([{ field: 'inputs' }, { field: 'variables' }]);
        expect(resume).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Direction 2 — the controls: either key ALONE answers exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

describe('#24546 — a body carrying one of the two keys is unaffected', () => {
    it('`variables` alone with an undeclared field — still the engine\'s 400 INVALID_SCREEN_INPUT', async () => {
        // The alias is live, not dead: sent alone, its bag reaches the engine
        // and is judged — which is what made dropping it in combination a
        // silent drop rather than a dead key.
        const { status, error, resume } = await answerFor({ variables: CARD_BODY.variables });
        expect(status).toBe(400);
        expect(error?.code).toBe('INVALID_SCREEN_INPUT');
        expect(error?.message).toMatch(/bogus_key/);
        expect(resume).toHaveBeenCalledWith('run_1', { variables: CARD_BODY.variables });
    });

    it('`variables` alone, valid — 200, the bag forwarded as the submission', async () => {
        const { status, resume } = await answerFor({ variables: { new_assignee: 'variables-only@example.com' } });
        expect(status).toBe(200);
        expect(resume).toHaveBeenCalledWith('run_1', { variables: { new_assignee: 'variables-only@example.com' } });
    });

    it('`inputs` alone, valid — 200, the bag forwarded as the submission', async () => {
        const { status, resume } = await answerFor({ inputs: { new_assignee: 'inputs-only@example.com' } });
        expect(status).toBe(200);
        expect(resume).toHaveBeenCalledWith('run_1', { variables: { new_assignee: 'inputs-only@example.com' } });
    });
});
