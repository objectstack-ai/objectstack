// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9934] The producer-side user-facing marking, at the REST door — the
// producer half of the objectui#5210 ruling (maintainer, 2026-08-19, option 1).
//
// A hook refusal that declares `userMessage` on the thrown error carries that
// EXACT text to the wire body's `userMessage` channel; the same throw without
// the marking carries NO user-facing marking at all. Both halves are pinned:
// the second half is what preserves #3821 by construction — the console's
// generic 403 substitution stays the answer for everything unmarked, so
// platform diagnostics can never reach an end user by default. (The console
// render half — showing a marked message instead of the generic string — is
// objectui#5210's card, not this file's subject.)
//
// The marking is STATUS-AGNOSTIC and BRANCH-AGNOSTIC (`withDeclaredUserMessage`
// in `error-response.ts`): whatever envelope classification chooses, a declared
// `userMessage` rides it, and it never moves the status or the `code`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { mapDataError, RestServer } from './rest-server.js';
import { handleRouteError } from './error-response.js';

const USER_TEXT = '该记录已进入月末结账期，暂不能修改；请联系财务主管解锁。';

/** The authoring shape the ruling targets: a hook guard's deliberate 403. */
function markedRefusal(status = 403, extra: Record<string, unknown> = {}) {
    return Object.assign(new Error(`close-period guard refused the write`), {
        statusCode: status,
        userMessage: USER_TEXT,
        ...extra,
    });
}

function unmarkedRefusal(status = 403) {
    return Object.assign(new Error(`close-period guard refused the write`), {
        statusCode: status,
    });
}

// ---------------------------------------------------------------------------
// §1 The executable criterion, on the classification door
// ---------------------------------------------------------------------------

describe('[#9934] mapDataError: the marking carries the exact text; unmarked carries nothing', () => {
    it('WITH the marking: the exact text reaches the wire body', () => {
        const r = mapDataError(markedRefusal(), 'showcase_task');

        expect(r.status).toBe(403);
        expect(r.body.userMessage).toBe(USER_TEXT);
        // The diagnostic channel is untouched — the marking never replaces it.
        expect(r.body.error).toBe('close-period guard refused the write');
    });

    it('WITHOUT the marking: no user-facing marking on the body at all', () => {
        const r = mapDataError(unmarkedRefusal(), 'showcase_task');

        expect(r.status).toBe(403);
        // The load-bearing negative: absence is what lets the console keep the
        // #3821 generic substitution for everything unmarked.
        expect('userMessage' in r.body).toBe(false);
    });

    it('the marking moves NOTHING else — marked and unmarked bodies differ by exactly one key', () => {
        const marked = mapDataError(markedRefusal(), 'showcase_task');
        const unmarked = mapDataError(unmarkedRefusal(), 'showcase_task');

        expect(marked.status).toBe(unmarked.status);
        const { userMessage, ...rest } = marked.body;
        expect(userMessage).toBe(USER_TEXT);
        expect(rest).toEqual(unmarked.body);
    });

    it('status-agnostic: not a 403 special case', () => {
        for (const status of [400, 403, 404, 409, 423, 451]) {
            const r = mapDataError(markedRefusal(status), 'showcase_task');
            expect(r.status).toBe(status);
            expect(r.body.userMessage).toBe(USER_TEXT);
        }
    });

    it('rides the structured-code branches too — a hook throwing the catalog PERMISSION_DENIED', () => {
        // The PERMISSION_DENIED branch sits ABOVE the declared-status
        // passthrough; a producer that reaches it with a marking keeps it.
        const err = Object.assign(new Error('denied by guard'), {
            code: 'PERMISSION_DENIED',
            userMessage: USER_TEXT,
        });
        const r = mapDataError(err, 'showcase_task');
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('PERMISSION_DENIED');
        expect(r.body.userMessage).toBe(USER_TEXT);
    });

    it('rides the sandbox unwrap — a body hook refusal keeps its marking at 400', () => {
        // The shape `quickjs-runner` produces for a body's deliberate throw:
        // `innerMessage` set (business message), plus the #9934 side-channel.
        const err = Object.assign(new Error("hook 'close_guard' threw: Error: 删除被阻断"), {
            innerMessage: '删除被阻断',
            userMessage: USER_TEXT,
        });
        const r = mapDataError(err, 'showcase_task');
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('删除被阻断');
        expect(r.body.userMessage).toBe(USER_TEXT);
    });

    it('a declared 5xx: the prose is still withheld, the marked channel still arrives', () => {
        // #5437's withhold is about text the producer never addressed to the
        // caller; the marked channel is authored FOR the caller and rides.
        const err = Object.assign(new Error('maintenance window: pool drained on 10.0.0.5'), {
            statusCode: 503,
            code: 'SERVICE_UNAVAILABLE',
            userMessage: '系统维护中（每日 02:00–02:30），请稍后重试。',
        });
        const r = mapDataError(err, 'showcase_task');
        expect(r.status).toBe(503);
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(r.body)).not.toContain('10.0.0.5');
        expect(r.body.userMessage).toBe('系统维护中（每日 02:00–02:30），请稍后重试。');
    });

    it('a genuine crash is byte-identical to before — no marking, no change', () => {
        const err = Object.assign(new Error("hook 'buggy' threw: TypeError: not a function"), {
            innerMessage: 'TypeError: not a function',
        });
        const r = mapDataError(err, 'showcase_task');
        expect(r).toEqual({
            status: 500,
            body: { error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' },
        });
    });

    it('a marked throw the crash heuristic misjudges still gets its marked text out', () => {
        // The accepted cost recorded on `isScriptFaultMessage` — a business rule
        // authored as `throw new RangeError(…)` — is softened by the marking:
        // the envelope stays the sanitised 500, but the author's opted-in text
        // is not lost. The status and code do NOT move.
        const err = Object.assign(new Error("hook 'range_rule' threw: RangeError: 数量超出范围"), {
            innerMessage: 'RangeError: 数量超出范围',
            userMessage: '数量超出可售余额，请调小数量后重试。',
        });
        const r = mapDataError(err, 'showcase_task');
        expect(r.status).toBe(500);
        expect(r.body.code).toBe('INTERNAL_ERROR');
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(r.body.userMessage).toBe('数量超出可售余额，请调小数量后重试。');
    });

    it('what is NOT a declaration: blank, non-string, whitespace — nothing is invented', () => {
        for (const bad of ['', '   ', 42, true, {}, [], null, undefined]) {
            const err = Object.assign(new Error('refused'), {
                statusCode: 403,
                userMessage: bad,
            });
            const r = mapDataError(err, 'showcase_task');
            expect('userMessage' in r.body, `userMessage=${JSON.stringify(bad)}`).toBe(false);
        }
    });

    it('over-long marked text is TRUNCATED, never replaced — the #5423 rule, same bound', () => {
        const long = 'A'.repeat(600);
        const r = mapDataError(markedRefusal(403, { userMessage: long }), 'showcase_task');
        const um = r.body.userMessage as string;
        expect(um.length).toBe(500);
        expect(um.endsWith('…')).toBe(true);
        expect(um.startsWith('AAAA')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// §2 The OTHER rest door — `resolveErrorResponse`'s status passthrough
// (metadata/UI/discovery routes exit there, bypassing `mapDataError`)
// ---------------------------------------------------------------------------

describe('[#9934] the handleRouteError passthrough carries the marking too', () => {
    function makeRes() {
        const res: any = { statusCode: 200, body: undefined };
        res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
        res.json = vi.fn((b: any) => { res.body = b; return res; });
        return res;
    }

    it('a `.status`-spelled 4xx refusal keeps its marking', () => {
        const res = makeRes();
        handleRouteError(res, Object.assign(new Error('refused'), { status: 403, userMessage: USER_TEXT }));
        expect(res.statusCode).toBe(403);
        expect(res.body.userMessage).toBe(USER_TEXT);
    });

    it('a `.status`-spelled 4xx without the marking carries none', () => {
        const res = makeRes();
        handleRouteError(res, Object.assign(new Error('refused'), { status: 403 }));
        expect(res.statusCode).toBe(403);
        expect('userMessage' in res.body).toBe(false);
    });

    it('a `.status`-spelled 5xx: prose withheld, marking carried', () => {
        const res = makeRes();
        handleRouteError(res, Object.assign(new Error('internal detail'), {
            status: 503, code: 'SERVICE_UNAVAILABLE', userMessage: USER_TEXT,
        }));
        expect(res.statusCode).toBe(503);
        expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(res.body.userMessage).toBe(USER_TEXT);
    });
});

// ---------------------------------------------------------------------------
// §3 The wire, on the real CRUD data route — the report's request shape
// ---------------------------------------------------------------------------

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeWireRes() {
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

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

describe('[#9934] PATCH /api/v1/data — a beforeUpdate guard refusal on the wire', () => {
    async function patchTask(rest: any) {
        const res = makeWireRes();
        const route = rest.getRoutes().find((r: any) => r.method === 'PATCH' && r.path === '/api/v1/data/:object/:id');
        if (!route) throw new Error('PATCH data route not registered');
        await route.handler(
            { method: 'PATCH', params: { object: 'showcase_task', id: 'rec1' }, query: {}, headers: {}, body: { name: 'edited' } },
            res,
        );
        return res;
    }

    it('marked: 403 with the exact author text in `userMessage`', async () => {
        const rest = setup({ updateData: vi.fn().mockRejectedValue(markedRefusal()) });
        const res = await patchTask(rest);
        expect(res.statusCode).toBe(403);
        expect(res.body.userMessage).toBe(USER_TEXT);
    }, 60_000);

    it('unmarked: 403 with no user-facing marking — #3821 preserved by construction', async () => {
        const rest = setup({ updateData: vi.fn().mockRejectedValue(unmarkedRefusal()) });
        const res = await patchTask(rest);
        expect(res.statusCode).toBe(403);
        expect('userMessage' in res.body).toBe(false);
    }, 60_000);
});
