// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7300 — `GET /api/v1/automation/:name/runs`'s coerced query parameters.
 *
 * The filed defect is character-for-character #6928's, one file over:
 * `{ limit: query.limit ? Number(query.limit) : undefined, cursor: query.cursor }`.
 * `?limit=abc` was `NaN`, and nothing downstream catches it —
 * `AutomationEngine.listRuns` computes `options?.limit ?? 20` (`??` does not
 * catch NaN), passes NaN to `store.listHistory(flowName, NaN)`, and finishes on
 * `.slice(0, NaN)`, which is `[]`. So a typo in the window answered **200 with
 * an empty run list**: "this flow has never run", said with full confidence,
 * about a flow with runs. The `cursor` half was forwarded raw into a slot the
 * contract types `cursor?: string` (`IAutomationService.listRuns`).
 *
 * Two halves are asserted here, and the second constrains the fix hardest:
 *
 *  1. REFUSAL — a value the contract does not admit answers `400` with
 *     `error.code === 'VALIDATION_FAILED'` (ADR-0112) and a `details.fields[]`
 *     entry naming the parameter with an ADR-0114 field code. BOTH the code and
 *     the status are asserted on every refusal case, never a bare `toThrow()`:
 *     the unfixed handler does not throw for these inputs at all — it answers
 *     200 with the wrong list — so a throw-only assertion would be pinning the
 *     absence of a throw, which is not the defect. The defect is the missing
 *     envelope.
 *  2. PRESERVATION — every value that had a defensible answer before keeps it,
 *     byte for byte, at the exact `listRuns(name, options)` call. That includes
 *     out-of-RANGE numbers (`?limit=1000`), which `ListRunsRequestSchema` bounds
 *     and the engine slices by: range is the service's declared business and
 *     stays reachable, unrefused.
 *
 * The wire mapping of the thrown shape to `400` + `details.fields[]` is not
 * re-proved here — it is one mapping for every domain handler, pinned at both
 * dispatcher error exits by `dispatcher-validation-error.test.ts` and against
 * the real `ValidationError` by `dispatcher-validation-error.real.test.ts`
 * (#3918), and over a real socket for this identical thrown shape by
 * `notifications.hono.integration.test.ts` (#6928).
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';

/** An automation slot whose `listRuns` records exactly what it was asked for. */
function makeDispatcher() {
    const listRuns = vi.fn(async () => [{ id: 'run_1', flowName: 'welcome_flow', status: 'completed' }]);
    const services: Record<string, unknown> = { automation: { listRuns, handlerReady: true } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), listRuns };
}

const CTX = () => ({ request: {}, executionContext: { userId: 'user_1' } } as any);

/**
 * Drive `GET /automation/welcome_flow/runs` with a raw query object, the way the
 * HTTP layer delivers it (string values), and report the refusal as the wire
 * would: the status is the one both dispatcher error exits derive for a thrown
 * validation failure carrying no `.status` of its own (`errorFromThrown`,
 * `errorResponseBase` — #3918).
 */
async function refusalFor(query: Record<string, unknown>) {
    const { dispatcher, listRuns } = makeDispatcher();
    let thrown: unknown;
    let response: unknown;
    try {
        response = (await dispatcher.handleAutomation('welcome_flow/runs', 'GET', undefined, CTX(), query)).response;
    } catch (e) {
        thrown = e;
    }
    expect(thrown, `${JSON.stringify(query)} was accepted (answered ${JSON.stringify(response)}) instead of refused`)
        .toBeDefined();
    const details = validationFailureDetails(thrown);
    const status =
        typeof (thrown as any)?.status === 'number' ? (thrown as any).status
        : details ? VALIDATION_FAILED_STATUS
        : 500;
    return { details, status, listRuns, message: (thrown as Error).message };
}

describe('#7300 — GET /automation/:name/runs refuses a malformed `limit` instead of listing with NaN', () => {
    it.each([
        ['non-numeric', 'abc'],
        ['numeric prefix only', '10abc'],
        ['not a whole number', '1.5'],
        ['infinite', 'Infinity'],
        ['repeated parameter', ['1', '2']],
        ['structured', { $gt: 1 }],
    ])('refuses ?limit=%s with 400 VALIDATION_FAILED', async (_label, raw) => {
        const { details, status, listRuns } = await refusalFor({ limit: raw });

        // ADR-0112: the envelope, not merely the throw — `code` AND `status`.
        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        // ADR-0114: the field-addressed half names the parameter and the
        // constraint it violated, so a caller can point at the input.
        expect(details?.fields).toEqual([
            { field: 'limit', code: 'invalid_number', message: expect.stringContaining('`limit`') },
        ]);
        // The whole point: the service is never reached with a poisoned window,
        // so no caller is handed `[]` as if it were the flow's run history.
        expect(listRuns).not.toHaveBeenCalled();
    });

    it('names the offending value in the message, capped so the body cannot be stuffed', async () => {
        const { message } = await refusalFor({ limit: 'x'.repeat(500) });

        expect(message).toContain('expected a whole number');
        expect(message.length).toBeLessThan(200);
    });
});

describe("#7300 — the same probe on this route's other passed-through parameter", () => {
    it.each([
        ['repeated parameter', ['n_1', 'n_2']],
        ['structured', { $ne: 'n_1' }],
        ['numeric', 7],
    ])('refuses ?cursor=%s rather than handing a non-string to a `cursor?: string` slot', async (_label, raw) => {
        const { details, status, listRuns } = await refusalFor({ cursor: raw });

        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        expect(details?.fields).toEqual([
            { field: 'cursor', code: 'invalid_type', message: expect.stringContaining('`cursor`') },
        ]);
        expect(listRuns).not.toHaveBeenCalled();
    });
});

describe('#7300 — every value that had a defensible answer keeps it', () => {
    async function listWith(query: Record<string, unknown> | undefined) {
        const { dispatcher, listRuns } = makeDispatcher();
        const result = await dispatcher.handleAutomation('welcome_flow/runs', 'GET', undefined, CTX(), query);
        return { result, listRuns };
    }

    it.each([
        // [label, query, the exact options object `listRuns` must receive]
        ['?limit=20', { limit: '20' }, { limit: 20, cursor: undefined }],
        ['?limit=1 (the low boundary)', { limit: '1' }, { limit: 1, cursor: undefined }],
        ['?limit=100 (the declared high boundary)', { limit: '100' }, { limit: 100, cursor: undefined }],
        // Out of RANGE is not out of DOMAIN. `ListRunsRequestSchema` bounds
        // `limit` to 1..100 and the engine slices by whatever it is handed;
        // neither answer is this boundary's to change, so both still arrive.
        ['?limit=1000 (over the declared range)', { limit: '1000' }, { limit: 1000, cursor: undefined }],
        ['?limit=-5 (under it)', { limit: '-5' }, { limit: -5, cursor: undefined }],
        // Falsy spellings meant "no limit here" before this gate existed and
        // still do — they must not become a new 400. `'0'` is NOT one of them:
        // the string is truthy, so `query.limit ? Number(query.limit) : …` read
        // it as the number `0` and passed it on, and that is preserved too.
        ['?limit= (empty)', { limit: '' }, { limit: undefined, cursor: undefined }],
        ['?limit=0', { limit: '0' }, { limit: 0, cursor: undefined }],
        ['limit: 0 (in-process number)', { limit: 0 }, { limit: undefined, cursor: undefined }],
        ['limit: null', { limit: null }, { limit: undefined, cursor: undefined }],
        ['no parameters at all', {}, { limit: undefined, cursor: undefined }],
        // A cursor is opaque: every string passes through VERBATIM, including
        // the empty one, exactly as the raw passthrough did.
        ['?cursor=n_007', { cursor: 'n_007' }, { limit: undefined, cursor: 'n_007' }],
        ['?cursor= (empty)', { cursor: '' }, { limit: undefined, cursor: '' }],
        ['both together', { limit: '5', cursor: 'n_007' }, { limit: 5, cursor: 'n_007' }],
    ])('%s answers 200 and reaches the service unchanged', async (_label, query, expected) => {
        const { result, listRuns } = await listWith(query);

        expect(result.response?.status).toBe(200);
        expect(listRuns).toHaveBeenCalledWith('welcome_flow', expected);
    });

    it('passes NO options at all when the transport delivers no query object', async () => {
        // Preserved verbatim from `query ? { … } : undefined`: an absent query
        // means the service applies its own default window (20), which is a
        // different statement from "a window of `undefined`" and stays so.
        const { result, listRuns } = await listWith(undefined);

        expect(result.response?.status).toBe(200);
        expect(listRuns).toHaveBeenCalledWith('welcome_flow', undefined);
    });

    it('leaves an unknown query key alone — `?status=failed` is ignored, not refused (#6361)', async () => {
        // `ListRunsRequestSchema` declares a `status` filter that this handler
        // has never read, so the key is silently ignored today. Refusing unknown
        // keys — or starting to honour this one — is a separate decision with
        // its own blast radius; this change takes neither.
        const { result, listRuns } = await listWith({ limit: '2', status: 'failed' });

        expect(result.response?.status).toBe(200);
        expect(listRuns).toHaveBeenCalledWith('welcome_flow', { limit: 2, cursor: undefined });
    });

    it('still refuses an anonymous caller with 401 before it ever looks at the query', async () => {
        // Ordering matters: a malformed query from an unauthenticated caller
        // must not become a 400 that confirms the route is wired and serveable
        // (#5519's anonymous baseline stands ahead of every parse on this
        // domain).
        const { dispatcher, listRuns } = makeDispatcher();
        const result = await dispatcher.handleAutomation(
            'welcome_flow/runs', 'GET', undefined, { request: {} } as any, { limit: 'abc' },
        );

        expect(result.response?.status).toBe(401);
        expect(listRuns).not.toHaveBeenCalled();
    });
});
