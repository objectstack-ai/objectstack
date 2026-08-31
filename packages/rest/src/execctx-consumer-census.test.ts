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
import {
    ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS,
    // [#13279] §8 drives the real loud failure rather than a stand-in, so the
    // propagation it observes is the one production raises.
    AuthzStoreUnavailableError, AUTHZ_STORE_UNAVAILABLE_STATUS,
} from '@objectstack/core';
// [#13538] §9 drives an ORG-OVERRIDABLE type on purpose, and asserts that
// choice against the registry rather than trusting a literal — the same
// predicate the read door itself consults.
import { declaresOrgOverride } from '@objectstack/metadata-core';
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
 * sits on and whether it carries its OWN `.catch(…)`.
 *
 * [#13279] The catch ARGUMENT changed: a caught site passes
 * `rethrowAuthzStoreUnavailable` instead of `() => undefined`, so a
 * permission-store outage is re-raised rather than degraded into a refusal.
 * The detection below keys on `.catch(` and is deliberately spelling-agnostic,
 * so this census still measures WHICH sites are caught, which is its subject.
 *
 * ⚠️ The catch may sit on the CONTINUATION line — four of them do. A
 * single-line grep counts 16 and misses those four, which is how the thread's
 * "16 caught / 52 bare" split came to name two numbers that do not add to 72.
 *
 * ⛔ THAT WARNING CAUGHT ITS OWN AUTHOR, AND THE RECORD SAYS SO. The first
 * revision of this block claimed "**every** site now passes
 * `rethrowAuthzStoreUnavailable`". It was FALSE when written: the conversion
 * had reached the 16 single-line sites and none of the four continuation ones
 * (their `.catch` lines were 2747, 4388, 5226, 6759 at that revision; §7 and §8
 * derive the numbers rather than quoting them) — the exact miss the paragraph
 * above describes, committed by the person who had just written it down.
 * Contract review found it. The sentence is now QUANTIFIED and, more to the
 * point, ENFORCED: §7 below re-derives the argument at every site from source
 * and fails on any `() => undefined` survivor, so this is a measurement rather
 * than a claim a reader has to trust.
 *
 * ⚠️ Reach of the sibling ledger, so nobody reads its green as covering this:
 * `authz-store-unavailable.test.ts`'s per-transport check is PRESENCE-based —
 * it asks whether the file CONTAINS `isAuthzStoreUnavailableError` or
 * `rethrowAuthzStoreUnavailable` at all. One converted site satisfies it for
 * the whole file, so it cannot see a PARTIAL conversion and no pin there failed
 * while those four sites stood. §7 is what closes that gap for this file.
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
    // [#13214] The internal key `computeExecCtx` stamps on every context it
    // produces, naming the environment whose auth service actually validated
    // the caller. `enforceEnvironmentOwnership` — the new guard on the UI-view
    // site this census now counts — compares it against the environment the
    // request resolved to, which under `makeServer` is `env_census`.
    // `instrument()` replaces `resolveExecCtx` wholesale, so a synthetic
    // context has to model the key or it is a caller anchored NOWHERE, which
    // that seam refuses. Every other site in this census ignores it.
    __authEnvironmentId: 'env_census',
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
    it('75 invocation sites, 95 mentions — the thread\'s two control numbers hold', () => {
        // [#13406] 73 → 75 sites / 92 → 95 mentions. The `/meta/:type/:name/
        // history` and `/diff` read doors resolved NO identity, so neither
        // could state which organization's `sys_metadata_history` partition it
        // was reading — they read the env one and answered an empty change log
        // for org-scoped overlays. Both join as LOCALLY CAUGHT sites (the
        // continuation-line `.catch(rethrowAuthzStoreUnavailable)` spelling),
        // which is the family the next case describes: neither door sits behind
        // the shared anonymous floor, so each must decide the outage for
        // itself — the same shape the `/audit` twin and the `/layers` door
        // already carry.
        //
        // ⚠️ Again the two numbers moved by DIFFERENT amounts (+2 and +3): two
        // call sites, and ONE prose mention in the history door's new
        // doc-comment recording that `resolveExecCtx` is memoised per request
        // and so this is not a new org-resolution seam.
        //
        // [#13214] 72 → 73 sites / 89 → 92 mentions. `registerUiEndpoints` was
        // the ONE metadata-touching route in the table that resolved no
        // identity at all — the exception this census surfaced — and the
        // 2026-08-30 ruling closed it. It joins as a BARE site behind the
        // shared floor, which is the family the next two cases describe.
        //
        // ⚠️ The two numbers moved by DIFFERENT amounts (+1 and +3) and that is
        // the point of counting both: one is the call site, the other two are
        // prose mentions in the new doc-comments (the registrar's, recording
        // that this route used to call `resolveExecCtx` zero times, and the
        // ownership guard's, recording that adding `resolveExecCtx` +
        // `enforceAuth` was measured NOT to be the repair). A mention count
        // that tracked the site count exactly would be measuring one thing
        // twice.
        expect(SITES.length).toBe(75);
        expect(SOURCE.split('resolveExecCtx').length - 1).toBe(95);
    });

    it('the split is 22 locally caught / 53 bare — NOT 16 / 53, which does not add to 75', () => {
        // 16 sites spell the catch on the invocation line; 4 more spell it on
        // the continuation line. A single-line grep sees 16 and the arithmetic
        // silently loses four sites.
        //
        // [#13214] The new site is BARE, and that is a decision the next case
        // enforces: a locally-caught site sitting behind the shared floor would
        // be the first of its kind and would break the structural claim below.
        const sameLine = CAUGHT.filter((s) => SOURCE.split('\n')[s.line - 1].includes('.catch('));
        expect(sameLine.length).toBe(16);
        expect(CAUGHT.length).toBe(22);
        expect(BARE.length).toBe(53);
        expect(CAUGHT.length + BARE.length).toBe(SITES.length);
    });

    it('⭐ every one of the 53 bare sites is guarded on the VERY NEXT LINE, and none of the 22 caught ones is', () => {
        // This inverts the reason the thread gave for doing the bare sites
        // first ("no local signal that a fault becomes an anonymous subject").
        // The bare sites are bare BECAUSE the shared anonymous floor is the
        // next statement; the locally-caught ones carry a `.catch` because
        // they are NOT behind that floor and each must decide for itself.
        expect(BARE.filter((s) => s.nextLine === ENFORCE_AUTH_GUARD).length).toBe(53);
        expect(CAUGHT.filter((s) => s.nextLine === ENFORCE_AUTH_GUARD).length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 3. The 53 bare sites, driven
// ---------------------------------------------------------------------------

describe('[#13160] §3 the 53 bare sites — driven, every one of them', () => {
    it('all 53 are reached by the mounted route table, so none is classified by inference', async () => {
        const reached = sitesOf(await sweep(undefined, 'FULL'));
        const unreached = BARE.map((s) => s.line).filter((l) => !reached.has(l));
        // ⛔ A bare site that stopped being reachable must show up as a
        // shrinking census, never as a row silently inherited from a neighbour.
        expect(unreached).toEqual([]);
    }, 120_000);

    it('an absent context is the ANONYMOUS SUBJECT at all 53: 401 UNAUTHENTICATED, and the same instrument serves an entitled caller', async () => {
        const fault = await sweep(undefined, 'FULL');
        const control = await sweep(ENTITLED, 'FULL');
        const bareLines = new Set(BARE.map((s) => s.line));
        const controlByRoute = new Map(control.map((r) => [r.route, r]));

        const rows = fault.filter((r) => r.sites.some((l) => bareLines.has(l)));
        expect(rows.length).toBeGreaterThanOrEqual(53);

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
        // [#13279] The catch argument is now `rethrowAuthzStoreUnavailable`
        // (was `() => undefined`): a permission-store OUTAGE must reach the
        // door as the 503 it is instead of being laundered into a 401/403.
        // This grep tracks the wrapper's CURRENT spelling — the site is still
        // deferred to its own file, which is what §6 asserts.
        const wrapper = SOURCE.split('\n').findIndex((l) =>
            l.includes('return this.resolveExecCtx(environmentId, req).catch(rethrowAuthzStoreUnavailable);'));
        expect(wrapper).toBeGreaterThan(0);
        expect(SITES.some((s) => s.line === wrapper + 1)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 7. ⭐ The catch ARGUMENT at every site — the half a presence check cannot see
//
//    Added after contract review found this file asserting, in prose, that
//    "every site now passes `rethrowAuthzStoreUnavailable`" while four sites
//    still passed `() => undefined`. Prose cannot rot loudly; this can.
//
//    Why the sibling ledger did not catch it: that check is PRESENCE-based
//    (does the file mention the guard at all), so one converted site satisfies
//    it for the whole file. A partial conversion is exactly what it cannot see,
//    and a partial conversion on this surface means a live door still launders
//    a store OUTAGE into an org-unscoped 200.
// ---------------------------------------------------------------------------

/** The catch argument at each caught site, read from source, both layouts. */
function catchArguments(): { line: number; arg: string; layout: 'inline' | 'continuation' }[] {
    const lines = SOURCE.split('\n');
    const out: { line: number; arg: string; layout: 'inline' | 'continuation' }[] = [];
    lines.forEach((text, i) => {
        if (!text.includes('this.resolveExecCtx(environmentId, req)')) return;
        const inline = /\.catch\(([^)]*(?:\)[^)]*)*)\);?\s*$/.exec(text);
        if (text.includes('.catch(') && inline) {
            out.push({ line: i + 1, arg: inline[1].trim(), layout: 'inline' });
            return;
        }
        const next = (lines[i + 1] ?? '').trim();
        const cont = /^\.catch\((.*)\);$/.exec(next);
        if (cont) out.push({ line: i + 1, arg: cont[1].trim(), layout: 'continuation' });
    });
    return out;
}

describe('[#13279] §7 every caught resolveExecCtx site re-raises the outage', () => {
    it('CONTROL: the reader finds sites in BOTH layouts, so neither can pass vacuously', () => {
        // Without this, a regex that silently stopped matching the continuation
        // form would report "0 survivors" and read exactly like a clean pass —
        // which is the precise failure that let the four sites through.
        const args = catchArguments();
        expect(args.filter((a) => a.layout === 'inline').length).toBeGreaterThanOrEqual(16);
        expect(args.filter((a) => a.layout === 'continuation').length).toBeGreaterThanOrEqual(4);
        expect(args.length).toBe(CAUGHT.length);
    });

    it('⭐ NO caught site swallows with `() => undefined`', () => {
        const swallowers = catchArguments().filter((a) => /=>\s*undefined/.test(a.arg));
        // Named, so a failure says WHICH door is still laundering an outage.
        expect(swallowers.map((s) => `${s.line} (${s.layout})`)).toEqual([]);
    });

    it('⭐ every caught site passes the shared guard, not a local re-spelling', () => {
        // A local `(e) => { if (e?.status === 503) throw e; }` would satisfy the
        // test above and still be a second, driftable copy of the predicate.
        for (const a of catchArguments()) {
            expect({ line: a.line, arg: a.arg }).toEqual({ line: a.line, arg: 'rethrowAuthzStoreUnavailable' });
        }
    });
});

// ---------------------------------------------------------------------------
// 8. ⭐ BEHAVIOURAL: the four continuation-layout doors PROPAGATE the outage
//
//    §7 proves the source says `rethrowAuthzStoreUnavailable` at every site.
//    That is a claim about text. This section drives the doors and observes
//    what they ANSWER when the resolver rejects with the real error, because
//    the defect these four carried was not a spelling: during a store outage
//    they swallowed the loud failure and served an org-unscoped, env-wide
//    `200` — a fabricated success, not a refusal.
//
//    ⚠️ The site lines are DERIVED from §7, never transcribed. This file's own
//    history is that hardcoded line numbers in it went stale and hid four
//    sites; a literal here would be the same mistake in the test that exists
//    to catch it.
//
//    ⛔ REACH OF THIS SECTION, measured by ablation rather than assumed — read
//    it before trusting §8 as the tripwire for a single site. Reverting ONE of
//    the four sites to `() => undefined` turns §7 red and leaves §8 GREEN. That
//    is not a gap in the assertion, it is the shape of the handlers: the
//    `${metaPath}/:type` handler registered at line 4332 runs to 4794 and
//    resolves the context THREE times (the continuation site, then two guarded
//    single-line sites), so under the TOTAL outage this section drives, a later
//    site still throws and the door still refuses. §8 therefore pins what a
//    door ANSWERS; §7 pins what each SITE spells. Only §7 fails on one reverted
//    site, and that is the division of labour to keep.
//
//    ⚠️ [#13538] CORRECTED, by ablation, without touching the paragraph above:
//    the mechanism named there is not the operative one. Reverting the `:type`
//    site and driving THIS section leaves it green because `resolveObjectMasker`
//    resolves the context again, guarded — and that method early-returns unless
//    `metaType === 'object'`, which is exactly the type this section sweeps. The
//    handler's 'app' and 'dashboard' resolves never run for `object`. §9 carries
//    the measurement.
//
//    ⚠️ Which also names what neither section covers: a PARTIAL outage, where
//    only the first read fails. There the swallow returns `undefined`, the
//    handler proceeds with no `organizationId`, and the door answers the
//    org-unscoped env-wide 200 that the conversion exists to prevent. Driving
//    that needs a per-read fault injector rather than a rejecting resolver;
//    it is NOT MEASURED here, and is stated so rather than implied away.
// ---------------------------------------------------------------------------

/** As `instrument`, but the resolver REJECTS — the production outage shape. */
function instrumentRejecting(err: unknown) {
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
        throw err;
    };
    return { hits, state, restore: () => { proto.resolveExecCtx = original; } };
}

async function sweepRejecting(err: unknown, mount: 'FULL' | 'ISOLATED'): Promise<Row[]> {
    const probe = instrumentRejecting(err);
    const { rs, table } = makeServer(metaProtocol(OBJECT_DOC));
    if (mount === 'FULL') rs.registerRoutes(); else rs.registerMetadataEndpointsInner(BASE);
    const rows: Row[] = [];
    for (const [key, handler] of table) {
        probe.state.route = key;
        const [method, pattern] = key.split(' ');
        const observed = await call(handler, method, pattern, paramsFor(pattern, 'object', OBJECT_DOC.name));
        rows.push({ route: key, sites: [...(probe.hits.get(key) ?? [])].sort((a, b) => a - b), ...observed });
    }
    probe.restore();
    return rows;
}

describe('[#13279] §8 an outage at the four continuation sites is not served as success', () => {
    const CONTINUATION = catchArguments().filter((a) => a.layout === 'continuation').map((a) => a.line);

    // ISOLATED, and the reason is measured rather than stylistic: under the FULL
    // mount `registerMetadataEndpoints`'s umbrella guard resolves the context
    // FIRST and refuses there, so the handler never reaches these four sites and
    // a sweep observes nothing about them. Isolating the floor is the same move
    // §6 documents — a counterfactual that reads a site on its OWN behaviour,
    // never a production posture.
    const MOUNT = 'ISOLATED' as const;

    it('CONTROL: the four sites are REACHED by real routes, and 200 is their HEALTHY answer', async () => {
        // Two things at once, and both are needed. Without the reachability half,
        // "no 200 during an outage" is satisfied by a door that never runs.
        // Without the 200 half, it is satisfied by a door that never returned 200
        // in the first place — and the defect being pinned is precisely that
        // these doors served an org-unscoped 200 while the store was down.
        expect(CONTINUATION.length).toBeGreaterThanOrEqual(4);
        const healthy = await sweep(ENTITLED, MOUNT);
        const touched = healthy.filter((r) => r.sites.some((line) => CONTINUATION.includes(line)));
        expect(touched.length).toBeGreaterThan(0);
        expect(touched.filter((r) => r.status === 200).length).toBeGreaterThan(0);
    });

    it('⭐ no route that touches a continuation site fabricates a 200 during an outage', async () => {
        const rows = await sweepRejecting(new AuthzStoreUnavailableError('sys_user_permission_set'), MOUNT);
        const touched = rows.filter((r) => r.sites.some((line) => CONTINUATION.includes(line)));
        expect(touched.length).toBeGreaterThan(0);
        // Named, so a regression says WHICH door started inventing an answer.
        expect(touched.filter((r) => r.status === 200).map((r) => r.route)).toEqual([]);
    });

    it('⭐ the outage keeps its declared 503 rather than turning into a refusal', async () => {
        const rows = await sweepRejecting(new AuthzStoreUnavailableError('sys_user_permission_set'), MOUNT);
        const touched = rows.filter((r) => r.sites.some((line) => CONTINUATION.includes(line)));
        for (const r of touched) {
            // Either the declared 503 reached the caller, or it propagated out of
            // the handler for `handleRouteError` to render. Never a 401/403 —
            // that disguise is the whole defect the ruling removed.
            const ok = r.threw !== undefined || r.status === AUTHZ_STORE_UNAVAILABLE_STATUS;
            expect({ route: r.route, status: r.status, ok }).toEqual({ route: r.route, status: r.status, ok: true });
        }
    });
});

// ---------------------------------------------------------------------------
// 9. ⭐ BEHAVIOURAL: a PARTIAL outage — only the CHOSEN read fails
//
//    [#13538] §7 pins what each site SPELLS. §8 pins what a door ANSWERS, but
//    only under a TOTAL outage: `instrumentRejecting` throws on every call. The
//    case in between — the store answering one read and failing another — is
//    where a swallowing site does its damage, because the swallow returns
//    `undefined`, the handler proceeds with NO tenant, and the read it issues
//    is env-wide. The door then answers an org-unscoped `200`: a fabricated
//    success carrying rows from outside the caller's organization. Not a
//    refusal, so nothing downstream notices.
//
//    ⭐ WHICH EXISTING PIN COULD HAVE CAUGHT IT — the question this section is
//    the answer to. Not §7: it reads catch ARGUMENTS out of the source, so a
//    regression that changes no spelling is invisible to it by construction,
//    and a stricter spelling assertion would be the non-fix. It is §8. §8 is
//    already behavioural, already drives these doors, already mounts them
//    ISOLATED and already records which sites each route touched — every part
//    of the instrument except the fault MODEL. Two things in that model, both
//    measured here rather than assumed, keep it away from this case:
//
//      (a) the fault is UNCONDITIONAL, so "the first read fails and the next
//          succeeds" cannot be expressed; and
//      (b) it drives `type: 'object'`, and `declaresOrgOverride('object')` is
//          FALSE — that type is env-wide BY DESIGN, healthy or faulted. So the
//          difference this card is about does not exist on the type §8 drives,
//          whatever fault model it were given. The first CONTROL below pins
//          both halves of that, so the reason §8 stops short stays measured
//          instead of becoming folklore.
//
//    ⚠️ AND THE TWO ARE THE SAME FIXTURE, which is the part worth keeping.
//    Ablation (collapse + swallow, both restored) recorded the list door's
//    sites and answers directly:
//
//        TOTAL outage   → status 503, sites [2821, 4388]
//        PARTIAL (1st)  → status 200, sites [4388], read carried NO organizationId
//
//    Site 2821 is `resolveObjectMasker`'s guarded resolve, and that method
//    early-returns unless `metaType === 'object'`. So what actually keeps §8
//    green under a swallow is a SECOND GUARDED RESOLVE THAT ONLY EXISTS FOR
//    `object` — the same fixture choice that makes its org-scope question
//    vacuous. ⛔ It is NOT the reading the card and §8's own note below record
//    (three resolves inside the `:type` handler): the handler's other two sit
//    behind `metaTypeSingular(...) === 'app'` and `=== 'dashboard'` and never
//    run for `object` at all. The conclusion those notes drew was right; the
//    mechanism they named was not, and re-deriving it by SYMBOL rather than by
//    line is what separated the two.
//
//    ⇒ What is owed is therefore a changed CRITERION on §8's harness — fault
//    selection per read, driven at an ORG-OVERRIDABLE type — not a new
//    source-text case. This section is that criterion; §8 keeps its own subject
//    (a total outage is a real shape and still must not be served as success).
//
//    ⚠️ The assertion that carries the weight is on the REQUEST the handler
//    BUILT, not on the status code. An org-unscoped read is the harm; a status
//    is downstream of it. That is what lets this survive a refactor which
//    changes no spelling — reordering the resolves, or collapsing them so the
//    first read is the only one — which is precisely what §7 cannot do.
// ---------------------------------------------------------------------------

/**
 * As {@link instrumentRejecting}, but the fault is SELECTED per read.
 *
 * `failOrdinal` is 1-based and counted PER DRIVEN REQUEST (the sweep resets
 * it), so `1` means "only the first read fails" and every later read of the
 * same request fulfils with an entitled context. `0` never fails: that is the
 * healthy leg, run on the SAME instrument as the fault legs so the two rows are
 * comparable rather than two different experiments.
 */
function instrumentSelective(err: unknown, ctxValue: any, failOrdinal: number) {
    const proto: any = (RestServer as any).prototype;
    const original = proto.resolveExecCtx;
    const hits = new Map<string, Set<number>>();
    const state = { route: '', reads: 0 };
    proto.resolveExecCtx = async function () {
        const m = (new Error().stack ?? '').match(/rest-server\.ts:(\d+):\d+/);
        if (m) {
            if (!hits.has(state.route)) hits.set(state.route, new Set());
            hits.get(state.route)!.add(Number(m[1]));
        }
        state.reads += 1;
        if (state.reads === failOrdinal) throw err;
        return { ...ctxValue };
    };
    return { hits, state, restore: () => { proto.resolveExecCtx = original; } };
}

/** `metaProtocol`, plus the LIST requests the handlers actually handed it. */
function recordingMetaProtocol(doc: any, reads: MetaRead[], state: { route: string }) {
    const inner: any = metaProtocol(doc);
    return new Proxy({}, {
        get: (_t, k: string) => {
            if (k === 'then' || k === 'constructor') return undefined;
            if (k === 'getMetaItems') {
                return vi.fn(async (request: any) => {
                    reads.push({ route: state.route, request });
                    return [doc];
                });
            }
            return inner[k];
        },
    });
}

interface MetaRead { route: string; request: any }

async function sweepSelective(failOrdinal: number, doc: any, type: string) {
    const probe = instrumentSelective(
        new AuthzStoreUnavailableError('sys_user_permission_set'), ENTITLED, failOrdinal,
    );
    const reads: MetaRead[] = [];
    const { rs, table } = makeServer(recordingMetaProtocol(doc, reads, probe.state));
    // ISOLATED for the reason §8 records: the FULL mount's umbrella guard
    // resolves first and refuses there, so the sites under test never run.
    rs.registerMetadataEndpointsInner(BASE);
    const rows: Row[] = [];
    for (const [key, handler] of table) {
        probe.state.route = key;
        probe.state.reads = 0;
        const [method, pattern] = key.split(' ');
        const observed = await call(handler, method, pattern, paramsFor(pattern, type, doc.name));
        rows.push({ route: key, sites: [...(probe.hits.get(key) ?? [])].sort((a, b) => a - b), ...observed });
    }
    probe.restore();
    return { rows, reads };
}

/** The list door, found by its PATTERN rather than by a transcribed key. */
const listRow = (rows: Row[]) =>
    rows.find((r) => r.route.startsWith('GET ') && r.route.endsWith('/meta/:type'));

// An ORG-OVERRIDABLE type, so the org-scope question is not vacuous — asserted
// against the registry in the first CONTROL rather than trusted here.
const ORG_SCOPED_TYPE = 'dashboard';
const ORG_SCOPED_DOC = { name: 'ops', type: 'dashboard', widgets: [] };

describe('[#13538] §9 a PARTIAL outage is not served as an org-unscoped 200', () => {
    it('CONTROL: this section drives an ORG-OVERRIDABLE type; the type §8 drives is env-wide BY DESIGN', () => {
        // The second half is why §8's green is not coverage of this card. On
        // `object`, `organizationIdForMetaRead` returns `undefined` for an
        // entitled caller too — so no fault model whatsoever could make §8
        // observe an org-scope difference on the type it sweeps.
        expect({ driven: declaresOrgOverride(ORG_SCOPED_TYPE), section8: declaresOrgOverride(OBJECT_DOC.type) })
            .toEqual({ driven: true, section8: false });
    });

    it('CONTROL: healthy, the list door serves 200 and its read NAMES the caller\'s organization', async () => {
        // Without this, "no unscoped read" below is satisfied by an instrument
        // that never scoped anything in the first place.
        const { rows, reads } = await sweepSelective(0, ORG_SCOPED_DOC, ORG_SCOPED_TYPE);
        const list = listRow(rows);
        expect({ found: list !== undefined, status: list?.status }).toEqual({ found: true, status: 200 });
        const listReads = reads.filter((r) => r.route === list!.route);
        expect(listReads.length).toBeGreaterThan(0);
        expect(listReads.map((r) => r.request?.organizationId))
            .toEqual(listReads.map(() => ENTITLED.tenantId));
    });

    it('CONTROL: the injector is SELECTIVE — with the second read faulted, the first still fulfils', async () => {
        // Two distinct sites recorded on one request ⇒ the first read RESOLVED,
        // because the second is only reachable when the first did not throw.
        // Without this the pin below is unfalsifiable: an instrument that fails
        // everything satisfies "the first read failed" vacuously.
        const { rows } = await sweepSelective(2, ORG_SCOPED_DOC, ORG_SCOPED_TYPE);
        // Any route with two recorded sites will do. Pinning this to ONE
        // handler would make the control fail on a legitimate collapse of that
        // handler's reads, which is a refactor this section must tolerate
        // rather than police.
        const multi = rows.filter((r) => r.sites.length >= 2);
        expect(multi.length).toBeGreaterThan(0);
        expect(multi.filter((r) => r.status === 200).map((r) => r.route)).toEqual([]);
    });

    it('⭐ with ONLY the first read faulted, the list door does not answer 200', async () => {
        const { rows } = await sweepSelective(1, ORG_SCOPED_DOC, ORG_SCOPED_TYPE);
        const list = listRow(rows);
        expect(list!.sites.length).toBeGreaterThan(0);
        // Named, so a regression says WHICH answer the door invented.
        // Named, so a regression says WHICH door started inventing an answer.
        expect({ route: list!.route, fabricated200: list!.status === 200 })
            .toEqual({ route: list!.route, fabricated200: false });
    });

    it('⭐ and it issues NO metadata read without an organization while the tenant is unresolvable', async () => {
        // ⭐ THE PROPERTY. The harm is the READ, not the status: a door that
        // proceeds with `listCtx === undefined` asks `getMetaItems` for the
        // env-wide partition and serves rows from outside the caller's org.
        // Asserting on the request the handler BUILT is what survives a
        // refactor that changes no spelling.
        const { rows, reads } = await sweepSelective(1, ORG_SCOPED_DOC, ORG_SCOPED_TYPE);
        const list = listRow(rows);
        const unscoped = reads.filter(
            (r) => r.route === list!.route && r.request?.organizationId === undefined,
        );
        expect(unscoped.map((r) => r.route)).toEqual([]);
    });
});
