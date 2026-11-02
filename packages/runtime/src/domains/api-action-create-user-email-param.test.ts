// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28280] `sys_user.create_user` declares its `email` param twice: optional
// while phone sign-in is on, required while it is off, each shown under its own
// `visible` gate in the console. The two action doors (REST
// `POST /actions/sys_user/create_user` and the MCP `run_action` bridge) judge
// the request bag with ADR-0104 D2's `validateActionParams` BEFORE forwarding
// to plugin-auth, and that check reads neither `visible` nor `features`. So the
// doors must hold `email` required only when every declaration of it is,
// otherwise a phone-only create with phone sign-in on is refused at the door
// ("Action param \"email\" is required") and never reaches the endpoint that
// accepts it.
//
// Only the REST door is driven here: `create_user` declares no `ai.exposed`, so
// the MCP bridge refuses it as a system-object action before any param check
// (measured; `systemObjectActionExposureError`). Both doors call the same
// `enforceActionParams` → `validateActionParams`, whose merge is pinned in
// `packages/spec/src/ui/action-params.test.ts`.
//
// The door is driven as `api-action-forward.test.ts` drives it, over a
// recording in-process target, with the REAL `SysUser` declaration. The target
// stands in for plugin-auth's Create User: whether a blank email is acceptable
// is that endpoint's decision (it answers 400 "Email is required" with phone
// sign-in off, pinned in plugin-auth), and the doors relay its answer whole.

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { SysUser } from '@objectstack/platform-objects/identity';
import { ActionActivationProjection } from '@objectstack/objectql';

const OBJECT = 'sys_user';
const ACTION = 'create_user';

function boot(answer: { status?: number; body?: unknown } = {}) {
    const injected: Array<{ url: string; init: RequestInit }> = [];
    const request = vi.fn(async (url: string, init: RequestInit) => {
        injected.push({ url, init });
        return new Response(JSON.stringify(answer.body ?? { success: true, data: { user: { id: 'u_new' } } }), {
            status: answer.status ?? 200,
            headers: [['content-type', 'application/json']],
        });
    });
    const server = { getRawApp: () => ({ request }) };
    const objectDef: any = SysUser;
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        getSchema: (name: string) => (name === OBJECT ? objectDef : undefined),
        registry: { getObject: (name: string) => (name === OBJECT ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
        isActionEnabled: () => true,
        describeDisabledAction: (name: string) => new ActionActivationProjection().describeDisabled(name),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : n === 'http.server' || n === 'http-server' ? server
        : null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    return { dispatcher: new HttpDispatcher(kernel), ql, metadata, request, injected };
}

/** A signed-in platform administrator, as the forward tests' caller. */
const CTX = (): HttpProtocolContext => ({
    request: {
        headers: {
            host: 'app.example.test',
            authorization: 'Bearer tok_admin',
            'content-type': 'application/json',
        },
    },
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', tenantId: 'org_1', systemPermissions: [] },
} as unknown as HttpProtocolContext);

const rest = (h: ReturnType<typeof boot>, params: Record<string, unknown>) =>
    h.dispatcher.handleActions(`/${OBJECT}/${ACTION}`, 'POST', { params }, CTX());

const statusOf = (r: any): unknown => r?.response?.status;
const forwardedBody = (h: ReturnType<typeof boot>) => JSON.parse(String(h.injected[0].init.body));

describe('#28280 — the action doors judge Create User\'s twice-declared email by the endpoint, not by the last declaration', () => {
    it('the declaration really carries two email params, optional first and required second', () => {
        const params = ((SysUser.actions ?? []).find((a) => a.name === ACTION)?.params ?? []) as Array<{ field?: string; required?: boolean }>;
        expect(params.filter((p) => p.field === 'email').map((p) => p.required)).toEqual([false, true]);
    });

    it('REST, phone sign-in on: a phone-only create passes the door and reaches the endpoint', async () => {
        const h = boot();

        const res = await rest(h, { phoneNumber: '+8613800000000', name: 'Ada' });

        expect(statusOf(res), JSON.stringify((res as any)?.response?.body)).toBe(200);
        expect(h.injected).toHaveLength(1);
        expect(h.injected[0].url).toBe('http://app.example.test/api/v1/auth/admin/create-user');
        expect(forwardedBody(h)).toMatchObject({ phoneNumber: '+8613800000000', name: 'Ada', generatePassword: true });
    });

    it('REST, phone sign-in off: a blank email passes the door, and the ENDPOINT\'s 400 "Email is required" is what the caller gets', async () => {
        const h = boot({
            status: 400,
            body: {
                success: false,
                error: {
                    code: 'VALIDATION_FAILED',
                    message: 'Email is required',
                    httpStatus: 400,
                    fields: [{ field: 'email', code: 'required', message: 'Email is required' }],
                },
            },
        });

        const res: any = await rest(h, { name: 'Ada' });

        expect(h.injected).toHaveLength(1);
        expect(statusOf(res)).toBe(400);
        expect(res?.response?.body?.error?.code).toBe('VALIDATION_FAILED');
        expect(res?.response?.body?.error?.message).toBe('Email is required');
        expect(res?.response?.body?.error?.fields).toEqual([{ field: 'email', code: 'required', message: 'Email is required' }]);
    });

    it('REST, phone sign-in off: a create with an email passes and is forwarded with it', async () => {
        const h = boot();

        const res = await rest(h, { email: 'ada@example.com', name: 'Ada' });

        expect(statusOf(res)).toBe(200);
        expect(forwardedBody(h)).toMatchObject({ email: 'ada@example.com', name: 'Ada' });
    });

    it('control: the door still judges the email\'s value shape, so a non-string email is refused there', async () => {
        const h = boot();

        const res: any = await rest(h, { email: 42 });

        expect(statusOf(res)).toBe(400);
        expect(h.injected).toHaveLength(0);
    });
});
