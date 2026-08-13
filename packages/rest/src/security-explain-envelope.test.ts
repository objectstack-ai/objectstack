// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8073] ONE error envelope across the `/security/explain` pair (ADR-0112 D5).
 *
 * ## What was wrong
 *
 * `registerSecurityExplainEndpoints` — `GET/POST /security/explain` and
 * `GET /security/my-delegable-scope` — answered TWO retired dialects across its
 * eight refusal arms, both of which #7035 (PR #7293) had already removed from
 * this file's `/meta` refusals and #7981 (PR #8071) from
 * `registerSecurityEndpoints`, the immediately ADJACENT registrar:
 *
 *   | arms                                        | shape                            |
 *   | :------------------------------------------ | :------------------------------- |
 *   | 401 / 501 / 400 / 403                       | `{ code, message }` — flat       |
 *   | 500 `EXPLAIN_FAILED`, `DELEGABLE_SCOPE_FAILED` | `{ code, error: '<msg>' }` — bare string |
 *
 * So `body.error.code` — the one position ADR-0112 D5 declares — read
 * `undefined` on all six, and a client calling `explain` and then
 * `suggested-bindings` met two shapes inside one `security` family.
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
 * Eight hand-written literal expectations that agree today is how this defect
 * started — each arm was individually defensible and nobody compared them. So
 * `shapeOf()` reduces a body to its structural skeleton (key paths + value
 * types) and the family case asserts every arm reduces to the SAME skeleton
 * without naming what that skeleton is. A third dialect added to any arm fails
 * there even if someone also adds a matching literal case.
 *
 * ## What does NOT move
 *
 * No status code, and no code VALUE: `UNAUTHORIZED`, `NOT_IMPLEMENTED`,
 * `VALIDATION_FAILED`, `PERMISSION_DENIED`, `EXPLAIN_FAILED` and
 * `DELEGABLE_SCOPE_FAILED` are all already registered (`StandardErrorCode` for
 * the first two of those, `ERROR_CODE_LEDGER`'s `@objectstack/rest` block for
 * the rest), so nothing in `packages/spec` moves for this. Only the POSITION
 * changes — plus the 400 arm's `detail`, which lands in `error.details`, the
 * slot `ApiErrorSchema` declares for structured context; as a top-level sibling
 * it was undeclared.
 *
 * The 401 the ANONYMOUS caller gets is a different seam — `enforceAuth`'s
 * shared `ANONYMOUS_DENY_BODY` (#2567) fires before these arms and is pinned in
 * `security-routes.test.ts`. This registrar's own 401 is the authenticated-but-
 * no-`userId` posture, which is what `SYSTEM_NO_USER` below reaches.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer } from './rest-server.js';

const EXPLAIN = '/api/v1/security/explain';
const DELEGABLE = '/api/v1/security/my-delegable-scope';

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

/** An authenticated caller — clears `enforceAuth` and this registrar's own 401. */
const CALLER = { userId: 'u_admin', positions: ['everyone'], systemPermissions: ['manage_users'] };

/**
 * Authenticated enough for the SHARED anonymous-deny seam (`isSystem` short-
 * circuits `shouldDenyAnonymous`) but carrying no `userId`, which is the only
 * posture that reaches this registrar's OWN `401 UNAUTHORIZED` arm.
 */
const SYSTEM_NO_USER = { isSystem: true };

/** What a healthy `explain` answers, so "explained" ≠ "refused". */
const DECISION = {
    allowed: true,
    object: 'task',
    operation: 'read',
    principal: { userId: 'u_admin', positions: ['everyone'], permissionSets: ['member_default'] },
    layers: [],
    readFilter: null,
};

type Answer = { status: number; body: any };

/**
 * @param service what `securityServiceProvider` resolves to. `undefined` leaves
 *                the provider unset — one half of the 501 arm. An object
 *                MISSING the method is the other half (the route's own
 *                duck-type check), which is how both routes reach 501 while
 *                still being driven normally.
 */
function boot(service?: any, context: any = CALLER) {
    const rest = new RestServer(
        mockServer() as any,
        { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: {} }) } as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => context;
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
            { method, path, params: {}, query: {}, headers: {}, body: {}, ...req } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return {
        explainPost: (body: Record<string, unknown> = { object: 'task', operation: 'read' }) =>
            drive('POST', EXPLAIN, { body }),
        explainGet: (query: Record<string, unknown> = { object: 'task' }) =>
            drive('GET', EXPLAIN, { query }),
        delegable: () => drive('GET', DELEGABLE),
    };
}

/** A service whose `explain` rejects with `err`. */
function throwingExplain(err: unknown) {
    return { explain: vi.fn().mockRejectedValue(err), describeDelegableScope: vi.fn() };
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
    // The pair ADR-0112 D5 declares — nested, because the flat position is the defect.
    expect(answer.body?.error?.code).toBe(code);
    expect(typeof answer.body?.error?.message).toBe('string');
    // Dialect 1 retired: `code` as a sibling of `error` (all eight arms had it).
    expect(answer.body).not.toHaveProperty('code');
    // Dialect 2 retired: `error` as a bare string (the two 500s), which is what
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

describe('[#8073] /security/explain — every refusal arm answers the ADR-0112 D5 envelope', () => {
    it('401 UNAUTHORIZED — authenticated transport, no resolved userId', async () => {
        const api = boot({ explain: vi.fn() }, SYSTEM_NO_USER);
        expectNestedEnvelope(await api.explainPost(), 401, 'UNAUTHORIZED');
    });

    it('501 NOT_IMPLEMENTED — no security service provider at all', async () => {
        expectNestedEnvelope(await boot(undefined).explainPost(), 501, 'NOT_IMPLEMENTED');
    });

    it('501 NOT_IMPLEMENTED — a service that does not expose explain', async () => {
        const api = boot({ getReadFilter: vi.fn() });
        expectNestedEnvelope(await api.explainPost(), 501, 'NOT_IMPLEMENTED');
    });

    it('400 VALIDATION_FAILED — the request fails ExplainRequestSchema', async () => {
        const api = boot({ explain: vi.fn() });
        expectNestedEnvelope(await api.explainPost({ operation: 'read' }), 400, 'VALIDATION_FAILED');
        expectNestedEnvelope(
            await api.explainPost({ object: 'task', operation: 'frobnicate' }),
            400, 'VALIDATION_FAILED',
        );
    });

    it("403 PERMISSION_DENIED — the service's D12 gate refuses", async () => {
        const denial = Object.assign(
            new Error("[Security] Access denied: explaining another user's access requires 'manage_users'."),
            { code: 'PERMISSION_DENIED', name: 'PermissionDeniedError' },
        );
        const api = boot(throwingExplain(denial));
        expectNestedEnvelope(await api.explainPost(), 403, 'PERMISSION_DENIED');
    });

    it('500 EXPLAIN_FAILED — an unexpected service fault', async () => {
        const api = boot(throwingExplain(new Error('boom')));
        const answer = await api.explainPost();
        expectNestedEnvelope(answer, 500, 'EXPLAIN_FAILED');
        // The bare-string dialect put this text at `body.error`; it is the
        // declared `message` now, and the 500-char sanitization cap is kept.
        expect(answer.body.error.message).toBe('boom');
    });

    it('GET and POST refuse identically — one contract, two transports', async () => {
        const api = boot(undefined);
        const [get, post] = [await api.explainGet(), await api.explainPost()];
        expectNestedEnvelope(get, 501, 'NOT_IMPLEMENTED');
        expectNestedEnvelope(post, 501, 'NOT_IMPLEMENTED');
        expect(shapeOf(get.body)).toBe(shapeOf(post.body));
    });
});

describe('[#8073] /security/my-delegable-scope — same envelope, same emitter', () => {
    it('401 UNAUTHORIZED — authenticated transport, no resolved userId', async () => {
        const api = boot({ describeDelegableScope: vi.fn() }, SYSTEM_NO_USER);
        expectNestedEnvelope(await api.delegable(), 401, 'UNAUTHORIZED');
    });

    it('501 NOT_IMPLEMENTED — no service, or one without describeDelegableScope', async () => {
        expectNestedEnvelope(await boot(undefined).delegable(), 501, 'NOT_IMPLEMENTED');
        expectNestedEnvelope(await boot({ explain: vi.fn() }).delegable(), 501, 'NOT_IMPLEMENTED');
    });

    it('500 DELEGABLE_SCOPE_FAILED — an unexpected service fault', async () => {
        const api = boot({ describeDelegableScope: vi.fn().mockRejectedValue(new Error('kaboom')) });
        const answer = await api.delegable();
        expectNestedEnvelope(answer, 500, 'DELEGABLE_SCOPE_FAILED');
        expect(answer.body.error.message).toBe('kaboom');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The cross-arm claim, derived rather than restated
// ─────────────────────────────────────────────────────────────────────────────

describe('[#8073] the whole explain family reduces to ONE skeleton', () => {
    it('every refusal arm of both routes has the same structural shape', async () => {
        const denial = Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
        const arms: Array<[string, Answer]> = [
            ['explain 401', await boot({ explain: vi.fn() }, SYSTEM_NO_USER).explainPost()],
            ['explain 501', await boot(undefined).explainPost()],
            ['explain 403', await boot(throwingExplain(denial)).explainPost()],
            ['explain 500', await boot(throwingExplain(new Error('boom'))).explainPost()],
            ['delegable 401', await boot({ describeDelegableScope: vi.fn() }, SYSTEM_NO_USER).delegable()],
            ['delegable 501', await boot(undefined).delegable()],
            [
                'delegable 500',
                await boot({ describeDelegableScope: vi.fn().mockRejectedValue(new Error('x')) }).delegable(),
            ],
        ];
        const [, reference] = arms[0];
        for (const [label, answer] of arms) {
            expect(shapeOf(answer.body), `${label} drifted: ${JSON.stringify(answer.body)}`)
                .toBe(shapeOf(reference.body));
        }
    });

    it('the 400 arm carries its Zod dump in the DECLARED slot, not as a sibling', async () => {
        const answer = await boot({ explain: vi.fn() }).explainPost({ operation: 'read' });
        expectNestedEnvelope(answer, 400, 'VALIDATION_FAILED');
        // `details` is `ApiErrorSchema`'s slot for structured context. The old
        // top-level `detail` was undeclared — it survived only because
        // `envelopeViolations` inspects the body's top level and the schema
        // governs `error`, so nothing ever parsed it.
        expect(typeof answer.body.error.details).toBe('string');
        expect(answer.body).not.toHaveProperty('detail');
    });

    it('a healthy explain still answers the decision unwrapped — only refusals moved', async () => {
        const explain = vi.fn().mockResolvedValue(DECISION);
        const api = boot({ explain });
        const answer = await api.explainPost({ object: 'task', operation: 'read' });
        expect(answer.status).toBe(200);
        expect(answer.body).toEqual(DECISION);
    });
});
