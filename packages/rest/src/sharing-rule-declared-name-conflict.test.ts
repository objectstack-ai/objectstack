// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6 regime O, guarded] `POST {basePath}/sharing/rules` and a
 * declared rule's name.
 *
 * A `sys_sharing_rule` row of a declared rule's name replaces the declaration
 * in its scope. The sharing-rule service refuses a NEW rule taking that name
 * with a declared envelope — `code: 'RESOURCE_CONFLICT'`, `status: 409`
 * (`DeclaredSharingRuleNameConflictError`, plugin-sharing) — and accepts the
 * EDIT of the declared rule, which the caller sends under the projection's id
 * (the rule's name). This door therefore owes two things:
 *
 *  - the refusal answers at its own status, in the nested envelope, through
 *    the classified-refusal arm of `handleError` — not as `500 RULE_DEFINE_FAILED`;
 *  - the body's `id` reaches the service, or no caller could make the edit.
 *
 * The thrown error is built here in the service's declared shape: this package
 * does not depend on plugin-sharing, and the arm reads the shape, not the class.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension (#7248).
import { RestServer } from './rest-server.js';
import { HttpStatusErrorCodeMap } from '@objectstack/spec/api';

const RULES = '/api/v1/sharing/rules';

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
    const found = (rest as any).getRoutes().find((r: any) => r.method === 'POST' && r.path === RULES);
    if (!found) throw new Error(`route not registered: POST ${RULES}`);
    return async (body: Record<string, unknown>): Promise<{ status: number; body: any }> => {
        const res = mockRes();
        await found.handler({ method: 'POST', path: RULES, headers: {}, query: {}, body, params: {} } as any, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
}

const RULE = {
    name: 'share_red_projects', label: 'Red projects', object: 'project',
    criteria: { status: 'red' }, recipientType: 'user', recipientId: 'exec',
};

/** The service's refusal, in its declared shape. */
function conflict(): Error {
    return Object.assign(
        new Error("sharing rule 'share_red_projects' is declared by the application (on object 'project'), so a new rule cannot take its name"),
        { code: 'RESOURCE_CONFLICT', status: 409, rule: 'share_red_projects' },
    );
}

describe('[ADR-0131 D6 regime O, guarded] POST /sharing/rules — a declared rule’s name', () => {
    it('a new rule taking the name answers 409 RESOURCE_CONFLICT in the nested envelope, the service writing nothing else', async () => {
        const defineRule = vi.fn().mockRejectedValue(conflict());
        const answer = await boot({ defineRule })(RULE);
        expect(answer.status, JSON.stringify(answer.body)).toBe(409);
        expect(answer.body?.error?.code).toBe('RESOURCE_CONFLICT');
        expect(HttpStatusErrorCodeMap[409]).toBe(answer.body?.error?.code);
        expect(answer.body?.success).toBe(false);
        expect(defineRule).toHaveBeenCalledTimes(1);
    });

    it('PRESERVATION: the body’s `id` reaches the service — the edit of the declared rule is addressed by it', async () => {
        const row = { id: 'srule_copy', name: RULE.name };
        const defineRule = vi.fn().mockResolvedValue(row);
        const answer = await boot({ defineRule })({ ...RULE, id: RULE.name, active: false });
        expect(answer.status).toBe(201);
        expect(answer.body).toEqual(row);
        expect(defineRule.mock.calls[0][0]).toMatchObject({ id: RULE.name, name: RULE.name, active: false, object: 'project' });
    });

    it('ANTI-VACUITY: an unexpected fault is still the route’s own 500', async () => {
        const answer = await boot({ defineRule: vi.fn().mockRejectedValue(new Error('kaboom')) })(RULE);
        expect(answer.status).toBe(500);
        expect(answer.body?.code ?? answer.body?.error?.code).toBe('RULE_DEFINE_FAILED');
    });
});
