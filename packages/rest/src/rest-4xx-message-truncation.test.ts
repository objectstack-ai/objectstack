// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5423] A 4xx domain error's message is TRUNCATED at the passthrough bound,
// never swapped wholesale for 'Request failed'.
//
// Both explicit-status passthrough branches in `rest-server.ts` bounded the
// message at 500 characters by REPLACING it: `code` and `status` landed as
// usual and every word of the body text disappeared. Nothing in the suite ever
// looked at the long-message side of either branch — the one assertion that
// touched it (`rest.test.ts`, "guards the passthrough message length") pinned
// the replacement as if it were the intent — which is how the behaviour stayed
// invisible while the messages it silences grew past the bound.
//
// It inverted the incentive on the whole rejection vocabulary. driver-sql's
// filter refusals exist ONLY to tell an author which operator or field they got
// wrong and how the spec declares it; #5158's unlowered-`FilterArray` and
// #5347's non-boolean `$null` refusals are both over 500 characters, so the two
// most carefully worded rejections in the driver were the two the client could
// not read at all. Worse, they were readable BEFORE they carried `status: 400`
// (`mapDataError`'s final `{ status: 400, body: { error: raw } }` ships the raw
// text and the leak heuristics do not match this wording) — #4436 added the
// status to give them a wire identity and, in this band, cost them their body.
//
// Reverse verification, direction predicted BEFORE running: restoring the
// wholesale replacement turns every "long" case here RED (they assert on text
// that only exists once the message survives) and leaves every "short" case
// GREEN (short messages are byte-for-byte unchanged by this fix — that is what
// those cases are for: they catch the opposite overreach, a "fix" that starts
// mangling messages that were always fine).

import { describe, it, expect, vi } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { mapDataError, RestServer } from './rest-server';

/** The bound both branches use. Unchanged by #5423 — only what happens at it. */
const MAX = 500;

// ---------------------------------------------------------------------------
// Realistic long 4xx messages
// ---------------------------------------------------------------------------

/**
 * driver-sql's `nonBooleanNullComparandError` (#5347/#5368), instantiated the
 * way a real request produces it: `{ status: { $null: "false" } }`.
 *
 * Copied rather than imported — `@objectstack/rest` must not take a dependency
 * on a driver package to run its own tests. The wording is what matters: the
 * MAIN CLAUSE (operator, field, what arrived, what the spec declares) is at the
 * front, the attribution and issue number at the back.
 */
const NULL_COMPARAND_MESSAGE =
    `Operator "$null" on field "status" requires a boolean comparand (true or false). ` +
    `Received string ("false") at where.status.$null. ` +
    `@objectstack/spec FieldOperatorsSchema declares $null as a boolean. It is refused rather ` +
    `than coerced because the backends read a non-boolean in OPPOSITE directions — this driver ` +
    `compiled IS NULL (anything but false), driver-memory's query path and driver-mongodb ` +
    `compiled IS NOT NULL (anything but true), and driver-memory's matcher dropped the ` +
    `constraint entirely. Note "false" the STRING is truthy, so it landed on the side opposite ` +
    `the false it was written to mean (#5347).`;

function invalidFilterError(message: string) {
    return Object.assign(new Error(message), { code: 'INVALID_FILTER', status: 400 });
}

/** A 600-character 4xx whose leading sentence is identifiable after slicing. */
function longClientError(status: number, code: string) {
    const head = 'The main clause a caller must read is right here at the front. ';
    return Object.assign(
        new Error(head + 'x'.repeat(600 - head.length)),
        { code, status },
    );
}

// ---------------------------------------------------------------------------
// mapDataError — the branch the generic data routes reach directly
// ---------------------------------------------------------------------------

describe('mapDataError: 4xx passthrough truncates an over-long message (#5423)', () => {
    it('a 600-character 4xx keeps its main clause instead of becoming "Request failed"', () => {
        const r = mapDataError(longClientError(400, 'INVALID_FILTER'), 'showcase_account');

        expect(r.status).toBe(400);
        expect(r.body.code).toBe('INVALID_FILTER');
        expect(r.body.object).toBe('showcase_account');
        // The regression this issue is about.
        expect(r.body.error).not.toBe('Request failed');
        // The part worth reading survived, verbatim and at the front.
        expect(r.body.error).toContain('The main clause a caller must read is right here at the front.');
        // ...and it is still bounded.
        expect(String(r.body.error)).toHaveLength(MAX);
        expect(String(r.body.error).endsWith('…')).toBe(true);
    });

    it("#5347's $null refusal reaches the client with its operator/field/spec sentence intact", () => {
        // The concrete case #5423 was raised on. Guard the premise first: if
        // this message ever drops under the bound the assertions below stop
        // proving anything, so assert it is genuinely in the truncated band.
        expect(NULL_COMPARAND_MESSAGE.length).toBeGreaterThanOrEqual(MAX);

        const r = mapDataError(invalidFilterError(NULL_COMPARAND_MESSAGE), 'showcase_account');

        expect(r.status).toBe(400);
        expect(r.body.code).toBe('INVALID_FILTER');
        expect(r.body.error).toContain('Operator "$null" on field "status" requires a boolean comparand');
        expect(r.body.error).toContain('Received string ("false") at where.status.$null');
        expect(r.body.error).toContain('FieldOperatorsSchema declares $null as a boolean');
        // What is cut is the tail — attribution and issue number, the part that
        // belongs in the log rather than in the response.
        expect(r.body.error).not.toContain('(#5347)');
    });

    it('the truncated text is a PREFIX of the original — no reordering, no summarising', () => {
        const r = mapDataError(invalidFilterError(NULL_COMPARAND_MESSAGE));
        const body = String(r.body.error);

        expect(body.slice(0, -1)).toBe(NULL_COMPARAND_MESSAGE.slice(0, MAX - 1));
        expect(NULL_COMPARAND_MESSAGE.startsWith(body.slice(0, -1))).toBe(true);
    });
});

describe('mapDataError: short 4xx messages are byte-for-byte unchanged (#5423)', () => {
    it('a normal-length message passes through with no ellipsis and no slicing', () => {
        const msg = 'FORBIDDEN: insufficient privileges to update showcase_inquiry rec1';
        const r = mapDataError(Object.assign(new Error(msg), { code: 'FORBIDDEN', status: 403 }));

        expect(r.status).toBe(403);
        expect(r.body.error).toBe(msg);
    });

    it('exactly 499 characters is still verbatim; exactly 500 is the first truncated length', () => {
        const at499 = mapDataError(Object.assign(new Error('y'.repeat(499)), { status: 400 }));
        expect(at499.body.error).toBe('y'.repeat(499));

        const at500 = mapDataError(Object.assign(new Error('y'.repeat(500)), { status: 400 }));
        expect(String(at500.body.error)).toHaveLength(MAX);
        expect(at500.body.error).toBe(`${'y'.repeat(MAX - 1)}…`);
    });

    it('an absent or empty message still degrades to generic text — nothing to truncate', () => {
        expect(mapDataError({ status: 400, code: 'X' }).body.error).toBe('Request failed');
        expect(mapDataError(Object.assign(new Error(''), { status: 400, code: 'X' })).body.error)
            .toBe('Request failed');
    });

    it('a 5xx never reaches this truncation at all — its message is dropped whole', () => {
        // [#5582] This case was "5xx never enters this branch at all
        // (unchanged: sanitizing heuristics own it)". The heuristics no longer
        // own it: `mapDataError`'s passthrough now runs 400-599, the same door
        // `resolveErrorResponse` opens, so the declared 502 IS preserved on
        // this direct-call path — the parenthetical the #5489 note left here
        // ("out of #5489's scope") is what that issue closed.
        //
        // What this file is about is unchanged and is the point of keeping the
        // case: TRUNCATION is a 4xx disposition only. A 4xx message is the
        // caller's remedy and is bounded; a 5xx message is the operator's and
        // is dropped whole — never sliced, never ellipsised, never partially
        // visible. That is why a 600-character 5xx is asserted here rather than
        // a short one.
        const r = mapDataError(
            Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432 '.repeat(20)), {
                status: 502,
                code: 'CONNECTOR_UPSTREAM_UNAVAILABLE',
            }),
        );
        expect(r.status).toBe(502);
        expect(r.body.code).toBe('CONNECTOR_UPSTREAM_UNAVAILABLE');
        // Withheld, not truncated: no prefix of the original, no ellipsis.
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(String(r.body.error).endsWith('…')).toBe(false);
        expect(String(r.body.error)).not.toContain('10.0.0.5');
        expect(String(r.body.error)).not.toContain('ECONNREFUSED');
    });

    it('a 5xx with no declared code keeps its status and gains no invented one', () => {
        // The exact shape this section used to carry (no `code`). Pinned here
        // too so the file still covers the half-declaration it was written on.
        const r = mapDataError(
            Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432 '.repeat(20)), { status: 502 }),
        );
        expect(r.status).toBe(502);
        expect(r.body.code).toBeUndefined();
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(String(r.body.error)).not.toContain('10.0.0.5');
    });
});

// ---------------------------------------------------------------------------
// sendError — walked through a real route, in-process
//
// The issue read this branch statically and said so ("`sendError` 那处是同款
// 写法，未单独走通"). It is walked here: a registered metadata route rejects,
// the handler's catch calls `sendError`, and the assertions read the body the
// client would actually receive.
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
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        saveMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        ...protocolOverrides,
    };
    const rest = new RestServer(
        createMockServer() as any,
        protocol,
        { api: { requireAuth: false } } as any,
    );
    // [#6603] this route now demands `manage_metadata` — an authoring capability, not just a session.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    return rest;
}

async function callRoute(rest: any, method: string, path: string, req: Record<string, unknown>) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    const res = makeRes();
    await route.handler({ method, params: {}, query: {}, body: {}, headers: {}, ...req }, res);
    return res;
}

/**
 * The metadata save validator's 422 — the NON-FILTER 4xx the issue asked to be
 * sampled, confirming the bound bites well outside driver-sql's filter family.
 *
 * Built the way `metadata-protocol`'s `saveMetaItem` builds it: the first THREE
 * issues are summarised as `<path>: <message>` joined by `; `, behind an
 * `[invalid_metadata] <type>/<name> failed spec validation: ` prefix, with a
 * `(+N more)` suffix for the remainder.
 *
 * Worth recording how close this family runs to the line: the same fixture with
 * three issues and no suffix measured 492 characters — under the bound by 8.
 * A metadata save is not an exotic path and a five-issue rejection is not an
 * exotic mistake, so this family straddles the cliff exactly as #5423 suspected
 * the near-miss filter refusals (#5240 at ~469, #5327 at ~454) do.
 */
function invalidMetadataError() {
    const issues = [
        { path: 'fields.amount.type', message: 'Invalid enum value. Expected one of text | number | currency | date | datetime | boolean | select | lookup | master_detail | formula | rollup, received "money"', code: 'invalid_enum_value' },
        { path: 'fields.owner.referenceTo', message: 'Required — a lookup field must name the object it references, and the name must be a registered object', code: 'invalid_type' },
        { path: 'views.grid_default.columns', message: 'Expected array, received string — a grid view declares its columns as a list of field names', code: 'invalid_type' },
        { path: 'fields.status.options', message: 'Required — a select field must declare its options', code: 'invalid_type' },
        { path: 'label', message: 'Required', code: 'invalid_type' },
    ];
    const summary = issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ');
    return Object.assign(
        new Error(
            `[invalid_metadata] object/maint_asset failed spec validation: ${summary}`
            + (issues.length > 3 ? ` (+${issues.length - 3} more)` : ''),
        ),
        { code: 'INVALID_METADATA', status: 422, issues },
    );
}

describe('sendError: the same bound, walked through a real route (#5423)', () => {
    it('a metadata-save 422 keeps its leading sentence and its structured issues', async () => {
        const err = invalidMetadataError();
        // Premise guard: this must actually be in the truncated band.
        expect(err.message.length).toBeGreaterThanOrEqual(MAX);

        const rest = setup({ saveMetaItem: vi.fn().mockRejectedValue(err) });
        const res = await callRoute(rest, 'PUT', '/api/v1/meta/:type/:name', {
            params: { type: 'object', name: 'maint_asset' },
            body: { name: 'maint_asset', label: 'Asset' },
        });

        expect(res.statusCode).toBe(422);
        expect(res.body.code).toBe('INVALID_METADATA');
        expect(res.body.error).not.toBe('Request failed');
        expect(res.body.error).toContain('[invalid_metadata] object/maint_asset failed spec validation');
        expect(res.body.error).toContain('fields.amount.type');
        expect(String(res.body.error)).toHaveLength(MAX);
        expect(String(res.body.error).endsWith('…')).toBe(true);
        // The structured half of the envelope is untouched by any of this.
        expect(Array.isArray(res.body.issues)).toBe(true);
        expect(res.body.issues).toHaveLength(5);
    }, 60_000);

    it('a 600-character 404 truncates too — this is not special-cased per status', async () => {
        const rest = setup({ getMetaItem: vi.fn().mockRejectedValue(longClientError(404, 'NO_DRAFT')) });
        const res = await callRoute(rest, 'GET', '/api/v1/meta/:type/:name', {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(res.statusCode).toBe(404);
        expect(res.body.code).toBe('NO_DRAFT');
        expect(res.body.error).toContain('The main clause a caller must read is right here at the front.');
        expect(String(res.body.error)).toHaveLength(MAX);
    }, 60_000);

    it('a short message is byte-for-byte what it always was', async () => {
        const msg = '[no_draft] No pending draft exists for object/showcase_account.';
        const rest = setup({
            getMetaItem: vi.fn().mockRejectedValue(
                Object.assign(new Error(msg), { code: 'NO_DRAFT', status: 404 }),
            ),
        });
        const res = await callRoute(rest, 'GET', '/api/v1/meta/:type/:name', {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: msg, code: 'NO_DRAFT' });
    }, 60_000);

    it('a 5xx is NOT truncated — it is withheld, whatever its length (#5437)', async () => {
        // This case used to pin the 400-599 passthrough, where an over-long 5xx
        // became the literal 'Request failed' while a SHORT one went out word
        // for word. That asymmetry WAS the #5437 leak: length is not a proxy
        // for "this text is safe to publish", and `metadata-protocol`
        // interpolates raw driver errors into 500s far shorter than the bound.
        //
        // The 4xx/5xx split survives and is still this file's subject; what
        // changed is the 5xx disposition — "withheld regardless of length"
        // instead of "withheld only above 500 characters". Full coverage lives
        // in `rest-5xx-message-sanitization.test.ts`.
        const rest = setup({
            getMetaItem: vi.fn().mockRejectedValue(
                Object.assign(new Error('z'.repeat(600)), { code: 'INTERNAL', status: 503 }),
            ),
        });
        const res = await callRoute(rest, 'GET', '/api/v1/meta/:type/:name', {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(res.statusCode).toBe(503);
        expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        // Withheld, not truncated: no prefix of the original survives at all.
        expect(String(res.body.error)).not.toContain('z');
        // The producer's own code still rides along — a SCREAMING_SNAKE
        // constant is what the client keys on and is not a leak.
        expect(res.body.code).toBe('INTERNAL');
    }, 60_000);
});
