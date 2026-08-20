// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9967] A sandboxed hook body that DECLARES its own HTTP status is served
// with it on `/api/v1/data` — the sandbox unwrap no longer outranks the
// declared-status read.
//
// ---------------------------------------------------------------------------
// The asymmetry this file closes: since #7867 the QuickJS side-channel carries
// a body-thrown error's declared `status` out of the VM onto
// `SandboxError.status`, and `domains/actions.ts` honours it ("an error that
// NAMES its own HTTP status is asking to be served with it"). On the CRUD data
// routes the sandbox-unwrap branch of `mapDataError` sat ABOVE the
// `declaredHttpStatus` passthrough and answered `{ status: 400 }`
// unconditionally, so a hook body's deliberate
//
//   var e = new Error('close-period lock'); e.status = 403; throw e;
//
// crossed the VM fine and was then answered 400 — a permission refusal
// presented as a client-input error, the #7525/#8016 door-disagreement shape
// one branch earlier.
//
// What is deliberately UNCHANGED, pinned in §3 here and (independently) by
// `hook-error-format.dogfood.test.ts` and
// `rest-hook-refusal-status-passthrough.test.ts` §3:
//   - a body throw that declares NO status keeps the verbatim-message 400;
//   - a body that CRASHES (`isScriptFaultMessage`) stays the sanitised 500 —
//     even when the crash object carries a stray `status`;
//   - the envelope still carries NO `code` field (old @objectstack/client
//     builds prepend `code` to the human-readable message).
//
// Reverse verification (measured against this branch with ONLY
// `error-response.ts` reverted to the pre-fix `origin/main` copy — the fix
// committed first, the revert via `git checkout origin/main -- <path>`, the
// restore via `git checkout <branch> -- <path>`): predicted §1 + §2 + §4 red,
// §3 green by construction. The measured result is recorded in the PR body
// rather than here so a wrong prediction cannot be rewritten to fit.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { mapDataError, RestServer } from './rest-server.js';

const DATA_ITEM = '/api/v1/data/:object/:id';

// ---------------------------------------------------------------------------
// Fixtures — the shape `quickjs-runner.ts` actually produces: `.message` is
// the `<kind> '<name>' threw: <msg>` debug wrapper, `.innerMessage` the
// business text, `.status` the #7867 side-channel value. Reproduced here so
// `@objectstack/rest` does not depend on `@objectstack/runtime` to run its
// own tests.
// ---------------------------------------------------------------------------

/** The issue's own repro: a body refusal that NAMES its status. */
function sandboxRefusal(overrides: Record<string, unknown> = {}) {
    const err: any = new Error("hook 'close_period_guard' threw: Error: close-period lock");
    err.name = 'SandboxError';
    err.innerMessage = 'close-period lock';
    return Object.assign(err, overrides);
}

// ---------------------------------------------------------------------------
// §1 The mapping itself — declared 4xx
// ---------------------------------------------------------------------------

describe('[#9967] mapDataError: a sandboxed body that declares a 4xx status keeps it', () => {
    it('the reported shape: `e.status = 403` answers 403, not 400', () => {
        const r = mapDataError(sandboxRefusal({ status: 403 }), 'showcase_task');

        expect(r.status).toBe(403);
        // The measured defect, pinned as a NEGATIVE so a partial fix cannot pass.
        expect(r.status).not.toBe(400);
        // "Keeping the unwrapped `innerMessage` as the body text": the business
        // message verbatim, never the debug wrapper.
        expect(r.body.error).toBe('close-period lock');
        expect(JSON.stringify(r.body)).not.toMatch(/threw:|hook '/);
        expect(r.body.object).toBe('showcase_task');
    });

    it('the body is byte-identical to the undeclared 400 envelope — only the status moves', () => {
        // The unwrap branch's own contract (deliberately NO `code`, `object`
        // rides) is unchanged by the fix; compared output-to-output so a field
        // later added to BOTH envelopes (e.g. #9934's marking) keeps this green.
        const declared = mapDataError(sandboxRefusal({ status: 403 }), 'showcase_task');
        const undeclared = mapDataError(sandboxRefusal(), 'showcase_task');

        expect(declared.body).toEqual(undeclared.body);
        expect(declared.body.code).toBeUndefined();
    });

    it('the whole client band is served, off either spelling — same read as every other exit', () => {
        for (const status of [401, 403, 404, 409, 423, 451]) {
            expect(mapDataError(sandboxRefusal({ status }), 'showcase_task').status).toBe(status);
            expect(mapDataError(sandboxRefusal({ statusCode: status }), 'showcase_task').status).toBe(status);
        }
    });

    it('a numeric `status` wins over `statusCode` — precedence matches the passthrough', () => {
        const r = mapDataError(sandboxRefusal({ status: 409, statusCode: 403 }), 'showcase_task');
        expect(r.status).toBe(409);
    });

    it('an out-of-band status is not a declaration — the 400 default holds', () => {
        for (const status of [0, 200, 302, 399, 600, 999]) {
            const r = mapDataError(sandboxRefusal({ status }), 'showcase_task');
            expect(r.status).toBe(400);
            expect(r.body.error).toBe('close-period lock');
        }
    });
});

// ---------------------------------------------------------------------------
// §2 Declared SERVER band — status kept, prose withheld (#5582's rule applies
// to this producer exactly as to every other)
// ---------------------------------------------------------------------------

describe('[#9967] a sandboxed body that declares a 5xx takes the sanitised 5xx arm', () => {
    it('`e.status = 503` keeps the 503 and withholds the words', () => {
        const r = mapDataError(sandboxRefusal({ status: 503 }), 'showcase_task');

        expect(r.status).toBe(503);
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(r.body)).not.toContain('close-period lock');
        // No code was declared; none is invented (ADR-0112: the producer names
        // the condition).
        expect(r.body.code).toBeUndefined();
    });

    it('a declared 5xx WITH a registered code ships both — same answer the passthrough gives', () => {
        const r = mapDataError(
            sandboxRefusal({ status: 503, code: 'SERVICE_UNAVAILABLE' }),
            'showcase_task',
        );
        expect(r.status).toBe(503);
        expect(r.body.code).toBe('SERVICE_UNAVAILABLE');
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    });
});

// ---------------------------------------------------------------------------
// §3 What deliberately did NOT move — green by construction under the fix's
// reverse verification
// ---------------------------------------------------------------------------

describe('[#9967] the pinned defaults are untouched', () => {
    it('an UNDECLARED body throw keeps the verbatim-message 400 with no code', () => {
        const r = mapDataError(sandboxRefusal(), 'showcase_task');

        expect(r.status).toBe(400);
        expect(r.body.error).toBe('close-period lock');
        expect(r.body.code).toBeUndefined();
    });

    it('a body CRASH stays the sanitised 500 even when it carries a stray `status`', () => {
        // Crash classification outranks the declaration: a `TypeError` that
        // happens to have a `status` property is still a script fault, never
        // an author-declared refusal.
        const err = sandboxRefusal({ status: 403 });
        err.innerMessage = 'TypeError: boom';
        const r = mapDataError(err, 'showcase_task');

        expect(r.status).toBe(500);
        expect(r.body.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(r.body)).not.toMatch(/TypeError|boom/);
    });
});

// ---------------------------------------------------------------------------
// §4 The wire — the reported request walked on the real CRUD data route
// (mirrors `rest-hook-refusal-status-passthrough.test.ts` §2's harness)
// ---------------------------------------------------------------------------

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

function setup(protocolOverrides: Record<string, unknown> = {}) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([{ name: 'showcase_task' }]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        createData: vi.fn().mockResolvedValue({}),
        updateData: vi.fn().mockResolvedValue({}),
        ...protocolOverrides,
    };
    const rest = new RestServer(
        createMockServer() as any,
        protocol,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    rest.registerRoutes();
    return rest;
}

async function callPatch(rest: any, object: string, id: string, body: Record<string, unknown>) {
    const route = rest.getRoutes().find((r: any) => r.method === 'PATCH' && r.path === DATA_ITEM);
    if (!route) throw new Error('PATCH data route not registered');
    const res = makeRes();
    await route.handler({ method: 'PATCH', params: { object, id }, query: {}, headers: {}, body }, res);
    return res;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

describe('[#9967] the reported request on the real data route', () => {
    it('PATCH refused by a status-declaring body → 403 with the business message', async () => {
        const rest = setup({ updateData: vi.fn().mockRejectedValue(sandboxRefusal({ status: 403 })) });

        const res = await callPatch(rest, 'showcase_task', 'rec1', { name: 'edited' });

        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('close-period lock');
        expect(res.body.code).toBeUndefined();
    }, 60_000);

    it('the declared refusal is not logged as an unhandled fault — 403 is an expected outcome', async () => {
        const rest = setup({ updateData: vi.fn().mockRejectedValue(sandboxRefusal({ status: 403 })) });

        await callPatch(rest, 'showcase_task', 'rec1', { name: 'edited' });

        const logged = errorSpy.mock.calls.some(
            (call: unknown[]) => JSON.stringify(call.map(String)).includes('Unhandled error'),
        );
        expect(logged).toBe(false);
    }, 60_000);

    it('an UNDECLARED body refusal on the wire is still the verbatim 400', async () => {
        const rest = setup({ updateData: vi.fn().mockRejectedValue(sandboxRefusal()) });

        const res = await callPatch(rest, 'showcase_task', 'rec1', { name: 'edited' });

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('close-period lock');
    }, 60_000);
});
