// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#11588] A sandboxed hook's refusal reaches the client in the AUTHOR'S words
// on every write route — never wearing the QuickJS debug wrapper.
//
// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------
// `classifyDataError`'s sandbox unwrap door exists precisely to keep the
// `<kind> '<name>' threw: <msg>` wrapper off the wire. Its own words: a hook's
// `throw new Error('删除被阻断…')` is "a deliberate business rule, not a fault",
// "End users must see only the business message", and the wrapper "belongs in
// server logs". `hook-error-format.dogfood.test.ts` pins that end to end — but
// only for a single-row `DELETE`, which is the one route family that reaches
// the door.
//
// Six routes never did. Measured on `main` at `cad8b42f`, and reproduced in §1:
//
//   PATCH /data/:object/:id     Opportunity is closed.                  ← correct
//   POST  /data/:object/batch   hook 'guard' threw: Error: …            ← the defect
//   POST  …/createMany · …/updateMany · …/deleteMany · …/:id/clone      ← the defect
//   POST  /analytics/dataset/query                                      ← NOT fixed here
//
// ---------------------------------------------------------------------------
// The branch, and why the repair is NOT the reorder it looks like
// ---------------------------------------------------------------------------
// Batch / bulk / clone exit through `handleRouteError` → `resolveErrorResponse`,
// whose declared-status passthrough is checked BEFORE it delegates to
// `mapDataError`. The passthrough's 4xx arm answered from `error.message` — the
// wrapper — and the unwrap door below was never reached.
//
// Moving the unwrap above the passthrough is ruled out by the passthrough's own
// argument: `mapDataError` derives a status from the message TEXT, so a declared
// 5xx handed to it comes back re-labelled (`404 OBJECT_NOT_FOUND` for the
// overlay-delete fault) and stops being logged — the #5437/#5582 withhold is
// load-bearing exactly where it sits. So the passthrough stays put and keeps
// deciding the STATUS; only the sentence it reads for the caller changes.
//
// What that restores is an invariant the passthrough docblock ALREADY asserts.
// Its #7525 paragraph says an error declaring `statusCode` instead "falls to
// `mapDataError` below … So the two doors already agree on the wire answer."
// For a sandbox refusal that sentence was false — `statusCode` was unwrapped,
// `status` was not — which is the two-spellings asymmetry the card named. §4
// pins the agreement door-to-door rather than restating it in a comment.
//
// ---------------------------------------------------------------------------
// Anti-vacuity — directions predicted BEFORE running, measured after
// ---------------------------------------------------------------------------
// Baseline leg: this file run with ONLY `error-response.ts` reverted to
// `origin/main` (the fix committed first; revert `git checkout origin/main --
// <path>`, restore `git checkout HEAD -- <path>`, both under `trap … EXIT INT
// TERM`, the mutation proven on disk by grepping both the injected and the
// removed text, and the restore re-verified by re-reading the file).
//
// No rebuild between legs, and the reason is load-bearing rather than an
// omission: every symbol under test is reached by a RELATIVE import inside this
// package, which vitest transforms from source — no `dist/` sits between the
// mutation and the assertion. The `exports`-resolved workspace deps here
// (`@objectstack/types`) are untouched by the mutation.
//
//   §1 predicted RED 5 / GREEN 1   measured 5 red — as predicted.
//   §2 predicted RED 5             measured 5 red — as predicted.
//   §3 predicted GREEN             measured green — as predicted.
//   §4 predicted RED 1             measured 1 red — as predicted.
//   §5 predicted GREEN throughout  measured green — as predicted. These are the
//      positive controls: a fix that stripped the wrapper by PATTERN instead of
//      reading `.innerMessage` reddens here and nowhere else.
//   §6 predicted GREEN throughout  measured green — as predicted.
//   §7 predicted GREEN both sides  measured green — as predicted. It pins a
//      divergence this card does NOT repair; see its own comment.
//
// Total 11 of 30 red pre-fix (prediction: 11).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
// `.js` extension deliberately: this package resolves `nodenext`, so an
// extensionless relative import is a `tsc` error (TS2835).
import { mapDataError, handleRouteError } from './error-response.js';
import { RestServer } from './rest-server.js';

const DATA_COLLECTION = '/api/v1/data/:object';
const DATA_ITEM = '/api/v1/data/:object/:id';

/** The wrapper text that must never reach a client. */
const WRAPPER_RE = /threw:|hook '/;

// ---------------------------------------------------------------------------
// Fixtures — the shape `runtime/src/sandbox/quickjs-runner.ts` produces:
// `.message` is the `<kind> '<name>' threw: <msg>` debug wrapper, `.innerMessage`
// the business text, `.status` / `.statusCode` the #7867 side-channel.
// Reproduced here so `@objectstack/rest` does not depend on
// `@objectstack/runtime` to run its own tests.
// ---------------------------------------------------------------------------

function sandboxRefusal(
    businessMessage: string,
    extra: Record<string, unknown> = {},
    hook = 'guard',
) {
    const err: any = new Error(`hook '${hook}' threw: Error: ${businessMessage}`);
    err.name = 'SandboxError';
    err.innerMessage = businessMessage;
    return Object.assign(err, extra);
}

/**
 * The same refusal thrown OUTSIDE the sandbox — no `.innerMessage`. The control
 * that isolates the branch: one property is the whole difference, and this twin
 * must come through byte-identical to before the fix.
 */
function plainRefusal(message: string, extra: Record<string, unknown> = {}) {
    return Object.assign(new Error(message), extra);
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

/** The wire answer `resolveErrorResponse` produces, reached through its one exported caller. */
function throughRouteDoor(error: any, object?: string): { status: number; body: any } {
    const res = makeRes();
    handleRouteError(res, error, object);
    return { status: res.statusCode, body: res.body };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

const BULK_ROUTES: Array<{
    name: string; path: string; method: string; protocolKey: string;
    business: string; req: Record<string, unknown>;
}> = [
    {
        name: 'batch', method: 'POST', path: `${DATA_COLLECTION}/batch`, protocolKey: 'batchData',
        business: 'Opportunity is closed (closed_won); only description, next_step, notes may be edited.',
        req: { params: { object: 'crm_opportunity' }, body: { operation: 'update', records: [{ id: 'r1', name: 'x' }] } },
    },
    {
        name: 'createMany', method: 'POST', path: `${DATA_COLLECTION}/createMany`, protocolKey: 'createManyData',
        business: 'Another contact (Ada Lovelace) with email ada@example.com already exists.',
        req: { params: { object: 'crm_contact' }, body: [{ email: 'a@b.com' }] },
    },
    {
        name: 'updateMany', method: 'POST', path: `${DATA_COLLECTION}/updateMany`, protocolKey: 'updateManyData',
        business: '制作基地被「项目主计划批次」引用(3 条),删除被阻断,请先解除引用',
        req: { params: { object: 'crm_opportunity' }, body: { records: [{ id: 'r1', data: { name: 'x' } }] } },
    },
    {
        name: 'deleteMany', method: 'POST', path: `${DATA_COLLECTION}/deleteMany`, protocolKey: 'deleteManyData',
        business: 'Cannot delete customer account: 1 open opportunity still references it.',
        req: { params: { object: 'crm_account' }, body: { ids: ['r1'] } },
    },
    {
        name: 'clone', method: 'POST', path: `${DATA_ITEM}/clone`, protocolKey: 'cloneData',
        business: 'Do Not Call is set on this contact.',
        req: { params: { object: 'crm_account', id: 'r1' }, body: {} },
    },
];

// ---------------------------------------------------------------------------
// §1 The card's rows, walked on the real route handlers in process
// ---------------------------------------------------------------------------

describe('[#11588] a bulk write answers with the hook\'s own sentence, not the debug wrapper', () => {
    for (const route of BULK_ROUTES) {
        it(`${route.name}: a \`status\`-declared 409 reaches the client unwrapped`, async () => {
            const rest = setup({
                [route.protocolKey]: vi.fn().mockRejectedValue(
                    sandboxRefusal(route.business, { code: 'RECORD_LOCKED', status: 409 }),
                ),
            });

            const res = await call(rest, route.method, route.path, route.req);

            expect(res.statusCode).toBe(409);
            expect(res.body.error).toBe(route.business);
            // The prefix is the defect, asserted on the WHOLE body: a repair
            // that merely moved the wrapper into a second field would pass an
            // `error`-only pin.
            expect(JSON.stringify(res.body)).not.toMatch(WRAPPER_RE);
            // #11590's half must survive this one — same envelope, other field.
            expect(res.body.code).toBe('RECORD_LOCKED');
        }, 60_000);
    }

    it('CONTROL — the single-row PATCH the card measured as correct is still correct', async () => {
        // The row that proves the defect was a BRANCH, not a policy about bulk
        // writes: same producer, same status, different exit. Green before and
        // after; it reddens only if the repair disturbed the unwrap door.
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
        expect(res.body.error).toBe(
            'Opportunity is closed (closed_won); only description, next_step, notes may be edited.',
        );
        expect(JSON.stringify(res.body)).not.toMatch(WRAPPER_RE);
    }, 60_000);
});

// ---------------------------------------------------------------------------
// §2 The two spellings, on one route — the asymmetry the card named
// ---------------------------------------------------------------------------

describe('[#11588] one hook cannot yield two sentences depending on the spelling its author picked', () => {
    for (const route of BULK_ROUTES) {
        it(`${route.name}: \`status\` and \`statusCode\` answer with the SAME message`, async () => {
            const answers = [];
            for (const spelling of ['status', 'statusCode'] as const) {
                const rest = setup({
                    [route.protocolKey]: vi.fn().mockRejectedValue(
                        sandboxRefusal(route.business, { code: 'RECORD_LOCKED', [spelling]: 409 }),
                    ),
                });
                const res = await call(rest, route.method, route.path, route.req);
                answers.push({ spelling, status: res.statusCode, error: res.body.error });
            }

            // Asserted as the DIFFERENCE, not as one reading: pre-fix
            // `statusCode` was already unwrapped and `status` was not.
            expect(answers[0].error).toBe(answers[1].error);
            expect(answers[0].status).toBe(answers[1].status);
            expect(answers[0].error).toBe(route.business);
        }, 60_000);
    }
});

// ---------------------------------------------------------------------------
// §3 The dogfood-pinned default, unmoved
// ---------------------------------------------------------------------------

describe('[#11588] the undeclared-status refusal still answers 400 with its own words', () => {
    it('a bulk refusal declaring NO status keeps the verbatim-message 400', async () => {
        // Green before and after: with no declared `status` the passthrough
        // never opens and the error reaches the unwrap door as it always did.
        // Here so a repair that widened the passthrough's gate is caught.
        const rest = setup({
            deleteManyData: vi.fn().mockRejectedValue(
                sandboxRefusal('month-end close is in progress'),
            ),
        });

        const res = await call(rest, 'POST', `${DATA_COLLECTION}/deleteMany`, {
            params: { object: 'crm_account' }, body: { ids: ['r1'] },
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('month-end close is in progress');
    }, 60_000);
});

// ---------------------------------------------------------------------------
// §4 Door-to-door — the invariant `resolveErrorResponse`'s own docblock asserts
// ---------------------------------------------------------------------------

describe('[#11588 / #7525] the two doors agree on the wire answer for a sandbox refusal', () => {
    it('every 4xx status, both spellings, both doors — one sentence', () => {
        // The passthrough docblock claims the two doors "already agree on the
        // wire answer". Pinned mechanically rather than by comment: the claim
        // was false for exactly this producer, and a comment cannot go red.
        for (const status of [400, 401, 403, 404, 409, 422, 423, 451]) {
            const routeDoor = throughRouteDoor(
                sandboxRefusal('this record is frozen', { code: 'RECORD_LOCKED', status }),
            );
            const dataDoor = mapDataError(
                sandboxRefusal('this record is frozen', { code: 'RECORD_LOCKED', statusCode: status }),
            );

            expect(routeDoor.status, `status=${status}`).toBe(status);
            expect(dataDoor.status, `statusCode=${status}`).toBe(status);
            expect(routeDoor.body.error, `status=${status}`).toBe('this record is frozen');
            expect(dataDoor.body.error, `statusCode=${status}`).toBe('this record is frozen');
            expect(routeDoor.body.code, `status=${status}`).toBe(dataDoor.body.code);
        }
    });
});

// ---------------------------------------------------------------------------
// §5 POSITIVE CONTROLS — the repair is a READ, never a pattern-strip
//
// A fix that removed the wrapper by matching `hook '…' threw: ` off
// `error.message` would satisfy every assertion above and redden here. That is
// the whole reason this section exists.
// ---------------------------------------------------------------------------

describe('[#11588] a NON-sandboxed error\'s message is untouched, character for character', () => {
    it('a plain 4xx refusal comes through verbatim', () => {
        const r = throughRouteDoor(plainRefusal('Opportunity is closed.', { status: 409 }));
        expect(r.status).toBe(409);
        expect(r.body.error).toBe('Opportunity is closed.');
    });

    it('⭐ a plain error whose OWN text looks like the wrapper is NOT rewritten', () => {
        // The trap for a pattern-strip. No `.innerMessage`, so nothing about
        // this error was produced by the sandbox — its message is the
        // producer's, wrapper-shaped or not, and the boundary does not
        // paraphrase a 4xx (#5423).
        const text = "hook 'guard' threw: Error: locked";
        const r = throughRouteDoor(plainRefusal(text, { status: 409, code: 'RECORD_LOCKED' }));
        expect(r.body.error).toBe(text);
    });

    it('⭐ an `innerMessage` that is not a non-empty string falls back to `.message`', () => {
        // The gate is the sandbox's own field, read exactly as the unwrap door
        // reads it — not "does this look like a hook error".
        for (const inner of [undefined, null, '', 42, {}]) {
            const err = plainRefusal("hook 'g' threw: Error: refused", { status: 409 });
            (err as any).innerMessage = inner;
            expect(throughRouteDoor(err).body.error, String(inner)).toBe(
                "hook 'g' threw: Error: refused",
            );
        }
    });

    it('⭐ a declared `userMessage` still rides, and is still the producer\'s text', () => {
        // #9934's marked channel is orthogonal to the unwrap and must stay so.
        const err = sandboxRefusal('this record is frozen', {
            status: 409, code: 'RECORD_LOCKED', userMessage: '该记录已锁定',
        });
        const r = throughRouteDoor(err);
        expect(r.body.error).toBe('this record is frozen');
        expect(r.body.userMessage).toBe('该记录已锁定');
    });
});

// ---------------------------------------------------------------------------
// §6 The withholds and defaults this repair must not move
// ---------------------------------------------------------------------------

describe('[#11588] #5437/#5582 and #5423 are exactly where they were', () => {
    it('a sandbox refusal declaring a 5xx still has its prose withheld — both spellings', () => {
        // The load-bearing ordering. The 4xx arm is the only one this card
        // touched; if the unwrap had been hoisted above the passthrough instead,
        // the business text would ship at 503 and this goes red.
        const viaRoute = throughRouteDoor(
            sandboxRefusal('upstream ledger unavailable at 10.0.0.5:5432', {
                code: 'SERVICE_UNAVAILABLE', status: 503,
            }),
        );
        expect(viaRoute.status).toBe(503);
        expect(viaRoute.body.error).toBe(INTERNAL_ERROR_MESSAGE);

        const viaData = mapDataError(
            sandboxRefusal('upstream ledger unavailable at 10.0.0.5:5432', {
                code: 'SERVICE_UNAVAILABLE', statusCode: 503,
            }),
        );
        expect(viaData.status).toBe(503);
        expect(viaData.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('an over-long business message is TRUNCATED, not replaced (#5423)', () => {
        const long = 'x'.repeat(700);
        const r = throughRouteDoor(sandboxRefusal(long, { status: 409 }));
        expect(r.body.error).toHaveLength(500);
        expect(r.body.error.endsWith('…')).toBe(true);
    });

    it('a non-string message with no `innerMessage` still degrades to `Request failed`', () => {
        const err: any = { status: 409, message: { not: 'a string' } };
        expect(throughRouteDoor(err).body.error).toBe('Request failed');
    });

    it('an EMPTY string message with no `innerMessage` is still served as itself', () => {
        // Deliberately not `'Request failed'`: this arm's degrade is keyed on
        // the TYPE, unlike `classifyDataError`'s sibling which also checks
        // length. Pinned because the repair rewrote this very expression.
        expect(throughRouteDoor(plainRefusal('', { status: 409 })).body.error).toBe('');
    });

    it('`OBJECT_NOT_FOUND` still bypasses the passthrough entirely (#3770)', () => {
        const r = throughRouteDoor(
            sandboxRefusal('no such object', { code: 'OBJECT_NOT_FOUND', status: 409 }),
        );
        expect(r.body.code).toBe('OBJECT_NOT_FOUND');
    });
});

// ---------------------------------------------------------------------------
// §7 MEASURED AND NOT REPAIRED — recorded so it is not rediscovered as new
// ---------------------------------------------------------------------------

describe('[#11588] the crash-with-a-declared-4xx divergence this card does NOT close', () => {
    it('a CRASHED body carrying a declared 4xx still answers differently at the two doors', () => {
        // `sandboxBusinessMessage` declines a script fault (#7543), so the
        // passthrough's answer here is byte-identical to before this card —
        // deliberately. The unwrap door sanitises the same error to a 500;
        // making the two agree means moving the STATUS the passthrough
        // decided, which is a contract question and not this card's. Green on
        // both sides of the fix: it documents the gap, it does not bless it.
        const crash = () => sandboxRefusal('x', { status: 409 });
        const withCrash = () => {
            const e = crash();
            (e as any).innerMessage = 'TypeError: obj.foo is not a function';
            return e;
        };

        const viaRoute = throughRouteDoor(withCrash());
        expect(viaRoute.status).toBe(409);
        expect(viaRoute.body.error).toBe("hook 'guard' threw: Error: x");

        const viaData = mapDataError(withCrash());
        expect(viaData.status).toBe(500);
        expect(viaData.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    });
});
