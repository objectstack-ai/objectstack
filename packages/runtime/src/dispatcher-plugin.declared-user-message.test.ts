// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13241] `errorResponseBase` carries the producer's `userMessage` to the wire
 * — the author-facing text channel the declared-5xx prose withhold names as its
 * own compensation, and the one ADR-0112 boundary that dropped it.
 *
 * ## The contract this pins
 *
 * `packages/spec/src/api/contract.zod.ts` declares the slot (`userMessage:
 * z.string().optional()`) and states the invariant directly, one line up:
 *
 * > `userMessage` on the thrown error; **the boundaries carry it to the wire**
 *
 * Three of the four ADR-0112 boundaries did. `/data` carries it through
 * `boundedDeclaredUserMessage`; the caught-path sibling `errorFromThrown`
 * carries it through the same `extra` mechanism used here. The dispatcher's
 * **throw-transparent** exit resolved the throw through `resolveThrownHttpError`
 * — whose result already carries `userMessage` — and then did not read the
 * field. `declared ≠ enforced` at exactly one door.
 *
 * ⭐ [#13623] There was a SECOND door, and this file is where it was recorded:
 * `HttpDispatcher.dispatch`'s foot catch answers `isPermissionDeniedError`
 * itself, so a marked `PERMISSION_DENIED` 403 never reaches the exit above and
 * lost its mark there instead. §2's carve-out row pinned that absence as an
 * observation; #13623 closed the door and MOVED the row to assert presence —
 * see its docblock for why moving it (rather than fixing it green) is the
 * deliverable.
 *
 * ## Why this is the compensation channel and not a decoration
 *
 * The 2026-08-27 ruling on #12509 (option D), propagated to #12281, made this
 * exit withhold the message of every **declared** 5xx:
 *
 * > the author-facing text channel is `userMessage` (#9934), never the raw
 * > message.
 *
 * That sentence only holds if the channel exists here. Before this change a
 * declared-5xx producer at this exit had **no** way to address the caller at
 * all: the diagnostic channel was withheld and the author channel was not
 * plumbed. `§1` below is that exact pairing — prose withheld, mark delivered,
 * in one response.
 *
 * ## ⚠️ Status-agnostic, which is wider than the card's framing
 *
 * #9934 made the mark status-agnostic on purpose ("a 400, 403, 409 or 503
 * refusal may all carry it"), so the gap here was never confined to the
 * declared-5xx band that motivated it: a marked **4xx** refusal reaching this
 * exit lost the field too, with no withhold anywhere in the picture. `§2` drives
 * the whole status range so a later reader cannot mistake this for a 5xx-only
 * repair, and so a future edit cannot quietly gate the mark on the withhold limb.
 *
 * ## ⛔ Why every case DRIVES the real route rather than calling the builder
 *
 * The population of producers that mark text on these throw-transparent routes
 * (`/analytics/*`, `/mcp/skill`, `/notifications`, `/i18n`, `/automation`) is
 * **empty today** — measured at claim: the only two in-repo `userMessage`
 * producers are the sandbox (`quickjs-runner`, reached via `/actions`, which
 * `domains/actions.ts` catches and answers through `errorFromThrown`) and
 * `metadata-protocol`'s `markedApplicationRefusalError` (reached via the REST
 * `/meta` and `/data` doors). Neither reaches this exit. So this change is a
 * **no-op on today's tree**, a green suite proves nothing by itself, and nothing
 * here may be established by a route test that never reaches the field. Every
 * case therefore throws its shape through the REAL mounted
 * `POST /api/v1/analytics/query` route — the throw-transparent instrument
 * `dispatcher-plugin.declared-5xx-prose-withhold.test.ts` established — and
 * reads the answer off the wire.
 *
 * ## ⛔ Absence is asserted twice, because one of the two is blind
 *
 * `JSON.stringify` **silently drops a key whose value is `undefined`**, so a
 * byte assertion alone cannot tell "the field was omitted" from "the field was
 * emitted as `undefined`". The second is a real defect — it puts an
 * `ApiErrorSchema` key on the envelope object that a consumer's `in` / `hasOwn`
 * probe answers `true` for, which is precisely the "absent means the consumer
 * keeps its generic substitution" rule (#3821, preserved by construction in
 * `declaredUserMessage`) failing open. Every omission case below therefore
 * asserts on `Object.keys(error)` **and** on the serialized bytes; neither alone
 * is accepted anywhere in this file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

// ── harness (the shape the sibling withhold test uses) ───────────────────────

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: {
            get: rec('GET'),
            post: rec('POST'),
            put: rec('PUT'),
            delete: rec('DELETE'),
            patch: rec('PATCH'),
        },
    };
}

function makeCtx(fakeServer: any, analytics: unknown) {
    const kernel = {
        getService: (name: string) => (name === 'analytics' ? analytics : undefined),
        getServiceAsync: async (name: string) => (name === 'analytics' ? analytics : undefined),
    };
    return {
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {},
        on: () => {},
    } as any;
}

function makeRes() {
    const res: any = {
        statusCode: undefined as number | undefined,
        body: undefined as any,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: any) { res.body = b; return res; },
    };
    return res;
}

/**
 * Drive the REAL `POST /api/v1/analytics/query` route with an analytics service
 * that throws `thrown`.
 *
 * The route is throw-transparent — `HttpDispatcher.dispatch`'s foot catch
 * handles `PermissionDenied` and rethrows everything else — so the error
 * reaching `errorResponseBase` is the one this stub actually threw.
 */
async function throwFromAnalyticsQuery(thrown: unknown) {
    const { server, handlers } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server, { query: async () => { throw thrown; } }));

    const handler = handlers['POST /api/v1/analytics/query'];
    expect(handler, 'POST /api/v1/analytics/query must be mounted').toBeTypeOf('function');

    const res = makeRes();
    await handler({ body: { cube: 'pipeline', measures: ['revenue'] }, query: {} }, res);
    return res;
}

/** A thrown shape carrying `props`, with prose that is not a driver dump. */
function declaring(props: Record<string, unknown>, message: string) {
    return Object.assign(new Error(message), props);
}

/**
 * The two-limbed absence assertion. ⛔ Never use one limb alone — see the module
 * docblock: `JSON.stringify` drops an `undefined` value, so the byte check is
 * blind to the `{ userMessage: undefined }` leak that the key check catches, and
 * the key check alone would miss the mark reaching the wire under some other
 * key.
 */
function expectNoUserMessageAnywhere(res: any) {
    expect(Object.keys(res.body.error)).not.toContain('userMessage');
    expect(Object.prototype.hasOwnProperty.call(res.body.error, 'userMessage')).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('userMessage');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[#13241] the dispatcher throw-transparent exit carries `userMessage`', () => {
    let errSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { errSpy.mockRestore(); });

    describe('§1 the compensation pairing — a DECLARED 5xx loses its prose and keeps its mark', () => {
        /**
         * The card's own case, and the one the #12509 ruling's second clause
         * asserts. Both halves are read off ONE response, because the claim
         * being pinned is that they happen together: asserting them in separate
         * tests would let a door that withholds everything satisfy the first and
         * a door that withholds nothing satisfy the second.
         */
        it('prose withheld, `userMessage` delivered verbatim, in one response', async () => {
            const res = await throwFromAnalyticsQuery(
                declaring(
                    { status: 503, code: 'SERVICE_UNAVAILABLE', userMessage: 'Reporting is briefly offline. Try again in a few minutes.' },
                    'Upstream warehouse pool exhausted for tenant acme_prod.',
                ),
            );

            expect(res.statusCode).toBe(503);
            expect(res.body.success).toBe(false);

            // The withhold still holds — this change must not re-open #12281.
            expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
            expect(JSON.stringify(res.body)).not.toContain('acme_prod');

            // …and the author's channel now survives it.
            expect(res.body.error.userMessage).toBe('Reporting is briefly offline. Try again in a few minutes.');

            // The mark never MOVES the status or the code (#9934's third
            // constraint) — a marked fault is still the sanitised fault.
            expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
        });

        it('an UNMARKED declared 5xx is byte-identical to before — the mark is opt-in', async () => {
            // The regression guard on the paragraph above: if the field were
            // synthesised from `message` rather than read from the throw, the
            // withheld prose would ride out on the new channel and #12281 would
            // be undone by its own compensation.
            const res = await throwFromAnalyticsQuery(
                declaring({ status: 503, code: 'SERVICE_UNAVAILABLE' }, 'Upstream warehouse pool exhausted for tenant acme_prod.'),
            );

            expect(res.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
            expectNoUserMessageAnywhere(res);
            expect(JSON.stringify(res.body)).not.toContain('acme_prod');
        });
    });

    describe('§2 status-agnostic (#9934) — the mark is not gated on the withhold limb', () => {
        /**
         * ⚠️ The rows below are the reason this repair is wider than the card's
         * framing. A 400/403/409 refusal carries no withhold at all, and still
         * lost its mark at this exit. `serverFaultProvenance` answers `undefined`
         * under 500, so any implementation that hung the mark off the 5xx
         * declaration limb would fail every row here while `§1` stayed green.
         */
        const MARKED: Array<{ status: number; code: string; prose: string; mark: string }> = [
            { status: 400, code: 'VALIDATION_FAILED', prose: 'measure revenue not additive over stage', mark: 'Pick a measure that adds up across stages.' },
            // ⚠️ `FORBIDDEN`, deliberately NOT `PERMISSION_DENIED` — see the
            // carve-out pinned below this table: a throw spelling
            // `PERMISSION_DENIED` never arrives at this exit at all. It is
            // answered by `HttpDispatcher.dispatch`'s foot catch, which since
            // #13623 carries the mark itself; this row keeps a status the foot
            // catch does NOT intercept, so it still measures THIS exit's 403.
            { status: 403, code: 'FORBIDDEN', prose: 'principal lacks cube_read on pipeline', mark: 'You do not have access to this report. Ask an admin for the Reporting role.' },
            { status: 409, code: 'RECORD_LOCKED', prose: 'cube pipeline locked by in-flight rebuild', mark: 'This report is being rebuilt. Try again shortly.' },
            { status: 503, code: 'SERVICE_UNAVAILABLE', prose: 'warehouse pool exhausted', mark: 'Reporting is briefly offline.' },
        ];

        for (const c of MARKED) {
            it(`${c.status} — the mark reaches the wire verbatim`, async () => {
                const res = await throwFromAnalyticsQuery(
                    declaring({ status: c.status, code: c.code, userMessage: c.mark }, c.prose),
                );

                expect(res.statusCode).toBe(c.status);
                expect(res.body.error.userMessage).toBe(c.mark);
                // Verbatim: not truncated, not re-wrapped, not merged into
                // `message`. `message` keeps its own wording for developers.
                expect(JSON.stringify(res.body)).toContain(c.mark);
                expect(res.body.error.message).not.toBe(c.mark);
            });
        }

        /**
         * ⭐ [#13623] THE CARVE-OUT MOVED — and this row is how a reader finds out.
         *
         * It was written as the opposite assertion (`expectNoUserMessageAnywhere`)
         * with a docblock saying, in terms: *"if a later change makes the denial
         * path throw-transparent, this test fails and tells the author that the
         * carve-out has moved"*. #13623 is that change, so the row is MOVED
         * deliberately rather than repaired green — the instrument worked, and
         * softening or deleting it would have thrown away the only signal.
         *
         * ⚠️ What moved is the MARK, not the route. The sentence the old
         * docblock opened with is still true: `HttpDispatcher.dispatch`'s foot
         * catch is not a pure rethrow — it recognises `isPermissionDeniedError`
         * (`name === 'PermissionDeniedError'` **or** `code === 'PERMISSION_DENIED'`
         * **or** a message starting `[Security] Access denied`) and answers it
         * itself via `this.error(…)` in
         * `packages/runtime/src/http-dispatcher.ts`. Such a throw still never
         * reaches `errorResponseBase`. What changed is that the OTHER door now
         * reads the same `declaredUserMessage` rule, so the mark survives both.
         *
         * ⇒ The row therefore pins a DIFFERENT door's behaviour from every other
         * row in this file, and is kept here on purpose: the two doors' answers
         * to one question belong in one place, and if either regresses the
         * failure names the door in its own title.
         *
         * ⛔ Still NOT a claim that this exit became throw-transparent. A
         * regression that made it so would silently satisfy this row; the pin
         * against that is `expect(res.body.error.details)` below — the foot
         * catch derives `details.object` from the ROUTE (`permissionDeniedErrorDetails`)
         * and `errorResponseBase` does nothing of the kind.
         */
        it('MOVED CARVE-OUT — a `PERMISSION_DENIED` 403 is answered by the foot catch, and now keeps its mark there', async () => {
            const res = await throwFromAnalyticsQuery(
                declaring(
                    { status: 403, code: 'PERMISSION_DENIED', userMessage: 'Ask an admin for the Reporting role.' },
                    'principal lacks cube_read on pipeline',
                ),
            );

            expect(res.statusCode).toBe(403);
            expect(res.body.error.code).toBe('PERMISSION_DENIED');
            // The half this card repaired: the author's channel now survives
            // the denial door too (#9934 is status-agnostic, and 403 is the
            // refusal class most likely to carry authored text).
            expect(res.body.error.userMessage).toBe('Ask an admin for the Reporting role.');
            // …verbatim, and never in place of the diagnostic channel.
            expect(JSON.stringify(res.body)).toContain('Ask an admin for the Reporting role.');
            expect(res.body.error.message).not.toBe('Ask an admin for the Reporting role.');
            // Still the foot catch answering, NOT this exit — the route-derived
            // `details` shape only that door produces. `/analytics/query` names
            // no object, so `permissionDeniedErrorDetails` contributes nothing
            // but the promoted `code`, and `details` is absent entirely.
            expect(res.body.error.details).toBeUndefined();
            // ⛔ #7450's withhold is untouched: the mark is a top-level sibling,
            // never `details` context.
            expect((res.body.error.details as any)?.userMessage).toBeUndefined();
        });

        it('POSITIVE CONTROL (the denial door) — an UNMARKED `PERMISSION_DENIED` 403 still has no key', async () => {
            // Without this, the row above could pass on a door that always
            // reports a `userMessage`. Same route, same code, same status — the
            // ONLY difference is the mark.
            const res = await throwFromAnalyticsQuery(
                declaring({ status: 403, code: 'PERMISSION_DENIED' }, 'principal lacks cube_read on pipeline'),
            );

            expect(res.statusCode).toBe(403);
            expect(res.body.error.code).toBe('PERMISSION_DENIED');
            expectNoUserMessageAnywhere(res);
        });

        it('POSITIVE CONTROL — the SAME instrument omits the field for an unmarked throw at the same status', async () => {
            // Without this, every row above could pass on an instrument that
            // always reports a `userMessage`. Same route, same status, same
            // code — the ONLY difference is the mark, so presence is a measured
            // difference rather than a constant.
            const marked = await throwFromAnalyticsQuery(
                declaring({ status: 409, code: 'RECORD_LOCKED', userMessage: 'Try again shortly.' }, 'cube locked'),
            );
            const unmarked = await throwFromAnalyticsQuery(
                declaring({ status: 409, code: 'RECORD_LOCKED' }, 'cube locked'),
            );

            expect(marked.body.error.userMessage).toBe('Try again shortly.');
            expectNoUserMessageAnywhere(unmarked);
            expect(marked.statusCode).toBe(unmarked.statusCode);
            expect(marked.body.error.code).toBe(unmarked.body.error.code);
        });
    });

    describe('§3 omission is real absence, ⛔ never an `undefined` value', () => {
        /**
         * Each row is a shape `declaredUserMessage` answers `undefined` for. The
         * shared rule is deliberately NOT re-implemented here — these drive the
         * real route and read the wire, so a door that grew its own inline
         * `typeof` probe (the per-door drift #12509 exists to stop) fails them.
         */
        const NOT_A_DECLARATION: Array<{ name: string; props: Record<string, unknown> }> = [
            { name: 'no `userMessage` at all', props: { status: 409, code: 'RECORD_LOCKED' } },
            { name: 'empty string', props: { status: 409, code: 'RECORD_LOCKED', userMessage: '' } },
            { name: 'whitespace only', props: { status: 409, code: 'RECORD_LOCKED', userMessage: '   \t\n ' } },
            { name: 'a number, not a string', props: { status: 409, code: 'RECORD_LOCKED', userMessage: 42 } },
            { name: 'null', props: { status: 409, code: 'RECORD_LOCKED', userMessage: null } },
            { name: 'an object', props: { status: 409, code: 'RECORD_LOCKED', userMessage: { text: 'nope' } } },
            { name: 'a bare undeclared Error', props: {} },
        ];

        for (const c of NOT_A_DECLARATION) {
            it(`${c.name} → the key is absent, not present-and-undefined`, async () => {
                const res = await throwFromAnalyticsQuery(declaring(c.props, 'analytics query failed'));
                expectNoUserMessageAnywhere(res);
            });
        }

        it('⛔ the guard itself is falsifiable — it REJECTS a present-but-undefined key', () => {
            // The omission assertion is the load-bearing half of this file, and
            // its own failure mode is silence: a helper that only ever passed
            // would grade every row above green. So it is driven against the
            // exact shape it exists to catch. `JSON.stringify` drops the key, so
            // the byte limb alone reports this envelope as clean — which is why
            // `expectNoUserMessageAnywhere` does not rely on it.
            const leaked = { body: { error: { code: 'X', message: 'y', httpStatus: 409, userMessage: undefined } } };
            expect(JSON.stringify(leaked.body)).not.toContain('userMessage'); // the blind limb, demonstrated blind
            expect(() => expectNoUserMessageAnywhere(leaked)).toThrow();      // the guard still catches it
        });
    });

    describe('§4 the merged `extra` — `declaredCode` and `userMessage` are siblings, not rivals', () => {
        /**
         * ⚠️ This is the regression the implementation shape exists to prevent.
         * Both fields ride the same `extra` bag. Expressed as two conditional
         * spreads of `{ extra: … }` on one object literal they do not merge —
         * the later spread REPLACES the earlier — so a throw carrying both would
         * silently ship only one, and every other test in this file would stay
         * green because no other row carries both at once.
         *
         * `demotedDeclaredCode` is present exactly when the producer spelled a
         * code that did NOT survive into the closed vocabulary, so an
         * unregistered spelling on a declared status produces both fields.
         */
        it('a throw carrying BOTH a demoted `declaredCode` and a mark ships BOTH', async () => {
            const res = await throwFromAnalyticsQuery(
                declaring(
                    // The spelling below is deliberately OUTSIDE the closed vocabulary,
                    // because that is the only input that exercises the demotion path:
                    // `demotedDeclaredCode` yields a `declaredCode` exactly when the throw
                    // spelled something the narrowing rejected. A registered SCREAMING code
                    // here would produce no `declaredCode` at all, and this row would stop
                    // being the both-fields case and assert nothing.
                    // adr0112-ok: unregistered PRODUCER spelling, the fixture for the #9106 demotion path — the assertions below require that the closed-vocabulary `code` does NOT capture it, which is D1 holding rather than bending
                    { status: 409, code: 'acme_quota_exceeded', userMessage: 'Your plan is out of report credits this month.' },
                    'tenant acme_prod exceeded cube query quota',
                ),
            );

            expect(res.statusCode).toBe(409);
            expect(res.body.error.declaredCode).toBe('acme_quota_exceeded');
            expect(res.body.error.userMessage).toBe('Your plan is out of report credits this month.');

            // The closed-vocabulary `code` is still the narrowed one — the
            // producer's spelling rides the sibling, it does not capture `code`
            // (#9106, maintainer ruling 2026-08-16).
            expect(res.body.error.code).not.toBe('acme_quota_exceeded');
            expect(typeof res.body.error.code).toBe('string');
        });

        it('CONTROL — each field still travels alone', async () => {
            // Proves the row above is testing the MERGE and not merely that both
            // fields can exist. If `extra` were dropped entirely both of these
            // would fail too, which distinguishes "merge broken" from "extra
            // broken".
            const codeOnly = await throwFromAnalyticsQuery(
                // adr0112-ok: the same unregistered PRODUCER spelling and the same reason as the row above — this CONTROL shows `declaredCode` travelling without a mark, and only an off-vocabulary spelling produces a `declaredCode` to travel
                declaring({ status: 409, code: 'acme_quota_exceeded' }, 'quota exceeded'),
            );
            expect(codeOnly.body.error.declaredCode).toBe('acme_quota_exceeded');
            expectNoUserMessageAnywhere(codeOnly);

            const markOnly = await throwFromAnalyticsQuery(
                declaring({ status: 409, code: 'RECORD_LOCKED', userMessage: 'Try again shortly.' }, 'cube locked'),
            );
            expect(markOnly.body.error.userMessage).toBe('Try again shortly.');
            expect(Object.keys(markOnly.body.error)).not.toContain('declaredCode');
        });
    });

    describe('§5 the envelope stays ADR-0112-shaped', () => {
        it('the mark is a declared SIBLING of `code`/`message`, never `details` context', async () => {
            // Where the string lands is the envelope decision (#9232 keeps
            // vocabulary and position apart), and `ApiErrorSchema.userMessage`
            // is a top-level optional — not a `details` member. A repair that
            // parked it in `details` would satisfy a naive byte assertion.
            const res = await throwFromAnalyticsQuery(
                declaring({ status: 409, code: 'RECORD_LOCKED', userMessage: 'Try again shortly.' }, 'cube locked'),
            );

            expect(res.body.error.userMessage).toBe('Try again shortly.');
            expect((res.body.error.details as any)?.userMessage).toBeUndefined();
        });
    });
});
