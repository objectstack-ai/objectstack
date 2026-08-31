// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13214] What `GET /api/v1/ui/view/:object/:type` decides about the caller —
 * at the REST seam AND downstream in `getUiView`.
 *
 * ## ⭐ What this file is NOW: the single-tenant half of the regression pin
 *
 * It was written as a MEASUREMENT file and every reading in §1-§2 pinned the
 * UNGUARDED seam: 200 to an absent context, byte-identical to an entitled one,
 * `resolveExecCtx` called zero times. The maintainer ruled the repair on
 * 2026-08-30 (option C), and those readings have been INVERTED onto the
 * repaired behaviour — ⛔ not deleted, ⛔ not softened. §3-§6 are unchanged:
 * they are readings about the PRODUCER, about `isAuthGateAllowlisted` and about
 * the ratchet's reach, and the repair moved none of them.
 *
 * ⚠️ The pre-repair readings were TRUE WHEN TAKEN and are kept in the comments
 * beside their inverses, because an assertion with no history cannot tell a
 * later reader whether the defect ever existed.
 *
 * ## The three questions, and why the second is the big one
 *
 * #13160 / PR #13213's census drove every `resolveExecCtx` consumer in
 * `rest-server.ts` and found 52 of 52 bare sites refusing an absent context
 * with 401. This route surfaced there precisely because it is NOT a consumer —
 * the one metadata-touching route in the table that resolves no identity at
 * all. That census stopped at the seam and said so. This file continues past
 * it:
 *
 *   1. §1-§2 — the seam, reproduced INDEPENDENTLY of #13213 (its own harness,
 *      its own instrument), plus the exact argument object the seam hands the
 *      producer.
 *   2. §3-§4 — ⭐ the half #13214 marks UNMEASURED: does `getUiView` apply
 *      authorization of its own? Driven against the REAL
 *      `ObjectStackProtocolImplementation`, not read off a grep.
 *   3. §5 — `isAuthGateAllowlisted` does not name a `/ui` path, verified by
 *      driving it rather than by reading the array.
 *   4. §6 — ⭐ the RATCHET reach. `authz-conformance.matrix.ts` carries no row
 *      for this route while its header says a new ungated route is
 *      UNCLASSIFIED and breaks CI. §6 measures the package-local half of why:
 *      how many routes `RestServer` mounts, and how they distribute over its
 *      registrars — only ONE of which (`registerMetadataEndpoints`) the
 *      ratchet's curated probe table names at all.
 *
 * ## ⚠️ Every "it refused" reading here stands next to a positive control
 *
 * An instrument that can only produce one answer has measured itself. That cuts
 * BOTH ways on this card and the second direction is the one that is easy to
 * get wrong: a 200 from a harness that could never have shown a refusal is not
 * evidence of a fail-open either. So each section that reports "served
 * identically" also drives a rival wiring on the SAME instrument that DOES
 * refuse, and each section that reports a refusal also drives a serve.
 *
 * ## ⚠️ `@objectstack/metadata-protocol` resolves to `dist/` here
 *
 * This package's vitest config aliases `plugin-hono-server` and
 * `service-datasource` to source; `metadata-protocol` is deliberately NOT
 * aliased (it is registered in `KNOWN_UNALIASED_TEST_IMPORTS` for
 * `@objectstack/rest`), so §3/§4 read the BUILT artifact. That is stated rather
 * than assumed: a reading about the producer is only as current as the `dist/`
 * it ran against, and §3 asserts a shape it would notice a stale build on (the
 * `object` key #5948 relocated to the container).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    ANONYMOUS_DENY_CODE,
    ANONYMOUS_DENY_STATUS,
    isAuthGateAllowlisted,
} from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'rest-server.ts'), 'utf8');

const BASE = '/api/v1';
const UI_ROUTE = `GET ${BASE}/ui/view/:object/:type`;
const DATA_ROUTE = `GET ${BASE}/data/:object`;

type Handler = (req: any, res: any) => any;

// ---------------------------------------------------------------------------
// Harness — same shape as `execctx-consumer-census.test.ts`, rebuilt here so
// this file's readings do not inherit that file's fixtures (#13214 asks for an
// INDEPENDENT reproduction, not a citation).
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

function anyService() {
    return new Proxy({}, {
        get: (_t, k: string) => (k === 'then' || k === 'constructor')
            ? undefined
            : vi.fn(async () => ({ ok: true, rows: [], data: [], total: 0 })),
    });
}

function makeServer(protocol: any) {
    const server = recordingServer();
    const provider = async () => anyService();
    const rs: any = new RestServer(
        // ⚠️ Exactly 20 arguments — the constructor's arity. A longer list
        // still RUNS (JS drops the surplus) but silently shifts every argument
        // past the overflow point onto the wrong parameter, so the boot under
        // measurement stops being the boot you wrote. `tsconfig.test.json`
        // covers this file, which is what turned that into a compile error
        // rather than a quietly different harness.
        server, protocol as any, {} as any, undefined, undefined, () => 'env_13214',
        provider, provider, provider, provider, provider, provider, provider,
        provider, provider, provider, () => true, provider, undefined, provider,
    );
    return { rs, table: server.table as Map<string, Handler> };
}

/**
 * Replace `resolveExecCtx` with the leg's value and COUNT the calls. The count
 * is the observable this card turns on: "answers 200 either way" is compatible
 * with a route that resolved identity and found it sufficient; "answers 200
 * either way AND never asked" is not.
 */
function instrument(ctxValue: any) {
    const proto: any = (RestServer as any).prototype;
    const original = proto.resolveExecCtx;
    const calls = { n: 0 };
    proto.resolveExecCtx = async function () {
        calls.n++;
        return ctxValue === undefined ? undefined : { ...ctxValue };
    };
    return { calls, restore: () => { proto.resolveExecCtx = original; } };
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
            headers: { host: 'measure.test' }, url: pattern,
        } as any, res);
    } catch (e: any) { threw = String(e?.message ?? e).slice(0, 160); }
    return { status: status || (sent ? 200 : 0), code: body?.code ?? body?.error?.code ?? body?.error, body, threw };
}

/**
 * The entitled caller this file drives with.
 *
 * ⚠️ `__authEnvironmentId` is not decoration and it is not a magic string: it is
 * the internal key `computeExecCtx` stamps on every context it produces, naming
 * the environment whose auth service actually validated the caller.
 * `enforceEnvironmentOwnership` compares it against the environment the request
 * resolved to, and `instrument()` below replaces `resolveExecCtx` wholesale, so
 * a synthetic context has to MODEL that key or it is a caller anchored nowhere
 * — which the repaired seam refuses, fail-closed and deliberately.
 *
 * `'env_13214'` is this harness's `defaultEnvironmentIdProvider` (see
 * `makeServer`), i.e. exactly the environment every drive in this file resolves
 * to. A caller entitled somewhere ELSE is the tenancy suite's subject, not
 * this file's.
 */
const ENTITLED = {
    userId: 'u_13214',
    isSystem: false,
    tenantId: 'org_13214',
    systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    __authEnvironmentId: 'env_13214',
};

/** Mount the REAL route table and drive one route under one wiring. */
async function driveRoute(
    route: string,
    ctxValue: any,
    protocol: any,
    params: Record<string, string>,
): Promise<Observed & { execCtxCalls: number }> {
    const probe = instrument(ctxValue);
    const { rs, table } = makeServer(protocol);
    rs.registerRoutes();
    const handler = table.get(route);
    if (!handler) { probe.restore(); throw new Error(`route not mounted: ${route}`); }
    const [method, pattern] = route.split(' ');
    const observed = await call(handler, method, pattern, params);
    const execCtxCalls = probe.calls.n;
    probe.restore();
    return { ...observed, execCtxCalls };
}

const UI_PARAMS = { object: 'account', type: 'list' };

// The object the REAL producer is fed in §3/§4. `secret` is `hidden`, which the
// producer DOES drop — a declaration-driven omission, never an identity-driven
// one, and §3 turns on exactly that distinction.
const ACCOUNT_SCHEMA = {
    name: 'account',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text', label: 'Name', required: true },
        status: { name: 'status', type: 'text', label: 'Status' },
        salary: { name: 'salary', type: 'number', label: 'Salary' },
        secret: { name: 'secret', type: 'text', hidden: true },
        created_at: { name: 'created_at', type: 'datetime' },
    },
};

/** A protocol carrying the REAL producer behind this route. */
function realProtocol(schema: unknown = ACCOUNT_SCHEMA) {
    // ⚠️ Callers wanting "no such object" must pass `null`, never `undefined`:
    // `undefined` re-triggers this default and hands back the account schema,
    // which read as the producer serving an unregistered object (it does not).
    const engine = { registry: { getObject: () => schema } };
    return new ObjectStackProtocolImplementation(engine as any) as any;
}

/** A protocol that records what the seam hands `getUiView`. */
function recordingProtocol() {
    const seen: any[] = [];
    return {
        seen,
        protocol: {
            getUiView: vi.fn(async (request: any) => { seen.push(request); return { object: request.object, list: { type: 'grid', label: 'x', columns: [] } }; }),
        } as any,
    };
}

/**
 * ⭐ The rival wiring. A producer that DOES gate: it refuses unless it is
 * handed an identity. Nothing in the seam's contract prevents such a producer
 * from existing, and if one were installed this instrument would report its
 * refusal — which is what makes §3's "served identically" a reading about the
 * shipped producer rather than about this harness.
 */
function gatingProtocol() {
    return {
        getUiView: vi.fn(async (request: any) => {
            const identity = request?.context?.userId ?? request?.userId ?? request?.executionContext?.userId;
            if (!identity) {
                const err: any = new Error('gated: no identity reached the producer');
                err.status = 403;
                err.code = 'PERMISSION_DENIED';
                throw err;
            }
            return { object: request.object, list: { type: 'grid', label: 'x', columns: [] } };
        }),
    } as any;
}

// ---------------------------------------------------------------------------
// 1. The seam, driven — independently reproduced
// ---------------------------------------------------------------------------

describe('[#13214] §1 the REST seam — absent context vs entitled context', () => {
    it('refuses an ABSENT context with 401 and serves an ENTITLED one — having actually ASKED for identity', async () => {
        // ⚠️ Pre-repair, this same drive answered 200 under BOTH, with
        // byte-identical bodies and `execCtxCalls` at 0 on both legs. Those
        // three observations were the finding; these are their inverses.
        const absent = await driveRoute(UI_ROUTE, undefined, realProtocol(), UI_PARAMS);
        const entitled = await driveRoute(UI_ROUTE, ENTITLED, realProtocol(), UI_PARAMS);

        expect(absent.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(absent.code).toBe(ANONYMOUS_DENY_CODE);
        expect(entitled.status).toBe(200);
        // Not merely "different statuses": the anonymous caller receives no
        // view at all, so this is a refusal rather than a narrowed answer.
        expect(JSON.stringify(absent.body)).not.toBe(JSON.stringify(entitled.body));
        expect((absent.body as any)?.list).toBeUndefined();
        expect((entitled.body as any)?.list?.columns?.length).toBeGreaterThan(0);

        // ⭐ The third, independent observation, inverted. `resolveExecCtx` is
        // patched on the prototype for the WHOLE server, so this counts every
        // site the driven request reached — not just this handler's.
        expect(absent.execCtxCalls).toBeGreaterThan(0);
        expect(entitled.execCtxCalls).toBeGreaterThan(0);
    }, 120_000);

    it('⭐ POSITIVE CONTROL — the same instrument, same boot, DOES refuse an absent context on a sibling route', async () => {
        // Without this, "200 under an absent context" could be a harness that
        // cannot express a refusal at all. `GET /data/:object` is mounted by
        // the very next registrar in `registerRoutes` and carries the shared
        // floor.
        const absent = await driveRoute(DATA_ROUTE, undefined, realProtocol(), { object: 'account' });
        expect(absent.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(absent.code).toBe(ANONYMOUS_DENY_CODE);
        expect(absent.execCtxCalls).toBeGreaterThan(0);

        // ...and it can also SERVE, so the 401 above is a decision and not a
        // stuck needle.
        const entitled = await driveRoute(DATA_ROUTE, ENTITLED, realProtocol(), { object: 'account' });
        expect(entitled.status).not.toBe(ANONYMOUS_DENY_STATUS);
        expect(entitled.execCtxCalls).toBeGreaterThan(0);
    }, 120_000);

    it('the handler now calls `enforceAuth` — read off the mounted registrar, not off a grep of the file', () => {
        // ⚠️ The two `false` assertions this case used to carry WERE the card's
        // source-level finding. The scoping matters as much now as it did then,
        // and for the same reason the card warns about: `enforceAuth` IS present
        // in this file 52 times over, and `registerUiEndpoints` sits directly
        // above `registerCrudEndpoints`, whose handlers all carry it — so a
        // file-wide grep would have read as a pass before the repair too.
        const start = SOURCE.indexOf('private registerUiEndpoints(');
        const end = SOURCE.indexOf('private registerCrudEndpoints(');
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const body = SOURCE.slice(start, end);

        expect(body).toContain('this.resolveProtocol(');
        expect(body).toContain('p.getUiView(');
        expect(body.includes('this.enforceAuth(')).toBe(true);
        expect(body.includes('this.resolveExecCtx(')).toBe(true);
        // ⛔ Reverse-checked: a `true` from a substring test is only worth
        // something if the term is spelled the way the rest of the file spells
        // it — 52 sibling sites say it is.
        expect(SOURCE.split('this.enforceAuth(').length - 1).toBeGreaterThan(40);
        expect(SOURCE.split('this.resolveExecCtx(').length - 1).toBeGreaterThan(40);
    });
});

// ---------------------------------------------------------------------------
// 2. What the seam hands the producer
// ---------------------------------------------------------------------------

describe('[#13214] §2 the argument object — the producer cannot gate on what it is never told', () => {
    it('the unscoped mount passes EXACTLY `{ object, type }` — no identity-bearing key of any spelling', async () => {
        const rec = recordingProtocol();
        const observed = await driveRoute(UI_ROUTE, ENTITLED, rec.protocol, UI_PARAMS);
        expect(observed.status).toBe(200);
        expect(rec.seen.length).toBe(1);

        const arg = rec.seen[0];
        expect(Object.keys(arg).sort()).toEqual(['object', 'type']);
        expect(arg).toEqual({ object: 'account', type: 'list' });

        // Spelled out because "no identity" is the claim, and a claim about an
        // ABSENCE is worth naming the candidates for. Driven with an ENTITLED
        // context in scope, so this is not "there was no identity to pass".
        for (const key of ['context', 'executionContext', 'ctx', 'userId', 'user', 'tenantId', 'organizationId', 'principal', 'req', 'request']) {
            expect(arg[key], `argument carried \`${key}\``).toBeUndefined();
        }
    }, 120_000);

    it('⭐ POSITIVE CONTROL — the recorder DOES capture a key when one is present', async () => {
        // The assertion above is `Object.keys(...) === ['object','type']`. If
        // the recorder silently dropped keys, that would pass no matter what
        // the seam sent. Driving the SAME recorder directly with a richer
        // argument shows it does not.
        const rec = recordingProtocol();
        await rec.protocol.getUiView({ object: 'account', type: 'list', context: { userId: 'u' } });
        expect(Object.keys(rec.seen[0]).sort()).toEqual(['context', 'object', 'type']);
        expect(rec.seen[0].context.userId).toBe('u');
    });
});

// ---------------------------------------------------------------------------
// 3. ⭐ The question #13214 marks UNMEASURED — does the producer gate?
// ---------------------------------------------------------------------------

describe('[#13214] §3 downstream — the REAL `getUiView`, driven', () => {
    // ⚠️ METHOD CHANGE, and it is the repair that forced it. Every case here
    // used to compare an ABSENT caller against an ENTITLED one THROUGH the
    // seam, because the seam served both. It no longer serves the absent one,
    // so that comparison is not available and ⛔ has not been faked by relaxing
    // an assertion. The producer question is unchanged and still answered — by
    // calling the producer DIRECTLY, which is where "does it gate?" actually
    // lives, plus a new reading the old method could not take: the producer is
    // never REACHED at all when the seam refuses.

    it('⭐ the producer is never REACHED when the seam refuses — the guard sits before it, not inside it', async () => {
        // The strongest form of "no metadata escapes": not that the response
        // was empty, but that the thing which produces metadata was not called.
        const rec = recordingProtocol();
        const absent = await driveRoute(UI_ROUTE, undefined, rec.protocol, UI_PARAMS);
        expect(absent.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(rec.seen.length).toBe(0);

        // ⭐ CONTROL — the SAME recorder is reached by an entitled caller, so
        // the zero above is a refusal and not a recorder that never records.
        const rec2 = recordingProtocol();
        const entitled = await driveRoute(UI_ROUTE, ENTITLED, rec2.protocol, UI_PARAMS);
        expect(entitled.status).toBe(200);
        expect(rec2.seen.length).toBe(1);
    }, 120_000);

    it('the producer applies NO authorization of its own — called directly, an identity in the argument changes nothing', async () => {
        // ⚠️ This is #13214's originally-UNMEASURED half and the answer has not
        // changed: the repair is at the seam, and the producer still gates
        // nothing. Measured where it can still be measured — §2 and §4 supply
        // the other half (the seam tells it nothing, and the instance is not
        // per-request, so it could not gate even if it wanted to).
        const producer = realProtocol();
        const bare = await producer.getUiView({ object: 'account', type: 'list' });
        const withIdentity = await producer.getUiView({
            object: 'account', type: 'list', context: ENTITLED, userId: ENTITLED.userId,
        } as any);
        expect(JSON.stringify(bare)).toBe(JSON.stringify(withIdentity));

        // Freshness of the built artifact this reads (see the header note):
        // #5948 relocated `object` onto the CONTAINER. A `dist/` from before
        // that would put it on `list` instead and this would fail loudly rather
        // than reporting a stale producer's behaviour as current.
        expect((bare as any).object).toBe('account');
        expect((bare as any).list.object).toBeUndefined();
    }, 120_000);

    it('⚠️ the one field it DOES drop is dropped by DECLARATION, not by caller — `hidden` goes, `salary` stays', async () => {
        // This is the distinction the whole question turns on. An FLS-style
        // narrowing would differ BETWEEN callers; this one is keyed on a
        // property of the schema and is identical however the producer is asked.
        const served = await driveRoute(UI_ROUTE, ENTITLED, realProtocol(), UI_PARAMS);
        const cols = (b: any) => (b.list.columns as any[]).map((c) => c.field);
        expect(cols(served.body)).not.toContain('secret');
        expect(cols(served.body)).toContain('salary');

        const direct: any = await realProtocol().getUiView({
            object: 'account', type: 'list', context: ENTITLED,
        } as any);
        expect((direct.list.columns as any[]).map((c) => c.field)).toEqual(cols(served.body));
    }, 120_000);

    it('the form branch behaves the same way — this is not a list-only reading', async () => {
        const served = await driveRoute(UI_ROUTE, ENTITLED, realProtocol(), { object: 'account', type: 'form' });
        expect(served.status).toBe(200);
        // ...and it is refused for an anonymous caller on the same branch, so
        // the repair is not list-only either.
        const absent = await driveRoute(UI_ROUTE, undefined, realProtocol(), { object: 'account', type: 'form' });
        expect(absent.status).toBe(ANONYMOUS_DENY_STATUS);
        expect((absent.body as any)?.form).toBeUndefined();
    }, 120_000);

    it('⭐ POSITIVE CONTROL A — the instrument REPORTS a downstream refusal when the producer makes one', async () => {
        // The rival wiring. Same route, same boot, same driver: a producer that
        // gates is visible as a refusal, so §3's readings are about the SHIPPED
        // producer and not a property of this harness.
        //
        // ⚠️ Driven with an ENTITLED caller now, and that is the point of the
        // case rather than a workaround: the seam passes the gate, the producer
        // still finds no identity in its argument (§2), and refuses. A 401 here
        // would mean the seam refused and this control measured nothing.
        const gated = await driveRoute(UI_ROUTE, ENTITLED, gatingProtocol(), UI_PARAMS);
        expect(gated.status).toBe(403);
        expect(gated.code).toBe('PERMISSION_DENIED');
    }, 120_000);

    it('⭐ POSITIVE CONTROL B — the REAL producer is reachable and CAN answer something other than 200', async () => {
        // Guards the other way a green could be vacuous: a producer never
        // actually invoked. An object absent from the registry makes the real
        // implementation throw, and the seam converts that into a non-200.
        const missing = await driveRoute(UI_ROUTE, ENTITLED, realProtocol(null), UI_PARAMS);
        expect(missing.status).not.toBe(200);
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 4. Why the producer could not gate even if it wanted to
// ---------------------------------------------------------------------------

describe('[#13214] §4 the producer instance is not per-request', () => {
    it('`resolveProtocol` hands the SAME object to two different requests, so it can hold no per-caller identity', async () => {
        const protocol = realProtocol();
        const { rs } = makeServer(protocol);
        const reqA = { headers: { host: 'a.test' }, params: {} };
        const reqB = { headers: { host: 'b.test' }, params: {} };
        const a = await (rs as any).resolveProtocol(undefined, reqA);
        const b = await (rs as any).resolveProtocol(undefined, reqB);
        expect(a).toBe(b);
        expect(a).toBe(protocol);
    });

    it('and the shipped `getUiView` declares ONE parameter — the request record §2 measured', () => {
        const protocol = realProtocol();
        expect(typeof protocol.getUiView).toBe('function');
        expect(protocol.getUiView.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 5. The explanation that is NOT the explanation
// ---------------------------------------------------------------------------

describe('[#13214] §5 `isAuthGateAllowlisted` does not name a `/ui` path', () => {
    it('every spelling of this route reads as NOT allow-listed', () => {
        for (const path of [
            '/api/v1/ui/view/account/list',
            '/api/v1/ui/view/account/form',
            '/api/v1/environments/env_1/ui/view/account/list',
            '/api/v1/ui/view/account/list?x=1',
        ]) {
            expect(isAuthGateAllowlisted(path), path).toBe(false);
        }
    });

    it('⭐ POSITIVE CONTROL — the same predicate DOES allow-list the control-plane paths, so `false` above is a decision', () => {
        // ⛔ Without this, a predicate that returned `false` for everything
        // (a rename, a broken import) would read exactly like the finding.
        expect(isAuthGateAllowlisted('/api/v1/auth/sign-in')).toBe(true);
        expect(isAuthGateAllowlisted(undefined)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 6. ⭐ The ratchet reach — the package-local half
// ---------------------------------------------------------------------------

/**
 * `packages/qa/dogfood/test/authz-conformance.test.ts` ratchets route
 * completeness over a CURATED per-file probe table. For THIS file it carries
 * exactly one non-tripwire probe — `private registerMetadataEndpoints(` —
 * so the umbrella covers the `/meta` family and nothing else in this file can
 * mint a discovery key at all.
 *
 * ⚠️ That cross-package fact is deliberately NOT asserted here: reading
 * `packages/qa/**` from a `packages/rest` test would silently widen this
 * package's real input set past its `CROSS_PACKAGE_TEST_INPUTS` declaration —
 * the #7802 defect. It is measured in this card's PR body instead. What §6
 * commits is the half that lives in this package and that the number is a
 * function of: how many routes `RestServer` mounts, and how they distribute
 * over registrars.
 */
function routesByRegistrar(): Map<string, string[]> {
    const names = [...SOURCE.matchAll(/private\s+(register[A-Za-z]*Endpoints)\s*\(/g)].map((m) => m[1]);
    const proto: any = (RestServer as any).prototype;
    const originals = new Map<string, any>();
    const attribution = new Map<string, string[]>();
    const { rs, table } = makeServer(realProtocol());

    for (const name of names) {
        if (typeof proto[name] !== 'function') continue;
        originals.set(name, proto[name]);
    }
    for (const [name, fn] of originals) {
        proto[name] = function (this: any, bp: string) {
            const before = new Set(table.keys());
            const out = fn.call(this, bp);
            const added = [...table.keys()].filter((k) => !before.has(k));
            attribution.set(name, [...(attribution.get(name) ?? []), ...added]);
            return out;
        };
    }
    try { rs.registerRoutes(); } finally {
        for (const [name, fn] of originals) proto[name] = fn;
    }
    // Routes registered by `registerRoutes` itself, outside every registrar.
    const attributed = new Set([...attribution.values()].flat());
    attribution.set('(registerRoutes, inline)', [...table.keys()].filter((k) => !attributed.has(k)));
    return attribution;
}

describe('[#13214] §6 the ratchet reach — how much of this file one probe key stands for', () => {
    it('`registerUiEndpoints` mounts exactly the one route on this card', () => {
        const byRegistrar = routesByRegistrar();
        expect(byRegistrar.get('registerUiEndpoints')).toEqual([UI_ROUTE]);
    }, 120_000);

    it('⭐ the `registerMetadataEndpoints` umbrella — the ONE registrar the probe table names — is a small minority of what this file mounts', () => {
        const byRegistrar = routesByRegistrar();
        const total = [...byRegistrar.values()].flat().length;
        const meta = (byRegistrar.get('registerMetadataEndpoints') ?? []).length;

        // Measured on this harness at the time of writing: 17 registrars, 85
        // mounted routes, 19 of them under the `/meta` umbrella and 66 outside
        // every key the ratchet can mint for this file.
        //
        // Deliberately inequalities, not pinned counts: this is a measurement
        // of PROPORTION, and an exact number would churn on every route added
        // for unrelated reasons. What must not silently change is the shape —
        // one covered registrar, many uncovered ones.
        expect(total).toBeGreaterThan(70);
        expect(meta).toBeGreaterThanOrEqual(15);
        expect(total - meta).toBeGreaterThan(50);

        // Fifteen-plus sibling registrars, none of which the probe table names.
        // `registerUiEndpoints` is one of them; it is not special.
        const registrars = [...byRegistrar.keys()].filter((k) => k !== '(registerRoutes, inline)');
        expect(registrars.length).toBeGreaterThanOrEqual(15);
        expect(registrars).toContain('registerUiEndpoints');
        expect(registrars).toContain('registerMetadataEndpoints');
    }, 120_000);

    it('⭐ POSITIVE CONTROL — the attribution really attributes, and is not just bucketing everything into one key', () => {
        const byRegistrar = routesByRegistrar();
        // At least three DISTINCT registrars each holding routes, and the
        // `/meta` bucket holding only `/meta` routes: an attribution that had
        // collapsed would fail both.
        const nonEmpty = [...byRegistrar.entries()].filter(([, v]) => v.length > 0);
        expect(nonEmpty.length).toBeGreaterThan(3);
        for (const route of byRegistrar.get('registerMetadataEndpoints') ?? []) {
            expect(route, 'meta bucket should hold only /meta routes').toContain('/meta');
        }
        expect(byRegistrar.get('registerCrudEndpoints')?.some((r) => r.includes('/data'))).toBe(true);
    }, 120_000);
});
