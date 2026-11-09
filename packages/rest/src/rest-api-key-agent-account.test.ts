// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0151 D3] The REST face: an AI service account's API key admits the
// ACCOUNT as the subject — `userId` the account, `principalKind: 'agent'`, no
// `onBehalfOf`, no system permission, no `everyone` anchor and no
// administrator standing — through the real `computeExecCtx` →
// `resolveAuthzContext` → `assembleExecutionContext` pipeline, captured as the
// protocol receives it (the instrumentation `rest-exec-ctx-principal-kind.test.ts`
// uses). CONTROL: a person's key over the same store is unchanged.

import { describe, it, expect, vi } from 'vitest';
// The route modules load ObjectQL lazily; pay that load at collection, never in a clocked case.
import '@objectstack/objectql';
import { hashApiKey } from '@objectstack/core';
import { RestServer } from './rest-server';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const TASK = {
    name: 'task',
    label: 'Task',
    fields: { id: { type: 'text', label: 'ID' }, title: { type: 'text', label: 'Title' } },
};

const makeServer = () => ({
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn(), close: vi.fn(),
});

const FUTURE = '2999-01-01T00:00:00Z';
const BOT_KEY = 'osk_31739_rest_account';
const MIA_KEY = 'osk_31739_rest_person';

/**
 * - `u_bot`: an AI service account, holding `ops_tools` (which carries a
 *   system permission) in org_a and — as a store can hold, though no door
 *   writes it — the Default Organization's `admin_full_access` grant, the row
 *   that anchors a person's platform standing.
 * - `u_mia`: a person holding the same two grants.
 * - The `everyone` anchor binds `everyone_reader`.
 */
const USERS: Record<string, Record<string, unknown>> = {
    u_bot: { id: 'u_bot', email: 'bot@agents.invalid', principal_kind: 'agent', accountable_user_id: 'u_mia' },
    u_mia: { id: 'u_mia', email: 'mia@example.com', principal_kind: 'human' },
};

/** The rows the store holds for `object` under the `where` of `opts`, before any bound. */
function rowsOf(object: string, opts: any): Record<string, unknown>[] {
    const where = opts?.where ?? {};
    if (object === 'sys_api_key') {
        const rows = [
            { id: 'k_bot', key: hashApiKey(BOT_KEY), revoked: false, user_id: 'u_bot', expires_at: FUTURE, active_organization_id: 'org_a' },
            { id: 'k_mia', key: hashApiKey(MIA_KEY), revoked: false, user_id: 'u_mia', expires_at: FUTURE, active_organization_id: 'org_a' },
        ];
        return rows.filter((row) => Object.entries(where).every(([k, v]) => (row as any)[k] === v));
    }
    if (object === 'sys_user') return USERS[where.id] ? [USERS[where.id]] : [];
    if (object === 'sys_member') {
        const rows = [
            { user_id: 'u_bot', organization_id: 'org_a', role: 'member' },
            { user_id: 'u_mia', organization_id: 'org_a', role: 'member' },
        ];
        return rows.filter((row) => Object.entries(where).every(([k, v]) => (row as any)[k] === v));
    }
    if (object === 'sys_organization') return [{ id: 'org_default', slug: 'default' }];
    if (object === 'sys_user_permission_set') {
        if (where.user_id !== 'u_bot' && where.user_id !== 'u_mia') return [];
        return [
            { user_id: where.user_id, permission_set: 'ops_tools', organization_id: 'org_a' },
            { user_id: where.user_id, permission_set: 'admin_full_access', organization_id: 'org_default' },
        ];
    }
    return [];
}

const makeQl = () => bindTestSecurityCatalog({
    // The caller's bound applies after the filter, by presence, as ObjectQL applies it.
    find: async (object: string, opts: any) => {
        const rows = rowsOf(object, opts);
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
}, {
    permissions: [
        { name: 'admin_full_access' },
        { name: 'ops_tools', systemPermissions: ['manage_users'] },
        { name: 'everyone_reader' },
    ],
    positions: [{ name: 'everyone', permissionSets: ['everyone_reader'] }],
});

function makeRes() {
    let status = 200;
    const res: any = {
        write: () => true,
        end: () => {},
        header: () => res,
        status: (code: number) => { status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return { res, getStatus: () => status };
}

/** Drive the REAL `GET /api/v1/data/task` route and capture the context `findData` receives. */
async function request(headers: Record<string, string>) {
    const seen: any[] = [];
    const protocol: any = {
        getMetaItems: vi.fn().mockResolvedValue({ items: [TASK] }),
        findData: vi.fn(async (args: any) => { seen.push(args.context); return { object: 'task', records: [] }; }),
    };
    const auth = { isAuthGateActive: () => true, api: { getSession: async () => undefined } };
    const rest = new RestServer(
        makeServer() as any,
        protocol as any,
        {} as any,
        undefined,
        undefined,
        undefined,
        async () => auth,
        async () => makeQl(),
    );
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object');
    expect(route).toBeDefined();
    const out = makeRes();
    await route!.handler({ method: 'GET', path: '/api/v1/data/task', params: { object: 'task' }, query: {}, headers } as any, out.res);
    return { ctx: seen[0], status: out.getStatus() };
}

describe('[ADR-0151 D3] REST: an AI service account\'s key admits the account itself', () => {
    it('userId is the account, principalKind agent, no onBehalfOf, no system permission, no everyone anchor, no admin standing', async () => {
        const { ctx, status } = await request({ 'x-api-key': BOT_KEY });
        expect(status).toBe(200);
        expect(ctx.userId).toBe('u_bot');
        expect(ctx.principalKind).toBe('agent');
        expect(ctx.onBehalfOf).toBeUndefined();
        expect(Object.keys(ctx)).not.toContain('onBehalfOf');
        expect(ctx.performedBy).toBeUndefined();
        expect(ctx.systemPermissions).toEqual([]);
        expect(ctx.positions).not.toContain('everyone');
        expect(ctx.positions).not.toContain('platform_admin');
        expect(ctx.posture).not.toBe('PLATFORM_ADMIN');
        expect(ctx.isSystem).toBe(false);
    });

    it('CONTROL: a person\'s key over the same store and the same grants is unchanged', async () => {
        const { ctx, status } = await request({ 'x-api-key': MIA_KEY });
        expect(status).toBe(200);
        expect(ctx.userId).toBe('u_mia');
        expect(ctx.principalKind).toBe('human');
        expect(ctx.onBehalfOf).toBeUndefined();
        expect(ctx.systemPermissions).toContain('manage_users');
        expect(ctx.positions).toContain('everyone');
        expect(ctx.posture).toBe('PLATFORM_ADMIN');
    });
});
