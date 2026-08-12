// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7981] ONE error envelope across the three `/security/suggested-bindings`
 * routes (ADR-0112 D5).
 *
 * ## What was wrong
 *
 * `registerSecurityEndpoints` answered THREE mutually incompatible shapes,
 * decided only by which arm refused — on three routes a single client calls in
 * sequence (list → confirm / dismiss):
 *
 *   | arm                                   | shape                                   |
 *   | :------------------------------------ | :-------------------------------------- |
 *   | validation refusals (#6877 / #7678)   | `{ error: { code, message } }` — ADR-0112 |
 *   | service not registered (`respond501`) | `{ code, message }` — no `error` at all |
 *   | thrown service error (`handleError`)  | `{ code, error: '<msg>' }` — bare string |
 *
 * So `body.error.code` — the one position ADR-0112 declares — read `undefined`
 * on two of the three, and the two it failed on include the arm carrying the
 * typed 403 / 404 / 409 codes the routes' own docblock advertises, i.e. the arm
 * a consumer is most likely to branch on. The bare-string `error` is
 * specifically the dialect #7035 (PR #7293) retired from this file's `/meta`
 * 501 refusals.
 *
 * ## What these cases assert, and why not `toThrow`
 *
 * These handlers *send*; they never throw. A `rejects.toThrow()`-shaped
 * assertion would report "the promise resolved" and could not separate
 * "refused with the wrong envelope" from "did not refuse at all" — and the
 * wrong envelope IS the defect. So every case asserts the ADR-0112 **pair**,
 * HTTP `status` AND nested `body.error.code`, plus the two retired dialects:
 * no top-level `code` sibling, and `error` an object rather than a bare string.
 *
 * ## The cross-arm pin is DERIVED
 *
 * Three hand-written literal expectations that agree today is how this defect
 * started — each arm was individually defensible and nobody compared them. So
 * `shapeOf()` below reduces a body to its structural skeleton (key paths +
 * value types) and the family case asserts every arm reduces to the SAME
 * skeleton, without naming what that skeleton is. A fourth dialect added to any
 * arm fails there even if someone also adds a matching literal case.
 *
 * No code value moves: `NOT_IMPLEMENTED` and `VALIDATION_ERROR` are the
 * standard catalog's members for 501 / 400, and the thrown arm still passes the
 * service's own `err.code` through. Only the POSITION changes, so nothing in
 * `packages/spec` moves for this.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer } from './rest-server.js';

const LIST = '/api/v1/security/suggested-bindings';
const CONFIRM = '/api/v1/security/suggested-bindings/:id/confirm';
const DISMISS = '/api/v1/security/suggested-bindings/:id/dismiss';

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
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any) { return this; }),
    };
    return res;
}

/** The rows a healthy service answers with, so "listed" ≠ "refused". */
const SUGGESTIONS = [{ id: 's1', status: 'pending', package_id: 'com.example.crm' }];

/**
 * The three typed errors plugin-security really throws, reproduced by shape
 * (`code` + `statusCode`) rather than imported: `@objectstack/plugin-security`
 * is not a dependency of this package, and `handleError` reads exactly these
 * two properties off whatever the service rejects with.
 */
function typedError(message: string, code: string, statusCode: number) {
    return Object.assign(new Error(message), { code, statusCode });
}

type Answer = { status: number; body: any };

/**
 * @param service  what `securityServiceProvider` resolves to. `undefined`
 *                 leaves the provider unset — the 501 arm. An object without
 *                 `listAudienceBindingSuggestions` is ALSO the 501 arm (the
 *                 route's own duck-type check), which is how the two POST
 *                 routes reach 501 while still being driven normally.
 */
function boot(service?: any) {
    const rest = new RestServer(
        mockServer() as any,
        { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: {} }) } as any,
        { api: { requireAuth: false } } as any,
    );
    // `isSystem` clears the auth gates that run BEFORE the arms under test, so
    // every request below reaches the envelope it is named after.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    if (service !== undefined) (rest as any).securityServiceProvider = async () => service;
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
            { method, path, params: { id: 's1' }, query: {}, headers: {}, body: {}, ...req } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return {
        list: (query: Record<string, unknown> = {}) => drive('GET', LIST, { query }),
        confirm: () => drive('POST', CONFIRM),
        dismiss: () => drive('POST', DISMISS),
    };
}

/** A service that answers every call successfully. */
function healthyService() {
    return {
        listAudienceBindingSuggestions: vi.fn().mockResolvedValue({
            suggestions: SUGGESTIONS,
            sync: { created: 0, confirmedObserved: 0, pruned: 0 },
        }),
        confirmAudienceBindingSuggestion: vi.fn().mockResolvedValue({ suggestion: SUGGESTIONS[0] }),
        dismissAudienceBindingSuggestion: vi.fn().mockResolvedValue({ suggestion: SUGGESTIONS[0] }),
    };
}

/** A service whose every method rejects with `err`. */
function throwingService(err: unknown) {
    return {
        listAudienceBindingSuggestions: vi.fn().mockRejectedValue(err),
        confirmAudienceBindingSuggestion: vi.fn().mockRejectedValue(err),
        dismissAudienceBindingSuggestion: vi.fn().mockRejectedValue(err),
    };
}

/**
 * The full ADR-0112 assertion for one refusal: the PAIR (status + code) at the
 * nested position, and both retired dialects absent.
 */
function expectNestedEnvelope(answer: Answer, status: number, code: string) {
    expect(
        answer.status,
        `expected ${status}, got ${answer.status} with body ${JSON.stringify(answer.body)}`,
    ).toBe(status);
    // The pair ADR-0112 declares — nested, because the flat position is the defect.
    expect(answer.body?.error?.code).toBe(code);
    expect(typeof answer.body?.error?.message).toBe('string');
    // Dialect 1 retired: `code` as a sibling of `error` (`respond501`, `handleError`).
    expect(answer.body).not.toHaveProperty('code');
    // Dialect 2 retired: `error` as a bare string (`handleError`), which is what
    // made `error.code` and `error.message` both read `undefined`.
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

describe('#7981 — arm 1: the service is not registered (was `{ code, message }`)', () => {
    it('GET list → 501 NOT_IMPLEMENTED in the nested envelope', async () => {
        expectNestedEnvelope(await boot().list(), 501, 'NOT_IMPLEMENTED');
    });

    it('POST confirm → 501 NOT_IMPLEMENTED', async () => {
        expectNestedEnvelope(await boot().confirm(), 501, 'NOT_IMPLEMENTED');
    });

    it('POST dismiss → 501 NOT_IMPLEMENTED', async () => {
        expectNestedEnvelope(await boot().dismiss(), 501, 'NOT_IMPLEMENTED');
    });

    it('a registered service missing the surface is the same refusal, not a 500', async () => {
        // `resolveService` duck-types `listAudienceBindingSuggestions`; a
        // deployment whose security service predates this surface takes the
        // same arm, and must not fall through to a fault envelope.
        expectNestedEnvelope(await boot({ explain: vi.fn() }).list(), 501, 'NOT_IMPLEMENTED');
    });
});

describe('#7981 — arm 2: a typed service error (was `{ code, error: "<string>" }`)', () => {
    // The three plugin-security throws this surface is documented to carry.
    const CASES: ReadonlyArray<readonly [string, string, number]> = [
        ['permission denied', 'PERMISSION_DENIED', 403],
        ['suggestion not found', 'SUGGESTION_NOT_FOUND', 404],
        ['suggestion already settled', 'SUGGESTION_STATE', 409],
    ];

    it.each(CASES)('confirm rejects %s → %s at the nested position', async (msg, code, status) => {
        const answer = await boot(throwingService(typedError(msg, code, status))).confirm();
        expectNestedEnvelope(answer, status, code);
        // The message survives the move — it was the ONE thing the bare-string
        // dialect did deliver, and the console surfaces it verbatim.
        expect(answer.body.error.message).toBe(msg);
    });

    it.each(CASES)('dismiss rejects %s → %s at the nested position', async (msg, code, status) => {
        expectNestedEnvelope(
            await boot(throwingService(typedError(msg, code, status))).dismiss(),
            status,
            code,
        );
    });

    it.each(CASES)('list rejects %s → %s at the nested position', async (msg, code, status) => {
        expectNestedEnvelope(
            await boot(throwingService(typedError(msg, code, status))).list(),
            status,
            code,
        );
    });

    it('an untyped fault falls back to the route default code, still nested', async () => {
        const answer = await boot(throwingService(new Error('boom'))).confirm();
        expectNestedEnvelope(answer, 500, 'SUGGESTION_CONFIRM_FAILED');
    });

    it('each route keeps its OWN default code on an untyped fault', async () => {
        const err = new Error('boom');
        expect((await boot(throwingService(err)).list()).body?.error?.code)
            .toBe('SUGGESTION_LIST_FAILED');
        expect((await boot(throwingService(err)).dismiss()).body?.error?.code)
            .toBe('SUGGESTION_DISMISS_FAILED');
    });

    it('the 500 arm still caps the message at 500 characters', async () => {
        // Sanitization, not shape: an unexpected fault's text is not a contract,
        // and moving the field must not quietly uncap it.
        const answer = await boot(throwingService(new Error('x'.repeat(2000)))).list();
        expectNestedEnvelope(answer, 500, 'SUGGESTION_LIST_FAILED');
        expect(answer.body.error.message).toHaveLength(500);
    });
});

describe('#7981 — arm 3: the validation refusals (already ADR-0112; pinned as the reference)', () => {
    it('?status=garbage → 400 VALIDATION_ERROR', async () => {
        // Conformant before this change. It is asserted here because it is the
        // shape the other two were converged ONTO: if it drifts, the
        // convergence loses its reference point and the family has three shapes
        // again — the same reason #7035 pinned its own anchor arm.
        expectNestedEnvelope(await boot(healthyService()).list({ status: 'garbage' }), 400, 'VALIDATION_ERROR');
    });

    it('a repeated ?status → 400 VALIDATION_ERROR from the shared multiplicity gate', async () => {
        expectNestedEnvelope(
            await boot(healthyService()).list({ status: ['pending', 'confirmed'] }),
            400,
            'VALIDATION_ERROR',
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The family claim — DERIVED, not three literals that agree
// ─────────────────────────────────────────────────────────────────────────────

describe('#7981 — the three arms answer ONE shape', () => {
    /** One answer per arm, across all three routes. */
    async function everyRefusal(): Promise<Array<{ label: string; answer: Answer }>> {
        const denied = typedError('denied', 'PERMISSION_DENIED', 403);
        return [
            { label: '501 list', answer: await boot().list() },
            { label: '501 confirm', answer: await boot().confirm() },
            { label: '501 dismiss', answer: await boot().dismiss() },
            { label: 'typed 403 list', answer: await boot(throwingService(denied)).list() },
            { label: 'typed 403 confirm', answer: await boot(throwingService(denied)).confirm() },
            { label: 'typed 403 dismiss', answer: await boot(throwingService(denied)).dismiss() },
            { label: 'untyped 500 list', answer: await boot(throwingService(new Error('boom'))).list() },
            { label: 'validation 400', answer: await boot(healthyService()).list({ status: 'garbage' }) },
            {
                label: 'multiplicity 400',
                answer: await boot(healthyService()).list({ status: ['pending', 'confirmed'] }),
            },
        ];
    }

    it('every refusal reduces to the same structural skeleton', async () => {
        const refusals = await everyRefusal();
        const shapes = new Map<string, string[]>();
        for (const { label, answer } of refusals) {
            const shape = shapeOf(answer.body);
            shapes.set(shape, [...(shapes.get(shape) ?? []), label]);
        }
        // Derived: the assertion never names the skeleton, so it holds for
        // whatever ONE shape the family lands on and fails the moment an arm
        // acquires a second — including a fourth dialect added with a matching
        // literal case above.
        expect(
            [...shapes.entries()].map(([shape, labels]) => `${shape} ← ${labels.join(', ')}`),
            'the refusal arms disagree on body shape',
        ).toHaveLength(1);
    });

    it('one read path — `body.error.code` — answers on every arm', async () => {
        // The consumer-side statement of the whole card: ONE way of reading the
        // code works everywhere, instead of three per-arm ways of which any
        // single choice silently yielded `undefined` on the others.
        for (const { label, answer } of await everyRefusal()) {
            expect(typeof answer.body?.error?.code, `${label} has no nested code`).toBe('string');
            expect(typeof answer.body?.error?.message, `${label} has no nested message`).toBe('string');
            expect(answer.status, `${label} did not refuse`).toBeGreaterThanOrEqual(400);
        }
    });

    it('no arm carries a retired dialect', async () => {
        for (const { label, answer } of await everyRefusal()) {
            expect(answer.body, `${label} still has a top-level code sibling`).not.toHaveProperty('code');
            expect(typeof answer.body?.error, `${label} still answers a bare-string error`).toBe('object');
            expect(answer.body, `${label} still has a top-level message`).not.toHaveProperty('message');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Preservation — an envelope change must not touch the success paths
// ─────────────────────────────────────────────────────────────────────────────

describe('#7981 — the success paths are untouched', () => {
    it('list still answers 200 with `{ data }`', async () => {
        const answer = await boot(healthyService()).list();
        expect(answer.status).toBe(200);
        expect(answer.body?.data?.suggestions).toEqual(SUGGESTIONS);
        expect(answer.body).not.toHaveProperty('error');
    });

    it('confirm and dismiss still answer 200 with `{ data }`', async () => {
        for (const answer of [
            await boot(healthyService()).confirm(),
            await boot(healthyService()).dismiss(),
        ]) {
            expect(answer.status).toBe(200);
            expect(answer.body?.data?.suggestion).toEqual(SUGGESTIONS[0]);
            expect(answer.body).not.toHaveProperty('error');
        }
    });
});
