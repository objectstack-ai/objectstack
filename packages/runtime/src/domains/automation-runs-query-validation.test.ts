// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7300 / #7359 / #8054 — `GET /api/v1/automation/:name/runs`'s query
 * parameters, at the boundary that reads them.
 *
 * #7300 (below) closed the two parameters this handler already forwarded but
 * COERCED. #7359 closed a third shape: `status` was declared by
 * `ListRunsRequestSchema`, had no slot on `IAutomationService.listRuns`, and
 * was never built into the handler's option object — so `?status=failed` was
 * dropped here in silence and the caller was answered with EVERY run of the
 * flow. #7300 deliberately pinned that ignore-the-key behaviour rather than
 * decide it; #7359 took the enforce route, so that one pin was superseded by
 * cases asserting the opposite on the same input. #8054 is the sibling of
 * #7359 on the SAME route's OTHER declared constraint: `limit` was already
 * type-checked (#7300) but its declared RANGE (`.min(1).max(100)`) was never
 * read, so `?limit=0` answered 200 with zero rows — "this flow has never
 * run", confidently, about a flow with runs — and `?limit=101` reached the
 * engine with its cap simply not applied. The `?limit=1000`/`?limit=-5`/
 * `?limit=0` preservation rows #7300 pinned are superseded here the same way
 * #7359 superseded the `status`-ignored case: same input, opposite behaviour.
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
 *     byte for byte, at the exact `listRuns(name, options)` call. As of #8054
 *     that no longer includes out-of-RANGE numbers (`?limit=1000`, `?limit=0`):
 *     `ListRunsRequestSchema` bounds `limit` to 1..100 and the boundary now
 *     enforces that declared range instead of only the value's type, so those
 *     inputs moved from PRESERVATION to REFUSAL. An ORDINARY in-range value
 *     (`?limit=25`) and both declared boundary values (`?limit=1`,
 *     `?limit=100`) still keep their defensible answer — the over-block guard
 *     for the new range check.
 *
 * The wire mapping of the thrown shape to `400` + `details.fields[]` is not
 * re-proved here — it is one mapping for every domain handler, pinned at both
 * dispatcher error exits by `dispatcher-validation-error.test.ts` and against
 * the real `ValidationError` by `dispatcher-validation-error.real.test.ts`
 * (#3918), and over a real socket for this identical thrown shape by
 * `notifications.hono.integration.test.ts` (#6928).
 */

import { ExecutionStatus } from '@objectstack/spec/automation';
import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';

/**
 * An automation slot whose `listRunsPage` records exactly what it was asked
 * for.
 *
 * [#19365] The double serves `listRunsPage` — the page-shaped member the door
 * now calls — rather than `listRuns`. The recorded OPTIONS object is what
 * every preservation row below pins, and it is unchanged by that switch except
 * for the retired `cursor` key: the door still forwards the caller's own
 * `limit`, ⛔ never a widened one. The over-read that makes `hasMore`
 * answerable lives in the ENGINE, behind this member, which is exactly why the
 * window a caller asks for is still the window the service is asked for.
 */
function makeDispatcher(hasMore = false) {
    // The parameters are DECLARED, not inferred: an argument-less `vi.fn`
    // types `mock.calls` as the empty tuple, so reading the options argument
    // off a recorded call is a type error (TS2493) — and the options argument
    // is precisely what the preservation rows below exist to inspect.
    const listRunsPage = vi.fn(
        async (_flowName: string, _options?: Record<string, unknown>) => ({
            runs: [{ id: 'run_1', flowName: 'welcome_flow', status: 'completed' }],
            hasMore,
        }),
    );
    const services: Record<string, unknown> = { automation: { listRunsPage, handlerReady: true } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), listRunsPage };
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
    const { dispatcher, listRunsPage } = makeDispatcher();
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
    return { details, status, listRunsPage, message: (thrown as Error).message };
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
        const { details, status, listRunsPage } = await refusalFor({ limit: raw });

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
        expect(listRunsPage).not.toHaveBeenCalled();
    });

    it('names the offending value in the message, capped so the body cannot be stuffed', async () => {
        const { message } = await refusalFor({ limit: 'x'.repeat(500) });

        expect(message).toContain('expected a whole number');
        expect(message.length).toBeLessThan(200);
    });
});

describe('#19365 — `cursor` is RETIRED, so this boundary stops reading it', () => {
    // ⚠️ This block SUPERSEDES #7300's cursor refusal cases rather than
    // extending them, and the supersession is a deliberate reversal, not a
    // relaxation that slipped through. #7300 refused `?cursor=a&cursor=b` with
    // 400 VALIDATION_FAILED because an ARRAY reached a slot the contract typed
    // `cursor?: string`, and it chose to validate the key rather than decide
    // it — on the reasoning that a future cursor implementation must not be
    // the one to discover the type was unenforced. The maintainer ruling of
    // decision batch #204 item 2 (letter C) decides it: there will be no
    // cursor implementation on this door. The key is a `retiredKey()`
    // tombstone on `ListRunsRequestSchema`, the slot is gone from
    // `IAutomationService.listRuns`, and a refusal here would be validating a
    // key the contract no longer has.
    //
    // Same input, opposite behaviour — the shape #7359 and #8054 already used
    // on this file's other two parameters.
    it.each([
        ['a plain value', 'n_007'],
        ['the empty spelling #7300 passed through verbatim', ''],
        ['repeated parameter — the exact input that used to answer 400', ['n_1', 'n_2']],
        ['structured', { $ne: 'n_1' }],
        ['numeric', 7],
    ])('?cursor=%s is IGNORED — 200, and no `cursor` reaches the service', async (_label, raw) => {
        const { dispatcher, listRunsPage } = makeDispatcher();
        const result = await dispatcher.handleAutomation(
            'welcome_flow/runs', 'GET', undefined, CTX(), { cursor: raw },
        );

        // Not a 400 any more. This route declares no closed query-parameter
        // set, so an unrecognised name has never been refused here on its own
        // account — `cursor` was refused because it was READ, and it no longer
        // is.
        expect(result.response?.status).toBe(200);
        // The half that actually matters: nothing named `cursor` survives into
        // the options object. A tolerant passthrough would have re-created the
        // declared-and-ignored parameter this card exists to close.
        expect(listRunsPage).toHaveBeenCalledTimes(1);
        const options = listRunsPage.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
        expect(options).not.toHaveProperty('cursor');
    });

    it('the retired key is still refused where it IS parsed — the spec schema', async () => {
        // The boundary ignores it; the tombstone is what makes the removal
        // audible, and it lives on the schema. Pinned here as well as in
        // `automation-api.zod.test.ts` so the runtime side records WHERE the
        // loudness moved to when this handler stopped refusing.
        const { ListRunsRequestSchema } = await import('@objectstack/spec/api');
        expect(() => ListRunsRequestSchema.parse({ name: 'welcome_flow', cursor: 'n_007' }))
            .toThrow(/`cursor`.*removed/s);
    });
});

describe('#19365 — `hasMore` is RELAYED from the service, never a constant', () => {
    // The defect this closes, in the source's own words: the door returned
    // `deps.success({ runs, hasMore: false })` — a literal — beside a list the
    // engine had already cut with `.slice(0, limit)`. A caller asking for one
    // row of a thousand was handed one row and told that was all of them, with
    // a 200 and nothing in the status, headers or body to distinguish it from
    // a complete answer.
    //
    // ⛔ These cases assert the RELAY, not the truncation arithmetic. Whether
    // `hasMore` is itself correct is the ENGINE's obligation and is pinned
    // where the over-read happens, in service-automation's own suite — a door
    // that recomputed it here would be a second implementation of the same
    // invariant, and the one that rots.

    async function listRunsWith(hasMore: boolean) {
        const { dispatcher, listRunsPage } = makeDispatcher(hasMore);
        const result = await dispatcher.handleAutomation(
            'welcome_flow/runs', 'GET', undefined, CTX(), { limit: '1' },
        );
        return { result, listRunsPage };
    }

    it('relays `hasMore: true` — the case the old literal got WRONG', async () => {
        const { result } = await listRunsWith(true);

        expect(result.response?.status).toBe(200);
        // Against the unfixed door this is the failing assertion: it answered
        // `false` here, always.
        expect(result.response?.body?.data?.hasMore).toBe(true);
        expect(result.response?.body?.data?.runs).toHaveLength(1);
    });

    it('relays `hasMore: false` — the over-block guard', async () => {
        // The literal was `false`, so a fix that simply hard-coded `true`
        // would pass the case above and be just as wrong. Both directions have
        // to come from the service.
        const { result } = await listRunsWith(false);

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.hasMore).toBe(false);
    });

    it('answers 501 when the service implements no `listRunsPage` — ⛔ never a 200', async () => {
        // "Absence must be loud." A service that cannot report truncation
        // leaves this door with nothing honest to put in a REQUIRED response
        // field, so it says so and names the member. Falling through to the
        // domain's 404 would have been the silent form — the caller could not
        // tell "no run listing is mounted here" from "no such flow" — and a
        // 200 carrying a guessed `hasMore` would re-create the exact defect
        // this card closed.
        const services: Record<string, unknown> = { automation: { handlerReady: true } };
        const resolve = (name: string) => services[name];
        const kernel: any = {
            getService: resolve,
            getServiceAsync: async (name: string) => resolve(name),
            context: { getService: resolve },
        };
        const result = await new HttpDispatcher(kernel)
            .handleAutomation('welcome_flow/runs', 'GET', undefined, CTX(), undefined);

        expect(result.response?.status).toBe(501);
        expect(result.response?.body?.error?.message).toContain('listRunsPage');
        expect(result.response?.body?.data?.hasMore).toBeUndefined();
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
        const { details, status, listRunsPage } = await refusalFor({ status: raw });

        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        // ADR-0114's closed catalog already carries the constraint this
        // violates — `invalid_option`, "not a member of the field's declared
        // options". No new error vocabulary is minted for it.
        expect(details?.fields).toEqual([
            { field: 'status', code: 'invalid_option', message: expect.stringContaining('`status`') },
        ]);
        expect(listRunsPage).not.toHaveBeenCalled();
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
        const { details, status, listRunsPage } = await refusalFor({ status: raw });

        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        expect(details?.fields).toEqual([
            { field: 'status', code: 'invalid_type', message: expect.stringContaining('`status`') },
        ]);
        expect(listRunsPage).not.toHaveBeenCalled();
    });

    it('names the declared members in the message, and caps the echoed value', async () => {
        const { message } = await refusalFor({ status: 'z'.repeat(500) });

        expect(message).toContain('failed');   // the caller is told what IS accepted
        expect(message).toContain('pending');
        expect(message.length).toBeLessThan(300);
    });
});

describe('#8054 — a `?limit=` outside the declared 1..100 range is refused, not silently answered', () => {
    // Measured, twice, identical both passes: `?limit=0` answered 200 with
    // ZERO rows (a confidently wrong "this flow has never run" — the store
    // sliced `.slice(0, 0)`), and `?limit=101` answered 200 with the cap
    // simply not applied. `ListRunsRequestSchema` had declared `.min(1).max(100)`
    // the whole time; this boundary just never read it. Once the range is
    // enforced there is no safe reading for a value outside it — same
    // reasoning #7359 already applied to `status`, on a bounded number instead
    // of a closed set.
    it.each([
        ['0 (the "no runs" trap)', '0', 'min_value'],
        ['-5 (negative)', '-5', 'min_value'],
        ['101 (one past the declared cap)', '101', 'max_value'],
        ['1000 (far past the declared cap — the old preserved case, inverted)', '1000', 'max_value'],
    ])('refuses ?limit=%s with 400 VALIDATION_FAILED (%s)', async (_label, raw, expectedCode) => {
        const { details, status, listRunsPage } = await refusalFor({ limit: raw });

        // ADR-0112: the envelope, not merely the throw — `code` AND `status`.
        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        // ADR-0114: `min_value`/`max_value` are the field codes the property
        // names already mirror — no new vocabulary minted for this.
        expect(details?.fields).toEqual([
            { field: 'limit', code: expectedCode, message: expect.stringContaining('`limit`') },
        ]);
        // The whole point: the service is never reached with a limit outside
        // its own declared contract, so no caller reads a wrong-but-confident
        // "no runs" and no caller gets an uncapped result set.
        expect(listRunsPage).not.toHaveBeenCalled();
    });

    // The boundary values themselves — `?limit=1` and `?limit=100` — are
    // pinned as VALID in the `#7300` preservation block below (they were
    // always in range and stay unaffected), so they are not repeated here.
});

describe('#7300 — every value that had a defensible answer keeps it', () => {
    async function listWith(query: Record<string, unknown> | undefined) {
        const { dispatcher, listRunsPage } = makeDispatcher();
        const result = await dispatcher.handleAutomation('welcome_flow/runs', 'GET', undefined, CTX(), query);
        return { result, listRunsPage };
    }

    it.each([
        // [label, query, the exact options object `listRuns` must receive]
        ['?limit=20', { limit: '20' }, { limit: 20, status: undefined }],
        // An ordinary in-range value is the over-block guard for #8054: bounds
        // threading must not start refusing numbers that were always fine.
        ['?limit=25 (ordinary, mid-range)', { limit: '25' }, { limit: 25, status: undefined }],
        ['?limit=1 (the low boundary)', { limit: '1' }, { limit: 1, status: undefined }],
        ['?limit=100 (the declared high boundary)', { limit: '100' }, { limit: 100, status: undefined }],
        // Out-of-RANGE numbers used to be preserved here (`?limit=1000`,
        // `?limit=-5`, `?limit=0`) on the theory that range was the engine's
        // declared business, not this boundary's. #8054 found the one place
        // that reasoning was wrong: `ListRunsRequestSchema` had ALWAYS
        // declared `limit`'s range, and nothing enforced it, so `?limit=0`
        // answered "no runs" and `?limit=101` reached the engine uncapped.
        // Those three rows are superseded by the `#8054` refusal block below
        // rather than deleted outright — same input, opposite behaviour now.
        //
        // Falsy spellings still mean "no limit here", unaffected by bounds
        // because the falsy gate runs BEFORE the bounds check: absent, `null`,
        // `''`, and an in-process (non-string) `0` never reach it. `'0'` as a
        // QUERY-STRING value is different — the string is truthy, so it always
        // reached `Number()` — and is exercised in the `#8054` block instead.
        ['?limit= (empty)', { limit: '' }, { limit: undefined, status: undefined }],
        ['limit: 0 (in-process number)', { limit: 0 }, { limit: undefined, status: undefined }],
        ['limit: null', { limit: null }, { limit: undefined, status: undefined }],
        ['no parameters at all', {}, { limit: undefined, status: undefined }],
        // The three `?cursor=` preservation rows that stood here — a verbatim
        // string, the empty spelling, and `limit` + `cursor` together — are
        // superseded by the `#19365` block above rather than deleted outright:
        // the key is retired, so "reaches the service unchanged" is no longer
        // the behaviour to preserve. What replaced them asserts the opposite
        // on the same inputs, which is the same supersession shape #7359 and
        // #8054 used on this route's other parameters.
    ])('%s answers 200 and reaches the service unchanged', async (_label, query, expected) => {
        const { result, listRunsPage } = await listWith(query);

        expect(result.response?.status).toBe(200);
        expect(listRunsPage).toHaveBeenCalledWith('welcome_flow', expected);
    });

    it('passes NO options at all when the transport delivers no query object', async () => {
        // Preserved verbatim from `query ? { … } : undefined`: an absent query
        // means the service applies its own default window (20), which is a
        // different statement from "a window of `undefined`" and stays so.
        const { result, listRunsPage } = await listWith(undefined);

        expect(result.response?.status).toBe(200);
        expect(listRunsPage).toHaveBeenCalledWith('welcome_flow', undefined);
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
        const { result, listRunsPage } = await listWith({ limit: '2', status: 'failed' });

        expect(result.response?.status).toBe(200);
        expect(listRunsPage).toHaveBeenCalledWith('welcome_flow', { limit: 2, status: 'failed' });
    });

    it.each(ExecutionStatus.options)('forwards every declared ExecutionStatus member — ?status=%s', async (member) => {
        // The rows are READ off the spec's `ExecutionStatus` — the same enum
        // `ListRunsRequestSchema` is built from, and the same one the boundary
        // hands `parseEnumParam` as its accepted set — so this pins that the
        // wire's declared set and the boundary's accepted set are one set. A
        // member added to the enum and refused here would fail this row.
        //
        // The members used to be re-listed inline here: identical to the enum
        // on the day it was written, and short by one the day `refused` was
        // appended (#14945), with this row still green under a name that says
        // EVERY declared member — a test named for a property it no longer
        // measured. Reading the vocabulary is what makes the name true, and it
        // is the discipline the boundary and the wire schema already apply
        // (#7359); `automation-api.zod.test.ts` turned the same copy into the
        // same read. ⛔ Iterating `.options` does not reorder it — the enum's
        // own note reserves those positions for readers that index them.
        const { result, listRunsPage } = await listWith({ status: member });

        expect(result.response?.status).toBe(200);
        expect(listRunsPage).toHaveBeenCalledWith('welcome_flow', { limit: undefined, status: member });
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
        const { result, listRunsPage } = await listWith(query);

        expect(result.response?.status).toBe(200);
        expect(listRunsPage).toHaveBeenCalledWith('welcome_flow', expect.objectContaining({ status: undefined }));
    });

    it('still refuses an anonymous caller with 401 before it ever looks at the query', async () => {
        // Ordering matters: a malformed query from an unauthenticated caller
        // must not become a 400 that confirms the route is wired and serveable
        // (#5519's anonymous baseline stands ahead of every parse on this
        // domain).
        const { dispatcher, listRunsPage } = makeDispatcher();
        const result = await dispatcher.handleAutomation(
            'welcome_flow/runs', 'GET', undefined, { request: {} } as any, { limit: 'abc' },
        );

        expect(result.response?.status).toBe(401);
        expect(listRunsPage).not.toHaveBeenCalled();
    });
});
