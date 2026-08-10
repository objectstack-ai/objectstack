// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5582] A producer that DECLARES a 5xx keeps that status on the CRUD data
// routes, exactly as it already does on every route that reports through
// `resolveErrorResponse`.
//
// `rest-server.ts` has two error doors, and they gave opposite answers to one
// question — "the producer declared a `status`":
//
//   sendError / handleRouteError  (metadata, UI, discovery, batch)  400-599
//   mapDataError                  (the CRUD data routes, ~11 direct   400-499
//                                  call sites that bypass the above)
//
// So the same thrown error came back as `502` through one door and as
// `500 INTERNAL_ERROR` through the other. #5437 / PR #5464 already ruled how a
// declared 5xx must be answered — keep the status, keep the machine-readable
// `code`, drop the prose — and this file pins `mapDataError` giving the same
// answer.
//
// The live producer is #5907: `driver-sql` / `driver-turso` throw
// `status: 501` + `code: NOT_IMPLEMENTED` for an aggregate function the spec
// declares and the backend cannot compile (`count_distinct` / `array_agg` /
// `string_agg`). Those names clear `metadata-protocol`'s shape gate, so the
// throw travels from the driver to a CRUD data route — `mapDataError`'s
// direct-call territory — where the 4xx-only passthrough skipped it, no text
// heuristic matched it, and `UNCLASSIFIED_FAULT` answered `500 INTERNAL_ERROR`.
// The caller was told "the server fell over" instead of "this backend does not
// implement that declared capability": the ADR-0112 CODE was overwritten too,
// not just the status.
//
// The `code` half is spelled with `declaresServerFault` (`@objectstack/types`,
// PR #6122) — the criterion this repo already uses for "the producer declared a
// server fault" at the analytics route and in `runtime`'s dispatcher — rather
// than a fourth open-coded truthiness check.
//
// ---------------------------------------------------------------------------
// Reverse verification (restore the 4xx-only gate, keep this file). Directions
// were predicted BEFORE running; §3's prediction was WRONG and is recorded as
// measured rather than rewritten to fit:
//
//   §1 §2 §5  predicted RED,   measured RED (19 failures total) — every
//             declared 5xx degrades to 500 INTERNAL_ERROR again and the #5907
//             501→500 case fails by name.
//   §3        predicted GREEN, measured MIXED — 5 of 8 red. The prediction was
//             right about WHAT these cases defend (a 5xx arm that starts
//             echoing the producer's prose) and wrong about which assertion
//             carries it. The CONTAINMENT half (`not.toContain(message)`) is
//             genuinely direction-insensitive: it stayed green in all 8, since
//             the pre-fix terminal branch sanitised too (#5489). The ENVELOPE
//             half (`error === INTERNAL_ERROR_MESSAGE`) moves, because the old
//             heuristics answered some of these inputs with a DIFFERENT
//             sanitised envelope — raw SQL / a SQLite or Postgres dump became
//             `DATA_STORE_FAULT`'s "Internal data error" + `DATABASE_ERROR`,
//             and a unique-constraint payload became `409 UNIQUE_VIOLATION`.
//             So the revert measures something worth knowing: for a producer
//             that DECLARED a 5xx, this branch now takes precedence over those
//             text classifiers. That is the intended ordering (a declaration
//             outranks a keyword guess about the same error) and matches
//             `resolveErrorResponse`, whose door is likewise the first one.
//             Undeclared errors are untouched — §4's last two cases pin that.
//   §4        predicted GREEN, measured GREEN — the 4xx half and the branches
//             above the passthrough are untouched.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { mapDataError, RestServer } from './rest-server';

const DATA_LIST = '/api/v1/data/:object';

// ---------------------------------------------------------------------------
// Producer fixtures — copied from the shipping producers, not invented.
// `@objectstack/rest` must not take a dependency on a driver package to run its
// own tests, so the shapes are reproduced here; what matters is that each is
// `status` + `code` + a message carrying something the caller must not read.
// ---------------------------------------------------------------------------

/**
 * `driver-sql`'s `uncompilableAggregateFunctionError` (#5907) — the first live
 * producer this issue has. Its wording names the backend's internal compile
 * table, which is operator detail rather than caller detail.
 */
function uncompilableAggregateError(func: string) {
    return Object.assign(
        new Error(
            `Aggregate function "${func}" is declared but not implemented by this backend. ` +
            `Compiled here: count, sum, avg, min, max. The name is spelled correctly and ` +
            `@objectstack/spec AggregationFunction declares it — this is a capability gap in the ` +
            `backend, not a mistake in the query (#5907).`,
        ),
        { code: 'NOT_IMPLEMENTED', status: 501 },
    );
}

/** The issue body's own measurement, with the `code` its producer would declare. */
function upstreamUnreachableError() {
    return Object.assign(
        new Error('connect ECONNREFUSED 10.0.0.5:5432 (internal pool)'),
        { code: 'UPSTREAM_UNAVAILABLE', status: 502 },
    );
}

/** `metadata-protocol`'s `metadataStoreUnavailableError` shape (503 + code). */
function metadataStoreUnavailableError() {
    return Object.assign(
        new Error('Metadata store is not available: SQLITE_ERROR: no such table: sys_metadata'),
        { code: 'SERVICE_UNAVAILABLE', status: 503 },
    );
}

// ---------------------------------------------------------------------------
// §1 The declared 5xx envelope: status and code survive, the prose does not
// ---------------------------------------------------------------------------

describe('[#5582] mapDataError: a declared 5xx keeps its status and its code', () => {
    it("#5907's 501 NOT_IMPLEMENTED survives instead of degrading to 500 INTERNAL_ERROR", () => {
        const r = mapDataError(uncompilableAggregateError('count_distinct'), 'showcase_account');

        // The regression this issue is about, in one pair of assertions.
        expect(r.status).toBe(501);
        expect(r.body.code).toBe('NOT_IMPLEMENTED');
        // ...and what it used to be, pinned as a NEGATIVE so a partial revert
        // (status restored, code still overwritten) cannot pass.
        expect(r.status).not.toBe(500);
        expect(r.body.code).not.toBe('INTERNAL_ERROR');
    });

    it('the 502 from the issue body keeps its status; the host and port do not ride along', () => {
        const r = mapDataError(upstreamUnreachableError(), 'showcase_account');

        expect(r.status).toBe(502);
        expect(r.body.code).toBe('UPSTREAM_UNAVAILABLE');
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(r.body)).not.toContain('10.0.0.5');
        expect(JSON.stringify(r.body)).not.toContain('5432');
        expect(JSON.stringify(r.body)).not.toContain('ECONNREFUSED');
    });

    it('a 503 stays a 503 — a retryable dependency outage is not a 500', () => {
        const r = mapDataError(metadataStoreUnavailableError(), 'showcase_account');

        expect(r.status).toBe(503);
        expect(r.body.code).toBe('SERVICE_UNAVAILABLE');
        // Its text names the metadata table AND trips the missing-relation
        // heuristic; both are withheld and neither re-labels the fault.
        expect(JSON.stringify(r.body)).not.toContain('sys_metadata');
        expect(r.body.code).not.toBe('OBJECT_NOT_FOUND');
        expect(r.body.code).not.toBe('DATABASE_ERROR');
    });

    it('the body is exactly { error, code } — no object, no extra keys', () => {
        // Same envelope `resolveErrorResponse` emits for the same input, which
        // is the whole point of this issue: one condition, one wire answer,
        // whichever door caught it. `object` is deliberately absent — every
        // other 5xx envelope in this file (DATA_STORE_FAULT, UNCLASSIFIED_FAULT)
        // omits it too.
        const r = mapDataError(uncompilableAggregateError('array_agg'), 'showcase_account');
        expect(r.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'NOT_IMPLEMENTED' });
    });

    it('the whole band passes through, not a hand-picked list of statuses', () => {
        for (const status of [500, 501, 502, 503, 504, 507, 599]) {
            const r = mapDataError(Object.assign(new Error('internal detail'), { status, code: 'X_FAULT' }));
            expect(r.status).toBe(status);
            expect(r.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'X_FAULT' });
        }
    });

    it('a 499 is a client status and keeps its wording; 500 is the first withheld one', () => {
        const at499 = mapDataError(Object.assign(new Error('almost server'), { status: 499, code: 'C' }));
        expect(at499.body.error).toBe('almost server');

        const at500 = mapDataError(Object.assign(new Error('almost server'), { status: 500, code: 'C' }));
        expect(at500.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('a status outside 400-599 is not a declaration this branch reads', () => {
        // 600 mirrors `resolveErrorResponse`'s upper bound exactly: it falls to
        // the heuristics, which recognise nothing here, so the terminal
        // sanitised 500 answers (#5489).
        const r = mapDataError(Object.assign(new Error('nonsense status'), { status: 600, code: 'X' }));
        expect(r.status).toBe(500);
        expect(r.body.code).toBe('INTERNAL_ERROR');
    });
});

// ---------------------------------------------------------------------------
// §2 The half-declaration: a 5xx with no `code`
// ---------------------------------------------------------------------------

describe('[#5582] a 5xx that declares no code passes its status and invents nothing', () => {
    it('a bare { status: 502 } lands as 502 with NO code at all', () => {
        // This is the exact shape the two pins this issue named were written
        // on, and the exact shape `resolveErrorResponse` already answers this
        // way ("a dynamically-assigned status is treated identically (no code
        // declared)", `rest-5xx-message-sanitization.test.ts`): ADR-0112 says
        // the PRODUCER names the condition, so the half that was declared is
        // honoured and the half that was not is left empty. Inventing
        // `INTERNAL_ERROR` here would put a code on the wire nobody wrote —
        // and overwriting the 502 with a 500 would re-derive a declared status
        // from message text, which is what #5437 ruled against one door over.
        const r = mapDataError(
            Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432 (internal pool)'), { status: 502 }),
        );

        expect(r.status).toBe(502);
        expect(r.body.code).toBeUndefined();
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(r.body)).not.toContain('10.0.0.5');
    });

    it('an EMPTY-string code is not a declaration either — nothing empty reaches the wire', () => {
        const r = mapDataError(Object.assign(new Error('boom'), { status: 503, code: '' }));
        expect(r.status).toBe(503);
        expect(r.body.code).toBeUndefined();
    });

    it('a NON-STRING code is not a declaration — a driver errno is not an ADR-0112 code', () => {
        // `declaresServerFault` requires a string, which is what keeps MySQL's
        // numeric `errno`-style codes off the wire as if they were catalog
        // entries. The status is still the producer's own.
        const r = mapDataError(Object.assign(new Error('boom'), { status: 502, code: 1062 }));
        expect(r.status).toBe(502);
        expect(r.body.code).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// §3 Sanitization — the opposite overreach.
//
// GREEN under a revert BY DESIGN (the pre-fix terminal branch sanitised too,
// #5489). These exist so a future 5xx arm cannot start echoing the producer's
// words, which is what the 4xx-only gate was originally defending against.
// ---------------------------------------------------------------------------

describe('[#5582] nothing of a 5xx message reaches the client', () => {
    const leaky = [
        ['raw SQL', 'insert into showcase_account (name, email) values (?, ?)'],
        ['a SQLite dump', 'SQLITE_ERROR: no such table: sys_metadata'],
        ['a Postgres dump', 'relation "public.showcase_account" does not exist'],
        ['a connection string', 'connect ECONNREFUSED 10.0.0.5:5432 (internal pool)'],
        ['a unique-constraint payload', 'UNIQUE constraint failed: sys_user.email'],
        ['an operator sentence', 'retry without options.atomic, or probe capabilities.transactionalBatch'],
        ['an RLS policy field name', '[read-scope-sql] unsafe field identifier "secret_policy_field"'],
    ] as const;

    it.each(leaky)('withholds %s', (_label, message) => {
        const r = mapDataError(
            Object.assign(new Error(message), { status: 500, code: 'DEPENDENCY_FAULT' }),
            'showcase_account',
        );
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(r.body)).not.toContain(message);
    });

    it('length is not the criterion — a 600-character 5xx is withheld, not truncated', () => {
        const r = mapDataError(
            Object.assign(new Error(`x${'y'.repeat(600)}`), { status: 503, code: 'SERVICE_UNAVAILABLE' }),
        );
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(String(r.body.error).endsWith('…')).toBe(false);
        expect(String(r.body.error)).not.toContain('yyy');
    });

    it('a missing message changes nothing — the generic sentence is unconditional', () => {
        const r = mapDataError({ status: 502, code: 'UPSTREAM_UNAVAILABLE' });
        expect(r.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'UPSTREAM_UNAVAILABLE' });
    });
});

// ---------------------------------------------------------------------------
// §4 Non-regression: the 4xx half and the branches ABOVE the passthrough
// ---------------------------------------------------------------------------

describe('[#5582] the 4xx half and the structured branches are untouched', () => {
    it('a short 4xx is still byte-for-byte verbatim, with its object', () => {
        const msg = 'FORBIDDEN: insufficient privileges to update showcase_inquiry rec1';
        const r = mapDataError(Object.assign(new Error(msg), { code: 'FORBIDDEN', status: 403 }), 'showcase_inquiry');
        expect(r.status).toBe(403);
        expect(r.body).toEqual({ error: msg, code: 'FORBIDDEN', object: 'showcase_inquiry' });
    });

    it('a long 4xx is still TRUNCATED rather than withheld (#5423)', () => {
        const r = mapDataError(Object.assign(new Error('z'.repeat(600)), { status: 400, code: 'INVALID_FILTER' }));
        expect(r.status).toBe(400);
        expect(String(r.body.error)).toHaveLength(500);
        expect(String(r.body.error).endsWith('…')).toBe(true);
        expect(r.body.error).not.toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('OBJECT_NOT_FOUND keeps its canonical 404 even when it declares a 5xx status', () => {
        // That branch sits ABOVE the passthrough, which is how `mapDataError`
        // reaches the same conclusion `resolveErrorResponse` spells out by
        // excluding the code from its passthrough gate: one condition, one
        // wire code, whichever layer detected it (#3770).
        const r = mapDataError(
            Object.assign(new Error('gone'), { code: 'OBJECT_NOT_FOUND', status: 503 }),
            'showcase_account',
        );
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('OBJECT_NOT_FOUND');
    });

    it('a 5xx-declaring DELETE_RESTRICTED still answers 409 with its structured fields', () => {
        const r = mapDataError(
            Object.assign(new Error('dependents exist'), {
                code: 'DELETE_RESTRICTED', status: 500, dependentCount: 3,
            }),
            'sys_position',
        );
        expect(r.status).toBe(409);
        expect(r.body.dependentCount).toBe(3);
    });

    it('an error with NO declared status is still judged by the heuristics', () => {
        // The overwhelming majority: raw driver errors carry no `status` at
        // all, so the classifiers still own them and still SUPPLY a code.
        const leak = mapDataError(new Error('SQLITE_ERROR: no such table: some_aux_table'), 'showcase_account');
        expect(leak.status).toBe(500);
        expect(leak.body.code).toBe('DATABASE_ERROR');

        const unknown = mapDataError(new Error('nothing recognisable here'), 'showcase_account');
        expect(unknown.status).toBe(500);
        expect(unknown.body.code).toBe('INTERNAL_ERROR');
    });

    it('an UNDECLARED unique violation is still a 409 — every dialect, unchanged', () => {
        // The case the reverse verification surfaced as worth pinning. A
        // declared 5xx now outranks the text classifiers (that is the point of
        // the branch), so the guard that matters is that real driver conflicts
        // — which carry a driver `code` and NO `status` — never enter it and
        // still answer `409 UNIQUE_VIOLATION` (#6250).
        const dialects = [
            Object.assign(new Error('UNIQUE constraint failed: sys_user.email'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }),
            Object.assign(new Error('duplicate key value violates unique constraint "sys_user_email_key"'), { code: '23505' }),
            Object.assign(new Error("ER_DUP_ENTRY: Duplicate entry 'a@b.com' for key 'idx_email_unique'"), { code: 'ER_DUP_ENTRY' }),
        ];
        for (const err of dialects) {
            const r = mapDataError(err, 'sys_user');
            expect(r.status).toBe(409);
            expect(r.body.code).toBe('UNIQUE_VIOLATION');
        }
    });
});

// ---------------------------------------------------------------------------
// §5 Walked through a real CRUD data route
//
// The unit cases above call `mapDataError` directly. This section proves the
// wire answer on the route the issue is about — the direct-call territory that
// bypasses `resolveErrorResponse` entirely.
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
        getMetaItems: vi.fn().mockResolvedValue([{ name: 'showcase_account' }]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
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

async function callDataList(rest: any, object: string) {
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === DATA_LIST);
    if (!route) throw new Error(`GET ${DATA_LIST} route not registered`);
    const res = makeRes();
    await route.handler({ method: 'GET', params: { object }, query: {}, headers: {} }, res);
    return res;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
const loggedText = (needle: string) =>
    errorSpy.mock.calls.some((call) => JSON.stringify(call.map(String)).includes(needle));

beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

describe('[#5582] the CRUD data route, in process', () => {
    it('an aggregate the backend cannot compile answers 501 NOT_IMPLEMENTED on the wire', async () => {
        const rest = setup({
            findData: vi.fn().mockRejectedValue(uncompilableAggregateError('string_agg')),
        });

        const res = await callDataList(rest, 'showcase_account');

        expect(res.statusCode).toBe(501);
        expect(res.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'NOT_IMPLEMENTED' });
        // The wording the driver wrote for the operator stays with the operator.
        expect(JSON.stringify(res.body)).not.toContain('Compiled here');
    }, 60_000);

    it('a 502 reaches the client as a 502, and the operator still gets the words', async () => {
        const rest = setup({ findData: vi.fn().mockRejectedValue(upstreamUnreachableError()) });

        const res = await callDataList(rest, 'showcase_account');

        expect(res.statusCode).toBe(502);
        expect(res.body.code).toBe('UPSTREAM_UNAVAILABLE');
        expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
        // No blind spot. 502 is an `isExpectedDataStatus` lifecycle outcome, so
        // it gets no "[REST] Unhandled error" line — `logWithheldServerFault`
        // (#5437) is what covers it, and `logUnexpectedRouteError` calls it on
        // exactly this path. (Green either side of the fix: before it, the
        // degraded 500 was logged through the unhandled channel instead. The
        // invariant is that the withheld text is never lost, not which channel
        // carries it.)
        expect(loggedText('ECONNREFUSED')).toBe(true);
    }, 60_000);

    it('a 4xx on the same route is unchanged — wording and object still land', async () => {
        const rest = setup({
            findData: vi.fn().mockRejectedValue(
                Object.assign(new Error('Filter operator "$nope" is not declared'), {
                    status: 400, code: 'INVALID_FILTER',
                }),
            ),
        });

        const res = await callDataList(rest, 'showcase_account');

        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('INVALID_FILTER');
        expect(res.body.error).toBe('Filter operator "$nope" is not declared');
        expect(res.body.object).toBe('showcase_account');
    }, 60_000);
});
