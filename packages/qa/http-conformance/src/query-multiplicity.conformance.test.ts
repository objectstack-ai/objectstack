// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A REPEATED query parameter — cross-adapter conformance (#6878, route 1).
 *
 * ## What this file is, and what it deliberately is NOT
 *
 * It is a **divergence record**, not a contract. The two `IHttpServer`
 * implementations hand a handler two DIFFERENT `req.query` shapes for one and
 * the same request, and **both are legal today**: the contract in
 * `packages/spec/src/contracts/http-server.ts` declares
 * `query: Record<string, string | string[]>`, and a repeated key landing on
 * either arm of that union satisfies it. Neither adapter has a bug here.
 *
 * So this file does NOT assert one unified answer. There isn't one. Asserting
 * one would be encoding a wish — and worse, it would settle #6878's open
 * contract question through the back door of a test file. Each adapter row
 * below carries the shape that adapter was **measured** to produce, and the
 * last describe states the disagreement out loud.
 *
 * ## The measurement (re-taken for this PR, not copied from the card)
 *
 * Measured 2026-08-09 on `origin/main` @ 9d425a94d, hono@4.12.34 resolved,
 * over a real socket through the same public entry points as production:
 *
 *     GET /probe?version=1.0.0&version=2.0.0&single=9
 *
 *     [NodeHttpServer]  { version: ['1.0.0', '2.0.0'], single: '9' }   // array
 *     [HonoHttpServer]  { version: '1.0.0',            single: '9' }   // first value
 *
 *  - `NodeHttpServer` (this package's reference adapter, `./adapter.ts`) reads
 *    `url.searchParams.getAll(key)` and keeps the array when `length > 1`.
 *  - `HonoHttpServer` (`plugin-hono-server/src/adapter.ts`) reads
 *    `c.req.query()`, which yields the FIRST value per key. It has two such
 *    construction sites — the route handler seam and the `use()` middleware
 *    seam — so both must move together whenever #6878 is decided.
 *
 * ## Why the gap existed until now
 *
 * The node half was already pinned, but only ADAPTER-LOCALLY, in
 * `adapter.test.ts` ('routes :param and multi-value query', `?a=1&b=x&b=y`).
 * Nothing ran the same request against Hono, and no case in either
 * `describe.each(ADAPTERS)` suite (`conformance.integration.test.ts`,
 * `fallback-seam.conformance.test.ts`) repeated a parameter at all. The one
 * place the adapters visibly disagree was therefore the one place this package
 * — whose entire purpose is "everything registered through `IHttpServer`
 * behaves the same on a non-Hono server" — was not looking.
 *
 * Consumer-side tests do not close that gap either: `packages/rest`'s
 * `package-routes-query-multiplicity.test.ts` (#6307) hand-constructs
 * `query: { version: [...] }` and drives the handler directly, so it asserts a
 * shape that no adapter is obliged to produce. A hand-built double can produce
 * anything, which is precisely why the suite was green.
 *
 * ## THIS FILE IS EXPECTED TO GO RED — on purpose — when #6878 is decided
 *
 * #6878 offers three dispositions; route 1 (this file) pins the divergence as
 * KNOWN without removing it. If route 2 lands ("a repeated parameter is always
 * an array": Hono switches to `c.req.queries()` normalised by `length`) or
 * route 3 lands ("always single, first value wins": node collapses), the rows
 * below stop matching and the divergence describe fails. That red is the
 * REMINDER, not a regression: collapse the per-adapter `measuredQuery` rows
 * into one shared expectation and delete the divergence describe.
 *
 * One datum for that decision, gathered here: the `single` key is a control.
 * On hono@4.12.34, `c.req.queries()` returns an array for EVERY key
 * (`{ version: ['1.0.0','2.0.0'], single: ['9'] }`), so route 2 cannot be a
 * bare swap — without the `length` normalisation, `single` would arrive as
 * `['9']` and this file's node/hono agreement on single-valued keys, asserted
 * below, is what would catch it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { IHttpRequest, RouteHandler } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import { NodeHttpServer } from './adapter.js';

/** The `IHttpServer` surface these cases drive — one GET route, one socket. */
interface QueryProbeServer {
    get(path: string, handler: RouteHandler): void;
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

type AdapterCase = {
    label: 'node' | 'hono';
    make: () => QueryProbeServer;
    /**
     * The shape this adapter was MEASURED to hand the handler for
     * `?${PROBE_QUERY}` — recorded, not chosen. See the file header: both
     * shapes satisfy `IHttpRequest.query` today, and which one is "right" is
     * exactly what #6878 has not decided yet.
     */
    measuredQuery: Record<string, string | string[]>;
};

const ADAPTERS: AdapterCase[] = [
    {
        label: 'node',
        make: () => new NodeHttpServer(0),
        // `url.searchParams.getAll(key)`, kept as an array when length > 1.
        measuredQuery: { version: ['1.0.0', '2.0.0'], single: '9' },
    },
    {
        label: 'hono',
        make: () => {
            const server = new HonoHttpServer(0);
            // The standard composed state `HonoServerPlugin.start()` produces —
            // same as the sibling fallback-seam suite. No case here issues an
            // unmatched request, but booting both adapters in the shape a
            // deployment actually serves keeps the comparison honest.
            server.installNotFoundSeam();
            return server;
        },
        // `c.req.query()`, which yields the first value per key.
        measuredQuery: { version: '1.0.0', single: '9' },
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

describe.each(ADAPTERS)(
    'repeated query parameter on $label adapter (#6878 — divergence record, not a contract)',
    ({ make, measuredQuery }) => {
        const opened: QueryProbeServer[] = [];

        async function boot(server: QueryProbeServer): Promise<string> {
            await server.listen(0);
            opened.push(server);
            return `http://127.0.0.1:${server.getPort()}`;
        }

        afterEach(async () => {
            await Promise.all(opened.splice(0).map((s) => s.close?.()));
        });

        it('hands the handler its measured query shape, over a real socket', async () => {
            const server = make();
            const probe = probeRoute(server);
            const base = await boot(server);

            const res = await fetch(`${base}/probe?${PROBE_QUERY}`);
            expect(res.status).toBe(200);

            // Exact shape, not a subset: this is the record of what this
            // adapter does TODAY. Both the repeated key and the single key
            // are pinned, so a change to either is visible.
            expect(probe.received()?.query).toEqual(measuredQuery);
        });

        it('leaves a single-valued key a plain string (the control)', async () => {
            // Without this, "arrays on repeats" and "arrays on everything"
            // read identically — and they are different adapters' futures
            // under #6878 route 2. See the file header.
            const server = make();
            const probe = probeRoute(server);
            const base = await boot(server);

            await fetch(`${base}/probe?single=9`);
            expect(probe.received()?.query).toEqual({ single: '9' });
        });
    },
);

/**
 * The divergence itself, asserted in ONE place so it cannot be read as two
 * unrelated per-adapter facts. This describe is the deliverable of #6878
 * route 1: the platform's answer to a repeated query parameter currently
 * depends on which server booted, and from here on a gate says so.
 *
 * It fails the day the two adapters agree — see the file header for why that
 * red is the intended alarm and what to do about it.
 */
describe('node ↔ hono: the repeated-parameter answer depends on which server booted (#6878)', () => {
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

    it('agrees on a single-valued key and DISAGREES on a repeated one', async () => {
        const node = await bootProbe(ADAPTERS[0]);
        const hono = await bootProbe(ADAPTERS[1]);

        const [nodeRes, honoRes] = await Promise.all([
            fetch(`${node.base}/probe?${PROBE_QUERY}`),
            fetch(`${hono.base}/probe?${PROBE_QUERY}`),
        ]);
        expect(nodeRes.status).toBe(honoRes.status);

        const nodeQuery = node.probe.received()?.query;
        const honoQuery = hono.probe.received()?.query;

        // Same status, same route, same request — and not the same answer.
        expect(nodeQuery?.single).toBe('9');
        expect(honoQuery?.single).toBe('9');
        expect(nodeQuery?.version).toEqual(['1.0.0', '2.0.0']);
        expect(honoQuery?.version).toBe('1.0.0');
        expect(
            nodeQuery?.version,
            'the adapters now AGREE on a repeated query parameter — #6878 route 2/3 has ' +
            'presumably landed, so collapse the per-adapter `measuredQuery` rows into one ' +
            'shared expectation and delete this describe',
        ).not.toEqual(honoQuery?.version);
    });

    it('a consumer reading the FIRST value gets a different operand on each adapter', async () => {
        // Why the shape difference is not cosmetic: this is the read #6307
        // found on `DELETE /api/v1/packages/:id`, where a truthy `version`
        // silently narrows a destructive operation's scope. Same request, two
        // operands — `'1.0.0'` on Hono, an ARRAY on node:http — and the
        // consumer cannot tell which server it is running on.
        const node = await bootProbe(ADAPTERS[0]);
        const hono = await bootProbe(ADAPTERS[1]);

        await Promise.all([
            fetch(`${node.base}/probe?${PROBE_QUERY}`),
            fetch(`${hono.base}/probe?${PROBE_QUERY}`),
        ]);

        const asOperand = (q: IHttpRequest['query'] | undefined) => q?.version;
        expect(typeof asOperand(hono.probe.received()?.query)).toBe('string');
        expect(Array.isArray(asOperand(node.probe.received()?.query))).toBe(true);
    });
});
