// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13160] What an ABSENT execution context means at every `resolveExecCtx`
 * consumer in `rest-server.ts` — the per-site census.
 *
 * ## The question, and why one door's answer is not this file's answer
 *
 * `computeExecCtx` wraps its whole body in `try { ... } catch { return
 * undefined; }`, so a production resolve FULFILS with `undefined` on a fault
 * instead of rejecting. That conversion is applied uniformly to every consumer
 * of `resolveExecCtx`. PR #13153 measured what it reads as at ONE door (the
 * packages gate: a subject holding nothing, fail-CLOSED, with positive controls
 * and both rival readings falsified). ⛔ That result is NOT coverage of the
 * rest, and this file exists to keep it from being cited as such.
 *
 * ⛔ This is a MEASUREMENT file. It repairs nothing and proposes nothing. A
 * site whose reading is a problem is a card of its own.
 *
 * ## How a site is classified here: DRIVEN, never read off the shape
 *
 * A grep tells you a site spells `ctx?.x`. It does not tell you whether the
 * request is refused, and the three readings #13153 named — a subject holding
 * nothing / an evaluation skipped / a fall-through to a default subject — can
 * produce byte-identical responses. So every row below is produced by DRIVING
 * the mounted handler under two wirings of the same instrument:
 *
 *   - FAULT   — `resolveExecCtx` fulfils with `undefined`, exactly what
 *               `computeExecCtx`'s catch produces on the production path
 *               (section 1 measures that the production supplier really does
 *               fulfil rather than reject, instead of assuming it);
 *   - CONTROL — the same instrument, same boot, an entitled context.
 *
 * ⭐ The CONTROL leg is not decoration. A census whose every row says "denies",
 * from an instrument never shown capable of producing an ALLOW, has measured
 * its own harness. Every "denies" below stands next to a same-instrument row
 * that is served.
 *
 * ## ⚠️ Two readings that look like a fail-open and are not — both measured
 *
 *  1. **An unwrapped metadata fixture.** `getMetaItem` answers the declared
 *     `{ type, name, item }` envelope and the handler unwraps it ONCE
 *     (`visible = envelope?.item`). A fixture that returns the bare document
 *     leaves `visible` undefined, so every `&& visible` gate below it —
 *     including the ADR-0046 §6.7 audience gate — is SKIPPED, and the raw
 *     envelope is still served with a 200. That reads exactly like "the gate
 *     did not run for an anonymous caller". It was a fixture defect, caught
 *     only because the sibling `/tree` route refused on the same boot.
 *     `metaProtocol` below answers the declared envelope for that reason.
 *  2. **A 200 whose body is empty.** The book/doc LIST route does not refuse;
 *     it FILTERS. `200 []` is the refusal, and `200 [item]` is the allow, so
 *     status alone is not the observable — section 5 asserts the body.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import { RestServer } from './rest-server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'rest-server.ts'), 'utf8');

const BASE = '/api/v1';
type Handler = (req: any, res: any) => any;

// ---------------------------------------------------------------------------
// Site table, derived from the source rather than transcribed
// ---------------------------------------------------------------------------

/**
 * Every `this.resolveExecCtx(environmentId, req)` invocation, with the line it
 * sits on and whether it carries its OWN `.catch(() => undefined)`.
 *
 * ⚠️ The catch may sit on the CONTINUATION line — four of them do. A
 * single-line grep counts 16 and misses those four, which is how the thread's
 * "16 caught / 52 bare" split came to name two numbers that do not add to 72.
 */
function siteTable(): { line: number; caught: boolean; nextLine: string }[] {
    const lines = SOURCE.split('\n');
    const out: { line: number; caught: boolean; nextLine: string }[] = [];
    lines.forEach((text, i) => {
        if (!text.includes('this.resolveExecCtx(environmentId, req)')) return;
        const caught = text.includes('.catch(') || (lines[i + 1] ?? '').trim().startsWith('.catch(');
        const nextLine = (lines[i + (caught && !text.includes('.catch(') ? 2 : 1)] ?? '').trim();
        out.push({ line: i + 1, caught, nextLine });
    });
    return out;
}

const SITES = siteTable();
const BARE = SITES.filter((s) => !s.caught);
const CAUGHT = SITES.filter((s) => s.caught);
const ENFORCE_AUTH_GUARD = 'if (this.enforceAuth(req, res, context)) return;';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function recordingServer() {
    const table = new Map<string, Handler>();
    const on = (m: string) => (p: string, h: Handler) => { table.set(`${m} ${p}`, h); };
    return {
        table,
        get: on('GET'), post: on('POST'), put: on('PUT'), delete: on('DELETE'), patch: on('PATCH'),
        use: () => {}, listen: async () => {}, close: async () => {},
    } as any;
}

/** A service that answers every method — the boot wires them all, none decides. */
function anyService() {
    return new Proxy({}, {
        get: (_t, k: string) => (k === 'then' || k === 'constructor')
            ? undefined
            : vi.fn(async () => ({ ok: true, rows: [], data: [], total: 0 })),
    });
}

/**
 * A protocol whose metadata reads answer the SHAPES the handlers declare —
 * `getMetaItem` in particular returns the `{ type, name, item }` envelope (see
 * the fixture-fidelity note in the file header).
 */
function metaProtocol(doc: any) {
    return new Proxy({}, {
        get: (_t, k: string) => {
            if (k === 'then' || k === 'constructor') return undefined;
            if (k === 'getMetaItems') return vi.fn(async () => [doc]);
            if (k === 'getMetaItem') return vi.fn(async () => ({ type: doc.type, name: doc.name, item: doc }));
            if (k === 'getMetaItemCached') return undefined;
            return vi.fn(async () => ({ ok: true, rows: [], data: [], items: [doc], total: 1 }));
        },
    });
}

const ENTITLED = {
    userId: 'u_census',
    isSystem: false,
    tenantId: 'org_census',
    systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
};
const OBJECT_DOC = { name: 'acct', type: 'object', fields: {}, groups: [] };

function makeServer(protocol: any) {
    const server = recordingServer();
    const provider = async () => anyService();
    const rs: any = new RestServer(
        server, protocol as any, {} as any, undefined, undefined, () => 'env_census',
        provider, provider, provider, provider, provider, provider, provider,
        provider, provider, provider, () => true, provider, undefined, provider,
    );
    return { rs, table: server.table as Map<string, Handler> };
}

/**
 * Replace `resolveExecCtx` with the leg's value and record, per driven route,
 * which SITE LINES were reached — read off the stack, so the correspondence
 * between a route and a census site is observed rather than transcribed.
 */
function instrument(ctxValue: any) {
    const proto: any = (RestServer as any).prototype;
    const original = proto.resolveExecCtx;
    const hits = new Map<string, Set<number>>();
    const state = { route: '' };
    proto.resolveExecCtx = async function () {
        const m = (new Error().stack ?? '').match(/rest-server\.ts:(\d+):\d+/);
        if (m) {
            if (!hits.has(state.route)) hits.set(state.route, new Set());
            hits.get(state.route)!.add(Number(m[1]));
        }
        return ctxValue === undefined ? undefined : { ...ctxValue };
    };
    return { hits, state, restore: () => { proto.resolveExecCtx = original; } };
}

interface Observed { status: number; code: unknown; body: unknown; threw?: string }

async function call(handler: Handler, method: string, pattern: string, params: any): Promise<Observed> {
    let status = 0; let body: any; let sent = false;
    const res: any = {
        status(c: number) { status = c; return res; },
        json(b: any) { body = b; sent = true; },
        send() { sent = true; }, header() { return res; }, setHeader() { return res; },
        end() { sent = true; }, write() { return true; }, type() { return res; },
    };
    let threw: string | undefined;
    try {
        await handler({
            params, query: {}, body: {}, method, path: pattern,
            headers: { host: 'census.test' }, url: pattern,
        } as any, res);
    } catch (e: any) { threw = String(e?.message ?? e).slice(0, 120); }
    return { status: status || (sent ? 200 : 0), code: body?.code ?? body?.error?.code ?? body?.error, body, threw };
}

function paramsFor(pattern: string, type: string, name: string) {
    const params: Record<string, string> = {};
    for (const seg of pattern.split('/')) {
        if (!seg.startsWith(':')) continue;
        const key = seg.slice(1);
        params[key] = key === 'type' ? type : key === 'name' ? name : 'x';
    }
    return params;
}

type Row = { route: string; sites: number[] } & Observed;

/**
 * Drive every mounted route once.
 *
 * `mount: 'ISOLATED'` registers the metadata endpoints WITHOUT the umbrella
 * guard `registerMetadataEndpoints` wraps them in — the same "isolate the floor
 * so the clause underneath it can be read" move #13153 used to reach the
 * packages gate's capability clause. It is a COUNTERFACTUAL, never a production
 * posture: what it answers is whether a site refuses on its OWN reading.
 */
async function sweep(ctxValue: any, mount: 'FULL' | 'ISOLATED', doc: any = OBJECT_DOC, type = 'object'): Promise<Row[]> {
    const probe = instrument(ctxValue);
    const { rs, table } = makeServer(metaProtocol(doc));
    if (mount === 'FULL') rs.registerRoutes(); else rs.registerMetadataEndpointsInner(BASE);
    const rows: Row[] = [];
    for (const [key, handler] of table) {
        probe.state.route = key;
        const [method, pattern] = key.split(' ');
        const observed = await call(handler, method, pattern, paramsFor(pattern, type, doc.name));
        rows.push({ route: key, sites: [...(probe.hits.get(key) ?? [])].sort((a, b) => a - b), ...observed });
    }
    probe.restore();
    return rows;
}

const sitesOf = (rows: Row[]) => new Set(rows.flatMap((r) => r.sites));

// ---------------------------------------------------------------------------
// 1. The supplier — measured, not assumed
// ---------------------------------------------------------------------------

describe('[#13160] §1 the production supplier fulfils with `undefined` rather than rejecting', () => {
    it('a faulting auth service produces a RESOLVED `undefined`, so a local `.catch` has nothing to catch', async () => {
        const faulting = async () => { throw new Error('auth service is down'); };
        const { rs } = makeServer(metaProtocol(OBJECT_DOC));
        (rs as any).authServiceProvider = faulting;
        (rs as any).resolveRequestEnvironmentId = async () => { throw new Error('boom'); };

        const settled = await (rs as any).resolveExecCtx('env_census', { headers: {} })
            .then((v: unknown) => ({ kind: 'fulfilled' as const, v }), (e: unknown) => ({ kind: 'rejected' as const, e }));

        // The whole point: FULFILLED. If this ever rejects, every `.catch(() =>
        // undefined)` in the file becomes load-bearing and the census's premise
        // changes — which is why it is asserted rather than described.
        expect(settled.kind).toBe('fulfilled');
        expect((settled as any).v).toBeUndefined();

        // Positive control on the same instrument: a healthy resolve is not
        // `undefined`, so "fulfilled with undefined" is a reading about the
        // fault and not about the harness.
        const healthy = makeServer(metaProtocol(OBJECT_DOC)).rs as any;
        healthy.computeExecCtx = async () => ({ userId: 'u_ok' });
        await expect(healthy.resolveExecCtx('env_census', { headers: {} })).resolves.toEqual({ userId: 'u_ok' });
    });
});

// ---------------------------------------------------------------------------
// 2. The structural census — the counts, and the split the thread had backwards
// ---------------------------------------------------------------------------

describe('[#13160] §2 the consumer surface, counted from the tree', () => {
    it('72 invocation sites, 89 mentions — the thread\'s two control numbers hold', () => {
        expect(SITES.length).toBe(72);
        expect(SOURCE.split('resolveExecCtx').length - 1).toBe(89);
    });

    it('the split is 20 locally caught / 52 bare — NOT 16 / 52, which does not add to 72', () => {
        // 16 sites spell the catch on the invocation line; 4 more spell it on
        // the continuation line. A single-line grep sees 16 and the arithmetic
        // silently loses four sites.
        const sameLine = CAUGHT.filter((s) => SOURCE.split('\n')[s.line - 1].includes('.catch('));
        expect(sameLine.length).toBe(16);
        expect(CAUGHT.length).toBe(20);
        expect(BARE.length).toBe(52);
        expect(CAUGHT.length + BARE.length).toBe(SITES.length);
    });

    it('⭐ every one of the 52 bare sites is guarded on the VERY NEXT LINE, and none of the 20 caught ones is', () => {
        // This inverts the reason the thread gave for doing the bare sites
        // first ("no local signal that a fault becomes an anonymous subject").
        // The bare sites are bare BECAUSE the shared anonymous floor is the
        // next statement; the locally-caught ones carry a `.catch` because
        // they are NOT behind that floor and each must decide for itself.
        expect(BARE.filter((s) => s.nextLine === ENFORCE_AUTH_GUARD).length).toBe(52);
        expect(CAUGHT.filter((s) => s.nextLine === ENFORCE_AUTH_GUARD).length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 3. The 52 bare sites, driven
// ---------------------------------------------------------------------------

describe('[#13160] §3 the 52 bare sites — driven, every one of them', () => {
    it('all 52 are reached by the mounted route table, so none is classified by inference', async () => {
        const reached = sitesOf(await sweep(undefined, 'FULL'));
        const unreached = BARE.map((s) => s.line).filter((l) => !reached.has(l));
        // ⛔ A bare site that stopped being reachable must show up as a
        // shrinking census, never as a row silently inherited from a neighbour.
        expect(unreached).toEqual([]);
    }, 120_000);

    it('an absent context is the ANONYMOUS SUBJECT at all 52: 401 UNAUTHENTICATED, and the same instrument serves an entitled caller', async () => {
        const fault = await sweep(undefined, 'FULL');
        const control = await sweep(ENTITLED, 'FULL');
        const bareLines = new Set(BARE.map((s) => s.line));
        const controlByRoute = new Map(control.map((r) => [r.route, r]));

        const rows = fault.filter((r) => r.sites.some((l) => bareLines.has(l)));
        expect(rows.length).toBeGreaterThanOrEqual(52);

        for (const row of rows) {
            expect(row.status, `${row.route} under an absent context`).toBe(ANONYMOUS_DENY_STATUS);
            expect(row.code, `${row.route} under an absent context`).toBe(ANONYMOUS_DENY_CODE);
            // ⭐ The positive control: the SAME route on the SAME instrument
            // must stop answering the anonymous floor once a context resolves.
            // Not "must be 200" — several of these refuse an entitled caller
            // for an unrelated reason (an empty body is a 400, a missing row a
            // 404). What is asserted is that the floor was cleared, which is
            // what makes the 401 above a decision rather than a stuck needle.
            const ok = controlByRoute.get(row.route)!;
            expect(ok.status, `${row.route} positive control`).not.toBe(ANONYMOUS_DENY_STATUS);
        }
    }, 180_000);

    it('and the control leg really can serve a 2xx — not merely "a different refusal"', async () => {
        const control = await sweep(ENTITLED, 'FULL');
        const bareLines = new Set(BARE.map((s) => s.line));
        const served = control.filter((r) => r.sites.some((l) => bareLines.has(l)) && r.status >= 200 && r.status < 300);
        expect(served.length).toBeGreaterThanOrEqual(30);
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 4. The 20 locally-caught sites
// ---------------------------------------------------------------------------

describe('[#13160] §4 the 20 locally-caught sites — the half with no shared floor above it', () => {
    it('the metadata umbrella refuses an absent context on every non-carve-out `/meta` route', async () => {
        const fault = await sweep(undefined, 'FULL');
        const meta = fault.filter((r) => r.route.includes('/meta') && r.sites.length > 0);
        expect(meta.length).toBeGreaterThan(10);
        for (const row of meta) {
            expect(row.status, row.route).toBe(ANONYMOUS_DENY_STATUS);
            expect(row.code, row.route).toBe(ANONYMOUS_DENY_CODE);
        }
        const control = await sweep(ENTITLED, 'FULL');
        for (const row of control.filter((r) => r.route.includes('/meta') && r.sites.length > 0)) {
            expect(row.status, `${row.route} positive control`).not.toBe(ANONYMOUS_DENY_STATUS);
        }
    }, 180_000);

    it('⭐ with the umbrella ISOLATED, six of the inner sites do NOT refuse on their own reading', async () => {
        // ⛔ Counterfactual, not a production posture — production mounts the
        // umbrella, and section 4's first case measures that it refuses. What
        // this separates is DOUBLE-guarded from SINGLE-guarded: an absent
        // context is a refusal at the first set and merely "no subject, no org
        // scope" at the second, where the umbrella is the only thing deciding.
        const iso = await sweep(undefined, 'ISOLATED');
        const isoControl = await sweep(ENTITLED, 'ISOLATED');
        const byRoute = new Map(iso.map((r) => [r.route, r]));
        const controlByRoute = new Map(isoControl.map((r) => [r.route, r]));

        const REFUSES_ON_ITS_OWN = [
            'GET /api/v1/meta/_drafts',                    // authoring capability
            'POST /api/v1/meta/_migrate-stored',           // manage_metadata
            'PUT /api/v1/meta/:type/:name',                // metadata write capability
            'DELETE /api/v1/meta/:type/:name',
            'POST /api/v1/meta/:type/:name/publish',
            'POST /api/v1/meta/:type/:name/rollback',
        ];
        const SERVES_ON_ITS_OWN = [
            'GET /api/v1/meta/:type',                      // list — org scope only
            'GET /api/v1/meta/:type/:name',                // item read — org scope only
            'GET /api/v1/meta/:type/:name/layers',
            'GET /api/v1/meta/:type/:name/audit',
            'GET /api/v1/meta/:type/:name/published',
        ];

        for (const route of REFUSES_ON_ITS_OWN) {
            const row = byRoute.get(route)!;
            expect(row, route).toBeDefined();
            expect(row.status, `${route} isolated, absent context`).toBe(403);
            expect(row.code, `${route} isolated, absent context`).toBe('FORBIDDEN');
            // Same instrument, entitled caller: no longer 403 — so the refusal
            // above is the gate deciding, not the route being unreachable.
            expect(controlByRoute.get(route)!.status, `${route} isolated control`).not.toBe(403);
        }
        for (const route of SERVES_ON_ITS_OWN) {
            const row = byRoute.get(route)!;
            expect(row, route).toBeDefined();
            expect(row.status, `${route} isolated, absent context`).toBe(200);
        }
    }, 240_000);

    it('the book tree refuses on its own reading — an absent context is an UNAUTHENTICATED audience caller', async () => {
        const iso = await sweep(undefined, 'ISOLATED', { name: 'handbook', type: 'book', audience: 'org', groups: [] }, 'book');
        const row = iso.find((r) => r.route === 'GET /api/v1/meta/book/:name/tree')!;
        expect(row.status).toBe(ANONYMOUS_DENY_STATUS);
        const control = await sweep(ENTITLED, 'ISOLATED', { name: 'handbook', type: 'book', audience: 'org', groups: [] }, 'book');
        expect(control.find((r) => r.route === 'GET /api/v1/meta/book/:name/tree')!.status).toBe(200);
    }, 180_000);
});

// ---------------------------------------------------------------------------
// 5. The one production path where an absent context passes the floor
// ---------------------------------------------------------------------------

/**
 * `isPublicAudienceRead` deliberately lets an anonymous `GET` of
 * `/meta/:type` (book|doc), `/meta/:type/:name` (book|doc) and
 * `/meta/book/:name/tree` past `enforceAuth`, so the ADR-0046 §6.7 audience
 * gate can decide instead (ADR-0056 Option A's declaration-derived shape).
 *
 * ⭐ That makes these the only routes where a swallowed context reaches a
 * consumer on the PRODUCTION path. Everything else in the file is refused
 * upstream, so this is where a census must be sharpest.
 */
describe('[#13160] §5 the public-audience carve-out — the absent context reaches the handler by design', () => {
    const audiences = [
        { label: 'undeclared', audience: undefined, anonymous: false },
        { label: 'org', audience: 'org', anonymous: false },
        { label: 'public', audience: 'public', anonymous: true },
        { label: 'permissionSet', audience: { permissionSet: 'ps_x' }, anonymous: false },
    ] as const;

    for (const { label, audience, anonymous } of audiences) {
        it(`a book whose audience is ${label} is ${anonymous ? 'SERVED' : 'refused'} to an absent context, on the item read`, async () => {
            const doc = { name: 'handbook', type: 'book', ...(audience === undefined ? {} : { audience }), groups: [] };
            const probe = instrument(undefined);
            const { rs, table } = makeServer(metaProtocol(doc));
            rs.registerRoutes();
            probe.state.route = 'item';
            const item = await call(table.get('GET /api/v1/meta/:type/:name')!, 'GET', '/api/v1/meta/:type/:name', { type: 'book', name: 'handbook' });
            probe.restore();

            if (anonymous) {
                expect(item.status).toBe(200);
            } else {
                // 401, not 403: the gate reads an absent context as an
                // UNAUTHENTICATED caller, never as an authenticated one holding
                // nothing — the two are different answers and it picks the
                // first, which is the anonymous-subject reading.
                expect(item.status).toBe(ANONYMOUS_DENY_STATUS);
                expect(item.code).toBe(ANONYMOUS_DENY_CODE);
            }
        }, 60_000);
    }

    it('an entitled caller is refused 403 by the SAME gate when the book is permission-set gated — so 401 above is a reading, not a stuck needle', async () => {
        const doc = { name: 'handbook', type: 'book', audience: { permissionSet: 'ps_x' }, groups: [] };
        const probe = instrument(ENTITLED);
        const { rs, table } = makeServer(metaProtocol(doc));
        rs.registerRoutes();
        const item = await call(table.get('GET /api/v1/meta/:type/:name')!, 'GET', '/api/v1/meta/:type/:name', { type: 'book', name: 'handbook' });
        probe.restore();
        expect(item.status).toBe(403);
        expect(item.code).toBe('PERMISSION_DENIED');
    }, 60_000);

    it('⚠️ the LIST route does not refuse, it FILTERS — the decision is in the body, and a 200 alone reads it wrong', async () => {
        const listUnder = async (audience: unknown, ctxValue: any) => {
            const doc = { name: 'handbook', type: 'book', ...(audience === undefined ? {} : { audience }), groups: [] };
            const probe = instrument(ctxValue);
            const { rs, table } = makeServer(metaProtocol(doc));
            rs.registerRoutes();
            const r = await call(table.get('GET /api/v1/meta/:type')!, 'GET', '/api/v1/meta/:type', { type: 'book' });
            probe.restore();
            return r;
        };
        const orgAnon = await listUnder('org', undefined);
        expect(orgAnon.status).toBe(200);          // ⚠️ not the observable
        expect(orgAnon.body).toEqual([]);          // ⭐ this is

        const publicAnon = await listUnder('public', undefined);
        expect(publicAnon.status).toBe(200);
        expect((publicAnon.body as any[]).length).toBe(1);

        const orgEntitled = await listUnder('org', ENTITLED);
        expect((orgEntitled.body as any[]).length).toBe(1);
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 6. What is NOT measured here
// ---------------------------------------------------------------------------

describe('[#13160] §6 the boundary of this census', () => {
    it('the packages-door wrapper is the one site this file does not drive — it has its own measurement', () => {
        // `resolvePackageRouteExecutionContext` is mounted by
        // `registerPackageRoutes`, not by `RestServer.registerRoutes`, so it is
        // outside this file's route table. It is measured in
        // `package-door-execctx-fault-reading.test.ts` (PR #13153) —
        // fail-CLOSED, two ablation legs, both rival readings falsified.
        // ⛔ Recorded as DEFERRED to that file, never as "assumed closed".
        const wrapper = SOURCE.split('\n').findIndex((l) =>
            l.includes('return this.resolveExecCtx(environmentId, req).catch(() => undefined);'));
        expect(wrapper).toBeGreaterThan(0);
        expect(SITES.some((s) => s.line === wrapper + 1)).toBe(true);
    });
});
