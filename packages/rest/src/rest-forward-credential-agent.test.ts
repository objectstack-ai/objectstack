// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [ADR-0090 D10 rule 5, #28367] The REST face's half of the agent forward
// credential. This face hands the shared assembler `oauth: undefined` for every
// caller but one: a request the action door itself injected in-process for an
// AI agent's `api` forward, carrying the credential minted for that forward.
// That request resolves to the SAME agent principal the MCP door built
// (`principalKind: 'agent'`, `onBehalfOf`, `performedBy`, `oauthScopes`), and it
// reports no admission, so the key-management rule never reads it as a
// signed-in session. ⛔ An OAuth access token presented from outside stays
// unaccepted here, and the credential's header presented outside a forward is
// nobody.
//
// The fixture below is the real data route over the stub protocol of
// `rest-exec-ctx-principal-kind.test.ts`, copied rather than shared because
// that file's fixtures are module-private.

import { describe, it, expect, vi } from 'vitest';
import { hashApiKey } from '@objectstack/core';
import { RestServer } from './rest-server';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { FORWARD_CREDENTIAL_HEADER, withForwardCredential } from './forward-credential.js';

const TASK = {
    name: 'task',
    label: '任务',
    fields: { id: { type: 'text', label: 'ID' }, title: { type: 'text', label: '标题' } },
};

const makeServer = () => ({
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn(), close: vi.fn(),
});

const FUTURE = '2999-01-01T00:00:00Z';
/** The raw API key `member1` presents; `sys_api_key` stores only its hash. */
const RAW_API_KEY = 'osk_6071_rest_face';

/**
 * A fake data engine holding what a real deployment holds: one `sys_api_key`
 * row for `member1`, a `member_default` grant for `member1` and an
 * `admin_full_access` grant for `admin1` owned by the Default Organization (the
 * grant that anchors platform standing → PLATFORM_ADMIN). Everything else
 * resolves empty.
 */
const makeQl = () => bindTestSecurityCatalog({
    find: async (object: string, opts: any) => {
        const rows = rowsFor(object, opts);
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
}, { permissions: [{ name: 'admin_full_access' }, { name: 'member_default' }] });

/** The rows the fake engine holds for `object`, filtered by `opts.where`. */
function rowsFor(object: string, opts: any): any[] {
    {
        const where = opts?.where ?? {};
        if (object === 'sys_api_key') {
            const row = { id: 'k1', key: hashApiKey(RAW_API_KEY), revoked: false, user_id: 'member1', expires_at: FUTURE };
            return Object.entries(where).every(([k, v]) => (row as any)[k] === v) ? [row] : [];
        }
        if (object === 'sys_user') return [{ id: where.id, email: `${where.id}@example.com` }];
        // The Default Organization, by its slug.
        if (object === 'sys_organization') return [{ id: 'org_default', slug: 'default' }];
        if (object === 'sys_user_permission_set') {
            if (where.user_id === 'admin1') return [{ permission_set_id: 'ps_admin', permission_set: 'admin_full_access', organization_id: 'org_default' }];
            if (where.user_id === 'member1') return [{ permission_set_id: 'ps_member', permission_set: 'member_default', organization_id: 'org_default' }];
            return [];
        }
        if (object === 'sys_permission_set') {
            // By id (a position binding) or by name (a user grant, ADR-0131 D4).
            const ids: string[] = where.id?.$in ?? [];
            const names: string[] = where.name?.$in ?? [];
            return [
                ids.includes('ps_admin') || names.includes('admin_full_access') ? { id: 'ps_admin', name: 'admin_full_access' } : null,
                ids.includes('ps_member') || names.includes('member_default') ? { id: 'ps_member', name: 'member_default' } : null,
            ].filter(Boolean);
        }
        return [];
    }
}

/** A fake auth service whose session is keyed off the request's `cookie` header. */
const makeAuth = () => ({
    // [#7280] The ADR-0069 gate feature is ON, so `computeExecCtx` takes its
    // gate branch for every authenticated request. A session with no
    // `user.authGate` still yields no gate — which is what keeps the golden key
    // set below unchanged, and makes the gated cases genuinely opt-in.
    isAuthGateActive: () => true,
    api: {
        getSession: async ({ headers }: { headers: any }) => {
            const cookie = headers?.get?.('cookie');
            if (cookie === 'admin') return { user: { id: 'admin1' } };
            if (cookie === 'member') return { user: { id: 'member1' } };
            // [commit f586f1a89] A session that DOES carry a bearer token, so the
            // `accessToken` pin below exercises a live branch of
            // `resolveAuthzContext` rather than an absent value.
            if (cookie === 'member-tok') {
                return { user: { id: 'member1' }, session: { token: 'sess_tok_rest' } };
            }
            // [#7280] A session blocked by an authentication policy…
            if (cookie === 'member-gated') {
                return {
                    user: {
                        id: 'member1',
                        authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
                    },
                };
            }
            // …and one whose gate names a code but no usable message, the shape
            // `normalizeAuthGate` exists to complete.
            if (cookie === 'member-gated-bare') {
                return { user: { id: 'member1', authGate: { code: 'MFA_REQUIRED' } } };
            }
            return undefined;
        },
    },
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
    return { res, getStatus: () => status, getJson: () => res._json };
}

/**
 * Boot the REAL data route over a stub protocol. `findData` records the
 * ExecutionContext the transport handed it — the instrumentation point of the
 * issue, moved into a test.
 */
function boot(auth: unknown = makeAuth()) {
    const seen: any[] = [];
    const protocol: any = {
        getMetaItems: vi.fn().mockResolvedValue({ items: [TASK] }),
        findData: vi.fn(async (args: any) => { seen.push(args.context); return { object: 'task', records: [] }; }),
    };
    const rest = new RestServer(
        makeServer() as any,
        protocol as any,
        {} as any,
        undefined,              // kernelManager
        undefined,              // envRegistry
        undefined,              // defaultEnvironmentIdProvider
        async () => auth,       // authServiceProvider
        async () => makeQl(),   // objectQLProvider
    );
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object');
    expect(route).toBeDefined();
    return { rest, route, seen, protocol };
}

/** Drive `GET /api/v1/data/task` with the given request headers. */
async function request(headers: Record<string, string>, auth?: unknown) {
    const { route, seen, protocol } = boot(auth);
    const out = makeRes();
    await route!.handler({
        method: 'GET',
        // [#7280] A real adapter always sets `path`, and `enforceAuth`'s
        // ADR-0069 branch reads it. [#7898] `isAuthGateAllowlisted(undefined)`
        // used to return TRUE, so a request without one read as allow-listed and
        // the gate never fired; the predicate is fail-closed now, which reverses
        // the consequence of omitting `path`. Either way, spelling it here keeps
        // the wire fixture honest about what a real adapter sends.
        path: '/api/v1/data/task',
        params: { object: 'task' }, query: {}, headers,
    } as any, out.res);
    return { ctx: seen[0], out, protocol };
}

const AGENT = { userId: 'member1', clientId: 'client_agent', scopes: ['actions:execute', 'data:read', 'data:write'] };
const bindForward = (method = 'GET', path = '/api/v1/data/task') =>
    ({ method, path, run: { objectName: 'task', actionName: 'probe' }, agent: AGENT });

describe('[ADR-0090 D10 rule 5] the REST face resolves a forward credential to the agent, and nothing else to one', () => {
    it('inside the forward, the presented credential resolves to the SAME agent principal the MCP door builds', async () => {
        const { ctx, out } = await withForwardCredential(bindForward(), (handle) =>
            request({ host: 'localhost', [FORWARD_CREDENTIAL_HEADER]: handle }));

        expect(out.getStatus()).toBe(200);
        expect(ctx).toMatchObject({
            userId: 'member1',
            principalKind: 'agent',
            onBehalfOf: { userId: 'member1', principalKind: 'human' },
            performedBy: { clientId: 'client_agent' },
            oauthScopes: AGENT.scopes,
        });
        // No admission is reported for it: the key-management rule reads no
        // credential, never a signed-in session.
        expect(ctx.__admittedBy).toBeUndefined();
    });

    it('a credential bound to another method or route is nobody here: 401, no context', async () => {
        for (const bound of [bindForward('POST'), bindForward('GET', '/api/v1/data/other')]) {
            const { ctx, out } = await withForwardCredential(bound, (handle) =>
                request({ host: 'localhost', [FORWARD_CREDENTIAL_HEADER]: handle }));
            expect(ctx).toBeUndefined();
            expect(out.getStatus()).toBe(401);
        }
    });

    it('a second request presenting the same handle inside the forward is nobody: the credential was spent', async () => {
        const second = await withForwardCredential(bindForward(), async (handle) => {
            const first = await request({ host: 'localhost', [FORWARD_CREDENTIAL_HEADER]: handle });
            expect(first.ctx?.principalKind).toBe('agent');
            return request({ host: 'localhost', [FORWARD_CREDENTIAL_HEADER]: handle });
        });
        expect(second.ctx).toBeUndefined();
        expect(second.out.getStatus()).toBe(401);
    });

    it('the header presented outside any forward is nobody, and a cookie beside it is read as before, unchanged', async () => {
        const forged = await request({ [FORWARD_CREDENTIAL_HEADER]: 'A'.repeat(43) });
        expect(forged.ctx).toBeUndefined();
        expect(forged.out.getStatus()).toBe(401);

        const withCookie = await request({ cookie: 'member', [FORWARD_CREDENTIAL_HEADER]: 'A'.repeat(43) });
        expect(withCookie.ctx).toMatchObject({ userId: 'member1', principalKind: 'human' });
        expect(withCookie.ctx.oauthScopes).toBeUndefined();
    });

    it('the boundary is unmoved: an OAuth access token presented from outside is not accepted on this face', async () => {
        const jwtShaped = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJtZW1iZXIxIn0.c2lnbmF0dXJl';
        const { ctx, out } = await request({ authorization: `Bearer ${jwtShaped}` });
        expect(ctx).toBeUndefined();
        expect(out.getStatus()).toBe(401);
    });
});
