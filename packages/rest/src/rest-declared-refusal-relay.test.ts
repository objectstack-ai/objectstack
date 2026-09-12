// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16146] A producer-DECLARED 5xx REFUSAL keeps its prose at every REST door;
 * a declared FAULT still loses it.
 *
 * ## The ruling this pins
 *
 * Director seat, decision batch #58, 2026-09-06, maintainer 「同意」, option C:
 *
 * > Refusal versus fault is a producer-side declaration on the published
 * > ADR-0112 envelope, not a status heuristic and not a second allow-list. One
 * > optional field (spec card #16335) says "this message is authored for the
 * > caller"; `declaredServerFaultAnswer` keeps the message verbatim only when
 * > it is present and withholds it otherwise, exactly as today.
 *
 * The declaration is `ApiErrorSchema.refusal` (`@objectstack/spec`), on the
 * tree since #16335, and the ONE read of it is `declaredRefusalMessage`
 * (`@objectstack/types`). This package holds TWO of the three arms that
 * withhold a declared 5xx's prose BECAUSE it was declared; the third is
 * `errorResponseBase` in `@objectstack/runtime` and is pinned in that package.
 *
 * ## ⛔ Why every case DRIVES a real mounted route
 *
 * The defect this closes was invisible to a unit test on the arm: the arm was
 * doing exactly what it said, and the prose died between a producer that
 * authored it and a caller that never read it. So each case throws its shape
 * from a REAL producer through a REAL route in `rest.getRoutes()` and reads the
 * answer off the response object the door wrote — never by calling the arm.
 *
 * ## The two arms, driven apart
 *
 * They compose the same bytes, which is why the door-to-door proof needs both:
 *
 *  - **arm 1**, `declaredServerFaultAnswer` — reached here through the
 *    analytics dataset door, which calls it BARE (#11718), i.e. without the
 *    `withDeclaredUserMessage` wrapper `/data` puts around it. That is the
 *    door a relay written into the wrapper would have missed.
 *  - **arm 2**, `resolveErrorResponse`'s own 5xx passthrough — reached here
 *    through `GET /meta/:type/:name/references` via `handleRouteError`. A
 *    throw spelling `status` takes the status passthrough into this arm; a
 *    `statusCode`-spelled one falls to `mapDataError` and arm 1.
 *
 * ## Controls
 *
 * Each kept-prose case has a DIFFERENTIAL twin: byte-identical throw, minus
 * `refusal`. Without it a door that shipped every 5xx message would satisfy
 * the positive half, and a door that withheld every one would satisfy the
 * negative half — the pair is what makes each reading a measurement. No probe
 * message contains `INTERNAL_ERROR_MESSAGE` as a substring, so no case can
 * pass by the two strings coinciding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const META = '/api/v1/meta';

/** Prose a producer authored FOR the caller. Names nothing tenant-sensitive. */
const AUTHORED = 'Cube pipeline cannot be rebuilt while a migration holds it. Retry after the migration completes, or ask for cube pipeline_v2.';

/** The detail a FAULT's prose names and the wire must never carry. */
const SECRET = 'warehouse_replica_eu';
const FAULT_PROSE = `Upstream warehouse pool exhausted for datasource ${SECRET}.`;

function mockRes() {
    const res: any = { statusCode: 200, _body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res._body = b; return res; });
    res.send = vi.fn((b: any) => { res._body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(() => res);
    res.end = vi.fn(() => res);
    return res;
}

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockProtocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
    };
}

/**
 * A valid inline dataset + selection, so the route reaches its analytics
 * service instead of refusing at the door. Same fixture shape the sibling
 * `analytics-dataset-refusal-envelope.test.ts` uses.
 */
const DATASET = {
    name: 'pipeline',
    label: 'Pipeline',
    object: 'crm_opportunity',
    dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};
const SELECTION = { dimensions: ['stage'], measures: ['revenue'] };

/** A thrown shape carrying `props`, exactly as a producer composes one. */
function declaring(props: Record<string, unknown>, message: string) {
    return Object.assign(new Error(message), props);
}

// ── arm 1: the analytics dataset door, which calls the arm BARE ──────────────

function datasetRoute(thrown: unknown) {
    const rest = new RestServer(
        mockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        (async () => ({ queryDataset: async () => { throw thrown; } })) as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'));
    expect(route, 'POST /analytics/dataset/query must be mounted').toBeTruthy();
    return route!;
}

async function postDataset(thrown: unknown) {
    const res = mockRes();
    await datasetRoute(thrown).handler(
        { method: 'POST', params: {}, headers: {}, query: {}, body: { dataset: DATASET, selection: SELECTION } } as any,
        res,
    );
    return { status: res.statusCode, body: res._body as any };
}

// ── arm 2: the /references door, reached through handleRouteError ────────────

/**
 * The narrowest engine the /references reads bottom out on: no rows anywhere.
 *
 * ⛔ READ-ONLY on purpose — no `delete`, `update` or `insert` member exists,
 * because nothing this file drives writes, so it adds no write double for
 * `check:engine-double-contract` to police. Its `findOne` IS pinned: a fake
 * looser than `ObjectQL.findOne` is how a dead REST route once shipped with
 * its suite green, so this one answers "no rows" to the same dispatch
 * predicate the real engine enforces.
 */
function emptyEngine(): any {
    return {
        find: async () => [],
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return null;
        },
        count: async () => 0,
        aggregate: async () => [],
        registry: {
            listItems: () => [], getItem: () => undefined, getObject: () => undefined,
            getPackage: () => undefined, getArtifactItem: () => undefined, isPackageDisabled: () => false,
        },
    };
}

async function getReferences(thrown: unknown) {
    const protocol: any = new ObjectStackProtocolImplementation(emptyEngine(), () => new Map());
    protocol.getDiscovery = async () => ({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } });
    protocol.findReferencesToMeta = async () => { throw thrown; };

    const rest = new RestServer(
        { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} } as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: ['manage_metadata'], tenantId: 'org_alpha' });
    rest.registerRoutes();

    const route = (rest as any).getRoutes().find(
        (r: any) => r.method === 'GET' && r.path === `${META}/:type/:name/references`,
    );
    expect(route, 'GET /meta/:type/:name/references must be mounted').toBeTruthy();
    const res = mockRes();
    await route.handler({ method: 'GET', path: '', params: { type: 'object', name: 'account' }, query: {}, headers: {}, body: {} } as any, res);
    return { status: res.statusCode, body: res._body as any };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[#16146] arm 1 — the analytics dataset door, which calls declaredServerFaultAnswer BARE', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { logSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { logSpy.mockRestore(); });

    it('a DECLARED REFUSAL keeps its prose verbatim, and the code still travels', async () => {
        const { status, body } = await postDataset(
            declaring({ status: 503, code: 'SERVICE_UNAVAILABLE', refusal: true }, AUTHORED),
        );
        expect(status).toBe(503);
        expect(String(body.error ?? body.message)).toBe(AUTHORED);
        expect(body.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('DIFFERENTIAL CONTROL — the same throw WITHOUT `refusal` is withheld', async () => {
        const { status, body } = await postDataset(
            declaring({ status: 503, code: 'SERVICE_UNAVAILABLE' }, AUTHORED),
        );
        expect(status).toBe(503);
        expect(String(body.error ?? body.message)).toBe(INTERNAL_ERROR_MESSAGE);
        expect(body.code).toBe('SERVICE_UNAVAILABLE');
        // The two cases differ in ONE key, so the reading above is the field's.
        expect(AUTHORED).not.toContain(INTERNAL_ERROR_MESSAGE);
    });

    it('a declared FAULT is withheld and its detail never reaches the wire', async () => {
        const { status, body } = await postDataset(
            declaring({ status: 503, code: 'SERVICE_UNAVAILABLE' }, FAULT_PROSE),
        );
        expect(status).toBe(503);
        expect(JSON.stringify(body)).not.toContain(SECRET);
    });

    it('the `statusCode` spelling declares the same refusal — no per-spelling dialect', async () => {
        // #7525's axis. A producer that spells `statusCode` is fully
        // ADR-0112-compliant, so its refusal must not depend on which field it
        // reached for; the shared read looks at `status ?? statusCode`.
        const { status, body } = await postDataset(
            declaring({ statusCode: 503, code: 'SERVICE_UNAVAILABLE', refusal: true }, AUTHORED),
        );
        expect(status).toBe(503);
        expect(String(body.error ?? body.message)).toBe(AUTHORED);
    });

    it('⛔ `refusal: true` with NO `code` declares nothing — the shape is `status` + `code` + the flag', async () => {
        const { status, body } = await postDataset(declaring({ status: 503, refusal: true }, AUTHORED));
        expect(status).toBe(503);
        expect(String(body.error ?? body.message)).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('⛔ `refusal` is `true` or nothing — a guessed spelling is not a declaration', async () => {
        for (const value of ['yes', 1, false, {}] as unknown[]) {
            const { body } = await postDataset(
                declaring({ status: 503, code: 'SERVICE_UNAVAILABLE', refusal: value }, AUTHORED),
            );
            expect(String(body.error ?? body.message), `refusal: ${JSON.stringify(value)}`).toBe(INTERNAL_ERROR_MESSAGE);
        }
    });

    it('⛔ SECURITY FLOOR — a refusal cannot buy leaky prose past the driver/SQL heuristic', async () => {
        // The declaration says the prose is ADDRESSED to the caller; it does
        // not say the prose is SAFE. `looksLikeInternalErrorLeak` stays
        // unconditional, so a producer that declares a refusal over a driver
        // dump is withheld exactly as a fault is.
        const leak = 'SQLITE_ERROR: no such column: crm_account.secret_policy_field';
        const { body } = await postDataset(
            declaring({ status: 503, code: 'SERVICE_UNAVAILABLE', refusal: true }, leak),
        );
        expect(String(body.error ?? body.message)).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(body)).not.toContain('secret_policy_field');
    });

    it('⛔ the flag QUALIFIES a declared status — it never invents one', async () => {
        // No `status`/`statusCode` at all: the throw declared no HTTP answer,
        // so the undeclared-5xx heuristic row runs and the flag is inert. A
        // leaky message therefore stays withheld.
        const leak = 'SQLITE_ERROR: no such column: crm_account.secret_policy_field';
        const { body } = await postDataset(Object.assign(new Error(leak), { refusal: true }));
        expect(String(body.error ?? body.message)).toBe(INTERNAL_ERROR_MESSAGE);
    });
});

describe('[#16146] arm 2 — resolveErrorResponse\'s 5xx passthrough, through handleRouteError', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { logSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { logSpy.mockRestore(); });

    it('a DECLARED REFUSAL keeps its prose verbatim at a door the route-local patch never covered', async () => {
        // `SERVICE_UNAVAILABLE` / 503, so the `/references` door's own
        // `501 NOT_IMPLEMENTED` envelope adapter declines and this reaches
        // `handleRouteError` — the arm the card's driven proof actually takes.
        const { status, body } = await getReferences(
            declaring({ status: 503, code: 'SERVICE_UNAVAILABLE', refusal: true }, AUTHORED),
        );
        expect(status).toBe(503);
        expect(String(body.error)).toBe(AUTHORED);
        expect(body.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('DIFFERENTIAL CONTROL — the same throw WITHOUT `refusal` is withheld', async () => {
        const { status, body } = await getReferences(
            declaring({ status: 503, code: 'SERVICE_UNAVAILABLE' }, AUTHORED),
        );
        expect(status).toBe(503);
        expect(String(body.error)).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('a declared FAULT still loses its prose, and its detail never reaches the wire', async () => {
        const { body } = await getReferences(declaring({ status: 503, code: 'SERVICE_UNAVAILABLE' }, FAULT_PROSE));
        expect(JSON.stringify(body)).not.toContain(SECRET);
    });

    it('LOGGING — a declared refusal is NOT logged as `[REST] Unhandled error`', async () => {
        // The card's second symptom, and the ruling's third constraint:
        // "logging follows the same field". Driven, because the log line and
        // the wire body are decided at two different call sites.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await getReferences(declaring({ status: 501, code: 'NOT_IMPLEMENTED', refusal: true }, AUTHORED));
            const refusalLines = spy.mock.calls.map((c) => String(c[0]));
            expect(refusalLines.some((l) => l.includes('[REST] Unhandled error'))).toBe(false);

            // …and the CONTROL, on the same instrument: drop the flag and the
            // identical throw is logged as an unhandled fault again. Without
            // this, a spy that never sees anything would pass the assertion
            // above for reasons that have nothing to do with the field.
            spy.mockClear();
            await getReferences(declaring({ status: 501, code: 'NOT_IMPLEMENTED' }, AUTHORED));
            const faultLines = spy.mock.calls.map((c) => String(c[0]));
            expect(faultLines.some((l) => l.includes('[REST] Unhandled error'))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });
});
