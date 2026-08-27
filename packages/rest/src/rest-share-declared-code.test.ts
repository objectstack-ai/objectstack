// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12510] The record-share family carries a DEMOTED producer spelling on the
 * nested envelope's `declaredCode`, instead of dropping the one it was already
 * holding.
 *
 * ## The defect, reproduced before it was repaired
 *
 * `respondSharingError` (`rest-server.ts`) asks {@link classifiedRefusalAnswer}
 * — the `/data` door's own classification — and then re-dressed only `status`,
 * `code` and the message into the nested ADR-0112 D5 envelope (#8111). The
 * classification's body was ALREADY carrying the demoted spelling, computed by
 * the one shared rule (`thrownCodeFields` → `demotedDeclaredCode`), and it was
 * dropped at the re-dress.
 *
 * Measured on `9a2f3dfe4` before the repair, one producer through both doors:
 *
 * ```text
 * throw { code: 'CLOSE_PERIOD_LOCKED', status: 409 }
 *   share door : 409 {"error":{"code":"RESOURCE_CONFLICT","message":"invoices still open"}}
 *   /data door : 409 {"error":"invoices still open","code":"RESOURCE_CONFLICT",
 *                     "declaredCode":"CLOSE_PERIOD_LOCKED"}
 * ```
 *
 * Nothing invalid shipped — the closed `code` still carried the member the
 * status derives — which is what made the loss silent and one-directional: the
 * author's spelling gone, and a consumer told by ADR-0112 to read
 * `declaredCode` finding nothing at this door while the twin carried it.
 *
 * ## Why the repair reads the CLASSIFICATION and not a second resolver call
 *
 * The near-twin at the direct-mount package registrar (#12405, PR #12508) holds
 * a `ThrownHttpError` in hand and passes `demotedDeclaredCode(thrown)`. This
 * call site does not hold one: it holds `classifiedRefusalAnswer`'s
 * `{ status, body }`, the flat answer whose `code` and message it is already
 * re-dressing. `body.declaredCode` is that same shared rule's OUTPUT — the flat
 * door's `thrownCodeFields` is literally `resolveThrownHttpError(error, status)`
 * followed by `demotedDeclaredCode` — so carrying it forwards the pair the rule
 * produced rather than asking the rule a second time at the re-dress. A second
 * call would be a second answer to a question this door deliberately asks once,
 * which is the shape that let the two `/api/v1/packages` doors drift apart in
 * the first place. §5 pins the equivalence from the outside so either side
 * drifting goes red.
 *
 * ⛔ What must NOT be read here is the resolver's RAW `thrown.declaredCode`.
 * Measured: a producer throwing `{ code: 'RECORD_LOCKED', status: 409 }`
 * resolves to `code: 'RECORD_LOCKED'` with `declaredCode: 'RECORD_LOCKED'`
 * beside it — the raw field records what the producer WROTE, not what was
 * demoted. Forwarding it would put two spellings of one fact on every
 * registered refusal, which is exactly the invariant `ApiErrorSchema`
 * documents for this field. §2 asserts the absence directly, on codes that ARE
 * ledger members.
 *
 * ## What is deliberately NOT asserted
 *
 * That the body merely "has one more field" or that `declaredCode` is
 * "defined". Both pass for a door that stamps the raw spelling on every
 * refusal. Every positive case below names the exact string, and §2 pins the
 * absence.
 *
 * ## Predicted before running the ablation (deleting the repair's two lines)
 *
 *   §1 RED    — the four demoting shapes lose the spelling again, x3 routes
 *   §2 GREEN  — the absences an unrepaired door satisfies too
 *   §3 RED    — for the demoting shapes only; the non-demoting rows stay green
 *   §4 GREEN  — the envelope, the prefix idiom and the 500 terminal never moved
 *   §5 RED    — for the demoting shapes only, same reason as §3
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — this package resolves `nodenext`, so an extensionless
// relative import is a `tsc` error (TS2835).
import { RestServer } from './rest-server.js';
import { handleRouteError, classifiedRefusalAnswer } from './error-response.js';
import { resolveThrownHttpError, demotedDeclaredCode } from '@objectstack/types';
import { ApiErrorSchema } from '@objectstack/spec/api';

const LIST = '/api/v1/data/:object/:id/shares';
const REVOKE = '/api/v1/data/:object/:id/shares/:shareId';

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
 * `rest-share-refusal-classification.test.ts` uses.
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
 * below so a repair that moved this family back to the flat dialect — or that
 * put `declaredCode` at the body's top level — cannot pass here.
 */
function expectNestedEnvelope(answer: Answer, status: number, code: string): any {
    expect(
        answer.status,
        `expected ${status}, got ${answer.status} with body ${JSON.stringify(answer.body)}`,
    ).toBe(status);
    expect(answer.body?.error?.code).toBe(code);
    expect(typeof answer.body?.error?.message).toBe('string');
    expect(answer.body).not.toHaveProperty('code');
    expect(answer.body).not.toHaveProperty('declaredCode');
    const parsed = ApiErrorSchema.safeParse(answer.body?.error);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    return answer.body.error;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 The demote reaches the wire, on all three routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both status spellings are produced in this repo (`metadata-protocol` throws
 * `status`, the lifecycle hooks throw `statusCode`, #7525), and the sandbox
 * limb is the OTHER way this family classifies a refusal — a metadata app's
 * own `.code` crossing the QuickJS boundary (#7867) is precisely the
 * population `declaredCode` exists for, and no ledger can enumerate it.
 */
const DEMOTED: Array<{
    name: string; error: unknown; status: number; code: string; declaredCode: string;
}> = [
    {
        name: 'an app spelling on a declared 409 (`status`)',
        error: refusal('invoices still open', { code: 'CLOSE_PERIOD_LOCKED', status: 409 }),
        status: 409, code: 'RESOURCE_CONFLICT', declaredCode: 'CLOSE_PERIOD_LOCKED',
    },
    {
        name: 'an app spelling on a declared 403 (`statusCode`, #7525)',
        error: refusal('seat count exceeded', { code: 'ORG_LICENCE_INVALID', statusCode: 403 }),
        status: 403, code: 'PERMISSION_DENIED', declaredCode: 'ORG_LICENCE_INVALID',
    },
    {
        name: 'a sandboxed hook body that declared an app spelling and a 403',
        error: sandboxRefusal('only the record owner may re-share this account', {
            code: 'ONLY_OWNER_MAY_RESHARE', status: 403,
        }),
        status: 403, code: 'PERMISSION_DENIED', declaredCode: 'ONLY_OWNER_MAY_RESHARE',
    },
    {
        name: 'a sandboxed hook body with an app spelling and NO declared status',
        error: sandboxRefusal('only the record owner may re-share this account', {
            code: 'ONLY_OWNER_MAY_RESHARE',
        }),
        status: 400, code: 'VALIDATION_ERROR', declaredCode: 'ONLY_OWNER_MAY_RESHARE',
    },
];

describe('[#12510] an UNREGISTERED producer spelling rides `declaredCode` on the share family', () => {
    for (const demoted of DEMOTED) {
        it(`${demoted.name}`, async () => {
            for (const [route, answer] of await allThree(demoted.error)) {
                const error = expectNestedEnvelope(answer, demoted.status, demoted.code);
                // ADR-0112, all three channels at once: `code` stays the CLOSED
                // member the status derives — the demote must not re-open the
                // vocabulary — and the producer's own string arrives BESIDE it
                // rather than instead of it.
                expect(error.declaredCode, `${route}: ${JSON.stringify(answer.body)}`)
                    .toBe(demoted.declaredCode);
            }
        });
    }

    it('the four shapes above really do produce different answers', () => {
        // Anti-vacuity for the table itself: four rows collapsing to one answer
        // would agree with almost any implementation.
        const answers = DEMOTED.map((d) => `${d.status} ${d.code} ${d.declaredCode}`);
        expect(new Set(answers).size).toBe(4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 Presence MEANS demotion — the half a "field is defined" assertion misses
// ─────────────────────────────────────────────────────────────────────────────

const ABSENT: Array<{ name: string; error: unknown; status: number; code: string }> = [
    {
        // ⭐ THE trap case. `resolveThrownHttpError` answers this throw with
        // `declaredCode: 'RECORD_LOCKED'` sitting beside an identical `code` —
        // a door reading the raw field would emit both spellings here.
        name: 'a REGISTERED code is already in `code`; repeating it would be two spellings of one fact',
        error: refusal('this account is locked while month-end close runs', {
            code: 'RECORD_LOCKED', status: 409,
        }),
        status: 409, code: 'RECORD_LOCKED',
    },
    {
        // `plugin-sharing`'s own write gate throws exactly this (`sharing-plugin.ts`).
        name: "plugin-sharing's own FORBIDDEN write-gate refusal — the live in-repo producer",
        error: refusal('FORBIDDEN: insufficient privileges to delete account a1', {
            code: 'FORBIDDEN', status: 403,
        }),
        status: 403, code: 'FORBIDDEN',
    },
    {
        name: 'a sandboxed body that declared NO code has nothing to declare',
        error: sandboxRefusal('sharing is frozen until the quarterly access review closes'),
        status: 400, code: 'VALIDATION_ERROR',
    },
    {
        name: "the ADR-0111 `CODE: message` prefix idiom declares no envelope at all",
        error: new Error('NOT_FOUND: record account/a1 does not exist'),
        status: 404, code: 'NOT_FOUND',
    },
];

describe('[#12510] `declaredCode` is ABSENT unless the demote actually happened', () => {
    for (const absent of ABSENT) {
        it(`${absent.name}`, async () => {
            for (const [route, answer] of await allThree(absent.error)) {
                const error = expectNestedEnvelope(answer, absent.status, absent.code);
                // Absent, not `undefined`-valued: a key present with `undefined`
                // survives `JSON.stringify` as an omission but would not through
                // every transport, and "presence means demotion" is a statement
                // about the KEY.
                expect(
                    'declaredCode' in error,
                    `${route} emitted ${JSON.stringify(answer.body)}`,
                ).toBe(false);
            }
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 Door-to-door — this family and `/data` answer one producer alike
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12510] the share door and the flat `/data` door agree on the producer spelling', () => {
    it('every classified refusal carries the same `declaredCode` at both doors', async () => {
        // This is the reproduction turned into a pin: the measurement that
        // opened the card was precisely a DISAGREEMENT between these two doors
        // about one producer's spelling, with the flat one right.
        for (const { name, error } of [...DEMOTED, ...ABSENT]) {
            const flat = throughDataDoor(error);
            const expected = flat.body?.declaredCode;
            for (const [route, answer] of await allThree(error)) {
                expect(
                    answer.body?.error?.declaredCode,
                    `${name} @ ${route}: share door ${JSON.stringify(answer.body)} vs ` +
                    `/data door ${JSON.stringify(flat.body)}`,
                ).toBe(expected);
            }
        }
    });

    it('the comparison is not vacuous — the flat door really does answer both ways', () => {
        // Without this, a `/data` door that emitted nothing at all would make
        // every row above compare `undefined` to `undefined`.
        const carried = DEMOTED
            .map((d) => throughDataDoor(d.error).body?.declaredCode)
            .filter((c) => typeof c === 'string');
        const bare = ABSENT
            .map((a) => throughDataDoor(a.error).body?.declaredCode)
            .filter((c) => c === undefined);
        expect(carried.length).toBe(DEMOTED.length);
        expect(bare.length).toBe(ABSENT.length);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 What must NOT move — the message, the dialect, and the 500 terminal
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12510] the channel added displaces nothing that was already there', () => {
    it('the message and the closed `code` are byte-identical to the pre-repair answers', async () => {
        // The three channels this family already published, restated as
        // literals so a repair that "carried" the spelling by overwriting one
        // of them cannot pass.
        for (const [route, answer] of await allThree(
            refusal('invoices still open', { code: 'CLOSE_PERIOD_LOCKED', status: 409 }),
        )) {
            expect(answer.status, route).toBe(409);
            expect(answer.body.error.code, route).toBe('RESOURCE_CONFLICT');
            expect(answer.body.error.message, route).toBe('invoices still open');
        }
    });

    it('an unclassified fault still leaves through this family\'s own 500, unchanged', async () => {
        const answers = await allThree(new Error('connection reset'));
        expect(answers.map(([, a]) => a.status)).toEqual([500, 500, 500]);
        expect(answers.map(([, a]) => a.body.error.code)).toEqual([
            'SHARES_LIST_FAILED', 'SHARE_GRANT_FAILED', 'SHARE_REVOKE_FAILED',
        ]);
        for (const [route, a] of answers) {
            expect(a.body.error.message, route).toBe('connection reset');
            expect('declaredCode' in a.body.error, route).toBe(false);
        }
    });

    it('a NON-string `code` is context, not a wire spelling (the #3842 drift)', async () => {
        // A numeric driver errno never declares an envelope, so this stays the
        // route's own 500 and nothing is demoted onto it. Pinned because a
        // door that read `body.declaredCode` without a type check would be
        // stamping a NUMBER into a string channel on exactly this shape.
        const answers = await allThree(refusal('driver errno', { code: 1234, status: 409 }));
        for (const [route, a] of answers) {
            expect(a.status, route).toBe(500);
            expect('declaredCode' in a.body.error, route).toBe(false);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 The wire answer IS the shared rule, not a second copy of it
// ─────────────────────────────────────────────────────────────────────────────

describe('[#12510] the wire `declaredCode` IS `demotedDeclaredCode`, not a local re-derivation', () => {
    /**
     * The literal cases above say what the answers ARE, which is what a reader
     * needs; they do not on their own keep this door with its siblings. A
     * second demote rule written at this call site could satisfy every literal
     * above and still diverge on the next throw shape nobody enumerated —
     * which is how the two `/api/v1/packages` doors came to disagree. So the
     * door is pinned to the shared function itself, read through the same
     * status the classification resolved (which is how the flat door's
     * `thrownCodeFields` calls it).
     */
    const SHAPES: unknown[] = [
        ...DEMOTED.map((d) => d.error),
        ...ABSENT.map((a) => a.error),
        refusal('two rows still reference this account', {
            code: 'CLOSE_PERIOD_LOCKED', status: 409,
            issues: [{ path: 'invoices', message: 'inv_1 is still open' }],
        }),
    ];

    it('every classified shape answers exactly what the shared rule says', async () => {
        for (const shape of SHAPES) {
            const classified = classifiedRefusalAnswer(shape);
            if (!classified) continue;
            const expected = demotedDeclaredCode(
                resolveThrownHttpError(shape, classified.status),
            );
            for (const [route, answer] of await allThree(shape)) {
                expect(
                    answer.body?.error?.declaredCode,
                    `${route}: ${JSON.stringify(answer.body)}`,
                ).toBe(expected);
            }
        }
    });

    it('the shapes above do not all answer the same thing', () => {
        // Anti-vacuity for the comparison itself.
        const answers = SHAPES
            .map((s) => {
                const classified = classifiedRefusalAnswer(s);
                return classified
                    ? demotedDeclaredCode(resolveThrownHttpError(s, classified.status))
                    : undefined;
            });
        expect(answers.filter((a) => a !== undefined).length).toBeGreaterThan(2);
        expect(answers.filter((a) => a === undefined).length).toBeGreaterThan(2);
    });
});
