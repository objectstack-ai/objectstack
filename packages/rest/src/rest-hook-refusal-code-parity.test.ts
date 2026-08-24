// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#10345] A sandboxed hook refusal keeps its ADR-0112 `code` on the
// `/api/v1/data` write path — at 409 and 403 exactly as at 400.
//
// ---------------------------------------------------------------------------
// The branch, named — the card deliberately made no claim about it
// ---------------------------------------------------------------------------
// The owner is `classifyDataError`'s SANDBOX UNWRAP door in
// `error-response.ts` (`typeof error?.innerMessage === 'string'`), not
// `toRowApiError` (no such function exists in this package) and not a
// per-status policy anywhere. The door rendered from the RAW error — the
// unwrapped `innerMessage` — and emitted no `code` at all, while every arm
// around it renders from the RESOLVED envelope. That is the split behind the
// card's `innerMessage` correlation: the two always moved together because
// they are the same branch, not because one causes the other.
//
// Why the card's reading looked status-shaped, and why it is not:
//
//   `DELETE_RESTRICTED` / `VALIDATION_FAILED`  have a BESPOKE arm above the
//       unwrap, so they never reach it → `code` present, and the message is
//       the sandbox WRAPPER those arms read off `error.message`.
//   `RECORD_LOCKED` / `DUPLICATE_VALUE` / `FORBIDDEN`  have none → they fall
//       into the unwrap → `code` dropped, message unwrapped.
//
// Measured on this branch before the fix, and pinned in §2 below: the unwrap
// dropped `code` on a declared **400** too, and KEPT it on a declared 5xx (by
// falling through to the passthrough). One sandboxed producer, its code
// surviving 503 and lost at 409 — a branch accident, not a narrowing of the
// response shape on non-400.
//
// The sibling that settles the intent question: the custom-action door
// (`runtime/src/domains/actions.ts`) performs the SAME unwrap on the SAME
// `SandboxError` and then exits through `errorFromThrown`, so it has always
// answered with the business message AND the code. Unwrapping and carrying the
// code were never alternatives.
//
// ---------------------------------------------------------------------------
// Assertions are `code` + `status` pairs on the BODY, never `toThrow`
// ---------------------------------------------------------------------------
// These doors return / send a body; a `toThrow`-shaped assertion could not
// separate "answered without the code" from "did not answer", and the missing
// code IS the defect (ADR-0112).
//
// ---------------------------------------------------------------------------
// Anti-vacuity — directions predicted BEFORE running, measured after
// ---------------------------------------------------------------------------
// Baseline leg: this file run with ONLY `error-response.ts` reverted to
// `origin/main` (the fix committed first; revert via `git checkout origin/main
// -- <path>`, restore via `git checkout <branch> -- <path>`, both under a
// `trap`). No rebuild is needed between legs and none was done: every symbol
// under test is reached by a RELATIVE import inside this package, which vitest
// transforms from source — the only `exports`-resolved workspace deps here
// (`@objectstack/spec/api`, `@objectstack/types`) are untouched by the
// mutation.
//
//   §1 predicted RED 3 / GREEN 2   measured 3 red — as predicted.
//   §2 predicted RED 3 / GREEN 1   measured 3 red — as predicted.
//   §3 predicted GREEN throughout  measured 1 RED. The prediction was WRONG,
//      recorded rather than rewritten: "an undeclared-status refusal WITH a
//      code still answers 400" asserts the status AND the code, and pre-fix
//      only its status half held. Its neighbours in the section really are
//      direction-insensitive; this one was mis-shelved, and the red is the
//      correct answer for it.
//   §4 predicted RED 1 / GREEN 2   measured 2 red — the "registered spelling
//      arrives verbatim" case reddens too, because pre-fix no code arrives at
//      all. Predicted as a control; it is not one.
//   §5 predicted RED 6 / GREEN 5   measured 6 red — as predicted.
//
// Total 15 of 27 red here (prediction: 13), plus 3 of the 4 cases the fifth
// `ARMS` entry adds to `rest-thrown-code-vocabulary.test.ts` (prediction: 2 —
// §1 contributes two assertions per arm, not one). 18 red across both files.
// The predictions above are left as written, per this repo's rule that a wrong
// prediction is reported rather than fitted to the measurement.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
// `.js` extension deliberately: this package resolves `nodenext`, so an
// extensionless relative import is a `tsc` error (TS2835).
import { mapDataError, RestServer } from './rest-server.js';

const DATA_COLLECTION = '/api/v1/data/:object';
const DATA_ITEM = '/api/v1/data/:object/:id';

// ---------------------------------------------------------------------------
// Fixtures — the shape `runtime/src/sandbox/quickjs-runner.ts` produces:
// `.message` is the `<kind> '<name>' threw: <msg>` debug wrapper, `.innerMessage`
// the business text, `.status` the #7867 side-channel. Reproduced here so
// `@objectstack/rest` does not depend on `@objectstack/runtime` to run its own
// tests.
// ---------------------------------------------------------------------------

/** The card's own repro: `Object.assign(new Error(msg), { code, status })` from a hook body. */
function sandboxRefusal(
    businessMessage: string,
    extra: Record<string, unknown> = {},
    hook = 'account_protection',
) {
    const err: any = new Error(`hook '${hook}' threw: Error: ${businessMessage}`);
    err.name = 'SandboxError';
    err.innerMessage = businessMessage;
    return Object.assign(err, extra);
}

/**
 * The SAME refusal thrown outside the sandbox — same `code`, same `status`, no
 * `innerMessage`. The control that isolates the branch: one property is the
 * whole difference between the two answers.
 */
function plainRefusal(businessMessage: string, extra: Record<string, unknown> = {}) {
    return Object.assign(new Error(businessMessage), extra);
}

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
        getMetaItems: vi.fn().mockResolvedValue([{ name: 'crm_account' }]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        createData: vi.fn().mockResolvedValue({}),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({}),
        batchData: vi.fn().mockResolvedValue({}),
        createManyData: vi.fn().mockResolvedValue({}),
        updateManyData: vi.fn().mockResolvedValue({}),
        deleteManyData: vi.fn().mockResolvedValue({}),
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

function routeOf(rest: any, method: string, path: string) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    return route;
}

async function call(rest: any, method: string, path: string, req: Record<string, unknown>) {
    const res = makeRes();
    await routeOf(rest, method, path).handler({ method, query: {}, headers: {}, ...req }, res);
    return res;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

// ---------------------------------------------------------------------------
// §1 The card's six measured rows, walked on the real routes in process
//
// The card measured these against a booted 17.1.0 server with real SQLite; this
// section reproduces the same six answers at the REST boundary so the contract
// is pinned where it is decided.
// ---------------------------------------------------------------------------

describe('[#10345] the reported rows: a 409 refusal reaches the client WITH its code', () => {
    it('PATCH a locked record → 409 RECORD_LOCKED, business message, not the wrapper', async () => {
        const rest = setup({
            updateData: vi.fn().mockRejectedValue(sandboxRefusal(
                'Opportunity is closed (closed_won); only description, next_step, notes may be edited.',
                { code: 'RECORD_LOCKED', status: 409 },
            )),
        });

        const res = await call(rest, 'PATCH', DATA_ITEM, {
            params: { object: 'crm_opportunity', id: 'rec1' }, body: { amount: 10 },
        });

        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('RECORD_LOCKED');
        // The unwrap is NOT what the fix trades away — asserted together with
        // the code so "delete the unwrap door" cannot pass this file either.
        expect(res.body.error).toBe(
            'Opportunity is closed (closed_won); only description, next_step, notes may be edited.',
        );
        expect(JSON.stringify(res.body)).not.toMatch(/threw:|hook '/);
        expect(res.body.object).toBe('crm_opportunity');
    }, 60_000);

    it('POST a duplicate contact → 409 DUPLICATE_VALUE', async () => {
        const rest = setup({
            createData: vi.fn().mockRejectedValue(sandboxRefusal(
                'Another contact (Ada Lovelace) with email ada@example.com already exists.',
                { code: 'DUPLICATE_VALUE', status: 409 },
            )),
        });

        const res = await call(rest, 'POST', DATA_COLLECTION, {
            params: { object: 'crm_contact' }, body: { email: 'ada@example.com' },
        });

        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('DUPLICATE_VALUE');
        expect(res.body.error).toContain('already exists');
    }, 60_000);

    it('POST refused by a Do-Not-Call guard → 403 FORBIDDEN', async () => {
        // The card took ONE 403 sample and said so. This pins the answer rather
        // than inheriting the card's inference from a single reading.
        const rest = setup({
            createData: vi.fn().mockRejectedValue(sandboxRefusal(
                'Do Not Call is set on this contact.',
                { code: 'FORBIDDEN', status: 403 },
            )),
        });

        const res = await call(rest, 'POST', DATA_COLLECTION, {
            params: { object: 'crm_task' }, body: { type: 'call' },
        });

        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
    }, 60_000);

    it('CONTROL — the 400 row keeps its `code` AND its `fields` (bespoke arm, untouched)', async () => {
        // GREEN before and after. The row the card measured as working; if the
        // fix had moved the bespoke arms this reddens.
        const err = sandboxRefusal('Website must start with http:// or https://', {
            code: 'VALIDATION_FAILED', status: 400, fields: [],
        });
        const rest = setup({ createData: vi.fn().mockRejectedValue(err) });

        const res = await call(rest, 'POST', DATA_COLLECTION, {
            params: { object: 'crm_account' }, body: { website: 'ftp://x' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(res.body.fields).toEqual([]);
    }, 60_000);

    it('LIVE CONTROL — DELETE 409 already carried its code, and still does', async () => {
        // The row that proves the defect was a BRANCH and not a policy about
        // conflicts: same status class, same producer, different arm. It must
        // stay green through any repair of the sibling rows.
        const rest = setup({
            deleteData: vi.fn().mockRejectedValue(sandboxRefusal(
                'Cannot delete customer account: 1 open opportunity still references it.',
                { code: 'DELETE_RESTRICTED', status: 409 },
            )),
        });

        const res = await call(rest, 'DELETE', DATA_ITEM, {
            params: { object: 'crm_account', id: 'rec1' },
        });

        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('DELETE_RESTRICTED');
    }, 60_000);
});

// ---------------------------------------------------------------------------
// §2 The branch, isolated — one property is the entire difference
// ---------------------------------------------------------------------------

describe('[#10345] the sandbox unwrap is the branch, and it was never status-shaped', () => {
    it('sandbox vs plain: the same code+status answered differently before the fix', () => {
        const sandboxed = mapDataError(
            sandboxRefusal('this record is frozen', { code: 'RECORD_LOCKED', status: 409 }),
            'crm_opportunity',
        );
        const plain = mapDataError(
            plainRefusal('this record is frozen', { code: 'RECORD_LOCKED', status: 409 }),
            'crm_opportunity',
        );

        // CONTROL: the plain twin always carried its code (it exits at the
        // declared-status passthrough, one branch below the unwrap).
        expect(plain.body.code).toBe('RECORD_LOCKED');
        // The defect, pinned as the DIFFERENCE rather than as one reading.
        expect(sandboxed.body.code).toBe('RECORD_LOCKED');
        expect(sandboxed.status).toBe(plain.status);
    });

    it('a declared 400 through the unwrap carries its code too — the demotion was never about 409', () => {
        // Kills the "the write path narrows its response shape on non-400"
        // reading directly: pre-fix this answered `{ error, object }` with no
        // code, at 400, on the same door.
        const r = mapDataError(
            sandboxRefusal('amount must be positive', { code: 'VALUE_OUT_OF_RANGE', status: 400 }),
            'crm_opportunity',
        );
        expect(r.status).toBe(400);
        expect(typeof r.body.code).toBe('string');
    });

    it('CONTROL — the same producer at 5xx always kept its code, by falling through', () => {
        // The internal contradiction the fix removes: one sandboxed producer,
        // its code surviving 503 and lost at 409. Green before and after.
        const r = mapDataError(
            sandboxRefusal('upstream ledger unavailable', { code: 'SERVICE_UNAVAILABLE', status: 503 }),
            'crm_account',
        );
        expect(r.status).toBe(503);
        expect(r.body.code).toBe('SERVICE_UNAVAILABLE');
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('the whole 4xx band answers with the code, off either declaration spelling', () => {
        for (const status of [401, 403, 404, 409, 423, 451]) {
            for (const spelling of ['status', 'statusCode'] as const) {
                const r = mapDataError(
                    sandboxRefusal('refused', { code: 'RECORD_LOCKED', [spelling]: status }),
                    'crm_account',
                );
                expect(r.status, `${spelling}=${status}`).toBe(status);
                expect(r.body.code, `${spelling}=${status}`).toBe('RECORD_LOCKED');
            }
        }
    });
});

// ---------------------------------------------------------------------------
// §3 What must NOT move — GREEN by construction, before and after
// ---------------------------------------------------------------------------

describe('[#10345] the pinned defaults the fix must not disturb', () => {
    it('a refusal that declares NO code still carries none — nothing is invented', () => {
        // ADR-0112: the PRODUCER names the condition. Narrowing or widening the
        // vocabulary must never start ADDING codes to bodies that carried none.
        const r = mapDataError(sandboxRefusal('month-end close is in progress'), 'crm_account');
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('month-end close is in progress');
        expect(r.body).not.toHaveProperty('code');
        expect(r.body).not.toHaveProperty('declaredCode');
    });

    it('an undeclared-status refusal WITH a code still answers 400 — the default did not move', () => {
        const r = mapDataError(
            sandboxRefusal('this record is frozen', { code: 'RECORD_LOCKED' }),
            'crm_account',
        );
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('RECORD_LOCKED');
    });

    it('a body CRASH is still the sanitised 500, even carrying a code and a status', () => {
        // Crash classification outranks everything about the error, including a
        // declared refusal shape. A `TypeError` must never be re-labelled as a
        // caller-addressed refusal just because the fix reads more of the error.
        const err = sandboxRefusal('x', { code: 'RECORD_LOCKED', status: 409 });
        err.innerMessage = 'TypeError: not a function';
        const r = mapDataError(err, 'crm_account');

        expect(r.status).toBe(500);
        expect(r.body.code).toBe('INTERNAL_ERROR');
        expect(String(r.body.error)).not.toContain('TypeError');
    });

    it('the 5xx prose is still withheld and the 4xx prose still reaches the caller', () => {
        expect(
            mapDataError(sandboxRefusal('connect ECONNREFUSED 10.0.0.5:5432', {
                code: 'SERVICE_UNAVAILABLE', status: 503,
            })).body.error,
        ).toBe(INTERNAL_ERROR_MESSAGE);
        expect(
            mapDataError(sandboxRefusal('this record is frozen', {
                code: 'RECORD_LOCKED', status: 409,
            })).body.error,
        ).toBe('this record is frozen');
    });
});

// ---------------------------------------------------------------------------
// §4 The vocabulary at this door — it stops being the one flat exit #9232 could
// not reach, so it answers the closed vocabulary like its three siblings.
// ---------------------------------------------------------------------------

describe('[#10345 / #9232] the unwrap door speaks the closed ADR-0112 vocabulary', () => {
    it('an unregistered spelling is DEMOTED, not shipped verbatim', () => {
        const r = mapDataError(
            sandboxRefusal('the package is haunted', { code: 'PACKAGE_IS_HAUNTED', status: 409 }),
            'crm_account',
        );
        expect(r.status).toBe(409);
        // The status-derived member arrives in `code`, the producer's string in
        // `declaredCode` — the same answer the sibling arms give.
        expect(r.body.code).toBe('RESOURCE_CONFLICT');
        expect(r.body.declaredCode).toBe('PACKAGE_IS_HAUNTED');
    });

    it('a REGISTERED spelling arrives verbatim with no `declaredCode` beside it', () => {
        const r = mapDataError(
            sandboxRefusal('this record is frozen', { code: 'RECORD_LOCKED', status: 409 }),
            'crm_account',
        );
        expect(r.body.code).toBe('RECORD_LOCKED');
        expect(r.body.declaredCode).toBeUndefined();
    });

    it('CONTROL — a numeric errno and an empty string are not declarations', () => {
        for (const code of [1062, '']) {
            const r = mapDataError(sandboxRefusal('refused', { code, status: 409 }), 'crm_account');
            expect(r.body.code, String(code)).toBeUndefined();
            expect(r.body.declaredCode, String(code)).toBeUndefined();
        }
    });
});

// ---------------------------------------------------------------------------
// §5 The routes the card never exercised — MEASURED, not assumed
//
// Batch / bulk / clone exit through `handleRouteError` → `resolveErrorResponse`,
// whose passthrough is a `status`-ONLY read sitting ABOVE `mapDataError`. So
// they share the unwrap door only through the `statusCode` spelling — and that
// half lost its code exactly as the single-row routes did.
// ---------------------------------------------------------------------------

const BULK_ROUTES: Array<{
    name: string; path: string; method: string; protocolKey: string;
    req: Record<string, unknown>;
}> = [
    {
        name: 'batch', method: 'POST', path: `${DATA_COLLECTION}/batch`, protocolKey: 'batchData',
        req: { params: { object: 'crm_opportunity' }, body: { operation: 'update', records: [{ id: 'r1', name: 'x' }] } },
    },
    {
        name: 'createMany', method: 'POST', path: `${DATA_COLLECTION}/createMany`, protocolKey: 'createManyData',
        req: { params: { object: 'crm_contact' }, body: [{ email: 'a@b.com' }] },
    },
    {
        name: 'updateMany', method: 'POST', path: `${DATA_COLLECTION}/updateMany`, protocolKey: 'updateManyData',
        req: { params: { object: 'crm_opportunity' }, body: { records: [{ id: 'r1', data: { name: 'x' } }] } },
    },
    {
        name: 'deleteMany', method: 'POST', path: `${DATA_COLLECTION}/deleteMany`, protocolKey: 'deleteManyData',
        req: { params: { object: 'crm_account' }, body: { ids: ['r1'] } },
    },
    {
        name: 'clone', method: 'POST', path: `${DATA_ITEM}/clone`, protocolKey: 'cloneData',
        req: { params: { object: 'crm_account', id: 'r1' }, body: {} },
    },
];

describe('[#10345] batch / bulk / clone share the door through the `statusCode` spelling', () => {
    for (const route of BULK_ROUTES) {
        it(`${route.name}: a \`statusCode\`-declared 409 keeps its code`, async () => {
            const rest = setup({
                [route.protocolKey]: vi.fn().mockRejectedValue(
                    sandboxRefusal('this record is frozen', { code: 'RECORD_LOCKED', statusCode: 409 }),
                ),
            });

            const res = await call(rest, route.method, route.path, route.req);

            expect(res.statusCode).toBe(409);
            expect(res.body.code).toBe('RECORD_LOCKED');
        }, 60_000);

        it(`CONTROL ${route.name}: a \`status\`-declared 409 already kept it (exits one door earlier)`, async () => {
            const rest = setup({
                [route.protocolKey]: vi.fn().mockRejectedValue(
                    sandboxRefusal('this record is frozen', { code: 'RECORD_LOCKED', status: 409 }),
                ),
            });

            const res = await call(rest, route.method, route.path, route.req);

            expect(res.statusCode).toBe(409);
            expect(res.body.code).toBe('RECORD_LOCKED');
        }, 60_000);
    }
});

describe('[#10345] the read-shaped data route on the same door', () => {
    it('POST /data/:object/query — a refused query keeps its code too', async () => {
        // `POST …/query` calls `mapDataError` directly like the single-row
        // writes, so it shared the defect and shares the repair. Recorded
        // because "write path" named the routes the card exercised, not the
        // set the branch covers.
        const rest = setup({
            findData: vi.fn().mockRejectedValue(
                sandboxRefusal('this object is not readable outside business hours', {
                    code: 'FORBIDDEN', status: 403,
                }),
            ),
        });

        const res = await call(rest, 'POST', `${DATA_COLLECTION}/query`, {
            params: { object: 'crm_account' }, body: { object: 'crm_account' },
        });

        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
    }, 60_000);
});
