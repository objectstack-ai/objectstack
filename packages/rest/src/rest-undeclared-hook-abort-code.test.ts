// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27597] A sandboxed hook that aborts a write with free text and declares no
// refusal code answers the `/data` door with ONE ledgered ADR-0112 code,
// `HOOK_ABORTED`, instead of a 400 that carries no `code` at all.
//
// Measured on `main` @ `178b5238` with this file and the `@objectstack/types`
// dist built from `main`: §1–§4 RED (every undeclared abort answered with
// `code` undefined — the card's `POST /data/OBJ` → `400 {"error":"boom
// abort","object":"OBJ"}`), §5 and §6's constant-free half GREEN. After the
// change, the whole file is GREEN.
//
// The CONTROLS in §5 are the other half of the card: a refusal that DECLARED a
// code keeps that code (a `refusals` catalogue entry, a registered code, an
// unregistered spelling demoted to `declaredCode`), a non-sandbox producer
// that declared no code still gets none — nothing is invented for it — and a
// crash is still the sanitised 500.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { UNDECLARED_HOOK_REFUSAL_CODE } from '@objectstack/types';
import { ErrorCode, REGISTERED_ERROR_CODES, ERROR_CODE_LEDGER } from '@objectstack/spec/api';
import { mapDataError, handleRouteError } from './error-response.js';
import { RestServer } from './rest-server.js';

beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

const DATA_COLLECTION = '/api/v1/data/:object';
const DATA_ITEM = '/api/v1/data/:object/:id';

/** The shape `runtime/src/sandbox/quickjs-runner.ts` throws for a body's own `throw`. */
function sandboxRefusal(businessMessage: string, extra: Record<string, unknown> = {}, hook = 'guard') {
    const err: any = new Error(`hook '${hook}' threw: Error: ${businessMessage}`);
    err.name = 'SandboxError';
    err.innerMessage = businessMessage;
    return Object.assign(err, extra);
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
        getMetaItems: vi.fn().mockResolvedValue([{ name: 'obj' }]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        createData: vi.fn().mockResolvedValue({}),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({}),
        batchData: vi.fn().mockResolvedValue({}),
        ...protocolOverrides,
    };
    const rest = new RestServer(
        { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
          listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) } as any,
        protocol,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    rest.registerRoutes();
    return rest;
}

async function call(rest: any, method: string, path: string, req: Record<string, unknown>) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    const res = makeRes();
    await route.handler({ method, query: {}, headers: {}, ...req }, res);
    return res;
}

/** The answer `resolveErrorResponse` gives, reached through its exported caller. */
function throughRouteDoor(error: any, object?: string): { status: number; body: any } {
    const res = makeRes();
    handleRouteError(res, error, object);
    return { status: res.statusCode, body: res.body };
}

describe('[#27597] §1 an undeclared free-text abort answers HOOK_ABORTED at mapDataError', () => {
    it('400, the hook\'s own sentence, the object, and the code', () => {
        const { status, body } = mapDataError(sandboxRefusal('boom abort'), 'obj');
        expect(status).toBe(400);
        expect(body).toEqual({ error: 'boom abort', code: 'HOOK_ABORTED', object: 'obj' });
    });

    it('the constant is the wire spelling', () => {
        expect(UNDECLARED_HOOK_REFUSAL_CODE).toBe('HOOK_ABORTED');
    });
});

describe('[#27597] §2 the /data routes answer it, whichever exit caught the abort', () => {
    it('POST /data/:object (the card\'s reproduction)', async () => {
        const rest = setup({ createData: vi.fn().mockRejectedValue(sandboxRefusal('boom abort')) });
        const res = await call(rest, 'POST', DATA_COLLECTION, { params: { object: 'obj' }, body: { name: 'throwabort' } });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('HOOK_ABORTED');
        expect(res.body.error).toBe('boom abort');
    }, 60_000);

    it('PATCH /data/:object/:id', async () => {
        const rest = setup({ updateData: vi.fn().mockRejectedValue(sandboxRefusal('Opportunity is closed.')) });
        const res = await call(rest, 'PATCH', DATA_ITEM, { params: { object: 'obj', id: 'r1' }, body: { name: 'x' } });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('HOOK_ABORTED');
    }, 60_000);

    it('POST /data/:object/batch (handleRouteError)', async () => {
        const rest = setup({ batchData: vi.fn().mockRejectedValue(sandboxRefusal('Opportunity is closed.')) });
        const res = await call(rest, 'POST', `${DATA_COLLECTION}/batch`, {
            params: { object: 'obj' }, body: { operation: 'update', records: [{ id: 'r1', name: 'x' }] },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('HOOK_ABORTED');
        expect(res.body.error).toBe('Opportunity is closed.');
    }, 60_000);
});

describe('[#27597] §3 a body that declared a status but no code: the status stays, the code joins', () => {
    it('`status` (the route door\'s passthrough) and `statusCode` (mapDataError) answer alike', () => {
        const viaStatus = throughRouteDoor(sandboxRefusal('Closed.', { status: 422 }), 'obj');
        const viaStatusCode = mapDataError(sandboxRefusal('Closed.', { statusCode: 422 }), 'obj');
        expect(viaStatus).toEqual({ status: 422, body: { error: 'Closed.', code: 'HOOK_ABORTED', object: 'obj' } });
        expect(viaStatusCode).toEqual(viaStatus);
    });
});

describe('[#27597] §4 the wrapper fallback (the SandboxError instance lost) answers the same body', () => {
    it('byte-identical to the innerMessage door', () => {
        const lost = new Error("hook 'guard' threw: Error: boom abort");
        expect(mapDataError(lost, 'obj')).toEqual(mapDataError(sandboxRefusal('boom abort'), 'obj'));
        expect(mapDataError(lost, 'obj').body.code).toBe('HOOK_ABORTED');
    });
});

describe('[#27597] §5 CONTROLS — a declared refusal keeps its declared code; nothing is invented elsewhere', () => {
    it('a `refusals` catalogue entry keeps its declaredCode beside the status-derived code', () => {
        // `resolveHookRefusal`'s answer for a declared `CREDIT_LIMIT` (status 400 by default).
        const declared = sandboxRefusal('Over the credit limit.', {
            code: 'CREDIT_LIMIT', status: 400, userMessage: 'Over the credit limit.',
        });
        for (const answer of [mapDataError(declared, 'obj'), throughRouteDoor(declared, 'obj')]) {
            expect(answer.status).toBe(400);
            expect(answer.body.code).toBe('VALIDATION_ERROR');
            expect(answer.body.declaredCode).toBe('CREDIT_LIMIT');
        }
    });

    it('a registered code a body threw is its own wire code', () => {
        const locked = sandboxRefusal('Record is locked.', { code: 'RECORD_LOCKED', status: 409 });
        expect(mapDataError(locked, 'obj').body.code).toBe('RECORD_LOCKED');
        expect(throughRouteDoor(locked, 'obj').body.code).toBe('RECORD_LOCKED');
    });

    it('a non-sandbox producer that declared a 400 and no code still answers no code', () => {
        const plain = Object.assign(new Error('Closed.'), { status: 400 });
        expect(throughRouteDoor(plain, 'obj').body.code).toBeUndefined();
        expect(mapDataError(plain, 'obj').body.code).toBeUndefined();
    });

    it('a body that CRASHED is still the sanitised 500, not an abort', () => {
        const crash = sandboxRefusal('TypeError: not a function');
        expect(mapDataError(crash, 'obj')).toMatchObject({ status: 500, body: { code: 'INTERNAL_ERROR' } });
    });
});

describe('[#27597] §6 the ledger row is live', () => {
    it('HOOK_ABORTED is registered under the package that stamps it, and parses as a wire code', () => {
        expect(ERROR_CODE_LEDGER['@objectstack/types']).toContain('HOOK_ABORTED');
        expect(REGISTERED_ERROR_CODES).toContain('HOOK_ABORTED');
        expect(ErrorCode.safeParse(UNDECLARED_HOOK_REFUSAL_CODE).success).toBe(true);
    });
});
