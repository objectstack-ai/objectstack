// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12669 fork (a)] The record-share family carries the producer's own
 * caller-facing sentence on the nested envelope's `userMessage`, instead of
 * dropping the one it was already holding.
 *
 * ## The defect, reproduced before it was repaired
 *
 * `respondSharingError` (`rest-server.ts`) asks {@link classifiedRefusalAnswer}
 * — the flat `/data` door's own classification — and re-dressed `status`,
 * `code`, the message and (since #12510) `declaredCode` into the nested
 * ADR-0112 D5 envelope (#8111). The classification's body was ALREADY carrying
 * the producer's `userMessage`, attached by `withDeclaredUserMessage` (#9934),
 * and it was dropped at the re-dress.
 *
 * Measured on `07e646565` before the repair, one producer driven through the
 * real routes on both doors:
 *
 * ```text
 * throw { code: 'CLOSE_PERIOD_LOCKED', status: 409,
 *         userMessage: 'Ask finance to reopen the period.' }
 *   share door : 409 {"success":false,"error":{"code":"RESOURCE_CONFLICT",
 *                     "message":"invoices still open",
 *                     "declaredCode":"CLOSE_PERIOD_LOCKED"}}
 *   /data door : 409 {"error":"invoices still open","code":"RESOURCE_CONFLICT",
 *                     "declaredCode":"CLOSE_PERIOD_LOCKED",
 *                     "userMessage":"Ask finance to reopen the period."}
 * ```
 *
 * Nothing invalid shipped — every body parsed as `ApiErrorSchema` — which is
 * what made the loss silent and one-directional: a console told by ADR-0112 to
 * render `userMessage` verbatim found nothing at this door and fell back to its
 * generic substitution, while the twin door serving the same throw rendered the
 * author's remedy.
 *
 * ## ⛔ This channel is NOT the shape of its `declaredCode` neighbour
 *
 * They arrive on adjacent lines and the next reader will assume they are
 * symmetric. They are not, and §6 holds them apart mechanically.
 *
 *   - `declaredCode` is read from the CLASSIFICATION because presence there
 *     MEANS demotion — an invariant the raw thrown field does not carry.
 *     #12510 owns that derivation; it is cited, not restated.
 *   - `userMessage` has no invariant left for a caller to re-derive.
 *     `declaredUserMessage` already decided PRESENCE (a non-empty string, or
 *     nothing — §2) and `truncateClientMessage` already applied #5423's bound
 *     (§5). The population is also strictly WIDER: a REGISTERED code demotes
 *     nothing and so carries no `declaredCode`, and still carries its author's
 *     sentence (§1 row 2).
 *
 * The sibling door at `package-routes` landed the same channel one card earlier
 * (#12502, `package-door-user-message.test.ts`) and states the same asymmetry
 * for the same reason. What differs HERE is only where the value is read: that
 * door holds a `ThrownHttpError` and passes `thrown.userMessage` straight
 * through, this one holds the classification's `{ status, body }` and carries
 * `body.userMessage` — the same rule's OUTPUT, asked once, re-dressed once.
 *
 * ## What is deliberately NOT asserted
 *
 * That the body "has one more field", or that `userMessage` is "defined". Both
 * pass for a door that stamps some other string there. Every positive case
 * names the exact sentence, §2 pins the absences, and §3 pins door-to-door
 * equality against the twin that was right.
 *
 * ## ⛔ Scope — fork (a) only
 *
 * The producer's structured `issues` is the OTHER half of #12669 and is not
 * touched here: the flat dialect carries it at the body's top level and the
 * nested envelope's channel is `ApiError.details`, so mapping one onto the
 * other is a shape decision on a contract field rather than a rename. §4 pins
 * that this change forwards no such key.
 *
 * ## The ablation — predicted, then MEASURED
 *
 * Deleting the repair (its local read and its spread) and re-running this file:
 * **15 of 21 red**, mutation confirmed on disk by anchored counts and blob hash
 * before any verdict was read, restored by `git checkout HEAD -- <path>` and
 * proven by an equal blob hash and an empty `git diff HEAD`.
 *
 *   §1 RED   (6/7) — every marked refusal loses its sentence again, x3 routes;
 *                    the row-distinctness check needs no door and stays green
 *   §2 RED   (4/4) — ⚠️ PREDICTED GREEN, and the prediction was wrong for a
 *                    reason worth keeping: the absences alone ARE satisfied by
 *                    an unrepaired door, which is why each test carries a
 *                    positive control in the same body — and it is the control
 *                    that reds. A §2 that had gone green here would have been
 *                    the warning that its zeroes prove nothing
 *   §3 RED   (1/2) — the door-to-door comparison is the reproduction itself;
 *                    its anti-vacuity half drives only `/data` and stays green
 *   §4 RED   (1/4) — the three "nothing moved" tests are green, as they must
 *                    be; the fork (b) test reds on the one line that asserts
 *                    the half which DID ship, so it cannot pass by the whole
 *                    re-dress having failed
 *   §5 RED   (2/2) — no sentence arrives, so no bound can be observed on it
 *   §6 RED   (1/2) — the matrix reds; its shape check needs no door
 *
 * Every failure names itself: the route, both doors' bodies and the exact
 * string expected.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — this package resolves `nodenext`, so an extensionless
// relative import is a `tsc` error (TS2835).
import { RestServer } from './rest-server.js';
import { handleRouteError } from './error-response.js';
import { declaredUserMessage } from '@objectstack/types';
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
 * `@objectstack/runtime` to run its own tests — the same fixture
 * `rest-share-declared-code.test.ts` uses. This limb matters for THIS channel
 * more than for any other: the sandbox relay is the one in-tree writer of
 * `userMessage` onto a throwable, so a metadata app's own remedy sentence is
 * the population the channel exists for.
 */
function sandboxRefusal(businessMessage: string, extra: Record<string, unknown> = {}) {
    const err: any = new Error(`hook 'guard' threw: Error: ${businessMessage}`);
    err.name = 'SandboxError';
    err.innerMessage = businessMessage;
    return Object.assign(err, extra);
}

/** A producer's throw, carrying whatever it declares. */
function refusal(message: string, carried: Record<string, unknown>) {
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
 * The ADR-0112 D5 pair at the NESTED position, asserted beside every claim
 * below so a repair that moved this family onto the flat dialect — or that put
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

const REMEDY = 'Ask finance to reopen the period.';

// ─────────────────────────────────────────────────────────────────────────────
// §1 The author's sentence reaches the wire, on all three routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both status spellings are produced in this repo (`metadata-protocol` throws
 * `status`, the lifecycle hooks throw `statusCode`, #7525), and the sandbox
 * limb is the OTHER way this family classifies a refusal.
 */
const MARKED: Array<{
    name: string; error: unknown; status: number; code: string;
    userMessage: string; declaredCode?: string;
}> = [
    {
        name: 'the card producer — an app spelling on a declared 409 (`status`)',
        error: refusal('invoices still open', {
            code: 'CLOSE_PERIOD_LOCKED', status: 409, userMessage: REMEDY,
        }),
        status: 409, code: 'RESOURCE_CONFLICT',
        userMessage: REMEDY, declaredCode: 'CLOSE_PERIOD_LOCKED',
    },
    {
        // ⭐ The row that shows the two channels are not one channel. A
        // REGISTERED code demotes nothing, so `declaredCode` is absent — and
        // the sentence still travels. A door that only ever emitted the mark
        // alongside a demote would fail exactly here.
        name: 'a REGISTERED code carries no `declaredCode` and still carries the sentence',
        error: refusal('this account is locked while month-end close runs', {
            code: 'RECORD_LOCKED', status: 409,
            userMessage: 'Month-end close is running; try again after it finishes.',
        }),
        status: 409, code: 'RECORD_LOCKED',
        userMessage: 'Month-end close is running; try again after it finishes.',
    },
    {
        name: 'an app spelling on a declared 403 (`statusCode`, #7525)',
        error: refusal('seat count exceeded', {
            code: 'ORG_LICENCE_INVALID', statusCode: 403,
            userMessage: 'Ask your workspace owner to add a seat.',
        }),
        status: 403, code: 'PERMISSION_DENIED',
        userMessage: 'Ask your workspace owner to add a seat.',
        declaredCode: 'ORG_LICENCE_INVALID',
    },
    {
        name: 'a sandboxed hook body that declared an app spelling, a 403 and a sentence',
        error: sandboxRefusal('only the record owner may re-share this account', {
            code: 'ONLY_OWNER_MAY_RESHARE', status: 403,
            userMessage: 'Ask the record owner to share it for you.',
        }),
        status: 403, code: 'PERMISSION_DENIED',
        userMessage: 'Ask the record owner to share it for you.',
        declaredCode: 'ONLY_OWNER_MAY_RESHARE',
    },
    {
        // The sandbox limb with NO declared status: `classifyDataError`'s unwrap
        // door answers 400 and the nested envelope fills the required `code`
        // from the catalog floor. The mark rides that arm too — #9934's rule is
        // branch-agnostic by construction.
        name: 'a sandboxed hook body with a sentence and NO declared status',
        error: sandboxRefusal('sharing is frozen until the access review closes', {
            userMessage: 'The quarterly access review closes on Friday.',
        }),
        status: 400, code: 'VALIDATION_ERROR',
        userMessage: 'The quarterly access review closes on Friday.',
    },
    {
        // `plugin-sharing`'s own write gate throws this (`sharing-plugin.ts`) —
        // the live in-repo producer at this seam.
        name: "plugin-sharing's own FORBIDDEN write-gate refusal, marked",
        error: refusal('FORBIDDEN: insufficient privileges to delete account a1', {
            code: 'FORBIDDEN', status: 403,
            userMessage: 'You can view this record but not change who it is shared with.',
        }),
        status: 403, code: 'FORBIDDEN',
        userMessage: 'You can view this record but not change who it is shared with.',
    },
];

describe('[#12669] a producer-marked `userMessage` rides the nested envelope on the share family', () => {
    for (const marked of MARKED) {
        it(`${marked.name}`, async () => {
            for (const [route, answer] of await allThree(marked.error)) {
                const error = expectNestedEnvelope(answer, marked.status, marked.code);
                expect(error.userMessage, `${route}: ${JSON.stringify(answer.body)}`)
                    .toBe(marked.userMessage);
                // The neighbour channel keeps its own rule on the same body:
                // present only where the demote happened (#12510).
                expect('declaredCode' in error, `${route}: ${JSON.stringify(answer.body)}`)
                    .toBe(marked.declaredCode !== undefined);
                if (marked.declaredCode !== undefined) {
                    expect(error.declaredCode, route).toBe(marked.declaredCode);
                }
            }
        });
    }

    it('the rows above really do produce different answers', () => {
        // Anti-vacuity for the table itself: rows collapsing to one answer
        // would agree with almost any implementation.
        const answers = MARKED.map((m) => `${m.status} ${m.code} ${m.userMessage} ${m.declaredCode}`);
        expect(new Set(answers).size).toBe(MARKED.length);
        // …and the table really does exercise BOTH sides of the neighbour rule.
        expect(MARKED.filter((m) => m.declaredCode !== undefined).length).toBeGreaterThan(0);
        expect(MARKED.filter((m) => m.declaredCode === undefined).length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 The door never INVENTS a mark — with its own positive control
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three shapes {@link declaredUserMessage} rejects, plus the ordinary
 * no-field case. ⭐ Each absence is asserted in the SAME test as a positive
 * control: the identical producer, marked, on the identical route. Without it
 * an absence assertion passes on a door that emits nothing at all — which is
 * precisely the pre-repair door, and precisely how a zero comes to be believed
 * for the wrong reason.
 */
const UNMARKED: Array<{ name: string; carried: Record<string, unknown> }> = [
    { name: 'no `userMessage` at all', carried: {} },
    { name: 'an empty-string `userMessage`', carried: { userMessage: '' } },
    { name: 'a whitespace-only `userMessage`', carried: { userMessage: '   \t  ' } },
    { name: 'a non-string `userMessage` (the #3842 drift)', carried: { userMessage: 42 } },
];

describe('[#12669] `userMessage` is ABSENT unless the producer actually marked one', () => {
    for (const unmarked of UNMARKED) {
        it(`${unmarked.name}`, async () => {
            const base = { code: 'CLOSE_PERIOD_LOCKED', status: 409 };
            const error = refusal('invoices still open', { ...base, ...unmarked.carried });
            // The shared predicate agrees this is unmarked — the rule stays
            // where it lives instead of being restated at this door.
            expect(declaredUserMessage(error)).toBeUndefined();

            for (const [route, answer] of await allThree(error)) {
                const body = expectNestedEnvelope(answer, 409, 'RESOURCE_CONFLICT');
                // Absent, not `undefined`-valued: a key present with `undefined`
                // survives `JSON.stringify` as an omission but would not through
                // every transport, and "the producer opted in" is a statement
                // about the KEY.
                expect(
                    'userMessage' in body,
                    `${route} emitted ${JSON.stringify(answer.body)}`,
                ).toBe(false);
            }

            // ⭐ POSITIVE CONTROL for the zero above. Same producer shape, same
            // routes, one marked field — if this does not carry, the absence
            // proved nothing.
            const marked = refusal('invoices still open', { ...base, userMessage: REMEDY });
            for (const [route, answer] of await allThree(marked)) {
                expect(
                    answer.body?.error?.userMessage,
                    `${route} control emitted ${JSON.stringify(answer.body)}`,
                ).toBe(REMEDY);
            }
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 Door-to-door — this family and `/data` answer one producer alike
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12669] the share door and the flat `/data` door agree on the marked sentence', () => {
    /**
     * Scoped to what {@link classifiedRefusalAnswer} answers — a CLASSIFIED
     * refusal. The 5xx band is deliberately outside it (a server fault is not a
     * refusal addressed to the caller), so the two doors are not twins there
     * and §4 pins this family's own terminal instead.
     */
    const CLASSIFIED: Array<{ name: string; error: unknown }> = [
        ...MARKED.map((m) => ({ name: m.name, error: m.error })),
        ...UNMARKED.map((u) => ({
            name: u.name,
            error: refusal('invoices still open', {
                code: 'CLOSE_PERIOD_LOCKED', status: 409, ...u.carried,
            }),
        })),
    ];

    it('every classified refusal carries the same `userMessage` at both doors', async () => {
        // This is the reproduction turned into a pin: the measurement that
        // opened the card was precisely a DISAGREEMENT between these two doors
        // about one producer's sentence, with the flat one right.
        for (const { name, error } of CLASSIFIED) {
            const flat = throughDataDoor(error);
            const expected = flat.body?.userMessage;
            for (const [route, answer] of await allThree(error)) {
                expect(
                    answer.body?.error?.userMessage,
                    `${name} @ ${route}: share door ${JSON.stringify(answer.body)} vs ` +
                    `/data door ${JSON.stringify(flat.body)}`,
                ).toBe(expected);
            }
        }
    });

    it('the comparison is not vacuous — the flat door really does answer both ways', () => {
        // ⭐ The positive control for the comparison itself. Without it, a
        // `/data` door that emitted nothing would make every row above compare
        // `undefined` to `undefined` — which is exactly what the share door was
        // doing before the repair.
        const carried = MARKED
            .map((m) => throughDataDoor(m.error).body?.userMessage)
            .filter((u) => typeof u === 'string');
        const bare = UNMARKED
            .map((u) => throughDataDoor(refusal('invoices still open', {
                code: 'CLOSE_PERIOD_LOCKED', status: 409, ...u.carried,
            })).body?.userMessage)
            .filter((u) => u === undefined);
        expect(carried.length).toBe(MARKED.length);
        expect(bare.length).toBe(UNMARKED.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 What must NOT move — the three channels already published, and the exits
//    this change does not touch
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12669] the channel added displaces nothing that was already there', () => {
    it('status, the closed `code` and the message are byte-identical to the pre-repair answers', async () => {
        // The three channels this family already published, restated as
        // literals so a repair that "carried" the sentence by overwriting one
        // of them cannot pass. These are the exact values measured on
        // `07e646565` before the change.
        for (const [route, answer] of await allThree(
            refusal('invoices still open', {
                code: 'CLOSE_PERIOD_LOCKED', status: 409, userMessage: REMEDY,
            }),
        )) {
            expect(answer.status, route).toBe(409);
            expect(answer.body.success, route).toBe(false);
            expect(answer.body.error.code, route).toBe('RESOURCE_CONFLICT');
            expect(answer.body.error.message, route).toBe('invoices still open');
            expect(answer.body.error.declaredCode, route).toBe('CLOSE_PERIOD_LOCKED');
        }
    });

    it('an unclassified fault still leaves through this family\'s own 500, unchanged', async () => {
        // A marked one, deliberately: `classifiedRefusalAnswer` declines a
        // fault, so the mark cannot reach the wire through the re-dress this
        // change touches, and this family's 500 terminal is where it stays.
        const answers = await allThree(Object.assign(new Error('connection reset'), {
            userMessage: REMEDY,
        }));
        expect(answers.map(([, a]) => a.status)).toEqual([500, 500, 500]);
        expect(answers.map(([, a]) => a.body.error.code)).toEqual([
            'SHARES_LIST_FAILED', 'SHARE_GRANT_FAILED', 'SHARE_REVOKE_FAILED',
        ]);
        for (const [route, a] of answers) {
            expect(a.body.error.message, route).toBe('connection reset');
        }
    });

    it('the ADR-0111 `CODE: message` prefix idiom keeps its own verdicts', async () => {
        // It declares no envelope, so the classification declines it and the
        // five-literal prefix map answers — untouched by this change.
        const answers = await allThree(new Error('NOT_FOUND: record account/a1 does not exist'));
        for (const [route, a] of answers) {
            expect(a.status, route).toBe(404);
            expect(a.body.error.code, route).toBe('NOT_FOUND');
            expect(a.body.error.message, route).toBe('record account/a1 does not exist');
        }
    });

    it('⛔ fork (b) is not shipped — the producer\'s structured `issues` reaches no key here', async () => {
        // #12669's other half. The flat door carries the producer's context at
        // the body's top level as `issues`; the nested envelope's channel is
        // `ApiError.details`, and mapping one onto the other is a shape
        // decision on a contract field. This asserts the CURRENT answer so the
        // decision, when it is taken, is taken deliberately.
        const error = refusal('two rows still reference it', {
            code: 'CLOSE_PERIOD_LOCKED', status: 409, userMessage: REMEDY,
            issues: [{ path: 'invoices', message: 'inv_1 is still open' }],
        });
        // Positive control for the two zeroes below: the flat door DOES carry
        // the context, so their absence is a statement about this door.
        expect(throughDataDoor(error).body?.issues).toEqual([
            { path: 'invoices', message: 'inv_1 is still open' },
        ]);
        for (const [route, answer] of await allThree(error)) {
            const body = expectNestedEnvelope(answer, 409, 'RESOURCE_CONFLICT');
            expect('issues' in body, `${route}: ${JSON.stringify(answer.body)}`).toBe(false);
            expect('details' in body, `${route}: ${JSON.stringify(answer.body)}`).toBe(false);
            // …and the half that DID ship is on the same body, so this test
            // cannot pass by the whole re-dress having failed.
            expect(body.userMessage, route).toBe(REMEDY);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 The bound is the classification's, not a second rule at this door
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12669] the sentence arrives already bounded — this door adds no second truncation', () => {
    it('a 600-character mark reaches both doors as the SAME bounded string', async () => {
        const long = 'L'.repeat(600);
        const error = refusal('invoices still open', {
            code: 'CLOSE_PERIOD_LOCKED', status: 409, userMessage: long,
        });
        const flat = throughDataDoor(error).body?.userMessage as string;

        // The observable #5423 asks for: truncated, never replaced.
        expect(typeof flat).toBe('string');
        expect(flat.length).toBe(CLIENT_MESSAGE_MAX);
        expect(flat.startsWith('L'.repeat(CLIENT_MESSAGE_MAX - 1))).toBe(true);
        expect(flat.endsWith('…')).toBe(true);

        for (const [route, answer] of await allThree(error)) {
            // Equal to the twin's, not merely "also truncated" — a second
            // `slice` at this door would be invisible to a length check that
            // used the same bound.
            expect(answer.body?.error?.userMessage, route).toBe(flat);
        }
    });

    it('a sentence UNDER the bound is verbatim, so the row above is not vacuous', async () => {
        for (const [route, answer] of await allThree(refusal('invoices still open', {
            code: 'CLOSE_PERIOD_LOCKED', status: 409, userMessage: REMEDY,
        }))) {
            expect(answer.body?.error?.userMessage, route).toBe(REMEDY);
            expect((answer.body?.error?.userMessage as string).endsWith('…'), route).toBe(false);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 The two channels compose without interacting — one throw, two rules
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12669] `userMessage` and `declaredCode` are independent at this door', () => {
    /**
     * ⛔ The pin that holds the asymmetry apart mechanically. A later author who
     * "harmonises" the two — running `userMessage` through a demote-style
     * helper, or gating it on a demote having happened — goes red here rather
     * than quietly inventing a rule that does not exist.
     */
    const MATRIX: Array<{
        name: string; carried: Record<string, unknown>;
        status: number; code: string;
        declaredCode: string | undefined; userMessage: string | undefined;
    }> = [
        {
            name: 'unregistered code + marked → both channels',
            carried: { code: 'CLOSE_PERIOD_LOCKED', status: 409, userMessage: REMEDY },
            status: 409, code: 'RESOURCE_CONFLICT',
            declaredCode: 'CLOSE_PERIOD_LOCKED', userMessage: REMEDY,
        },
        {
            name: 'unregistered code + unmarked → the demote alone',
            carried: { code: 'CLOSE_PERIOD_LOCKED', status: 409 },
            status: 409, code: 'RESOURCE_CONFLICT',
            declaredCode: 'CLOSE_PERIOD_LOCKED', userMessage: undefined,
        },
        {
            name: 'registered code + marked → the sentence alone',
            carried: { code: 'RECORD_LOCKED', status: 409, userMessage: REMEDY },
            status: 409, code: 'RECORD_LOCKED',
            declaredCode: undefined, userMessage: REMEDY,
        },
        {
            name: 'registered code + unmarked → neither',
            carried: { code: 'RECORD_LOCKED', status: 409 },
            status: 409, code: 'RECORD_LOCKED',
            declaredCode: undefined, userMessage: undefined,
        },
    ];

    it('all four corners of the matrix answer independently', async () => {
        for (const row of MATRIX) {
            for (const [route, answer] of await allThree(
                refusal('invoices still open', row.carried),
            )) {
                const body = expectNestedEnvelope(answer, row.status, row.code);
                const where = `${row.name} @ ${route}: ${JSON.stringify(answer.body)}`;
                expect(body.declaredCode, where).toBe(row.declaredCode);
                expect('declaredCode' in body, where).toBe(row.declaredCode !== undefined);
                expect(body.userMessage, where).toBe(row.userMessage);
                expect('userMessage' in body, where).toBe(row.userMessage !== undefined);
            }
        }
    });

    it('the matrix really is a matrix', () => {
        // Anti-vacuity: four corners, four distinct (declaredCode, userMessage)
        // presence pairs. A table where one axis never varies would pass under
        // a door that had fused the two channels.
        const corners = MATRIX.map((m) =>
            `${m.declaredCode !== undefined}/${m.userMessage !== undefined}`);
        expect(new Set(corners).size).toBe(4);
    });
});
