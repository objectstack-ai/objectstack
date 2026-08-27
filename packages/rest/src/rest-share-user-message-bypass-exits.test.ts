// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12693] The record-share family carries the producer's `userMessage` on its
 * TWO exits that never reach the classified re-dress: the 500 fault terminal,
 * and the ADR-0111 message-prefix arm.
 *
 * ## Why this is a third card and not a re-run of its neighbour
 *
 * #12669 fork (a) (`rest-share-user-message.test.ts`) repaired the arm that
 * asks `classifiedRefusalAnswer` and re-dresses its answer. These two exits are
 * reached precisely when that arm did NOT answer:
 *
 *   - the **500 fault terminal**, because a declared server fault is
 *     deliberately not a refusal — `classifiedRefusalAnswer` hands a 5xx back
 *     to "the catching route's own terminal" in as many words, and these three
 *     arms are that terminal;
 *   - the **prefix arm**, because it runs only after the classification
 *     answered `undefined`.
 *
 * So neither holds a `refusal.body`, and the classified arm's one line is not
 * reusable at either. The value comes from `boundedDeclaredUserMessage`
 * instead — the same rule (`declaredUserMessage`'s presence answer, #5423's
 * bound) asked of the raw thrown error. §5 pins that the two doors agree on
 * the VALUE, which is what makes it one rule rather than two agreeing copies.
 *
 * ## Reproduced before it was repaired, on `15bf9e859`
 *
 * One marked producer per exit, driven through the REAL routes on both doors:
 *
 * ```text
 * throw { code: 'SHARE_STORE_DOWN', status: 503, userMessage: '…recovers…' }
 *   share GET/POST/DELETE : 500 {"code":"SHARES_LIST_FAILED",
 *                                "message":"share store connection reset"}
 *   /data door            : 503 {"code":"SERVICE_UNAVAILABLE",
 *                                "declaredCode":"SHARE_STORE_DOWN",
 *                                "userMessage":"…recovers…"}
 *
 * throw Error('NOT_FOUND: no such record account/a1') + userMessage
 *   share GET/POST/DELETE : 404 {"code":"NOT_FOUND",
 *                                "message":"no such record account/a1"}
 *   /data door            : 500 {"code":"INTERNAL_ERROR",
 *                                "userMessage":"Check the record link…"}
 * ```
 *
 * ⭐ The second row is the card's OPEN question, measured rather than assumed:
 * the prefix exit had no precedent of its own (the fault terminal has one —
 * #9934 deliberately rides the mark onto fault terminals). The measurement
 * answers it. `/data` carries the mark for that identical throw, on all five
 * prefixes (§3), so the two doors disagree and the exit is in. Had `/data`
 * omitted it there, the two doors would have AGREED and there would have been
 * nothing to repair — §3 is the test that would have said so.
 *
 * ## ⛔ Three deliberate door disagreements this repair does NOT touch
 *
 * They are visible in the very measurement above and reporting them as defects
 * would cost as much as missing one. §4b pins all three as STILL PRESENT, so a
 * later "tidy-up" reds here:
 *
 *   1. the share family folds a declared `503` into its own `500` terminal;
 *   2. it interpolates the caught message where `/data` withholds 5xx prose
 *      unconditionally (#5437);
 *   3. `/data` answers the prefix shape `500 INTERNAL_ERROR` rather than the
 *      prefix's status — the prefix idiom is `plugin-sharing`'s own local
 *      convention (ADR-0111) and no shared classifier can read it.
 *
 * ⚠️ §4b is NOT evidence of the repair and is predicted GREEN under the
 * ablation below: it constrains the repair's blast radius, nothing more.
 *
 * ## Producers are BUILT here, deliberately
 *
 * `git grep -c userMessage -- packages/plugins/plugin-sharing` is **0**
 * (positive control: `throw ` hits 25 files), so no in-tree producer reaches
 * these paths today. This file therefore injects its own throws. What is being
 * pinned is that the DECLARED channel is wired at these exits — ⛔ not that any
 * shipping code is losing a sentence right now.
 *
 * ## The ablation — predicted, then MEASURED
 *
 * Deleting the repair (the `sharingDeclaredExtra` argument at its four call
 * sites) and re-running this file: **16 of 21 red**. Mutation confirmed on
 * disk before any verdict was read — the anchored count went 4 -> 0 and the
 * blob hash `0112c6b7` -> `b079cac4` — and restored by
 * `git checkout HEAD -- <absolute path>`, proven by the blob hash returning to
 * `0112c6b7` and an empty `git diff HEAD`.
 *
 *   §1  RED (4/4) — the fault terminal loses every mark again, x3 routes
 *   §2  RED (6/6) — all five prefixes lose theirs, x3 routes, and the
 *                   `startsWith`-not-`includes` row loses the mark its
 *                   fall-through was supposed to ride
 *   §3  RED (1/2) — the door-to-door comparison IS the reproduction; its
 *                   `/data`-only half needs no share door and stays green
 *   §4a RED (2/2) — ⚠️ the absences alone are satisfied by an unrepaired door,
 *                   which is why each carries a positive control in the same
 *                   body. Measured: it is the CONTROL that reds, naming itself
 *                   ("positive control - a MARKED producer must carry its
 *                   sentence"). A §4a that went GREEN here would have been the
 *                   alarm that its zeroes prove nothing
 *   §4b GRN (0/3) — as predicted: it pins what the repair must not move
 *   §5  RED (2/2) — no sentence arrives, so no bound can be observed on it
 *   §6  RED (1/2) — the forwarding matrix reds on the half that DID ship; the
 *                   envelope-shape half needs no mark and stays green
 *
 * ⚠️ Recorded because the prediction was written first and one number in it
 * was wrong: §2 was predicted "2/2" by counting the section's two `it` shapes
 * instead of the six cases the table expands to. Every section's DIRECTION was
 * predicted correctly; the totals above are the measurement, not the guess.
 *
 * Every failure names itself: the route, the body it got and the exact string
 * expected.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — this package resolves `nodenext`, so an extensionless
// relative import is a `tsc` error (TS2835).
import { RestServer } from './rest-server.js';
import { handleRouteError } from './error-response.js';
import { declaredUserMessage, INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { ApiErrorSchema } from '@objectstack/spec/api';

const LIST = '/api/v1/data/:object/:id/shares';
const REVOKE = '/api/v1/data/:object/:id/shares/:shareId';

/** #5423's bound, restated as the OBSERVABLE it produces, not re-imported. */
const CLIENT_MESSAGE_MAX = 500;

type Answer = { status: number; body: any };

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(function (this: any) { return this; }),
        end: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any) { return this; }),
    };
    return res;
}

/**
 * The shape `runtime/src/sandbox/quickjs-runner.ts` produces: `.message` is the
 * `<kind> '<name>' threw: <msg>` debug wrapper and `.innerMessage` the business
 * text. Reproduced here so `@objectstack/rest` does not depend on
 * `@objectstack/runtime` to run its own tests — the same fixture the two
 * sibling share-door files use. It matters at THIS exit for one reason: a
 * sandbox refusal that declared a 5xx lands on the fault terminal with its
 * prose withheld, and §1 row 4 pins the mark travelling anyway.
 */
function sandboxRefusal(businessMessage: string, extra: Record<string, unknown> = {}) {
    const err: any = new Error(`hook 'guard' threw: Error: ${businessMessage}`);
    err.name = 'SandboxError';
    err.innerMessage = businessMessage;
    return Object.assign(err, extra);
}

/** A producer's throw, carrying whatever it declares. */
function refusal(message: string, carried: Record<string, unknown> = {}) {
    return Object.assign(new Error(message), carried);
}

/**
 * The three catch sites this family has, each driven through the REAL route
 * with a service verb that rejects — plus a witness that the verb was actually
 * called, so a case that silently never reached the seam cannot "pass" on a
 * body it got for some entirely different reason.
 */
function boot(err: unknown) {
    const service = {
        listShares: vi.fn().mockRejectedValue(err),
        grant: vi.fn().mockRejectedValue(err),
        revoke: vi.fn().mockRejectedValue(err),
    };
    const rest = new RestServer(
        mockServer() as any,
        { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: {} }) } as any,
        { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
        (async () => service) as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_admin' });
    rest.registerRoutes();

    const drive = async (method: string, path: string): Promise<Answer> => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const res = mockRes();
        await found.handler(
            {
                method, path, headers: {}, query: {}, body: {},
                params: { object: 'account', id: 'a1', shareId: 'shr_X' },
            } as any,
            res,
        );
        const calls = res.json.mock.calls;
        return { status: res.statusCode, body: calls[calls.length - 1]?.[0] };
    };

    return { service, drive };
}

/** All three routes, with the seam-reached witness for each. */
async function allThree(err: unknown): Promise<Array<[string, Answer]>> {
    const { service, drive } = boot(err);
    const list = await drive('GET', LIST);
    expect(service.listShares.mock.calls.length, 'GET never reached listShares').toBe(1);
    const grant = await drive('POST', LIST);
    expect(service.grant.mock.calls.length, 'POST never reached grant').toBe(1);
    const revoke = await drive('DELETE', REVOKE);
    expect(service.revoke.mock.calls.length, 'DELETE never reached revoke').toBe(1);
    return [['GET shares', list], ['POST shares', grant], ['DELETE shares/:shareId', revoke]];
}

/** The wire answer the flat `/data` door gives for the same error. */
function throughDataDoor(error: any): Answer {
    const res = mockRes();
    handleRouteError(res, error);
    const calls = res.json.mock.calls;
    return { status: res.statusCode, body: calls[calls.length - 1]?.[0] };
}

/**
 * The ADR-0112 D5 pair at the NESTED position, asserted beside every claim so a
 * repair that moved this family onto the flat dialect — or that put
 * `userMessage` at the body's top level, where the flat door carries it —
 * cannot pass here.
 */
function expectNestedEnvelope(answer: Answer, status: number, code: string): any {
    expect(
        answer.status,
        `expected ${status}, got ${answer.status} with body ${JSON.stringify(answer.body)}`,
    ).toBe(status);
    expect(answer.body?.error?.code).toBe(code);
    expect(typeof answer.body?.error?.message).toBe('string');
    expect(answer.body).not.toHaveProperty('userMessage');
    expect(answer.body).not.toHaveProperty('code');
    const parsed = ApiErrorSchema.safeParse(answer.body?.error);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    return answer.body.error;
}

/** The `code` each route's own 500 terminal answers with. */
const FAULT_CODE: Record<string, string> = {
    'GET shares': 'SHARES_LIST_FAILED',
    'POST shares': 'SHARE_GRANT_FAILED',
    'DELETE shares/:shareId': 'SHARE_REVOKE_FAILED',
};

const RECOVERING = 'Sharing is read-only while the store recovers; try again in a few minutes.';

// ─────────────────────────────────────────────────────────────────────────────
// §1 Exit A — the 500 fault terminal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every way a marked throw can reach the fault terminal rather than the
 * classification: a declared 5xx (both status spellings are produced in this
 * repo, #7525), an unclassified `Error`, and a sandbox refusal whose declared
 * 5xx puts it here with its prose withheld.
 */
const FAULTS: Array<{ name: string; error: unknown; message: string }> = [
    {
        name: 'the card producer — a declared 503 (`status`) with an app code',
        error: refusal('share store connection reset', {
            code: 'SHARE_STORE_DOWN', status: 503, userMessage: RECOVERING,
        }),
        message: 'share store connection reset',
    },
    {
        name: 'a declared 500 (`statusCode`, #7525) with an app code',
        error: refusal('share index corrupt', {
            code: 'SHARE_INDEX_CORRUPT', statusCode: 500, userMessage: RECOVERING,
        }),
        message: 'share index corrupt',
    },
    {
        // Nothing declared at all — the card's second fault shape.
        name: 'an UNCLASSIFIED `Error` carrying only the mark',
        error: refusal('connection reset', { userMessage: RECOVERING }),
        message: 'connection reset',
    },
    {
        // ⭐ The row that shows the mark and the WITHHELD PROSE are two
        // different decisions: `sharingFaultMessage` replaces the QuickJS
        // wrapper with the generic sentence, and the author's own text still
        // travels. #9934's argument, exercised rather than quoted.
        name: 'a sandboxed body on a declared 5xx — prose withheld, mark carried',
        error: sandboxRefusal('the share index is being rebuilt', {
            code: 'SHARE_INDEX_REBUILDING', status: 503, userMessage: RECOVERING,
        }),
        message: INTERNAL_ERROR_MESSAGE,
    },
];

describe('[#12693] §1 the 500 fault terminal carries the producer mark', () => {
    for (const fault of FAULTS) {
        it(fault.name, async () => {
            for (const [route, answer] of await allThree(fault.error)) {
                const err = expectNestedEnvelope(answer, 500, FAULT_CODE[route]!);
                expect(
                    err.userMessage,
                    `${route}: expected the author's sentence, got ${JSON.stringify(answer.body)}`,
                ).toBe(RECOVERING);
                // ⛔ Scope guard, in the same body: the prose the terminal
                // already put on the wire is untouched by the mark.
                expect(err.message, `${route}: the terminal's own message moved`)
                    .toBe(fault.message);
            }
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 Exit B — the ADR-0111 prefix-idiom arm
// ─────────────────────────────────────────────────────────────────────────────

/** All five prefixes the arm maps, each with its own author sentence. */
const PREFIXES: Array<{ prefix: string; status: number; rest: string; mark: string }> = [
    {
        prefix: 'VALIDATION_FAILED', status: 400,
        rest: 'accessLevel must be read or edit',
        mark: 'Pick either read or edit access.',
    },
    {
        prefix: 'PERMISSION_DENIED', status: 403,
        rest: 'not a manager of account/a1',
        mark: 'Ask a record manager to share it for you.',
    },
    {
        prefix: 'NOT_FOUND', status: 404,
        rest: 'no such record account/a1',
        mark: 'Check the record link you were given.',
    },
    {
        prefix: 'CONFLICT', status: 409,
        rest: 'already shared with that recipient',
        mark: 'That recipient already has access.',
    },
    {
        prefix: 'SHARING_NOT_ENABLED', status: 422,
        rest: 'org posture is private',
        mark: 'Ask an admin to turn sharing on for this org.',
    },
];

describe('[#12693] §2 the ADR-0111 prefix arm carries the producer mark', () => {
    for (const { prefix, status, rest, mark } of PREFIXES) {
        it(`\`${prefix}:\` → ${status}, on all three routes`, async () => {
            const error = refusal(`${prefix}: ${rest}`, { userMessage: mark });
            for (const [route, answer] of await allThree(error)) {
                const err = expectNestedEnvelope(answer, status, prefix);
                expect(
                    err.userMessage,
                    `${route}: expected the author's sentence, got ${JSON.stringify(answer.body)}`,
                ).toBe(mark);
                // ⛔ The PREFIX read and its stripping are untouched: the arm
                // still answers the stripped remainder, not the raw message.
                expect(err.message, `${route}: the stripped remainder moved`).toBe(rest);
            }
        });
    }

    it('the arm still refuses to classify a message that only CONTAINS a prefix', async () => {
        // `startsWith`, not `includes` — a producer whose sentence merely
        // mentions `NOT_FOUND` falls through to the fault terminal, and the
        // mark rides THAT instead. Pins the two exits as distinct rather than
        // one over-eager match.
        const error = refusal('lookup failed: NOT_FOUND was returned by the index', {
            userMessage: RECOVERING,
        });
        for (const [route, answer] of await allThree(error)) {
            const err = expectNestedEnvelope(answer, 500, FAULT_CODE[route]!);
            expect(err.userMessage).toBe(RECOVERING);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 Door-to-door — the reproduction, and ruling 1's open question
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12693] §3 both doors carry the same producer mark for the same throw', () => {
    it('the fault shape and the prefix shape, share door vs `/data` door', async () => {
        const cases: Array<[string, any, string]> = [
            [
                'declared 503 + app code',
                refusal('share store connection reset', {
                    code: 'SHARE_STORE_DOWN', status: 503, userMessage: RECOVERING,
                }),
                RECOVERING,
            ],
            ...PREFIXES.map(({ prefix, rest, mark }) => [
                `\`${prefix}:\` prefix idiom`,
                refusal(`${prefix}: ${rest}`, { userMessage: mark }),
                mark,
            ] as [string, any, string]),
        ];

        for (const [name, error, mark] of cases) {
            const flat = throughDataDoor(error);
            // The `/data` half of the comparison — ⭐ this is the measurement
            // ruling 1 asked for on the prefix exit, which had no precedent of
            // its own. `/data` carrying the mark is what makes the share
            // door's silence a DISAGREEMENT rather than two doors agreeing.
            expect(
                flat.body?.userMessage,
                `${name}: /data door did not carry the mark — body ${JSON.stringify(flat.body)}`,
            ).toBe(mark);

            for (const [route, answer] of await allThree(error)) {
                expect(
                    answer.body?.error?.userMessage,
                    `${name} @ ${route}: share door dropped the mark `
                    + `while /data carried it — share ${JSON.stringify(answer.body)} `
                    + `vs /data ${JSON.stringify(flat.body)}`,
                ).toBe(flat.body.userMessage);
            }
        }
    });

    it('and the `/data` door is not simply stamping every body (anti-vacuity)', () => {
        // Drives ONLY `/data`, so it is green with or without the repair —
        // deliberately. It is here so the row above cannot pass by `/data`
        // attaching the field to everything it answers.
        const unmarked = throughDataDoor(refusal('NOT_FOUND: no such record account/a1'));
        expect(unmarked.body).not.toHaveProperty('userMessage');
        expect(declaredUserMessage(refusal('x'))).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4a Absence — and why each carries its own positive control
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12693] §4a nothing is invented for a producer that marked nothing', () => {
    it('an UNMARKED throw gets no `userMessage` at either exit', async () => {
        for (const error of [
            refusal('connection reset'),
            refusal('NOT_FOUND: no such record account/a1'),
        ]) {
            for (const [route, answer] of await allThree(error)) {
                expect(
                    answer.body?.error,
                    `${route}: invented a mark for an unmarked producer — ${JSON.stringify(answer.body)}`,
                ).not.toHaveProperty('userMessage');
            }
        }
        // ⚠️ Positive control, in the same body: the absences above are
        // satisfied by an unrepaired door too, so they prove nothing alone.
        // This is the half that reds under the ablation.
        const marked = refusal('NOT_FOUND: no such record account/a1', { userMessage: RECOVERING });
        for (const [route, answer] of await allThree(marked)) {
            expect(
                answer.body?.error?.userMessage,
                `${route}: positive control — a MARKED producer must carry its sentence`,
            ).toBe(RECOVERING);
        }
    });

    it('a blank, whitespace-only or non-string mark is NOT a declaration', async () => {
        for (const carried of [
            { userMessage: '' },
            { userMessage: '   \t ' },
            { userMessage: 42 },
            { userMessage: null },
            { userMessage: { text: 'nope' } },
        ]) {
            for (const error of [
                refusal('connection reset', carried),
                refusal('CONFLICT: already shared', carried),
            ]) {
                for (const [route, answer] of await allThree(error)) {
                    expect(
                        answer.body?.error,
                        `${route}: ${JSON.stringify(carried)} was treated as a declaration — `
                        + JSON.stringify(answer.body),
                    ).not.toHaveProperty('userMessage');
                }
            }
        }
        // ⚠️ Positive control — same shapes, one real sentence.
        for (const error of [
            refusal('connection reset', { userMessage: RECOVERING }),
            refusal('CONFLICT: already shared', { userMessage: RECOVERING }),
        ]) {
            for (const [route, answer] of await allThree(error)) {
                expect(
                    answer.body?.error?.userMessage,
                    `${route}: positive control — a real sentence must arrive`,
                ).toBe(RECOVERING);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4b ⛔ The three DELIBERATE door disagreements, pinned as still present
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12693] §4b the deliberate share-vs-/data differences are NOT tidied up', () => {
    it('a declared 503 still folds into this family\'s own 500 terminal', async () => {
        const error = refusal('share store connection reset', {
            code: 'SHARE_STORE_DOWN', status: 503, userMessage: RECOVERING,
        });
        expect(throughDataDoor(error).status, '/data still answers the declared 503').toBe(503);
        for (const [route, answer] of await allThree(error)) {
            expect(answer.status, `${route}: the 500 fold moved`).toBe(500);
            expect(answer.body?.error?.code).toBe(FAULT_CODE[route]);
        }
    });

    it('the 5xx terminal still interpolates the caught message where `/data` withholds it', async () => {
        const error = refusal('share store connection reset', {
            code: 'SHARE_STORE_DOWN', status: 503, userMessage: RECOVERING,
        });
        expect(throughDataDoor(error).body?.error, '/data still withholds 5xx prose (#5437)')
            .toBe(INTERNAL_ERROR_MESSAGE);
        for (const [route, answer] of await allThree(error)) {
            expect(answer.body?.error?.message, `${route}: the interpolation moved`)
                .toBe('share store connection reset');
        }
    });

    it('`/data` still cannot read the ADR-0111 prefix idiom, and is not taught to', async () => {
        for (const { prefix, rest, mark } of PREFIXES) {
            const error = refusal(`${prefix}: ${rest}`, { userMessage: mark });
            const flat = throughDataDoor(error);
            expect(flat.status, `${prefix}: /data was taught the local prefix idiom`).toBe(500);
            expect(flat.body?.code).toBe('INTERNAL_ERROR');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 #5423's bound reaches these exits, from the same definition
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12693] §5 the mark is bounded here exactly as the twin door bounds it', () => {
    const LONG = `${'x'.repeat(CLIENT_MESSAGE_MAX + 100)}TAIL`;

    it('an over-long mark is TRUNCATED, not replaced, at both exits', async () => {
        for (const error of [
            refusal('connection reset', { userMessage: LONG }),
            refusal('NOT_FOUND: no such record account/a1', { userMessage: LONG }),
        ]) {
            for (const [route, answer] of await allThree(error)) {
                const got = answer.body?.error?.userMessage;
                expect(typeof got, `${route}: no mark arrived at all`).toBe('string');
                expect(got.length, `${route}: bound not applied — ${got.length} chars`)
                    .toBe(CLIENT_MESSAGE_MAX);
                // Truncate-never-replace: the head survives verbatim.
                expect(got.startsWith('x'.repeat(50))).toBe(true);
                expect(got.endsWith('…'), `${route}: not an ellipsis truncation`).toBe(true);
                expect(got, `${route}: the tail leaked past the bound`).not.toContain('TAIL');
            }
        }
    });

    it('and the bounded VALUE is byte-equal to the one `/data` publishes', async () => {
        // ⭐ One rule, not two agreeing copies: had the exits open-coded
        // `error.userMessage`, this is the row that would separate them.
        for (const error of [
            refusal('connection reset', { userMessage: LONG }),
            refusal('NOT_FOUND: no such record account/a1', { userMessage: LONG }),
        ]) {
            const flat = throughDataDoor(error);
            for (const [route, answer] of await allThree(error)) {
                expect(answer.body?.error?.userMessage, `${route}: doors bound differently`)
                    .toBe(flat.body?.userMessage);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 Scope — exactly one key is added, and the envelope does not move
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12693] §6 the exits forward the mark and nothing else', () => {
    it('the producer\'s structured `issues` is NOT forwarded (that is #12669 fork (b))', async () => {
        const error = refusal('NOT_FOUND: no such record account/a1', {
            userMessage: RECOVERING,
            issues: [{ path: ['recipientId'], message: 'unknown recipient' }],
        });
        for (const [route, answer] of await allThree(error)) {
            const err = expectNestedEnvelope(answer, 404, 'NOT_FOUND');
            // The half that DID ship — so this cannot pass by the whole
            // forward having failed.
            expect(err.userMessage, `${route}: the mark did not arrive`).toBe(RECOVERING);
            expect(err, `${route}: forwarded a channel this card did not open`)
                .not.toHaveProperty('issues');
            expect(err, `${route}: mapped \`issues\` onto \`details\``)
                .not.toHaveProperty('details');
            expect(answer.body).not.toHaveProperty('issues');
        }
    });

    it('the key set is exactly what it was, plus `userMessage`', async () => {
        // Needs no mark, so it is green with or without the repair — it is the
        // shape guard, not the evidence. `code` + `message` are the two the
        // nested D5 envelope has always carried at these exits.
        for (const error of [
            refusal('connection reset'),
            refusal('NOT_FOUND: no such record account/a1'),
        ]) {
            for (const [, answer] of await allThree(error)) {
                expect(Object.keys(answer.body.error).sort()).toEqual(['code', 'message']);
                expect(Object.keys(answer.body).sort()).toEqual(['error', 'success']);
            }
        }
    });
});
