// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8207] `POST {basePath}/sharing/rules/:idOrName/evaluate` maps the ADR-0111
 * D7 inertness refusal onto 422, not a 500.
 *
 * ## Why this arm appeared
 *
 * `evaluateRule` reconciles through `SharingService.grant` under a SYSTEM
 * context, and #8207 made the D7 inert-grant guard run for system callers too
 * (it is an inertness check — its answer does not depend on who asks). So a
 * rule pointed at an object no sharing gate consults — a public model, an
 * owner-less object, a `controlled_by_parent` detail, a federated
 * phantom-anchor object, a bypass object — now REFUSES here instead of
 * silently materialising `sys_record_share` rows nothing reads.
 *
 * That refusal reaches this route's `handleError`, whose arms are matched on
 * the plugin's `CODE:` message prefix. Without a `SHARING_NOT_ENABLED` arm the
 * admin who asked for the evaluation gets `500 RULE_EVALUATE_FAILED` — an
 * unhandled-fault status for a condition the platform diagnosed precisely, and
 * one that hides which object is at fault behind a generic code. The pair
 * asserted here is the SAME one the per-record shares routes already publish
 * (`respondSharingError`'s `['SHARING_NOT_ENABLED', 422]`), so no new contract
 * is introduced — only a second route family reaching an existing one.
 *
 * ## The envelope SHAPE here is deliberately not the subject
 *
 * `registerSharingRuleEndpoints` still answers the pre-#8111 flat dialect
 * (`{ code, error: '<string>' }`) on every one of its arms; #8111 converted the
 * per-record shares family only. These cases therefore assert the STATUS and
 * the code VALUE — the substance of the mapping — and read the code through a
 * helper that accepts either position, so the eventual ADR-0112 D5 conversion
 * of this route family changes one helper rather than going red on a card that
 * was never about the shape. What they do NOT do is pin the retired dialect as
 * if it were the contract.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension (#7248).
import { RestServer } from './rest-server.js';
import { ERROR_CODE_LEDGER } from '@objectstack/spec/api';

const EVALUATE = '/api/v1/sharing/rules/:idOrName/evaluate';

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

/** The code, whichever position this route family currently answers in. */
const codeOf = (body: any): unknown => body?.error?.code ?? body?.code;
/** The message, likewise. */
const messageOf = (body: any): unknown =>
    typeof body?.error === 'string' ? body.error : (body?.error?.message ?? body?.message);

function boot(ruleService: any) {
    const rest = new RestServer(
        mockServer() as any,
        { getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: {} }) } as any,
        { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined,
        (async () => ruleService) as any, // sharingRulesServiceProvider
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_admin' });
    rest.registerRoutes();

    const found = (rest as any).getRoutes().find(
        (r: any) => r.method === 'POST' && r.path === EVALUATE,
    );
    if (!found) throw new Error(`route not registered: POST ${EVALUATE}`);

    return async (): Promise<Answer> => {
        const res = mockRes();
        await found.handler(
            {
                method: 'POST', path: EVALUATE, headers: {}, query: {}, body: {},
                params: { idOrName: 'share_whiteboard_gold' },
            } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
}

/** The verbatim idiom `SharingService.assertNotInertGrant` throws. */
const INERT = new Error(
    "SHARING_NOT_ENABLED: 'whiteboard' is not under record-sharing enforcement "
    + "(public sharing model or no 'owner_id' field); a share row on it would never be consulted",
);

describe('[#8207] POST /sharing/rules/:idOrName/evaluate — the D7 inertness refusal', () => {
    it('answers 422 SHARING_NOT_ENABLED when reconcile refuses an inert object', async () => {
        const evaluate = boot({ evaluateRule: vi.fn().mockRejectedValue(INERT) });
        const answer = await evaluate();
        expect(
            answer.status,
            `expected 422, got ${answer.status} with body ${JSON.stringify(answer.body)}`,
        ).toBe(422);
        expect(codeOf(answer.body)).toBe('SHARING_NOT_ENABLED');
    });

    it('the message names the object and survives, minus the internal prefix', async () => {
        // The operator half: a bare code cannot tell them WHICH object of the
        // rule's is inert. The `CODE:` prefix is a server-internal
        // service→REST derivation (#8111) and is stripped like every sibling
        // arm's, so it must not reach the wire.
        const evaluate = boot({ evaluateRule: vi.fn().mockRejectedValue(INERT) });
        const { body } = await evaluate();
        expect(messageOf(body)).toMatch(/'whiteboard' is not under record-sharing enforcement/);
        expect(String(messageOf(body)).startsWith('SHARING_NOT_ENABLED')).toBe(false);
    });

    it('the code is one the platform DECLARES — the ADR-0112 ledger, not a route literal', () => {
        expect(ERROR_CODE_LEDGER['@objectstack/plugin-sharing']).toContain('SHARING_NOT_ENABLED');
    });

    it('ANTI-VACUITY: a successful evaluation still answers 200 with the reconcile result', async () => {
        // Without this the case above would read identically against a route
        // that answered 422 to everything.
        const result = { ruleId: 'srule_1', matchedRecords: 2, expandedUsers: 1, grantsCreated: 2, grantsUpdated: 0, grantsRevoked: 0 };
        const evaluate = boot({ evaluateRule: vi.fn().mockResolvedValue(result) });
        const answer = await evaluate();
        expect(answer.status).toBe(200);
        expect(answer.body).toEqual(result);
    });

    it('ANTI-VACUITY: the sibling arms still map to their own statuses', async () => {
        // The new arm must not have shadowed the ones around it — it is matched
        // by message prefix, so an over-broad predicate would swallow these.
        for (const [message, status, code] of [
            ['VALIDATION_FAILED: name is required', 400, 'VALIDATION_FAILED'],
            ['PERMISSION_DENIED: requires manage_sharing', 403, 'PERMISSION_DENIED'],
            ['RULE_NOT_FOUND', 404, 'RULE_NOT_FOUND'],
        ] as const) {
            const evaluate = boot({ evaluateRule: vi.fn().mockRejectedValue(new Error(message)) });
            const answer = await evaluate();
            expect(answer.status, `for ${message}`).toBe(status);
            expect(codeOf(answer.body)).toBe(code);
        }
        // …and an genuinely unexpected fault is still a 500 with the route's
        // own default code, not a mis-attributed 422.
        const evaluate = boot({ evaluateRule: vi.fn().mockRejectedValue(new Error('kaboom')) });
        const answer = await evaluate();
        expect(answer.status).toBe(500);
        expect(codeOf(answer.body)).toBe('RULE_EVALUATE_FAILED');
    });
});
