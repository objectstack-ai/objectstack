// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30771 · ruling A on #30126 row 16] A platform-admin action declares its
 * gate once, and both action doors read that one declaration.
 *
 * Before: `ban_user`, `set_user_manager` and the rest of the platform-admin
 * family carried their gate only in `visible` (display only), so MCP
 * `list_actions` listed them to a plain member and the platform action door
 * forwarded the call for the target to refuse. Now each declares
 * `requiredPermissions` (ADR-0066 D4), and the runtime's one reader,
 * `actionPermissionError`, answers both doors from it.
 *
 * Driven over the REAL `sys_user` declaration (`@objectstack/platform-objects`)
 * through the one production `McpActionBridge` and the REST
 * `POST /actions/:object/:action` door, with the forward target faked so the
 * test can see whether the call ever left the door.
 *
 * What it pins:
 *   - a plain member is not listed `ban_user` / `set_user_manager`; a platform
 *     admin (the capabilities the rung carries) is;
 *   - a plain member's call is refused 403 at both doors and never forwarded;
 *     an admin's is forwarded, so the target still judges the rung as before;
 *   - the listing and both run doors agree, action by action.
 */

import { describe, it, expect, vi } from 'vitest';

import { SysUser } from '@objectstack/platform-objects/identity';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec/identity';

import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext } from './http-dispatcher.js';
import { actionPermissionError } from './action-execution.js';

const OBJECT = 'sys_user';
const ADMIN_CAPS: string[] = [...(ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions ?? [])];

function boot() {
    const request = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200, headers: [['content-type', 'application/json']],
    }));
    const server = { getRawApp: () => ({ request }) };
    const served: Record<string, any> = { [OBJECT]: SysUser };
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        listRegisteredActions: () => [],
        getSchema: (name: string) => served[name],
        registry: { getObject: (name: string) => served[name], getItem: () => undefined },
        find: vi.fn(async (_object: string, q: any) =>
            q?.where?.id === 'u_target' ? [{ id: 'u_target', email: 'target@example.test', banned: false, source: 'local' }] : []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
        isActionEnabled: () => true,
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => Object.values(served)),
        getObject: vi.fn(async (name?: string) => (name ? served[name] : undefined)),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : n === 'http.server' || n === 'http-server' ? server
        : null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    return { dispatcher: new HttpDispatcher(kernel) as any, request };
}

/** A signed-in human holding `caps`, over a session cookie. */
const CTX = (userId: string, caps: string[]): HttpProtocolContext => ({
    request: {
        headers: {
            host: 'app.example.test',
            'x-forwarded-proto': 'https',
            cookie: 'better-auth.session_token=abc',
            'content-type': 'application/json',
        },
    },
    environmentId: 'platform',
    executionContext: { userId, tenantId: 'org_1', permissions: [], systemPermissions: caps, principalKind: 'human' },
} as unknown as HttpProtocolContext);

const MEMBER = () => CTX('u_member', []);
const ADMIN = () => CTX('u_admin', ADMIN_CAPS);

async function listedNames(ctx: HttpProtocolContext): Promise<string[]> {
    const { dispatcher } = boot();
    const listed: any[] = await dispatcher.buildMcpBridge(ctx).listActions();
    return listed.filter((a) => a.objectName === OBJECT).map((a) => a.name);
}

async function refusalOf(p: Promise<unknown>): Promise<any> {
    try {
        await p;
    } catch (e) {
        return e;
    }
    throw new Error('expected a refusal, the call ran');
}

const PINNED = ['ban_user', 'set_user_manager'] as const;

/** The params each pinned action declares, so a refusal is the gate's and not the param contract's. */
const PARAMS: Record<(typeof PINNED)[number], Record<string, unknown>> = {
    ban_user: { banReason: 'spam' },
    set_user_manager: { managerId: 'u_admin' },
};

describe('[#30771] the declaration: the platform-admin actions on sys_user declare their gate', () => {
    it('ban_user and set_user_manager declare a capability the rung carries (positive control for every block below)', () => {
        for (const name of PINNED) {
            const action = (SysUser as any).actions.find((a: any) => a.name === name);
            expect(action, name).toBeDefined();
            expect(action.requiredPermissions, name).toEqual(['manage_users']);
            expect(ADMIN_CAPS).toContain('manage_users');
        }
    });
});

describe('[#30771] MCP list_actions lists only what the caller can run', () => {
    it('a plain member is not listed ban_user or set_user_manager', async () => {
        const names = await listedNames(MEMBER());
        // Control: the listing is live for this caller (an ungated identity action is still there).
        expect(names.length).toBeGreaterThan(0);
        for (const name of PINNED) expect(names, name).not.toContain(name);
    });

    it('a platform admin (the capabilities the rung carries) is listed both', async () => {
        const names = await listedNames(ADMIN());
        for (const name of PINNED) expect(names, name).toContain(name);
    });
});

describe('[#30771] a hidden action is still refused when called', () => {
    for (const name of PINNED) {
        it(`REST POST /actions/sys_user/${name}: the member is refused 403 at the door, nothing forwarded; the admin is forwarded`, async () => {
            const member = boot();
            const refused = await member.dispatcher.handleActions(`/${OBJECT}/${name}`, 'POST', { recordId: 'u_target', params: PARAMS[name] }, MEMBER());
            expect(refused?.response?.status).toBe(403);
            expect(String(refused?.response?.body?.error?.message)).toContain('requires capability [manage_users]');
            expect(member.request).not.toHaveBeenCalled();

            const admin = boot();
            await admin.dispatcher.handleActions(`/${OBJECT}/${name}`, 'POST', { recordId: 'u_target', params: PARAMS[name] }, ADMIN());
            // The door no longer answers for the admin: the target judges the rung, as before.
            expect(admin.request).toHaveBeenCalledTimes(1);
        });

        it(`MCP run_action ${name}: the member is refused with the same gate, nothing forwarded`, async () => {
            const { dispatcher, request } = boot();
            const err = await refusalOf(dispatcher.buildMcpBridge(MEMBER()).runAction(name, {
                objectName: OBJECT, recordId: 'u_target', params: PARAMS[name],
            }));
            expect(String(err?.message)).toContain('requires capability [manage_users]');
            // The REST door's status and its standard code (ADR-0112).
            expect(err).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
            expect(request).not.toHaveBeenCalled();
        });
    }
});

describe('[#30771] capabilityRefusal: why the scoped MCP pre-screen finds an action missing', () => {
    it('answers the gate\'s refusal for an exposed action the member cannot run — the one run_action throws by name', async () => {
        const { dispatcher, request } = boot();
        const bridge = dispatcher.buildMcpBridge(MEMBER());
        for (const name of PINNED) {
            const refusal = await bridge.capabilityRefusal(name, OBJECT);
            expect(refusal, name).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
            const thrown = await refusalOf(bridge.runAction(name, { recordId: 'u_target', params: PARAMS[name] }));
            expect(refusal.message, name).toBe(thrown.message);
        }
        expect(request).not.toHaveBeenCalled();
    });

    it('answers nothing for the admin, for an action not exposed to AI, and for one not declared there', async () => {
        const { dispatcher } = boot();
        expect(await dispatcher.buildMcpBridge(ADMIN()).capabilityRefusal('ban_user', OBJECT)).toBeUndefined();
        const member = dispatcher.buildMcpBridge(MEMBER());
        // CONTROL: `impersonate_user` declares a gate but no `ai` block, so its
        // absence from the listing is exposure, and the tool keeps the
        // system-object sentence for it.
        const impersonate = (SysUser as any).actions.find((a: any) => a.name === 'impersonate_user');
        expect(impersonate.requiredPermissions).toEqual(['manage_users']);
        expect(impersonate.ai?.exposed).not.toBe(true);
        expect(await member.capabilityRefusal('impersonate_user', OBJECT)).toBeUndefined();
        expect(await member.capabilityRefusal('no_such_action', OBJECT)).toBeUndefined();
    });
});

describe('[#30771] the listing and the run doors read one declaration', () => {
    it('for every sys_user action and both callers, list_actions omits it exactly when the shared gate refuses it', async () => {
        const deps: any = {};
        for (const [who, ctx] of [['member', MEMBER()], ['admin', ADMIN()]] as const) {
            const names = new Set(await listedNames(ctx));
            for (const action of (SysUser as any).actions as any[]) {
                const gated = actionPermissionError(deps, action, (ctx as any).executionContext, OBJECT) !== null;
                if (gated) expect(names.has(action.name), `${who}: ${action.name} is gated but listed`).toBe(false);
            }
            // Every listed action passes the gate that the REST door runs first.
            for (const name of names) {
                const action = (SysUser as any).actions.find((a: any) => a.name === name);
                expect(actionPermissionError(deps, action, (ctx as any).executionContext, OBJECT), `${who}: ${name}`).toBeNull();
            }
        }
    });
});
