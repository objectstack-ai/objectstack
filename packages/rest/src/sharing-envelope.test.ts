// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8111] ONE error envelope across the record-sharing family (ADR-0112 D5).
 *
 * ## What was wrong
 *
 * `registerSharingEndpoints` — `GET/POST /data/:object/:id/shares` and
 * `DELETE /data/:object/:id/shares/:shareId` — answered TWO retired dialects
 * across its nine refusal arms, both of which #7035 (PR #7293) had already
 * removed from this file's `/meta` refusals, #7981 (PR #8071) from
 * `registerSecurityEndpoints` and #8073 (PR #8174) from the explain pair:
 *
 *   | arms                                    | shape                                    |
 *   | :-------------------------------------- | :--------------------------------------- |
 *   | 501 `NOT_IMPLEMENTED` (`respond501`)    | `{ code, message }` — flat               |
 *   | 400/403/404/409/422 (`respondSharingError`) | `{ code, error: '<bare string>' }`   |
 *   | three 500s (list/grant/revoke)          | `{ code, error: '<bare string>' }`       |
 *
 * So `body.error.code` — the one position ADR-0112 D5 declares — read
 * `undefined` on all nine.
 *
 * ## The `CODE:` message prefix is NOT the wire contract
 *
 * `respondSharingError` recovers the verdict by parsing the service's message
 * text (`msg.startsWith(CODE)`) and then STRIPS that prefix before answering.
 * The prefix is a server-internal service→REST derivation that never reaches
 * the wire, so no consumer can read it — censused at claim. It is therefore
 * untouched here: this card moved the response SHAPE only. `stripsThePrefix`
 * below pins that the stripping still happens, so a future reader does not
 * "restore" a prefix the wire never carried.
 *
 * ## What these cases assert, and why not `toThrow`
 *
 * These handlers *send*; they never throw. A `rejects.toThrow()`-shaped
 * assertion would report "the promise resolved" and could not separate
 * "refused with the wrong envelope" from "did not refuse at all" — and the
 * wrong envelope IS the defect. So every case asserts the ADR-0112 **pair**,
 * HTTP `status` AND nested `body.error.code`, plus both retired dialects'
 * absence: no top-level `code` sibling, and `error` an object rather than a
 * bare string.
 *
 * ## The cross-arm pin is DERIVED
 *
 * Nine hand-written literal expectations that agree today is how this defect
 * started — each arm was individually defensible and nobody compared them. So
 * `shapeOf()` reduces a body to its structural skeleton (key paths + value
 * types) and the family case asserts every arm reduces to the SAME skeleton
 * without naming what that skeleton is. A third dialect added to any arm fails
 * there even if someone also adds a matching literal case.
 *
 * ## What does NOT move
 *
 * No status code, and no code VALUE. `NOT_IMPLEMENTED` and `PERMISSION_DENIED`
 * are `StandardErrorCode`; `VALIDATION_FAILED`, `NOT_FOUND`, `SHARES_LIST_FAILED`,
 * `SHARE_GRANT_FAILED` and `SHARE_REVOKE_FAILED` are in `ERROR_CODE_LEDGER`'s
 * `@objectstack/rest` block; `SHARING_NOT_ENABLED` in `@objectstack/plugin-sharing`'s
 * (the union is flat). `CONFLICT` was registered by this card — it was the one
 * code this emitter has always put on the wire while being declared NOWHERE,
 * so `ApiErrorSchema` would have rejected the 409 body. Registering the
 * existing value keeps the wire byte-identical; renaming it onto the standard
 * catalog's `RESOURCE_CONFLICT` would change what clients read and is filed
 * separately for the maintainer.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer } from './rest-server.js';
import { ApiErrorSchema } from '@objectstack/spec/api';

const LIST = '/api/v1/data/:object/:id/shares';
const REVOKE = '/api/v1/data/:object/:id/shares/:shareId';

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

/**
 * @param service what `sharingServiceProvider` resolves to. `undefined` leaves
 *                the provider unset, which is the 501 arm.
 */
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

    const route = (method: string, path: string) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        return found;
    };

    const drive = async (
        method: string,
        path: string,
        req: Record<string, unknown> = {},
    ): Promise<Answer> => {
        const res = mockRes();
        await route(method, path).handler(
            {
                method, path, headers: {}, query: {}, body: {},
                params: { object: 'account', id: 'a1', shareId: 'shr_X' },
                ...req,
            } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return {
        list: () => drive('GET', LIST),
        grant: (body: Record<string, unknown> = {}) => drive('POST', LIST, { body }),
        revoke: () => drive('DELETE', REVOKE),
    };
}

/** A service whose every verb rejects with `err`. */
function throwingService(err: unknown) {
    return {
        listShares: vi.fn().mockRejectedValue(err),
        grant: vi.fn().mockRejectedValue(err),
        revoke: vi.fn().mockRejectedValue(err),
    };
}

/** The prefixed messages the real `sharing-service` throws (verbatim idiom). */
const prefixed = (code: string, rest: string) => new Error(`${code}: ${rest}`);

/**
 * The full ADR-0112 assertion for one refusal: the PAIR (status + code) at the
 * nested position, and both retired dialects absent.
 */
function expectNestedEnvelope(answer: Answer, status: number, code: string) {
    expect(
        answer.status,
        `expected ${status}, got ${answer.status} with body ${JSON.stringify(answer.body)}`,
    ).toBe(status);
    // The pair ADR-0112 D5 declares — nested, because the flat position is the defect.
    expect(answer.body?.error?.code).toBe(code);
    expect(typeof answer.body?.error?.message).toBe('string');
    // Dialect 1 retired: `code` as a sibling of `error` (all nine arms had it).
    expect(answer.body).not.toHaveProperty('code');
    // Dialect 2 retired: `error` as a bare string, which is what made
    // `error.code` and `error.message` both read `undefined`.
    expect(typeof answer.body?.error).toBe('object');
}

/**
 * A body reduced to its STRUCTURE: every leaf key path with the type of its
 * value, sorted. Values are dropped on purpose — arms legitimately differ in
 * code and message, and the claim under test is that they agree in shape.
 */
function shapeOf(body: unknown): string {
    const walk = (node: unknown, prefix: string): string[] => {
        if (node === null || typeof node !== 'object' || Array.isArray(node)) {
            return [`${prefix}:${Array.isArray(node) ? 'array' : node === null ? 'null' : typeof node}`];
        }
        return Object.entries(node as Record<string, unknown>)
            .flatMap(([k, v]) => walk(v, prefix ? `${prefix}.${k}` : k));
    };
    return walk(body, '').sort().join('|');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Each arm, on its own terms — status AND nested code, per ADR-0112
// ─────────────────────────────────────────────────────────────────────────────

describe('[#8111] the record-sharing family answers the ADR-0112 D5 envelope', () => {
    it('501 NOT_IMPLEMENTED — no sharing service provider is wired', async () => {
        const api = boot(undefined);
        for (const answer of [await api.list(), await api.grant(), await api.revoke()]) {
            expectNestedEnvelope(answer, 501, 'NOT_IMPLEMENTED');
        }
    });

    it('400 VALIDATION_FAILED — the service refuses the grant input', async () => {
        const api = boot(throwingService(prefixed('VALIDATION_FAILED', 'recipientId is required')));
        const answer = await api.grant();
        expectNestedEnvelope(answer, 400, 'VALIDATION_FAILED');
        expect(answer.body.error.message).toBe('recipientId is required');
    });

    it('403 PERMISSION_DENIED — the caller does not manage the record (ADR-0111 D1)', async () => {
        const api = boot(throwingService(
            prefixed('PERMISSION_DENIED', 'you do not hold canManageShares on this record'),
        ));
        expectNestedEnvelope(await api.list(), 403, 'PERMISSION_DENIED');
    });

    it('404 NOT_FOUND — the record is missing or invisible (indistinguishable by design)', async () => {
        const api = boot(throwingService(prefixed('NOT_FOUND', 'record account/a1 does not exist')));
        expectNestedEnvelope(await api.list(), 404, 'NOT_FOUND');
    });

    it('409 CONFLICT — revoke on a rule-materialised share (ADR-0111 D4)', async () => {
        const api = boot(throwingService(
            prefixed('CONFLICT', "share shr_X is materialised by source 'rule' and would be re-granted"),
        ));
        const answer = await api.revoke();
        expectNestedEnvelope(answer, 409, 'CONFLICT');
        expect(answer.body.error.message).toBe(
            "share shr_X is materialised by source 'rule' and would be re-granted",
        );
    });

    it('422 SHARING_NOT_ENABLED — grant on an object the gates never consult', async () => {
        const api = boot(throwingService(
            prefixed('SHARING_NOT_ENABLED', "'account' bypasses record sharing"),
        ));
        expectNestedEnvelope(await api.grant(), 422, 'SHARING_NOT_ENABLED');
    });

    it('500 — an unexpected fault on each verb keeps its own code', async () => {
        const api = boot(throwingService(new Error('boom')));
        const cases: Array<[Answer, string]> = [
            [await api.list(), 'SHARES_LIST_FAILED'],
            [await api.grant(), 'SHARE_GRANT_FAILED'],
            [await api.revoke(), 'SHARE_REVOKE_FAILED'],
        ];
        for (const [answer, code] of cases) {
            expectNestedEnvelope(answer, 500, code);
            // The bare-string dialect put this text at `body.error`; it is the
            // declared `message` now, and the 500-char cap is kept.
            expect(answer.body.error.message).toBe('boom');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The cross-arm claim, derived rather than restated
// ─────────────────────────────────────────────────────────────────────────────

describe('[#8111] the whole sharing family reduces to ONE skeleton', () => {
    it('every refusal arm of all three routes has the same structural shape', async () => {
        const arms: Array<[string, Answer]> = [
            ['501 list', await boot(undefined).list()],
            ['501 revoke', await boot(undefined).revoke()],
            ['400 grant', await boot(throwingService(prefixed('VALIDATION_FAILED', 'x'))).grant()],
            ['403 list', await boot(throwingService(prefixed('PERMISSION_DENIED', 'x'))).list()],
            ['404 list', await boot(throwingService(prefixed('NOT_FOUND', 'x'))).list()],
            ['409 revoke', await boot(throwingService(prefixed('CONFLICT', 'x'))).revoke()],
            ['422 grant', await boot(throwingService(prefixed('SHARING_NOT_ENABLED', 'x'))).grant()],
            ['500 list', await boot(throwingService(new Error('x'))).list()],
            ['500 grant', await boot(throwingService(new Error('x'))).grant()],
            ['500 revoke', await boot(throwingService(new Error('x'))).revoke()],
        ];
        const [, reference] = arms[0];
        for (const [label, answer] of arms) {
            expect(shapeOf(answer.body), `${label} drifted: ${JSON.stringify(answer.body)}`)
                .toBe(shapeOf(reference.body));
        }
    });

    it('every arm parses as the DECLARED ApiErrorSchema, code vocabulary included', async () => {
        const arms: Answer[] = [
            await boot(undefined).list(),
            await boot(throwingService(prefixed('VALIDATION_FAILED', 'x'))).grant(),
            await boot(throwingService(prefixed('PERMISSION_DENIED', 'x'))).list(),
            await boot(throwingService(prefixed('NOT_FOUND', 'x'))).list(),
            // The 409's `CONFLICT` was registered NOWHERE before this card, so
            // this parse is what would have caught it: `ApiErrorSchema.code` is
            // a closed enum and an unregistered code fails it.
            await boot(throwingService(prefixed('CONFLICT', 'x'))).revoke(),
            await boot(throwingService(prefixed('SHARING_NOT_ENABLED', 'x'))).grant(),
            await boot(throwingService(new Error('x'))).grant(),
        ];
        for (const answer of arms) {
            const parsed = ApiErrorSchema.safeParse(answer.body.error);
            expect(
                parsed.success,
                `body.error failed ApiErrorSchema: ${JSON.stringify(answer.body)} → ${
                    parsed.success ? '' : JSON.stringify(parsed.error.issues)}`,
            ).toBe(true);
        }
    });

    it('stripsThePrefix — the `CODE:` derivation stays server-internal', async () => {
        // The prefix is how the service signals the verdict to the route. It is
        // stripped before answering and has never been on the wire, so nothing
        // can read it. Pinned so a later reader neither "restores" it nor
        // assumes the message is the raw throw.
        const api = boot(throwingService(prefixed('NOT_FOUND', 'record account/a1 does not exist')));
        const answer = await api.list();
        expect(answer.body.error.message).toBe('record account/a1 does not exist');
        expect(answer.body.error.message.startsWith('NOT_FOUND')).toBe(false);
    });

    it('an unprefixed service error falls through to the 500 arm, not a verdict', async () => {
        // `respondSharingError` returns false when no prefix matches — the
        // fall-through that keeps an unexpected fault from being reported as a
        // permission verdict.
        const api = boot(throwingService(new Error('connection reset')));
        const answer = await api.list();
        expectNestedEnvelope(answer, 500, 'SHARES_LIST_FAILED');
        expect(answer.body.error.message).toBe('connection reset');
    });

    it('the healthy paths are untouched — only refusals moved', async () => {
        const api = boot({
            listShares: vi.fn().mockResolvedValue([{ id: 'shr_1', recipient_id: 'bob' }]),
            grant: vi.fn(async (input: any) => ({ id: 'shr_2', ...input })),
            revoke: vi.fn().mockResolvedValue(undefined),
        });
        const listed = await api.list();
        expect(listed.body).toEqual({ data: [{ id: 'shr_1', recipient_id: 'bob' }] });
        const granted = await api.grant({ recipientId: 'bob', accessLevel: 'edit' });
        expect(granted.status).toBe(201);
        expect(granted.body).toEqual(expect.objectContaining({ id: 'shr_2', recipientId: 'bob' }));
    });
});
