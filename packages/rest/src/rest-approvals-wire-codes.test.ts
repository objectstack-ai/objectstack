// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8885] The approvals routes' wire codes are REGISTERED vocabulary — pins
 * for the population the card's sweep found.
 *
 * The #8885 sweep measured 9 codes reaching the wire from `packages/rest` that
 * were in neither `StandardErrorCode` nor `ERROR_CODE_LEDGER`, all in one
 * family and all with the same cause: the approvals route factories spell the
 * terminal 500 catch's code as a TEMPLATE
 * (`` `APPROVAL_${action.toUpperCase()}_FAILED` `` — `decisionRoute`,
 * `flowMoveRoute`, `threadRoute` in `rest-server.ts`), so the literal-grep
 * pass that registered their literal-spelled siblings
 * (`APPROVAL_RECALL_FAILED`, `APPROVAL_ACTIONS_FAILED`, …) never saw them; the
 * ninth, `THROTTLED`, is a single-word code the multi-token sweep shape
 * missed. All nine are registered by this card's ledger edit, and this file
 * pins them three ways:
 *
 * 1. **A live emission per channel** — the `THROTTLED` 429 through the real
 *    remind route, and one template-generated 500 through the real approve
 *    route — asserting the ADR-0112 minimum (`code` AND `status`) plus
 *    closed-union membership.
 * 2. **The class, not the instances**: the derivation case enumerates the
 *    registered `POST /approvals/requests/:id/<action>` routes and asserts the
 *    code each one's catch arm would generate parses against `ApiErrorSchema`'s
 *    closed union. A future action route whose generated code nobody registers
 *    fails HERE, mechanically — the same gap cannot reopen by adding a tenth
 *    route. The derivation mirrors the production template exactly
 *    (single-occurrence `.replace('-', '_')` included), so a route name the
 *    template would mangle into an invalid code also fails here.
 * 3. The union stays CLOSED — the control case in
 *    `rest-field-visibility-fault-envelope.test.ts` covers this file too (same
 *    schema instance); membership green here is evidence, not vacuity.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema } from '@objectstack/spec/api';
// `.js` on purpose — NodeNext resolution requires the extension (#7248).
import { RestServer } from './rest-server.js';

const REQ = '/api/v1/approvals/requests/:id';

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
    };
    return res;
}

/** Boot a RestServer with a real approvals service stub wired (per #7527's harness). */
function boot(approvals: Record<string, any>) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        findData: vi.fn().mockResolvedValue({ records: [] }),
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
        undefined, // kernelManager
        undefined, // envRegistry
        undefined, // defaultEnvironmentIdProvider
        undefined, // authServiceProvider
        undefined, // objectQLProvider
        undefined, // emailServiceProvider
        undefined, // sharingServiceProvider
        undefined, // reportsServiceProvider
        async () => approvals, // approvalsServiceProvider
    );
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();
    return rest;
}

async function drive(rest: any, method: string, path: string, body: any = {}) {
    const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!found) throw new Error(`route not registered: ${method} ${path}`);
    const res = mockRes();
    await found.handler(
        { method, path, params: { id: 'req_1' }, query: {}, headers: {}, body } as any,
        res,
    );
    return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
}

describe('approvals wire codes are registered vocabulary (#8885)', () => {
    it('remind inside the cool-down answers 429 THROTTLED — the contract-documented rejection', async () => {
        const rest = boot({
            remind: vi.fn().mockRejectedValue(new Error('THROTTLED: a reminder was already sent recently')),
        });
        const answer = await drive(rest, 'POST', `${REQ}/remind`);
        expect(answer.status).toBe(429);
        expect(answer.body?.code).toBe('THROTTLED');
        expect(answer.body?.error).toBe('a reminder was already sent recently');
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'THROTTLED must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    it('an unmapped service fault on approve answers 500 APPROVAL_APPROVE_FAILED — the template-generated arm, live', async () => {
        const rest = boot({
            decide: vi.fn().mockRejectedValue(new Error('kaboom: not in the mapping table')),
        });
        const answer = await drive(rest, 'POST', `${REQ}/approve`);
        expect(answer.status).toBe(500);
        expect(answer.body?.code).toBe('APPROVAL_APPROVE_FAILED');
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'APPROVAL_APPROVE_FAILED must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    it('every POST /approvals/requests/:id/<action> route generates a REGISTERED terminal code (the class pin)', () => {
        const rest = boot({}) as any;
        const actions: string[] = rest.getRoutes()
            .filter((r: any) => r.method === 'POST')
            .map((r: any) => /^\/api\/v1\/approvals\/requests\/:id\/([a-z][a-z-]*)$/.exec(r.path)?.[1])
            .filter((a: string | undefined): a is string => a !== undefined);
        // Anti-vacuity floor: the route shape this derivation reads must still
        // exist — if a refactor moves the paths, this fails HERE rather than
        // leaving the loop below green over an empty list. Deliberately a
        // SUBSET check: a new action route joins the loop automatically (which
        // is the point — its generated code is judged for membership without
        // anyone editing this file).
        expect(actions).toEqual(expect.arrayContaining([
            'approve', 'reject', 'recall', 'revise', 'resubmit',
            'reassign', 'remind', 'request-info', 'comment',
        ]));
        for (const action of actions) {
            // EXACTLY the production template (single-occurrence replace, per
            // `threadRoute`): if the template would mangle a future action name
            // into an invalid code, this derivation mangles identically and the
            // parse below goes red.
            const code = `APPROVAL_${action.toUpperCase().replace('-', '_')}_FAILED`;
            expect(
                ApiErrorSchema.safeParse({ code, message: 'x' }).success,
                `terminal code ${code} (route action '${action}') must be registered in ERROR_CODE_LEDGER`,
            ).toBe(true);
        }
    });
});
