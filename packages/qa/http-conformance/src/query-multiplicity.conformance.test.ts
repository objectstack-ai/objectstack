// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A REPEATED query parameter — cross-adapter conformance (#6878, route 2).
 *
 * ## What this file is
 *
 * It is now a **contract**: every `IHttpServer` implementation hands a handler
 * the SAME `req.query` shape for one and the same request —
 *
 *     a repeated key  ⇒ an array, in wire order
 *     a single key    ⇒ a plain string
 *
 * It did not start that way. It was written under #6878 route 1 (PR #6941) as
 * a **divergence record**, because at that time the two adapters answered the
 * same request differently and both answers were legal: the contract in
 * `packages/spec/src/contracts/http-server.ts` declares
 * `query: Record<string, string | string[]>`, and either arm of that union
 * satisfies it. The file therefore recorded each adapter's MEASURED shape and
 * refused to assert a unified one, since asserting one would have settled the
 * open contract question through the back door of a test file.
 *
 * The cli-lane seat then ruled the fork (2026-08-10, #6878 comment 5236010909):
 * **route 2 adopted** — a repeated parameter is always an array — and the Hono
 * adapter was flipped to `c.req.queries()` with a `length` normalisation. This
 * file was collapsed into the single expected shape exactly as its own previous
 * header instructed, which is what that header's "expected to go red on
 * purpose" clause was for. The declared type in `packages/spec` is UNCHANGED:
 * the union already permitted arrays, so nothing about the contract's shape
 * moved — what moved is the platform's answer, from "depends on which server
 * booted" to one answer.
 *
 * ## The measurements
 *
 * BEFORE (2026-08-09, `origin/main` @ 9d425a94d, hono@4.12.34, real socket):
 *
 *     GET /probe?version=1.0.0&version=2.0.0&single=9
 *
 *     [NodeHttpServer]  { version: ['1.0.0', '2.0.0'], single: '9' }   // array
 *     [HonoHttpServer]  { version: '1.0.0',            single: '9' }   // first value
 *
 * AFTER (2026-08-10, this change, same probe, same real socket): both adapters
 * yield `{ version: ['1.0.0','2.0.0'], single: '9' }`.
 *
 *  - `NodeHttpServer` (this package's reference adapter, `./adapter.ts`) reads
 *    `url.searchParams.getAll(key)` and keeps the array when `length > 1`.
 *    Unchanged — it was already the shape route 2 adopted.
 *  - `HonoHttpServer` (`plugin-hono-server/src/adapter.ts`) now reads
 *    `c.req.queries()` through one `readQuery(c)` helper, normalised by
 *    `length`. It has TWO construction sites — the route handler seam and the
 *    `use()` middleware seam — and both moved together, which is what the
 *    per-adapter rows below (driven through a real socket, not a double) and
 *    the middleware case at the end of this file each hold down.
 *
 * ## ⚠️ The normalisation is load-bearing — the control case is why
 *
 * On hono@4.12.x, `c.req.queries()` returns an array for EVERY key, including
 * single-valued ones (`{ version: ['1.0.0','2.0.0'], single: ['9'] }`). A bare
 * swap would therefore have turned every existing single-value read point on
 * the production adapter into an array. The `single`-key control case below is
 * the tripwire for exactly that: PR #6941 measured a bare, un-normalised
 * `queries()` at `4 failed | 2 passed`, failing with
 * `expected { single: ['9'] } to deeply equal { single: '9' }`. ⛔ Do not
 * weaken or delete the control case — it is the only assertion separating
 * "arrays on repeats" from "arrays on everything".
 *
 * ## Why this suite is the right home for it
 *
 * The node half was pinned before this file existed, but only ADAPTER-LOCALLY,
 * in `adapter.test.ts` ('routes :param and multi-value query', `?a=1&b=x&b=y`).
 * Nothing ran the same request against Hono, and no case in either
 * `describe.each(ADAPTERS)` suite (`conformance.integration.test.ts`,
 * `fallback-seam.conformance.test.ts`) repeated a parameter at all.
 *
 * Consumer-side tests do not cover it either: `packages/rest`'s
 * `package-routes-query-multiplicity.test.ts` (#6307) hand-constructs
 * `query: { version: [...] }` and drives the handler directly, so it asserts a
 * shape no adapter is obliged to produce. A hand-built double can produce
 * anything, which is precisely why that suite stayed green while the adapters
 * disagreed. These cases go over a real socket for that reason.
 *
 * ## What a future red here means
 *
 * A failure is no longer a reminder — it is a regression. Either an adapter
 * stopped honouring the convention, or a dependency bump changed how it parses
 * a query string. The rest-side gates that DEPEND on this convention being
 * live are #6877 (PR #7324 — 63 single-valued parameter slots that now refuse
 * repetition) and #7321 (PR #7386); they were landed BEFORE this flip precisely
 * so that arrays reaching production handlers meet a gate rather than a
 * `String(…)` coercion. Fix the adapter, do not relax these rows.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { IHttpRequest, Middleware, RouteHandler } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import { NodeHttpServer } from './adapter.js';

/** The `IHttpServer` surface these cases drive — one GET route, one socket. */
interface QueryProbeServer {
    get(path: string, handler: RouteHandler): void;
    use(pathOrHandler: string | Middleware, handler?: Middleware): void;
    listen(port: number): Promise<void>;
    close?(): Promise<void>;
    getPort(): number;
}

/**
 * The probe request, verbatim from #6878: one key repeated, one key single.
 * The single key is load-bearing — it separates "this adapter arrays repeats"
 * from "this adapter arrays everything".
 */
const PROBE_QUERY = 'version=1.0.0&version=2.0.0&single=9';

/**
 * The ONE shape every `IHttpServer` implementation must hand a handler for
 * `?${PROBE_QUERY}` — repeated key as an array in wire order, single key as a
 * plain string (#6878 route 2, ruled 2026-08-10).
 *
 * This constant replaced a per-adapter `measuredQuery` field, which is exactly
 * the collapse the previous revision's header prescribed for the day the fork
 * was decided. Its being shared is the assertion: there is no longer a place
 * for an adapter to record a shape of its own.
 */
const EXPECTED_QUERY: Record<string, string | string[]> = {
    version: ['1.0.0', '2.0.0'],
    single: '9',
};

type AdapterCase = {
    label: 'node' | 'hono';
    make: () => QueryProbeServer;
};

const ADAPTERS: AdapterCase[] = [
    {
        label: 'node',
        // `url.searchParams.getAll(key)`, kept as an array when length > 1.
        make: () => new NodeHttpServer(0),
    },
    {
        label: 'hono',
        // `c.req.queries()` through `readQuery(c)`, normalised by length.
        make: () => {
            const server = new HonoHttpServer(0);
            // The standard composed state `HonoServerPlugin.start()` produces —
            // same as the sibling fallback-seam suite. No case here issues an
            // unmatched request, but booting both adapters in the shape a
            // deployment actually serves keeps the comparison honest.
            server.installNotFoundSeam();
            return server;
        },
    },
];

/** Register `/probe` on `server`, capturing the `req` the adapter builds. */
function probeRoute(server: QueryProbeServer): { received: () => IHttpRequest | undefined } {
    let received: IHttpRequest | undefined;
    server.get('/probe', (req, res) => {
        received = req;
        res.status(200);
        res.json({ ok: true });
    });
    return { received: () => received };
}

/**
 * Register a middleware capturing the `req` the adapter builds for the
 * MIDDLEWARE seam — a different construction site from the route handler's on
 * both adapters, and on Hono a physically separate one (`adapter.ts` builds
 * `query` at the route-handler seam AND inside `installMiddlewareSeam()`).
 * Without this, half of route 2's two-point change is unpinned: flipping only
 * the handler seam would leave every `use()` middleware still reading a
 * collapsed first value, and every case above would stay green.
 */
function probeMiddleware(server: QueryProbeServer): { received: () => IHttpRequest | undefined } {
    let received: IHttpRequest | undefined;
    server.use((req, _res, next) => {
        received = req;
        return next();
    });
    return { received: () => received };
}

describe.each(ADAPTERS)(
    'repeated query parameter on $label adapter (#6878 route 2 — the platform convention)',
    ({ make }) => {
        const opened: QueryProbeServer[] = [];

        async function boot(server: QueryProbeServer): Promise<string> {
            await server.listen(0);
            opened.push(server);
            return `http://127.0.0.1:${server.getPort()}`;
        }

        afterEach(async () => {
            await Promise.all(opened.splice(0).map((s) => s.close?.()));
        });

        it('surfaces a repeated key as an array and a single key as a string', async () => {
            const server = make();
            const probe = probeRoute(server);
            const base = await boot(server);

            const res = await fetch(`${base}/probe?${PROBE_QUERY}`);
            expect(res.status).toBe(200);

            // Exact shape, not a subset, and the SHARED expectation — both the
            // repeated key and the single key are pinned, so a change to
            // either is visible on either adapter.
            expect(probe.received()?.query).toEqual(EXPECTED_QUERY);
        });

        it('leaves a single-valued key a plain string (the control)', async () => {
            // ⛔ Load-bearing, do not delete. Without this, "arrays on repeats"
            // and "arrays on everything" read identically — and the latter is
            // what an un-normalised `c.req.queries()` produces on the Hono
            // adapter. PR #6941 measured that mistake at `4 failed | 2 passed`,
            // failing here with `{ single: ['9'] }`. See the file header.
            const server = make();
            const probe = probeRoute(server);
            const base = await boot(server);

            await fetch(`${base}/probe?single=9`);
            expect(probe.received()?.query).toEqual({ single: '9' });
        });

        it('applies the same convention at the middleware seam', async () => {
            // The SECOND construction site. On Hono these are two independent
            // pieces of code (`adapter.ts`: the route-handler seam and
            // `installMiddlewareSeam()`), so a half-applied route 2 lands
            // exactly here and nowhere else.
            const server = make();
            const mw = probeMiddleware(server);
            probeRoute(server);
            const base = await boot(server);

            await fetch(`${base}/probe?${PROBE_QUERY}`);
            expect(mw.received()?.query).toEqual(EXPECTED_QUERY);
        });
    },
);

/**
 * The AGREEMENT, asserted in ONE place, side by side in a single test — so it
 * cannot be read as two unrelated per-adapter facts that happen to match.
 * This describe is the deliverable of #6878 route 2, and it replaces the
 * divergence describe the route-1 revision (PR #6941) put here.
 *
 * The per-adapter cases above already pin each adapter to `EXPECTED_QUERY`;
 * what this adds is the cross-adapter claim itself — two live servers, one
 * request shape, one answer — which is the sentence `packages/qa` exists to
 * defend ("everything registered through `IHttpServer` behaves the same on a
 * non-Hono server").
 */
describe('node ↔ hono: the repeated-parameter answer no longer depends on which server booted (#6878)', () => {
    const opened: QueryProbeServer[] = [];

    async function bootProbe(adapter: AdapterCase) {
        const server = adapter.make();
        const probe = probeRoute(server);
        await server.listen(0);
        opened.push(server);
        return { base: `http://127.0.0.1:${server.getPort()}`, probe };
    }

    afterEach(async () => {
        await Promise.all(opened.splice(0).map((s) => s.close?.()));
    });

    it('agrees on BOTH the single-valued key and the repeated one', async () => {
        const node = await bootProbe(ADAPTERS[0]);
        const hono = await bootProbe(ADAPTERS[1]);

        const [nodeRes, honoRes] = await Promise.all([
            fetch(`${node.base}/probe?${PROBE_QUERY}`),
            fetch(`${hono.base}/probe?${PROBE_QUERY}`),
        ]);
        expect(nodeRes.status).toBe(honoRes.status);

        const nodeQuery = node.probe.received()?.query;
        const honoQuery = hono.probe.received()?.query;

        // Same status, same route, same request — and now the same answer.
        expect(nodeQuery).toEqual(EXPECTED_QUERY);
        expect(honoQuery).toEqual(EXPECTED_QUERY);
        expect(
            honoQuery,
            'the adapters disagree on a repeated query parameter again — #6878 route 2 is ' +
            'the platform convention, so fix the adapter that drifted rather than relaxing ' +
            'this expectation',
        ).toEqual(nodeQuery);
    });

    it('hands a consumer the SAME operand on either adapter — the ambiguity is visible, not collapsed', async () => {
        // Why the shape agreement is not cosmetic: this is the read #6307
        // found on `DELETE /api/v1/packages/:id`, where a truthy single
        // `version` silently narrowed a destructive operation's scope. Before
        // route 2 the operand differed by server — `'1.0.0'` on Hono, an ARRAY
        // on node:http — and the consumer could not tell which it was running
        // on. Now both hand over the array, which is what lets the rest-side
        // gates from #6877 (PR #7324) refuse it with a 400 instead of coercing
        // it; a consumer that WANTS one value must now say so and reject the
        // repetition, rather than being handed a first value by the transport.
        const node = await bootProbe(ADAPTERS[0]);
        const hono = await bootProbe(ADAPTERS[1]);

        await Promise.all([
            fetch(`${node.base}/probe?${PROBE_QUERY}`),
            fetch(`${hono.base}/probe?${PROBE_QUERY}`),
        ]);

        const asOperand = (q: IHttpRequest['query'] | undefined) => q?.version;
        const nodeOperand = asOperand(node.probe.received()?.query);
        const honoOperand = asOperand(hono.probe.received()?.query);
        expect(Array.isArray(nodeOperand)).toBe(true);
        expect(Array.isArray(honoOperand)).toBe(true);
        expect(honoOperand).toEqual(nodeOperand);
    });
});
