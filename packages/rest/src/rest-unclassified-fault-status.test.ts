// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5489] An error `mapDataError` can attribute to NOTHING is a server fault.
//
// The mapper's terminal branch — reached only after every `code` match, every
// declared-status passthrough and every message-text heuristic has declined —
// answered `{ status: 400, body: { error: <the raw message> } }`. Both halves
// were wrong in the same direction, and the two failures compound:
//
//   400 is "you sent a bad request". An SDK, a browser fetch wrapper, a proxy
//   and a retry policy all read it as "do not retry, the caller must change
//   something". The errors that actually land here are the opposite kind:
//   `matchEndpoint` throwing because its metadata store cannot be read (it
//   throws precisely so an outage does not masquerade as an empty declaration
//   set — ADR-0110 D3), or a handler `TypeError`. Those are faults the caller
//   cannot fix and SHOULD retry. Measured on `GET /api/v1/meta/api` against a
//   store that throws `Error('metadata store unreachable')`: HTTP 400.
//
//   The raw message shipped verbatim, on the one path with the least evidence
//   that it is safe to ship — this branch is reached BECAUSE
//   `looksLikeInternalErrorLeak` matched nothing, and #5462 already recorded
//   that a keyword heuristic declining is not evidence of safety. The census
//   below is the proof: a producer declaring `status: 502` with the message
//   `connect ECONNREFUSED 10.0.0.5:5432 (internal pool)` reached a client as a
//   400 carrying host and port, because `mapDataError`'s own passthrough is
//   4xx-only and the heuristics do not know that phrasing.
//
// ---------------------------------------------------------------------------
// What did NOT move — the regression surface, mapped before the change
// ---------------------------------------------------------------------------
// The risk on this issue was misclassifying a REAL client error as a fault, so
// the question "who depends on the terminal fallback for their 400?" was
// answered empirically before editing: the branch was instrumented to record
// every error reaching it, and the whole `@objectstack/rest` suite (48 files,
// 719 tests) was run. Six errors reached it, and not one is a client error:
//
//   `metadata store unreachable`                         (this issue's outage)
//   `connect ECONNREFUSED 10.0.0.5:5432 (internal pool)`   status 502, ×2
//   `Cannot read properties of undefined (reading 'name')` TypeError
//   `boom`                                                 TypeError, ×2
//
// That matches the static reading: reaching here requires no declared 4xx
// status, none of the ~12 recognised `code`/`name` values, no `innerMessage`,
// and a message matching none of the sandbox / provisioning / record-not-found
// / unknown-column / not-null / missing-relation / unknown-object / SQL-leak
// limbs. The one family that used to ride this branch as a genuine client error
// — driver-sql's uncompilable-filter refusals — was moved off it at the
// PRODUCER by #4436, which is why `sql-driver.ts` now declares `status: 400` +
// `INVALID_FILTER` instead. Contract-first, and the reason nothing 4xx-shaped
// is left here to break.
//
// The `describe` block at the bottom pins that boundary directly: every real
// client error still gets its 4xx, from its own branch.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Ordinary red: restoring `return { status: 400, body: { error: raw || 'Bad
// request' } };` turns every case in the first two describes RED (they assert
// 500 / `INTERNAL_ERROR` / a withheld message), and leaves the whole "real 4xx
// is untouched" block GREEN — that block exists to catch the opposite
// overreach, a fix that starts promoting client mistakes to server faults.
// Confirmed by running it; see the PR.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { mapDataError, RestServer } from './rest-server';

const META_ITEM = '/api/v1/meta/:type/:name';

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
        getMetaItems: vi.fn().mockResolvedValue([]),
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
    return { rest, protocol };
}

async function callMetaItem(rest: any, params: any) {
    const res = makeRes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === META_ITEM);
    if (!route) throw new Error(`GET ${META_ITEM} route not registered`);
    await route.handler({ method: 'GET', params, query: {}, headers: {} }, res);
    return res;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

/** Everything the error channel printed, flattened for substring searching. */
const loggedText = () => errorSpy.mock.calls.map((c: unknown[]) => JSON.stringify(c.map(String))).join('\n');

// ---------------------------------------------------------------------------
// The unit: mapDataError's terminal branch
// ---------------------------------------------------------------------------

describe('[#5489] an unattributable error maps to a sanitised 500, not a 400', () => {
    it('the store-outage error this issue was raised on is a server fault', () => {
        const r = mapDataError(new Error('metadata store unreachable'));

        expect(r.status).toBe(500);
        expect(r.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' });
    });

    it('a handler bug lands in the same envelope — nothing here is data-specific', () => {
        const r = mapDataError(new TypeError('x.map is not a function'), 'showcase_account');

        expect(r.status).toBe(500);
        expect(r.body.code).toBe('INTERNAL_ERROR');
        // No `object` key: the branch is reached precisely because nothing
        // attributed the failure to the caller's object, so naming it would be
        // the same over-claim `DATABASE_ERROR` would be.
        expect(r.body.object).toBeUndefined();
    });

    it('the message is WITHHELD, not truncated — this branch has no evidence it is safe', () => {
        const r = mapDataError(new Error('pool exhausted for dsn postgres://svc:hunter2@10.0.0.5/app'));

        expect(String(r.body.error)).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(r.body)).not.toContain('hunter2');
        expect(JSON.stringify(r.body)).not.toContain('10.0.0.5');
    });

    it('an error with no message at all still answers the same envelope', () => {
        // The old branch degraded this to `{ error: 'Bad request' }`, which was
        // the least informative 400 in the file and still told the caller they
        // were at fault.
        expect(mapDataError(new Error(''))).toEqual({
            status: 500,
            body: { error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' },
        });
        expect(mapDataError(undefined).status).toBe(500);
    });

    it('`INTERNAL_ERROR`, not `DATABASE_ERROR` — this branch cannot name a cause', () => {
        // `DATA_STORE_FAULT`'s `DATABASE_ERROR` is emitted where the evidence
        // NAMES a store failure (a driver's missing-relation phrasing, a
        // `looksLikeInternalErrorLeak` hit). Here the defining fact is the
        // absence of evidence, and a handler `TypeError` returned as
        // `DATABASE_ERROR` points an operator at a database that is fine.
        // `INTERNAL_ERROR` is `standardErrorCodeForHttpStatus(500)` — the
        // catalog's own floor for "500 with no more specific code", not a third
        // vocabulary — and the message is the constant the declared-5xx branch
        // of `resolveErrorResponse` already emits.
        expect(mapDataError(new Error('who knows')).body.code).toBe('INTERNAL_ERROR');
        expect(mapDataError(new Error('no such table: sys_metadata')).body.code).toBe('DATABASE_ERROR');
        expect(mapDataError(new Error('no such table: sys_metadata')).body.error).toBe('Internal data error');
    });
});

// ---------------------------------------------------------------------------
// Walked through a real route, in-process
// ---------------------------------------------------------------------------

describe('[#5489] the metadata route answers 5xx for an unreadable store', () => {
    it('GET /meta/:type reports a fault the caller may retry, and logs the words', async () => {
        const outage = new Error('metadata store unreachable');
        const { rest } = setup({ getMetaItem: vi.fn().mockRejectedValue(outage) });

        const res = await callMetaItem(rest, { type: 'api', name: 'showcase_task_feed' });

        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' });
        // The other half of withholding: an operator can still read it. 500 is
        // outside `isExpectedDataStatus`, so `handleRouteError` prints the
        // whole error object.
        expect(loggedText()).toContain('metadata store unreachable');
    }, 60_000);
});

// ---------------------------------------------------------------------------
// The boundary: every real client error keeps its 4xx, from its own branch
// ---------------------------------------------------------------------------

describe('[#5489] real client errors are untouched — none of them rode the fallback', () => {
    it('a declared 4xx status still passes through with its own message and code', () => {
        const r = mapDataError(
            Object.assign(new Error('Unsupported filter operator "$bogusop" on field "title"'), {
                status: 400, code: 'INVALID_FILTER',
            }),
            'showcase_task',
        );

        // driver-sql's refusals (#4436) — the one family that historically rode
        // the terminal fallback, moved to the producer before this change.
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('INVALID_FILTER');
        expect(String(r.body.error)).toContain('$bogusop');
    });

    it.each([
        ['VALIDATION_FAILED', { code: 'VALIDATION_FAILED', fields: [] }, 400],
        ['INVALID_FIELD', { code: 'INVALID_FIELD', field: 'nope' }, 400],
        ['PERMISSION_DENIED', { code: 'PERMISSION_DENIED' }, 403],
        ['FEEDS_DISABLED', { code: 'FEEDS_DISABLED' }, 403],
        ['RECORD_NOT_ACCESSIBLE', { code: 'RECORD_NOT_ACCESSIBLE' }, 403],
        ['OBJECT_NOT_FOUND', { code: 'OBJECT_NOT_FOUND' }, 404],
        ['RECORD_NOT_FOUND', { code: 'RECORD_NOT_FOUND' }, 404],
        ['DELETE_RESTRICTED', { code: 'DELETE_RESTRICTED' }, 409],
        ['CONCURRENT_UPDATE', { code: 'CONCURRENT_UPDATE' }, 409],
    ])('%s keeps its status from its own branch', (_name, props, status) => {
        const r = mapDataError(Object.assign(new Error('something the caller can fix'), props), 'acct');
        expect(r.status).toBe(status);
        expect(r.body.code).toBe((props as any).code);
    });

    it('the message-text client errors keep their 400s too', () => {
        // These have no `code` and no `status` — they are judged by phrasing,
        // and they are the reason the terminal branch could not simply be
        // "anything un-coded is a fault".
        expect(mapDataError(new Error('table acct has no column named ghost'), 'acct').status).toBe(400);
        expect(mapDataError(new Error('NOT NULL constraint failed: acct.name'), 'acct').status).toBe(400);
        expect(mapDataError(new Error("hook 'beforeInsert' threw: Error: 删除被阻断"), 'acct').status).toBe(400);
        expect(mapDataError(Object.assign(new Error('wrapped'), { innerMessage: '删除被阻断' })).status).toBe(400);
    });

    it('a unique violation is still the 409 the UI keys on', () => {
        const r = mapDataError(
            new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: acct.email'),
            'acct',
        );
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('UNIQUE_VIOLATION');
    });
});
