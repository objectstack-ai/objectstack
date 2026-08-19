// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9416 — the resume body refuses a MIS-SHAPED VALUE on an accepted key, and a
 * body that is not a JSON object at all.
 *
 * #8796 closed the resume envelope's KEY set; this is the same silent-drop
 * family one axis over, on the VALUE. The assembly type-guarded each accepted
 * key and skipped whatever failed the guard, so `{"inputs":"a string"}` passed
 * the closed key set (the key IS accepted), lost its value, and answered HTTP
 * 200 `success:true` with the submission treated as EMPTY — the run completed
 * and the caller was told its screen input landed when nothing did. Identical
 * for `{"output":42}`, `{"branchLabel":7}`, a non-object JSON body, and an
 * EMPTY array body (a non-empty one was already refused, because its indices
 * read as unknown keys).
 *
 * Maintainer ruling on the card — **Option A**: refuse, 400, located, naming
 * the key and the expected type; non-object and array bodies refuse the same
 * way. It inherits #8796's ruling together with its reason, plus #3899's
 * toggle-arm precedent (a truthy non-boolean `enabled` is refused there, never
 * coerced or dropped). ⛔ Option B — forward the raw value and let the engine
 * judge — was rejected: `ResumeSignal` types `variables`/`output` as
 * `Record<string, unknown>` and `branchLabel` as `string`, so forwarding hands
 * a service a shape its own contract excludes.
 *
 * BOTH directions are pinned here, because a door that refuses everything ships
 * just as green as a correct one: every refused shape answers 400 naming the
 * key and the expected type, AND every currently-valid submission still
 * succeeds with byte-identical arguments at the service.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';

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

const CTX = () => ({ request: {}, executionContext: { userId: 'user_1' } } as any);
const RESUME = '/flow_a/runs/run_1/resume';

/**
 * Drive the resume route with one body and report the refusal as the wire
 * would: the status is the one both dispatcher error exits derive for a thrown
 * validation failure carrying no `.status` of its own (#3918).
 */
async function refusalFor(body: unknown) {
    const { dispatcher, spies } = makeDispatcher();
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
    return { details, status, message: (thrown as Error).message, code: (thrown as any).code, spies };
}

/** Drive the resume route to its 200 and hand back what the service received. */
async function acceptedFor(body: unknown) {
    const { dispatcher, spies } = makeDispatcher();
    const result = await dispatcher.handleAutomation(RESUME, 'POST', body, CTX());
    return { status: result.response?.status, spies };
}

// ─────────────────────────────────────────────────────────────────────────────
// Direction 1 — the refusal
// ─────────────────────────────────────────────────────────────────────────────

describe('#9416 — a type-mismatched value on an accepted key is refused, not dropped', () => {
    // The card's measured shapes, plus the two JSON values that used to vanish
    // most quietly: an explicit `null`, and an array (which the old
    // `typeof === "object"` guard forwarded to a contract that excludes it).
    const OBJECT_KEYS = ['inputs', 'variables', 'output'] as const;
    const NON_OBJECTS: Array<[string, unknown]> = [
        ['a string', 'a string'],
        ['a number', 42],
        ['a boolean', true],
        ['null', null],
        ['an array', [1, 2]],
    ];

    describe.each(OBJECT_KEYS)('`%s` must be an object', (key) => {
        it.each(NON_OBJECTS)('refuses %s — 400, located, naming the expected type', async (_label, value) => {
            const r = await refusalFor({ [key]: value });
            expect(r.status).toBe(VALIDATION_FAILED_STATUS);
            expect(r.details?.code).toBe('VALIDATION_FAILED');
            // Located: the offending key is named, with an ADR-0114 catalog code.
            expect(r.details?.fields).toMatchObject([{ field: key, code: 'invalid_type' }]);
            // …and the EXPECTED TYPE is named, in the field entry and the message.
            expect((r.details?.fields[0] as any).message).toMatch(/expected an object/);
            expect(r.message).toMatch(new RegExp(`\`${key}\``));
            expect(r.message).toMatch(/expected an object/);
            // The suspension was never consulted, so a corrected retry is legitimate.
            expect(r.spies.resume).not.toHaveBeenCalled();
        });
    });

    const NON_STRINGS: Array<[string, unknown]> = [
        ['a number', 7],
        ['a boolean', false],
        ['null', null],
        ['an object', { label: 'approve' }],
        ['an array', ['approve']],
    ];

    it.each(NON_STRINGS)('`branchLabel` must be a string — refuses %s', async (_label, value) => {
        const r = await refusalFor({ branchLabel: value });
        expect(r.status).toBe(VALIDATION_FAILED_STATUS);
        expect(r.details?.fields).toMatchObject([{ field: 'branchLabel', code: 'invalid_type' }]);
        expect((r.details?.fields[0] as any).message).toMatch(/expected a string/);
        expect(r.message).toMatch(/`branchLabel`/);
        expect(r.message).toMatch(/expected a string/);
        expect(r.spies.resume).not.toHaveBeenCalled();
    });

    it('names EVERY mis-shaped key, not just the first', async () => {
        const r = await refusalFor({ inputs: 'a string', output: 42, branchLabel: 7 });
        expect(r.details?.fields).toMatchObject([
            { field: 'inputs', code: 'invalid_type' },
            { field: 'output', code: 'invalid_type' },
            { field: 'branchLabel', code: 'invalid_type' },
        ]);
        expect(r.message).toMatch(/`inputs`/);
        expect(r.message).toMatch(/`output`/);
        expect(r.message).toMatch(/`branchLabel`/);
    });

    it('reports the received type too, so the caller sees what it sent', async () => {
        expect((await refusalFor({ inputs: 'x' })).message).toMatch(/received a string/);
        expect((await refusalFor({ output: 42 })).message).toMatch(/received a number/);
        expect((await refusalFor({ inputs: null })).message).toMatch(/received null/);
        expect((await refusalFor({ output: [] })).message).toMatch(/received an array/);
        expect((await refusalFor({ branchLabel: 7 })).message).toMatch(/received a number/);
    });

    it('stays off FLOW_FAILED — this refusal leaves the suspension live', async () => {
        // ⚠️ #8684 hazard pin: the console treats 400 FLOW_FAILED as terminal
        // (the wizard closes — objectui PR #4899). The engine was never
        // consulted here, so the pause is intact and the caller can retry.
        const r = await refusalFor({ inputs: 'a string' });
        expect(r.code).toBe('VALIDATION_FAILED');
        expect(r.code).not.toBe('FLOW_FAILED');
    });

    it('escapes dispatch() as the recognized validation-failure shape', async () => {
        const { dispatcher, spies } = makeDispatcher();
        (dispatcher as any).timedResolveExecutionContext = async () => ({ userId: 'user_1' });
        let thrown: unknown;
        try {
            await dispatcher.dispatch(
                'POST', '/automation/flow_a/runs/run_1/resume',
                { inputs: 'a string' }, {}, {} as any,
            );
        } catch (e) {
            thrown = e;
        }
        expect(thrown, 'the refusal must reach the HTTP error exits').toBeDefined();
        expect(validationFailureDetails(thrown)?.code).toBe('VALIDATION_FAILED');
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([{ field: 'inputs' }]);
        expect(spies.resume).not.toHaveBeenCalled();
    });

    it('refuses the mis-shaped value even when a sibling key is perfectly valid', async () => {
        // The half-wrong body must not be silently half-dropped — the same
        // reasoning #8796 used to decline "refuse only when nothing is
        // recognized".
        const r = await refusalFor({ inputs: { real: 'value' }, branchLabel: 7 });
        expect(r.details?.fields).toMatchObject([{ field: 'branchLabel', code: 'invalid_type' }]);
        expect(r.spies.resume).not.toHaveBeenCalled();
    });

    it('reports an unknown KEY ahead of a mis-shaped value — #8796 message unchanged', async () => {
        // Ordering pin: a body that is both misspelled and mis-shaped still
        // reports the misspelling, which is the correction the caller needs
        // first and the one #8796 pinned.
        const r = await refusalFor({ inputs: 'a string', values: { x: 1 } });
        expect(r.details?.fields).toMatchObject([{ field: 'values', code: 'unknown_field' }]);
        expect(r.message).toMatch(/`values`/);
    });
});

describe('#9416 — a body that is not a JSON object is refused', () => {
    const NON_OBJECT_BODIES: Array<[string, unknown]> = [
        ['a JSON string', 'a string'],
        ['a JSON number', 42],
        ['a JSON boolean', true],
        ['an EMPTY array', []],
    ];

    it.each(NON_OBJECT_BODIES)('refuses %s — 400 at `(body)`, naming the accepted keys', async (_label, body) => {
        const r = await refusalFor(body);
        expect(r.status).toBe(VALIDATION_FAILED_STATUS);
        expect(r.details?.code).toBe('VALIDATION_FAILED');
        // `(body)` is the root-level locator — a body of the wrong type has no
        // path to point at (`fieldsFromZodIssues`' own convention).
        expect(r.details?.fields).toMatchObject([{ field: '(body)', code: 'invalid_type' }]);
        expect(r.message).toMatch(/expected an object/);
        expect(r.message).toMatch(/`inputs`/);
        expect(r.message).toMatch(/`branchLabel`/);
        expect(r.spies.resume).not.toHaveBeenCalled();
    });

    it('refuses a NON-empty array too — the #8796 arm keeps working, now located at `(body)`', async () => {
        // Previously caught by the key check (indices read as unknown keys);
        // now caught one step earlier, by the shape it actually is.
        const r = await refusalFor([{ inputs: {} }]);
        expect(r.status).toBe(VALIDATION_FAILED_STATUS);
        expect(r.details?.fields).toMatchObject([{ field: '(body)', code: 'invalid_type' }]);
        expect(r.spies.resume).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Direction 2 — the half a regression does not redden: everything valid still
// works, with the arguments the service always received.
// ─────────────────────────────────────────────────────────────────────────────

describe('#9416 — every currently-valid submission still succeeds, unchanged', () => {
    it('forwards all four accepted keys exactly as before', async () => {
        const { status, spies } = await acceptedFor({
            inputs: { new_assignee: 'ada' },
            output: { comment: 'ok' },
            branchLabel: 'approve',
        });
        expect(status).toBe(200);
        expect(spies.resume).toHaveBeenCalledWith('run_1', {
            variables: { new_assignee: 'ada' },
            output: { comment: 'ok' },
            branchLabel: 'approve',
        });
    });

    it('keeps the `variables` alias, and `inputs` still wins when both are sent', async () => {
        const alias = await acceptedFor({ variables: { note: 'hi' } });
        expect(alias.status).toBe(200);
        expect(alias.spies.resume).toHaveBeenCalledWith('run_1', { variables: { note: 'hi' } });

        const both = await acceptedFor({ inputs: { a: 1 }, variables: { b: 2 } });
        expect(both.status).toBe(200);
        expect(both.spies.resume).toHaveBeenCalledWith('run_1', { variables: { a: 1 } });
    });

    it.each([
        ['empty object', {}],
        ['undefined body', undefined],
        ['null body', null],
    ])('still accepts %s as an empty submission', async (_label, body) => {
        // The bodyless resume is legal (a screen whose declared fields are all
        // optional). The refusal is about a value that is WRONG, never about a
        // value that is absent.
        const { status, spies } = await acceptedFor(body);
        expect(status).toBe(200);
        expect(spies.resume).toHaveBeenCalledWith('run_1', {});
    });

    it.each([
        ['an empty inputs object', { inputs: {} }, { variables: {} }],
        ['an empty output object', { output: {} }, { output: {} }],
        ['an empty-string branchLabel', { branchLabel: '' }, { branchLabel: '' }],
    ])('accepts %s — empty is a legal value of the right type', async (_label, body, expected) => {
        const { status, spies } = await acceptedFor(body);
        expect(status).toBe(200);
        expect(spies.resume).toHaveBeenCalledWith('run_1', expected);
    });

    it('treats an `undefined` value as ABSENT, not mis-shaped', async () => {
        // `JSON.stringify` drops such a key, so no HTTP caller can produce
        // one; the in-process spelling `{ inputs: maybeUndefined }` means "no
        // inputs" and must not become a 400.
        const { status, spies } = await acceptedFor({ inputs: undefined, branchLabel: undefined });
        expect(status).toBe(200);
        expect(spies.resume).toHaveBeenCalledWith('run_1', {});
    });

    it('still forwards the INNER bag verbatim — the engine, not the route, judges its contents', async () => {
        // The refusal is about the value's TYPE only. Reserved-name and
        // declared-field verdicts stay in the engine (#3853, #4477), at the one
        // place a signal reaches the variable map.
        const { status, spies } = await acceptedFor({
            inputs: { new_assignee: 'ada', 'collect.note': 'hi', price$: 3, nested: { deep: [1, 2] } },
            output: { decision: 'ok', $internal: true },
        });
        expect(status).toBe(200);
        expect(spies.resume).toHaveBeenCalledWith('run_1', {
            variables: { new_assignee: 'ada', 'collect.note': 'hi', price$: 3, nested: { deep: [1, 2] } },
            output: { decision: 'ok', $internal: true },
        });
    });
});
