// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #6071 — the REST transport's `authorization envelope → ExecutionContext`
// assembly dropped the ADR-0090 D9/D10 principal taxonomy.
//
// `resolveAuthzContext` (@objectstack/core) was extracted so the two HTTP entry
// points could never drift on AUTHORIZATION — but the step AFTER it, assembling
// the ExecutionContext, is still two hand-written copies. The runtime /
// dispatcher copy (`packages/runtime/src/security/resolve-execution-context.ts`)
// set `principalKind` (+ `onBehalfOf` on the agent arm); the REST copy
// (`rest-server.ts` `computeExecCtx`) set neither, so every enforcement-side
// judgment that reads `principalKind` was silently NEVER-TRUE on the REST face
// (explain's guest⇒EXTERNAL floor, the security plugin's agent baseline, the
// perf-disclosure gate).
//
// The issue's own evidence was an instrumented dogfood boot printing the key
// set of the context that ARRIVED at a consumer plugin — `__kernel` present
// (proving the rest-server path), `principalKind` absent. These tests reproduce
// that instrumentation on the wire: a real registered route, the real
// `computeExecCtx` → `resolveAuthzContext` pipeline, and the captured context
// the protocol actually receives.

import { describe, it, expect, vi } from 'vitest';
import { hashApiKey } from '@objectstack/core';
import { runWithPerfDisclosure, type PerfDisclosureGate } from '@objectstack/observability';
import { RestServer } from './rest-server';

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
 * row for `member1`, a `member_default` grant for `member1` and an UNSCOPED
 * `admin_full_access` grant for `admin1` (→ PLATFORM_ADMIN). Everything else
 * resolves empty.
 */
const makeQl = () => ({
    find: async (object: string, opts: any) => {
        const where = opts?.where ?? {};
        if (object === 'sys_api_key') {
            const row = { id: 'k1', key: hashApiKey(RAW_API_KEY), revoked: false, user_id: 'member1', expires_at: FUTURE };
            return Object.entries(where).every(([k, v]) => (row as any)[k] === v) ? [row] : [];
        }
        if (object === 'sys_user') return [{ id: where.id, email: `${where.id}@example.com` }];
        if (object === 'sys_user_permission_set') {
            if (where.user_id === 'admin1') return [{ permission_set_id: 'ps_admin', organization_id: null }];
            if (where.user_id === 'member1') return [{ permission_set_id: 'ps_member', organization_id: null }];
            return [];
        }
        if (object === 'sys_permission_set') {
            const ids: string[] = where.id?.$in ?? [];
            return [
                ids.includes('ps_admin') ? { id: 'ps_admin', name: 'admin_full_access' } : null,
                ids.includes('ps_member') ? { id: 'ps_member', name: 'member_default' } : null,
            ].filter(Boolean);
        }
        return [];
    },
});

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
            // [#6216] A session that DOES carry a bearer token, so the
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
function boot() {
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
        async () => makeAuth(), // authServiceProvider
        async () => makeQl(),   // objectQLProvider
    );
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object');
    expect(route).toBeDefined();
    return { rest, route, seen, protocol };
}

/** Drive `GET /api/v1/data/task` with the given request headers. */
async function request(headers: Record<string, string>) {
    const { route, seen, protocol } = boot();
    const out = makeRes();
    await route!.handler({
        method: 'GET',
        // [#7280] A real adapter always sets `path`, and `enforceAuth`'s
        // ADR-0069 branch reads it — `isAuthGateAllowlisted(undefined)` returns
        // TRUE, so a request without one is treated as allow-listed and the gate
        // never fires. Spelling it here keeps the wire fixture honest.
        path: '/api/v1/data/task',
        params: { object: 'task' }, query: {}, headers,
    } as any, out.res);
    return { ctx: seen[0], out, protocol };
}

/**
 * [#7280] The envelope `computeExecCtx` actually produces, read directly.
 *
 * Needed because a GATED session never reaches `findData`: `enforceAuth` answers
 * 403 first, which is the whole point of the gate — so the wire-capture helper
 * above cannot observe the envelope for exactly the case under test.
 */
async function execCtx(headers: Record<string, string>) {
    const { rest } = boot();
    return await (rest as any).computeExecCtx(undefined, {
        method: 'GET', params: { object: 'task' }, query: {}, headers,
    });
}

describe('#6071 — REST-face ExecutionContext carries the ADR-0090 D9/D10 principal taxonomy', () => {
    it('a session-backed request reaches the data layer with principalKind:human', async () => {
        const { ctx, out } = await request({ cookie: 'member' });

        expect(out.getStatus()).toBe(200);
        expect(ctx?.userId).toBe('member1');
        // The regression itself: the key was ABSENT from the key set the issue
        // measured in a dogfood boot. Assert on the key set, not just the value,
        // so re-dropping the field fails here even if some consumer defaults it.
        expect(Object.keys(ctx)).toContain('principalKind');
        expect(ctx.principalKind).toBe('human');
    });

    it('an API-key-backed request is a human principal too — the same verdict the runtime face pins', async () => {
        // Runtime-side pin, verbatim in intent: "an authenticated (API-key)
        // request resolves as a human principal, never guest"
        // (packages/runtime/src/security/resolve-execution-context.test.ts).
        // Same envelope, same provenance, same label — that is the drift closed.
        const { ctx } = await request({ 'x-api-key': RAW_API_KEY });

        expect(ctx?.userId).toBe('member1');
        expect(ctx.principalKind).toBe('human');
        expect(ctx.positions).not.toContain('guest');
    });

    it('leaves onBehalfOf ABSENT — this transport has no delegation provenance', async () => {
        // `onBehalfOf` is set ONLY by the runtime resolver's agent arm, which
        // needs an OAuth access token naming an authorized client. That
        // credential is honoured on the `/mcp` door alone
        // (`acceptOAuthAccessToken`), so no REST request can produce a delegated
        // principal. Absent here == absent for every human principal on the
        // dispatcher face; it is parity, not a second gap. If REST ever accepts
        // an OAuth client credential, this pin is the thing that must change.
        const { ctx } = await request({ cookie: 'member' });

        expect(ctx.onBehalfOf).toBeUndefined();
        expect(Object.keys(ctx)).not.toContain('onBehalfOf');
        expect(ctx.principalKind).not.toBe('agent');
    });

    it('an anonymous request is UNCHANGED: no context at all, 401 — never a guest-labelled one', async () => {
        // The guest arm of the runtime derivation is not representable here and
        // is deliberately NOT reproduced: `computeExecCtx` returns undefined
        // when the envelope carries no userId, so the anonymous REST face keeps
        // its 401 (`enforceAuth`). Labelling anonymous callers `guest` here
        // would hand them a context where they previously had none — a behaviour
        // change well beyond D9/D10's declared intent.
        const { ctx, out, protocol } = await request({});

        expect(ctx).toBeUndefined();
        expect(out.getStatus()).toBe(401);
        expect(protocol.findData).not.toHaveBeenCalled();
    });

    it('the platform-admin principal is labelled human as well — the label is provenance, not privilege', async () => {
        const { ctx } = await request({ cookie: 'admin' });

        expect(ctx.principalKind).toBe('human');
        // Posture keeps saying what it always said; the new field adds no
        // authority of its own.
        expect(ctx.posture).toBe('PLATFORM_ADMIN');
    });
});

describe('#6071 — activated-branch pin: the perf-disclosure gate (perf-timing.ts:475)', () => {
    // `isPerfDisclosurePrincipal` reads `principalKind` for 'service' / 'system'
    // ONLY. The REST face produces neither, so labelling it 'human' cannot open
    // the per-request `Server-Timing` disclosure — the gate keeps deciding on
    // `isSystem` / `posture` exactly as before this change.
    const resolveInGate = async (headers: Record<string, string>) => {
        const { route } = boot();
        const gate: PerfDisclosureGate = { allowed: false };
        const out = makeRes();
        await runWithPerfDisclosure(gate, () =>
            route!.handler({ method: 'GET', params: { object: 'task' }, query: {}, headers } as any, out.res),
        );
        return gate;
    };

    it('stays CLOSED for the newly-labelled human member', async () => {
        expect((await resolveInGate({ cookie: 'member' })).allowed).toBe(false);
    });

    it('still OPENS for a platform admin (posture, unchanged by the new label)', async () => {
        const gate = await resolveInGate({ cookie: 'admin' });
        expect(gate.allowed).toBe(true);
        expect(gate.privileged).toBe(true);
    });
});

describe('#6216 — the REST face assembles through the SHARED assembler, output unchanged', () => {
    // The maintainer ruling of 2026-08-08 (Option A) converged the two
    // hand-written assemblies onto one module and is explicit that NEITHER
    // surface changes runtime behaviour. The frozen-transcription parity matrix
    // lives next to the assembler
    // (`packages/core/src/security/assemble-execution-context.test.ts`); these
    // two pins are the same claim measured on the WIRE, through the real
    // `computeExecCtx` → `resolveAuthzContext` pipeline, because that is where a
    // wiring mistake (wrong entry, wrong per-face input) would actually show.

    it('emits exactly the pre-#6216 key set for a session-backed request', async () => {
        const { ctx } = await request({ cookie: 'member' });

        // Golden key set, not a subset check: a field ARRIVING that never used
        // to (the direction a naive convergence fails in) is as much a
        // behaviour change as a field going missing, and only an exact
        // comparison catches both.
        expect(new Set(Object.keys(ctx))).toEqual(new Set([
            'positions', 'permissions', 'systemPermissions', 'isSystem', 'principalKind',
            'userId', 'email', 'posture', 'org_user_ids', 'accessible_org_ids',
            'timezone', 'locale',
            // Not an ExecutionContext field — the REST face still adds this one
            // itself, after assembly (the resolved kernel, ADR-0057 D10). The
            // ADR-0069 gate posture used to sit beside it here; #7280 declared
            // it, so it is an assembled field now and absent for the same reason
            // every other unset field is: this session carries no gate.
            '__kernel',
        ]));
    });

    it('still WITHHOLDS accessToken — the named per-face divergence, not an omission', async () => {
        // `ExecutionContext.accessToken` reaches hooks as `session.accessToken`
        // (`objectql/engine.ts` buildSession, `spec/data/hook.zod.ts`), and the
        // runtime / MCP face has always carried it. This transport never has.
        // #6216 makes that an explicit `accessToken: undefined` input at this
        // face rather than a silent gap — widening a published hook surface to
        // a second transport is a product decision, not a refactor. If REST
        // should carry it, this pin is the thing that must change, deliberately.
        const { ctx } = await request({ cookie: 'member-tok' });

        expect(ctx?.userId).toBe('member1');
        expect(Object.keys(ctx)).not.toContain('accessToken');
        expect(ctx.accessToken).toBeUndefined();
    });
});

describe('#7280 — the ADR-0069 gate posture is an ASSEMBLED field on this face', () => {
    // Before #7280 the gate reached the envelope through
    // `...(authGate ? { authGate } : {})` spread on AFTER assembly, behind an
    // `as any` — outside the closed entry field set (#6216) by construction.
    // It is an assembler input now. These pins are on the WIRE, through the real
    // `computeExecCtx` pipeline: `rest-auth-gate.test.ts` hand-builds a context
    // and so proves only that `enforceAuth` reads the key, never that this face
    // still puts it there.

    it('a gated session reaches enforcement with the gate on the envelope', async () => {
        const ctx = await execCtx({ cookie: 'member-gated' });

        expect(ctx?.userId).toBe('member1');
        expect(Object.keys(ctx)).toContain('authGate');
        expect(ctx.authGate).toEqual({
            code: 'PASSWORD_EXPIRED',
            message: 'Your password has expired.',
        });
    });

    it('an ungated session emits NO authGate key — not a key spelled undefined', async () => {
        const ctx = await execCtx({ cookie: 'member' });

        expect(Object.keys(ctx)).not.toContain('authGate');
        expect('authGate' in ctx).toBe(false);
    });

    it('completes a gate that names a code but no message, so a 403 body is never blank', async () => {
        // The declaration requires `message`; the session user crosses an
        // external boundary as `any` and may carry none. `normalizeAuthGate`
        // fills it at this producer rather than letting `message: undefined`
        // ride into the response body.
        const ctx = await execCtx({ cookie: 'member-gated-bare' });

        expect(ctx.authGate.code).toBe('MFA_REQUIRED');
        expect(typeof ctx.authGate.message).toBe('string');
        expect(ctx.authGate.message.length).toBeGreaterThan(0);
    });

    it('end to end: a gated session is refused on a protected data route with the gate code', async () => {
        // The full chain in one assertion — computeExecCtx resolves the gate,
        // the shared assembler carries it, `enforceAuth` reads it off the
        // envelope and refuses. Nothing pinned this seam end to end before.
        const { out, protocol } = await request({ cookie: 'member-gated' });

        expect(out.getStatus()).toBe(403);
        expect(out.getJson()?.error?.code).toBe('PASSWORD_EXPIRED');
        expect(out.getJson()?.error?.message).toBe('Your password has expired.');
        expect(protocol.findData).not.toHaveBeenCalled();
    });

    it('an ungated session on the same route is unaffected', async () => {
        const { out, protocol } = await request({ cookie: 'member' });

        expect(out.getStatus()).toBe(200);
        expect(protocol.findData).toHaveBeenCalled();
    });
});
