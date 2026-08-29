// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12975] The `/data` door's declared-4xx arm ships HUMAN LANGUAGE in `error`.
 *
 * ---------------------------------------------------------------------------
 * The ruling
 * ---------------------------------------------------------------------------
 * Maintainer, 2026-08-29 (issue #12975, option 1): the `/data` door's
 * declared-4xx arm strips the ADR-0111 `CODE:` prefix from the human-readable
 * `error` string, converging with the share-route family — ONE envelope
 * semantics: `error` = human language, `code` = the machine token (already
 * carried separately via `thrownCodeFields`).
 *
 * What the user was reading before it, on a zh-CN deployment, through
 * `PATCH /api/v1/data/:object/:id`:
 *
 *     FORBIDDEN: 您无权修改或删除这条记录，如需修改请联系该记录的负责人或管理员。
 *
 * The actionable half is localized; the machine token glued in front of it was
 * the only non-human fragment left in the toast.
 *
 * ---------------------------------------------------------------------------
 * Why every case asserts BOTH halves
 * ---------------------------------------------------------------------------
 * There are two ways to get this wrong and only one of them is the defect.
 * Asserting `error` alone passes just as happily for the other one — dropping
 * the machine token along with the prefix — so each case pins the token's new
 * home (`code`, or the `declaredCode` sibling when the spelling is
 * unregistered) beside the sentence. The token moves AXIS; it never leaves the
 * body.
 *
 * ---------------------------------------------------------------------------
 * Driven through the real routes
 * ---------------------------------------------------------------------------
 * Every case boots a real `RestServer`, registers the real routes and calls the
 * registered handler, so what is asserted is the wire body a client receives —
 * not a hand-built envelope agreeing with a hand-built expectation.
 *
 * ---------------------------------------------------------------------------
 * Anti-vacuity — directions predicted BEFORE running, measured after
 * ---------------------------------------------------------------------------
 * Ablation leg: this file run with ONLY `error-response.ts` reverted to the
 * pre-fix bytes (fix committed first; revert `git checkout <base> -- <abs
 * path>`, restore `git checkout HEAD -- <abs path>`, both under
 * `trap … EXIT INT TERM`, the mutation proven on disk by grepping the removed
 * text and comparing blob hashes, the restore proven by `git diff HEAD` empty).
 *
 * No rebuild between legs, and that is load-bearing rather than an omission:
 * every symbol under test is reached by a RELATIVE import inside this package,
 * which vitest transforms from source — no `dist/` sits between the mutation
 * and the assertion. The `exports`-resolved workspace deps (`@objectstack/types`,
 * `@objectstack/spec`) are untouched by the mutation.
 *
 *   §1 predicted RED     — the ruled behaviour is what the revert removes.
 *   §2 predicted GREEN   — the branches the ruling does not touch. These are
 *                          the real controls: a fix that stripped by PATTERN
 *                          instead of by the declared code reddens here (the
 *                          no-code and non-matching-prefix cases) and nowhere
 *                          else.
 *   §3 predicted RED     — the demoted-spelling case rides the same arm.
 *   §4 predicted RED     — the degradation is part of the new arm.
 *   §5 predicted GREEN   — the share family is untouched by this card, in both
 *                          the arm that already stripped and the two exits
 *                          measured still carrying the prefix.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// `.js` extension deliberately: this package resolves `nodenext`, so an
// extensionless relative import is a `tsc` error (TS2835).
import { RestServer } from './rest-server.js';

const ITEM = '/api/v1/data/:object/:id';
const COLLECTION = '/api/v1/data/:object';
const SHARES = '/api/v1/data/:object/:id/shares';

/** The sentence #12260 put on the wire, verbatim — the reason this card exists. */
const ZH = '您无权修改或删除这条记录，如需修改请联系该记录的负责人或管理员。';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = { statusCode: 200, _body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res._body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(() => res);
    res.write = vi.fn();
    res.end = vi.fn(() => res);
    res.send = vi.fn(() => res);
    return res;
}

/**
 * @param protocolOverrides the data-protocol methods the route calls.
 * @param sharingService    what `sharingServiceProvider` resolves to; omit to
 *                          leave the record-share routes unserved.
 */
function boot(protocolOverrides: Record<string, unknown> = {}, sharingService?: any) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([{ name: 'showcase_inquiry' }]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        createData: vi.fn().mockResolvedValue({}),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({}),
        batchData: vi.fn().mockResolvedValue({}),
        createManyData: vi.fn().mockResolvedValue({}),
        updateManyData: vi.fn().mockResolvedValue({}),
        deleteManyData: vi.fn().mockResolvedValue({}),
        ...protocolOverrides,
    };
    const rest = new RestServer(
        mockServer() as any, protocol, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined,
        sharingService === undefined ? undefined : (async () => sharingService) as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    rest.registerRoutes();
    return rest;
}

async function call(rest: any, method: string, path: string, req: Record<string, unknown>) {
    const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!found) throw new Error(`route not registered: ${method} ${path}`);
    const res = mockRes();
    await found.handler({ method, query: {}, headers: {}, params: {}, body: {}, ...req }, res);
    return { status: res.statusCode, body: res._body };
}

const thrown = (message: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(message), extra);

/** `sharing-plugin.ts`'s by-id write gate, verbatim: the card's live producer. */
const sharingWriteRefusal = () =>
    thrown(`FORBIDDEN: ${ZH}`, { code: 'FORBIDDEN', status: 403 });

const patchWith = (error: unknown) => call(
    boot({ updateData: vi.fn().mockRejectedValue(error) }),
    'PATCH', ITEM, { params: { object: 'showcase_inquiry', id: 'rec1' }, body: { name: 'x' } },
);
const deleteWith = (error: unknown) => call(
    boot({ deleteData: vi.fn().mockRejectedValue(error) }),
    'DELETE', ITEM, { params: { object: 'showcase_inquiry', id: 'rec1' } },
);

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

// ---------------------------------------------------------------------------
// §1 The ruled behaviour, on the two routes the report was filed from
// ---------------------------------------------------------------------------

describe('[#12975] the declared-4xx arm hands the caller the human half only', () => {
    it('PATCH /data/:object/:id — the localized sentence arrives with no machine prefix', async () => {
        const answer = await patchWith(sharingWriteRefusal());

        expect(answer.status).toBe(403);
        // The half a user reads: human language, and ONLY human language.
        expect(answer.body.error).toBe(ZH);
        expect(String(answer.body.error).startsWith('FORBIDDEN')).toBe(false);
        // The other half of the same fact: the machine token is still on the
        // wire, on the axis that owns it. Without this assertion the case
        // above would also pass for "the token was dropped entirely".
        expect(answer.body.code).toBe('FORBIDDEN');
    });

    it('DELETE /data/:object/:id — one key serves both write verbs', async () => {
        const answer = await deleteWith(sharingWriteRefusal());

        expect(answer.status).toBe(403);
        expect(answer.body.error).toBe(ZH);
        expect(answer.body.code).toBe('FORBIDDEN');
    });

    it('the sentence a zh-CN user reads carries no Latin prose at all', async () => {
        // The end-user-facing claim #12260 made, now true end to end: before
        // this card the body opened with `FORBIDDEN:` and this assertion was
        // false on the wire while being true inside the plugin.
        const answer = await patchWith(sharingWriteRefusal());
        expect(String(answer.body.error)).not.toMatch(/[A-Za-z]/);
    });

    it('a producer-declared `userMessage` still rides the body, unchanged', async () => {
        const answer = await patchWith(
            thrown(`FORBIDDEN: ${ZH}`, { code: 'FORBIDDEN', status: 403, userMessage: '请联系管理员' }),
        );
        expect(answer.body).toEqual({
            error: ZH, code: 'FORBIDDEN', object: 'showcase_inquiry', userMessage: '请联系管理员',
        });
    });
});

// ---------------------------------------------------------------------------
// §2 What must NOT move — measured byte-identical before and after
// ---------------------------------------------------------------------------

describe('[#12975] every branch that is not the declared-4xx idiom is untouched', () => {
    it('a declared 4xx whose message carries no prefix is unchanged', async () => {
        const answer = await patchWith(
            thrown('insufficient privileges', { code: 'FORBIDDEN', status: 403 }),
        );
        expect(answer.body).toEqual({
            error: 'insufficient privileges', code: 'FORBIDDEN', object: 'showcase_inquiry',
        });
    });

    it('⭐ a declared 4xx with NO `code` KEEPS its prefix — the token is nowhere else', async () => {
        // The control that rules out a blanket SCREAMING_SNAKE strip.
        // `thrownCodeFields` answers `{}` for a producer that named no code
        // (ADR-0112: nothing is invented for the half it did not declare), so
        // stripping here would delete the only machine token in the response
        // rather than move it to its axis.
        const answer = await patchWith(thrown(`FORBIDDEN: ${ZH}`, { status: 403 }));
        expect(answer.body).toEqual({
            error: `FORBIDDEN: ${ZH}`, object: 'showcase_inquiry',
        });
        expect('code' in answer.body).toBe(false);
    });

    it('⭐ a prefix that does not name the declared code is left alone — driver prose stays', async () => {
        // The second control: the strip is anchored to the producer's own
        // `code`, so a message opening with some other capitalised word and a
        // colon is not eaten by it.
        const answer = await patchWith(
            thrown('SQLITE_ERROR: no such table: showcase_inquiry', { code: 'FORBIDDEN', status: 400 }),
        );
        expect(answer.body.error).toBe('SQLITE_ERROR: no such table: showcase_inquiry');
    });

    it('a declared 5xx still withholds its prose entirely (#5437/#5582)', async () => {
        const answer = await patchWith(
            thrown('SERVICE_UNAVAILABLE: pool down', { code: 'SERVICE_UNAVAILABLE', status: 503 }),
        );
        expect(answer.status).toBe(503);
        expect(answer.body.code).toBe('SERVICE_UNAVAILABLE');
        expect(String(answer.body.error)).not.toContain('pool down');
        expect(String(answer.body.error)).not.toContain('SERVICE_UNAVAILABLE:');
    });

    it('an undeclared error still reaches the sanitised 500 terminal', async () => {
        const answer = await patchWith(thrown('FORBIDDEN: something'));
        expect(answer.status).toBe(500);
        expect(answer.body.code).toBe('INTERNAL_ERROR');
    });

    it('a sandbox refusal still answers 400 with the author’s own sentence', async () => {
        const answer = await patchWith(Object.assign(
            thrown("hook 'guard' threw: Error: Opportunity is closed."),
            { name: 'SandboxError', innerMessage: 'Opportunity is closed.' },
        ));
        expect(answer.status).toBe(400);
        expect(answer.body.error).toBe('Opportunity is closed.');
    });

    it('DELETE_RESTRICTED answers from the arm ABOVE the passthrough, prefix and all', async () => {
        const answer = await deleteWith(thrown('DELETE_RESTRICTED: dependents exist', {
            code: 'DELETE_RESTRICTED', status: 409, dependentCount: 3,
        }));
        expect(answer.status).toBe(409);
        expect(answer.body.error).toBe('DELETE_RESTRICTED: dependents exist');
    });

    it('OBJECT_NOT_FOUND keeps its canonical 404 body', async () => {
        // The arm ABOVE the passthrough, so the strip is never consulted. Its
        // sentence is re-derived from the route's own object name rather than
        // echoed from the throw, which is why the expectation names
        // `showcase_inquiry` and not whatever the producer wrote.
        const answer = await patchWith(thrown("Object 'zz' is not registered", {
            code: 'OBJECT_NOT_FOUND', status: 404,
        }));
        expect(answer.status).toBe(404);
        expect(answer.body.code).toBe('OBJECT_NOT_FOUND');
        expect(answer.body.error).toBe("Object 'showcase_inquiry' is not registered");
    });
});

// ---------------------------------------------------------------------------
// §3 An UNREGISTERED spelling — the token lands on `declaredCode`
// ---------------------------------------------------------------------------

describe('[#12975] a demoted spelling still carries the token beside the sentence', () => {
    it('the prefix is read against the PRODUCER’s spelling, not the narrowed `code`', async () => {
        // #9232 demotes an unregistered thrown spelling to a `declaredCode`
        // sibling and fills `code` from the status. The prefix restates what
        // the producer WROTE, so anchoring the strip on the narrowed value
        // would miss exactly this shape — and the token is still on the wire,
        // one field over.
        const answer = await patchWith(thrown('RECORD_LOCKED_BY_APP: the row is checked out', {
            code: 'RECORD_LOCKED_BY_APP', status: 423,
        }));
        expect(answer.status).toBe(423);
        expect(answer.body.error).toBe('the row is checked out');
        expect(answer.body.declaredCode).toBe('RECORD_LOCKED_BY_APP');
        expect(typeof answer.body.code).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// §4 A message that is nothing BUT the prefix
// ---------------------------------------------------------------------------

describe('[#12975] a message with no human half degrades rather than shipping a bare token', () => {
    it('`CODE:` alone becomes the generic sentence, with the token still on `code`', async () => {
        const answer = await patchWith(thrown('FORBIDDEN:', { code: 'FORBIDDEN', status: 403 }));
        expect(answer.body.error).toBe('Request failed');
        expect(answer.body.code).toBe('FORBIDDEN');
    });
});

// ---------------------------------------------------------------------------
// §5 The share-route family — what converged, and what measurably did NOT
// ---------------------------------------------------------------------------

describe('[#12975] the share family: convergence, and the two exits still carrying the prefix', () => {
    const throwingShareService = (error: unknown) => ({
        listShares: vi.fn().mockRejectedValue(error),
        grant: vi.fn().mockRejectedValue(error),
        revoke: vi.fn().mockRejectedValue(error),
    });

    it('the ADR-0111 prefix-idiom arm still strips — unchanged by this card', async () => {
        const answer = await call(
            boot({}, throwingShareService(thrown('NOT_FOUND: record showcase_inquiry/rec1 does not exist'))),
            'GET', SHARES, { params: { object: 'showcase_inquiry', id: 'rec1' } },
        );
        expect(answer.status).toBe(404);
        expect(answer.body.error.code).toBe('NOT_FOUND');
        expect(answer.body.error.message).toBe('record showcase_inquiry/rec1 does not exist');
    });

    it('CONVERGENCE — that arm and the `/data` door now answer one semantics', async () => {
        // The same fact stated from both doors: neither puts the machine token
        // inside the sentence, and both keep it on the code axis. This is the
        // pin the ruling asked for; it reds if either door starts disagreeing
        // again, whichever one moves.
        const shareAnswer = await call(
            boot({}, throwingShareService(thrown(`PERMISSION_DENIED: ${ZH}`))),
            'GET', SHARES, { params: { object: 'showcase_inquiry', id: 'rec1' } },
        );
        const dataAnswer = await patchWith(sharingWriteRefusal());

        expect(shareAnswer.body.error.message).toBe(ZH);
        expect(dataAnswer.body.error).toBe(ZH);
        for (const sentence of [shareAnswer.body.error.message, dataAnswer.body.error]) {
            expect(String(sentence)).not.toMatch(/^[A-Z][A-Z0-9_]*:/);
        }
        expect(shareAnswer.body.error.code).toBe('PERMISSION_DENIED');
        expect(dataAnswer.body.code).toBe('FORBIDDEN');
    });

    it('⚠️ MEASURED, NOT REPAIRED HERE — two exits still ship the prefix', async () => {
        // Recorded rather than fixed: the ruling moved ONE arm, and both exits
        // below are reached through `resolveErrorResponse`'s own declared-4xx
        // passthrough, which it did not name. Filed for the maintainer; this
        // case is the evidence, and it REDS the day either exit is converged,
        // which is the point — the follow-up moves it deliberately instead of
        // discovering the divergence a third time.
        //
        //   (a) the record-share family's CLASSIFIED arm — a producer that
        //       declared `{ code, status }` AND used the prefix idiom;
        //   (b) `/data`'s bulk exits (batch / createMany / updateMany /
        //       deleteMany / clone), which report through `handleRouteError`.
        const classified = await call(
            boot({}, throwingShareService(sharingWriteRefusal())),
            'GET', SHARES, { params: { object: 'showcase_inquiry', id: 'rec1' } },
        );
        expect(classified.body.error.message).toBe(`FORBIDDEN: ${ZH}`);

        const bulk = await call(
            boot({ batchData: vi.fn().mockRejectedValue(sharingWriteRefusal()) }),
            'POST', `${COLLECTION}/batch`,
            { params: { object: 'showcase_inquiry' }, body: { operation: 'update', records: [{ id: 'r1' }] } },
        );
        expect(bulk.body.error).toBe(`FORBIDDEN: ${ZH}`);
    });
});
