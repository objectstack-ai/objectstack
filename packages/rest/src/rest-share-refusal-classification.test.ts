// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11683] The record-share family classifies a refusal by what the PRODUCER
 * declared, not by how the message happens to start.
 *
 * ## What was measured
 *
 * `GET`/`POST /api/v1/data/:object/:id/shares` and
 * `DELETE …/shares/:shareId` recovered the verdict with
 * `msg.startsWith(CODE)` over five literal prefixes and, on no match,
 * interpolated `String(error.message)` into a hand-built 500. Two independent
 * defects rode that one read:
 *
 *  1. **A declared ADR-0112 envelope was ignored entirely.** A producer
 *     throwing `{ code: 'RECORD_LOCKED', status: 409 }` — the envelope every
 *     other `/data` face honours through `handleRouteError` — was answered
 *     `500 SHARE_GRANT_FAILED`, because `RECORD_LOCKED` is not one of the five
 *     prefixes. Live rather than hypothetical: `plugin-sharing`'s own write
 *     gate throws `{ code: 'FORBIDDEN', status: 403 }`
 *     (`sharing-plugin.ts`), and `FORBIDDEN` is not a prefix either.
 *  2. **The QuickJS debug wrapper reached the client.** A sandboxed hook
 *     refusal arrives with `.message` = `hook '<name>' threw: Error: <text>`
 *     and `.innerMessage` = the business text. The wrapper IS the prefix, so
 *     no `startsWith` ever matched and the wrapper was interpolated verbatim
 *     into the 500 — #11588's defect on a branch #11588 (landed as #11687) did
 *     not reach.
 *
 * ## What the repair is, and what it deliberately is NOT
 *
 * The routes now ask {@link classifiedRefusalAnswer} — the `/data` door's own
 * classification — BEFORE the prefix map, and only for a refusal the producer
 * classified (a declared 4xx envelope, or a sandboxed body's business
 * `throw`). Everything else is untouched: the five-prefix idiom is
 * ADR-0111's declaration channel for this service and still runs, and an
 * unclassified fault still leaves through this route's own
 * `SHARES_LIST_FAILED` / `SHARE_GRANT_FAILED` / `SHARE_REVOKE_FAILED` 500 with
 * its own message. `sharing-envelope.test.ts` pins that terminal and is
 * expected to stay green character for character.
 *
 * ## Why the assertions are `status` + nested `error.code`, never `toThrow`
 *
 * These handlers send; they never throw (`sharing-envelope.test.ts` records
 * the same reasoning). A bare `toThrow` would be blind in both directions
 * here: the pre-fix route answered 500 without throwing at all.
 *
 * Predicted before running, against pre-fix `main` (`4ceae8ab0`):
 *   §1 RED 3   — the declared envelope is answered 500 on all three routes
 *   §2 RED 3   — the wrapper reaches the client on all three routes
 *   §3 GREEN 6 — the five-prefix idiom and the plain-500 terminal, unmoved
 *   §4 RED 1   — the share door and the `/data` door disagree
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — this package resolves `nodenext`, so an extensionless
// relative import is a `tsc` error (TS2835).
import { RestServer } from './rest-server.js';
import { handleRouteError } from './error-response.js';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { ApiErrorSchema } from '@objectstack/spec/api';

const LIST = '/api/v1/data/:object/:id/shares';
const REVOKE = '/api/v1/data/:object/:id/shares/:shareId';

/** The wrapper text that must never reach a client. */
const WRAPPER_RE = /threw:|hook '/;

/**
 * The shape `runtime/src/sandbox/quickjs-runner.ts` produces: `.message` is the
 * `<kind> '<name>' threw: <msg>` debug wrapper, `.innerMessage` the business
 * text, `.status` / `.statusCode` the #7867 side-channel. Reproduced here so
 * `@objectstack/rest` does not depend on `@objectstack/runtime` to run its own
 * tests — the same fixture `rest-hook-refusal-message-parity.test.ts` uses.
 */
function sandboxRefusal(
    businessMessage: string,
    extra: Record<string, unknown> = {},
    hook = 'guard',
) {
    const err: any = new Error(`hook '${hook}' threw: Error: ${businessMessage}`);
    err.name = 'SandboxError';
    err.innerMessage = businessMessage;
    return Object.assign(err, extra);
}

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

type Answer = { status: number; body: any };

/** A sharing service whose every verb rejects with `err`. */
function throwingService(err: unknown) {
    return {
        listShares: vi.fn().mockRejectedValue(err),
        grant: vi.fn().mockRejectedValue(err),
        revoke: vi.fn().mockRejectedValue(err),
    };
}

function boot(service?: any) {
    const rest = new RestServer(
        mockServer() as any,
        { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: {} }) } as any,
        { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
        service === undefined ? undefined : (async () => service) as any,
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
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return {
        list: () => drive('GET', LIST),
        grant: () => drive('POST', LIST),
        revoke: () => drive('DELETE', REVOKE),
    };
}

/** All three routes, driven with one rejecting service. */
async function allThree(err: unknown): Promise<Array<[string, Answer]>> {
    const api = boot(throwingService(err));
    return [
        ['GET shares', await api.list()],
        ['POST shares', await api.grant()],
        ['DELETE shares/:shareId', await api.revoke()],
    ];
}

/** The wire answer the `/data` door gives for the same error. */
function throughDataDoor(error: any): Answer {
    const res = mockRes();
    handleRouteError(res, error);
    return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
}

/**
 * The ADR-0112 D5 pair at the NESTED position, which is where #8111 put this
 * family's envelope. Asserted alongside every status claim so a repair that
 * moved the dialect back to the flat one cannot pass here.
 */
function expectNestedEnvelope(answer: Answer, status: number, code: string) {
    expect(
        answer.status,
        `expected ${status}, got ${answer.status} with body ${JSON.stringify(answer.body)}`,
    ).toBe(status);
    expect(answer.body?.error?.code).toBe(code);
    expect(typeof answer.body?.error?.message).toBe('string');
    expect(answer.body).not.toHaveProperty('code');
    expect(typeof answer.body?.error).toBe('object');
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 A declared ADR-0112 envelope is answered with the status and code it
//    declared — the card's problem 1, on all three routes
// ─────────────────────────────────────────────────────────────────────────────

describe('[#11683] a declared `status`/`code` envelope is honoured, not sniffed for a prefix', () => {
    it('all three routes answer 409 RECORD_LOCKED, not 500 SHARE_*_FAILED', async () => {
        const refusal = Object.assign(
            new Error('This account is locked while month-end close runs.'),
            { code: 'RECORD_LOCKED', status: 409 },
        );

        for (const [label, answer] of await allThree(refusal)) {
            expect(answer.status, `${label}: ${JSON.stringify(answer.body)}`).toBe(409);
            expectNestedEnvelope(answer, 409, 'RECORD_LOCKED');
            expect(answer.body.error.message).toBe(
                'This account is locked while month-end close runs.',
            );
        }
    });

    it('the `statusCode` spelling resolves too (#7525) — one refusal, one answer', async () => {
        // `plugin-approvals`' lifecycle hooks declare `statusCode`, not
        // `status`; #7525 ruled the boundary reads both. This family read
        // neither.
        const refusal = Object.assign(new Error('A pending approval locks this record.'), {
            code: 'RECORD_LOCKED', statusCode: 409,
        });

        for (const [label, answer] of await allThree(refusal)) {
            expect(answer.status, `${label}: ${JSON.stringify(answer.body)}`).toBe(409);
            expect(answer.body.error.code).toBe('RECORD_LOCKED');
        }
    });

    it("plugin-sharing's OWN write-gate refusal — the live in-repo producer", async () => {
        // `sharing-plugin.ts` throws exactly this for a fail-closed row denial.
        // `FORBIDDEN` is not one of the five prefixes, so the route answered
        // 500 for a refusal that had declared 403 twice over (code AND status).
        const refusal: any = new Error('FORBIDDEN: insufficient privileges to delete account a1');
        refusal.code = 'FORBIDDEN';
        refusal.status = 403;

        for (const [label, answer] of await allThree(refusal)) {
            expect(answer.status, `${label}: ${JSON.stringify(answer.body)}`).toBe(403);
            expect(answer.body.error.code).toBe('FORBIDDEN');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 No sandbox debug wrapper reaches the client — the card's problem 2
// ─────────────────────────────────────────────────────────────────────────────

describe('[#11683] a sandboxed hook refusal surfaces its business text, never the wrapper', () => {
    it('all three routes answer the business sentence, wrapper-free', async () => {
        const business = 'Sharing is frozen until the quarterly access review closes.';

        for (const [label, answer] of await allThree(sandboxRefusal(business))) {
            expect(
                JSON.stringify(answer.body),
                `${label} leaked the wrapper: ${JSON.stringify(answer.body)}`,
            ).not.toMatch(WRAPPER_RE);
            expect(answer.body.error.message).toBe(business);
        }
    });

    it('a sandbox refusal that ALSO declares an envelope keeps both halves', async () => {
        const business = 'Only the record owner may re-share this account.';
        const refusal = sandboxRefusal(business, { code: 'FORBIDDEN', status: 403 });

        for (const [label, answer] of await allThree(refusal)) {
            expect(answer.status, `${label}: ${JSON.stringify(answer.body)}`).toBe(403);
            expect(answer.body.error.code).toBe('FORBIDDEN');
            expect(answer.body.error.message).toBe(business);
            expect(JSON.stringify(answer.body)).not.toMatch(WRAPPER_RE);
        }
    });

    it('⭐ POSITIVE CONTROL — a body that CRASHED is NOT served as a refusal (#7543)', async () => {
        // `isScriptFaultMessage` declines a native error name, so this stays a
        // server fault and keeps this route's own 500 code. The control that
        // proves §2 is a READ of `.innerMessage` and not a pattern-strip.
        const crash = sandboxRefusal('TypeError: ctx.input.title.trim is not a function');

        const answers = await allThree(crash);
        const codes = answers.map(([, a]) => a.body?.error?.code);
        expect(answers.map(([, a]) => a.status)).toEqual([500, 500, 500]);
        expect(codes).toEqual(['SHARES_LIST_FAILED', 'SHARE_GRANT_FAILED', 'SHARE_REVOKE_FAILED']);
        // …and the wrapper does not ride out on the 500 either. This is the
        // one arm the classification door cannot reach, so it is the arm the
        // leak would survive on: `sharingFaultMessage` withholds a sandbox
        // error's own text here, the same answer `/data` gives a crash
        // through `UNCLASSIFIED_FAULT`. The whole error still reaches the
        // operator through each route's `logError` line.
        for (const [label, a] of answers) {
            expect(a.body.error.message, label).toBe(INTERNAL_ERROR_MESSAGE);
            expect(JSON.stringify(a.body), label).not.toMatch(WRAPPER_RE);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 What must NOT move — the ADR-0111 prefix idiom and the 500 terminal
// ─────────────────────────────────────────────────────────────────────────────

describe('[#11683] the `CODE: message` string convention and the 500 terminal are untouched', () => {
    const PREFIXED: Array<[string, number, string]> = [
        ['VALIDATION_FAILED', 400, 'recipientId is required'],
        ['PERMISSION_DENIED', 403, 'you do not hold canManageShares on this record'],
        ['NOT_FOUND', 404, 'record account/a1 does not exist'],
        ['CONFLICT', 409, "share shr_X is materialised by source 'rule'"],
        ['SHARING_NOT_ENABLED', 422, "'account' bypasses record sharing"],
    ];

    it.each(PREFIXED)('`%s:` still maps to %i with the prefix stripped', async (code, status, tail) => {
        // Backward compatibility is REQUIRED: every producer in
        // `plugin-sharing/src/sharing-service.ts` still throws a bare `Error`
        // with this prefix and declares no envelope at all (censused at claim
        // — 11 throw sites, zero declared `code`/`status`).
        const api = boot(throwingService(new Error(`${code}: ${tail}`)));
        const answer = await api.grant();
        expectNestedEnvelope(answer, status, code);
        expect(answer.body.error.message).toBe(tail);
    });

    it('an unclassified fault still leaves through this route\'s own 500, verbatim', async () => {
        const answers = await allThree(new Error('connection reset'));
        expect(answers.map(([, a]) => a.status)).toEqual([500, 500, 500]);
        expect(answers.map(([, a]) => a.body.error.code)).toEqual([
            'SHARES_LIST_FAILED', 'SHARE_GRANT_FAILED', 'SHARE_REVOKE_FAILED',
        ]);
        for (const [, a] of answers) expect(a.body.error.message).toBe('connection reset');
    });

    it('every answer still parses as the declared ApiErrorSchema', async () => {
        const bodies = [
            ...(await allThree(Object.assign(new Error('locked'), { code: 'RECORD_LOCKED', status: 409 }))),
            ...(await allThree(sandboxRefusal('frozen'))),
            ...(await allThree(new Error('NOT_FOUND: nope'))),
            ...(await allThree(new Error('boom'))),
        ];
        for (const [label, answer] of bodies) {
            const parsed = ApiErrorSchema.safeParse(answer.body.error);
            expect(
                parsed.success,
                `${label}: ${JSON.stringify(answer.body)} → ${
                    parsed.success ? '' : JSON.stringify(parsed.error.issues)}`,
            ).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 Door-to-door — the share family and the `/data` family agree on the STATUS
// ─────────────────────────────────────────────────────────────────────────────

describe('[#11683 / #11684] the share door and the `/data` door answer one refusal alike', () => {
    it('every classified refusal gets the same status at both doors', async () => {
        const cases: Array<[string, any]> = [
            ['declared 409 + code', Object.assign(new Error('locked'), { code: 'RECORD_LOCKED', status: 409 })],
            ['declared 403 + code', Object.assign(new Error('nope'), { code: 'FORBIDDEN', status: 403 })],
            ['statusCode 409 + code', Object.assign(new Error('locked'), { code: 'RECORD_LOCKED', statusCode: 409 })],
            ['undeclared sandbox refusal', sandboxRefusal('month-end close is in progress')],
            ['sandbox refusal + declared 403', sandboxRefusal('nope', { code: 'FORBIDDEN', status: 403 })],
        ];

        for (const [label, error] of cases) {
            const dataDoor = throughDataDoor(error);
            for (const [route, answer] of await allThree(error)) {
                expect(
                    answer.status,
                    `${label} @ ${route}: share door ${answer.status} vs /data door ${dataDoor.status}`,
                ).toBe(dataDoor.status);
            }
        }
    });
});
