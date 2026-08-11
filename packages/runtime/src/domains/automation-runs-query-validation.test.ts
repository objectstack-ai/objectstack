// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7300 / #7359 — `GET /api/v1/automation/:name/runs`'s query parameters, at
 * the boundary that reads them.
 *
 * #7300 (below) closed the two parameters this handler already forwarded but
 * COERCED. #7359 closed the third, which is the same 200-with-the-wrong-answer
 * arrived at from the opposite direction: `status` was declared by
 * `ListRunsRequestSchema`, had no slot on `IAutomationService.listRuns`, and
 * was never built into the handler's option object — so `?status=failed` was
 * dropped here in silence and the caller was answered with EVERY run of the
 * flow. #7300 deliberately pinned that ignore-the-key behaviour rather than
 * decide it; #7359 took the enforce route, so that one pin is superseded here
 * by cases asserting the opposite on the same input.
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

describe('#7359 — a `?status=` outside the declared set is refused, not silently widened', () => {
    it.each([
        ['a typo', 'faild'],
        ['right word, wrong case', 'FAILED'],
        ['a status of a neighbouring vocabulary', 'success'],
        ['empty-ish but not a member', ' '],
    ])('refuses ?status=%s with 400 VALIDATION_FAILED', async (_label, raw) => {
        // Once the filter is honoured there is no safe reading left for a value
        // outside the set. `?status=faild` cannot mean "no filter" — the caller
        // plainly asked to narrow — and serving the empty list is no better,
        // because "no runs are `faild`" and "no runs failed" read identically to
        // a caller who cannot see their own typo. Both are a monitoring surface
        // answering "you have no failures" with confidence.
        const { details, status, listRuns } = await refusalFor({ status: raw });

        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        // ADR-0114's closed catalog already carries the constraint this
        // violates — `invalid_option`, "not a member of the field's declared
        // options". No new error vocabulary is minted for it.
        expect(details?.fields).toEqual([
            { field: 'status', code: 'invalid_option', message: expect.stringContaining('`status`') },
        ]);
        expect(listRuns).not.toHaveBeenCalled();
    });

    it.each([
        ['repeated parameter', ['failed', 'completed']],
        ['structured', { $ne: 'failed' }],
        ['numeric', 7],
    ])('refuses ?status=%s — it was never a single string (invalid_type)', async (_label, raw) => {
        // The same mapping `parseStringParam` makes for the same condition: a
        // repeated `?status=failed&status=completed` arrives as an ARRAY, and a
        // filter is not a set on this wire. `String([...])` would have made it
        // the single value `'failed,completed'`, matching nothing.
        const { details, status, listRuns } = await refusalFor({ status: raw });

        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        expect(details?.fields).toEqual([
            { field: 'status', code: 'invalid_type', message: expect.stringContaining('`status`') },
        ]);
        expect(listRuns).not.toHaveBeenCalled();
    });

    it('names the declared members in the message, and caps the echoed value', async () => {
        const { message } = await refusalFor({ status: 'z'.repeat(500) });

        expect(message).toContain('failed');   // the caller is told what IS accepted
        expect(message).toContain('pending');
        expect(message.length).toBeLessThan(300);
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
        ['?limit=20', { limit: '20' }, { limit: 20, cursor: undefined, status: undefined }],
        ['?limit=1 (the low boundary)', { limit: '1' }, { limit: 1, cursor: undefined, status: undefined }],
        ['?limit=100 (the declared high boundary)', { limit: '100' }, { limit: 100, cursor: undefined, status: undefined }],
        // Out of RANGE is not out of DOMAIN. `ListRunsRequestSchema` bounds
        // `limit` to 1..100 and the engine slices by whatever it is handed;
        // neither answer is this boundary's to change, so both still arrive.
        ['?limit=1000 (over the declared range)', { limit: '1000' }, { limit: 1000, cursor: undefined, status: undefined }],
        ['?limit=-5 (under it)', { limit: '-5' }, { limit: -5, cursor: undefined, status: undefined }],
        // Falsy spellings meant "no limit here" before this gate existed and
        // still do — they must not become a new 400. `'0'` is NOT one of them:
        // the string is truthy, so `query.limit ? Number(query.limit) : …` read
        // it as the number `0` and passed it on, and that is preserved too.
        ['?limit= (empty)', { limit: '' }, { limit: undefined, cursor: undefined, status: undefined }],
        ['?limit=0', { limit: '0' }, { limit: 0, cursor: undefined, status: undefined }],
        ['limit: 0 (in-process number)', { limit: 0 }, { limit: undefined, cursor: undefined, status: undefined }],
        ['limit: null', { limit: null }, { limit: undefined, cursor: undefined, status: undefined }],
        ['no parameters at all', {}, { limit: undefined, cursor: undefined, status: undefined }],
        // A cursor is opaque: every string passes through VERBATIM, including
        // the empty one, exactly as the raw passthrough did.
        ['?cursor=n_007', { cursor: 'n_007' }, { limit: undefined, cursor: 'n_007', status: undefined }],
        ['?cursor= (empty)', { cursor: '' }, { limit: undefined, cursor: '', status: undefined }],
        ['both together', { limit: '5', cursor: 'n_007' }, { limit: 5, cursor: 'n_007', status: undefined }],
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

    // ── #7359 ────────────────────────────────────────────────────────────────
    // The block above used to end with a case asserting that `?status=failed`
    // was IGNORED — #7300 deliberately preserved that, since choosing between
    // honouring and retiring the declared key was a separate decision. #7359
    // took the enforce route, so that pin is superseded rather than deleted:
    // the cases below assert the opposite behaviour on the same input.

    it('FORWARDS a declared `?status=` to the service instead of dropping it', async () => {
        // The defect: `status` is declared by `ListRunsRequestSchema` but was
        // never built into this handler's option object, so it never left the
        // HTTP layer. The caller got 200 + every run of the flow — a caller
        // paging for failures read the first `limit` runs of ANY status and
        // concluded those were the failures.
        const { result, listRuns } = await listWith({ limit: '2', status: 'failed' });

        expect(result.response?.status).toBe(200);
        expect(listRuns).toHaveBeenCalledWith('welcome_flow', { limit: 2, cursor: undefined, status: 'failed' });
    });

    it.each(
        ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'timed_out', 'retrying'],
    )('forwards every declared ExecutionStatus member — ?status=%s', async (member) => {
        // The gate reads its members from the spec's `ExecutionStatus` enum, the
        // same one `ListRunsRequestSchema` is built from, so this pins that the
        // wire's declared set and the boundary's accepted set are one set. A
        // member added to the enum and refused here would fail this row.
        const { result, listRuns } = await listWith({ status: member });

        expect(result.response?.status).toBe(200);
        expect(listRuns).toHaveBeenCalledWith('welcome_flow', { limit: undefined, cursor: undefined, status: member });
    });

    it.each([
        ['absent', {}],
        ['?status= (empty — an "All statuses" select)', { status: '' }],
        ['status: null', { status: null }],
    ])('%s still means NO filter — the unnarrowed listing is unchanged', async (_label, query) => {
        // The preservation half. An absent filter must keep reaching the
        // service as `undefined` (list everything), and the empty spelling must
        // not become a new 400: unlike `?read=`, which used to serve the wrong
        // HALF of the inbox, `?status=` already served exactly what "no filter"
        // means, so it had a defensible answer to preserve.
        const { result, listRuns } = await listWith(query);

        expect(result.response?.status).toBe(200);
        expect(listRuns).toHaveBeenCalledWith('welcome_flow', expect.objectContaining({ status: undefined }));
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
