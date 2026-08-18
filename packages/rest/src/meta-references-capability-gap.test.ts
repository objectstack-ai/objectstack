// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9326] `GET /meta/:type/:name/references` — a MISSING capability is not an
 * EMPTY reference list.
 *
 * ## The defect
 *
 * The handler feature-detects `findReferencesToMeta` on the resolved protocol
 * and, when it is absent, used to answer:
 *
 * ```ts
 * res.json({ references: [] })
 * ```
 *
 * That is ADR-0110 D3 collapsed — *a miss and a fault are different facts*.
 * The two conditions it merged are:
 *
 *   1. the graph WAS walked and nothing points at this item, and
 *   2. the graph could not be walked at all, because this deployment's
 *      protocol has no such method.
 *
 * They arrived on the wire as the same `200 { references: [] }`, so no consumer
 * could tell them apart. The consumer is the admin "Used by" panel, whose empty
 * state reads, verbatim from `objectui`'s `metadata-admin/i18n.ts`:
 *
 * ```
 * 'engine.edit.refsEmptyDesc': 'Nothing in the metadata graph points at this item. Safe to delete.'
 * ```
 *
 * — shown to an operator about to delete something, on a deployment where the
 * question was never actually asked.
 *
 * ## Why the fix is a refusal at the route
 *
 * `findReferencesToMeta` is NOT a member of `RestProtocol`
 * (`= DataProtocol & MetadataProtocol`); it is not declared anywhere in
 * `packages/spec` at all. It is an ADR-0076 D9 server-only extension, which is
 * why the handler reaches it through a runtime cast rather than a typed call.
 * A host that implements the DECLARED contract exactly is therefore a
 * CONFORMING deployment that lands on this branch with no type error — which is
 * what makes the branch worth answering honestly rather than asserting away at
 * boot. Promoting an undeclared optional extension into a required one is a
 * `packages/spec` contract decision and is deliberately not taken here.
 *
 * ## What these cases assert, and why not `toThrow`
 *
 * This handler *sends*, it never throws, so a `toThrow`-shaped assertion could
 * not separate "answered with the wrong body" from "did not refuse at all" —
 * and the wrong body IS the defect. Every case asserts the ADR-0112 pair,
 * `status` AND `body.error.code`, at the **nested** position (#7035), plus the
 * load-bearing one this file exists for: the capability gap and a genuine zero
 * do not produce the same answer.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer } from './rest-server.js';

const REFERENCES_PATH = '/api/v1/meta/:type/:name/references';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(),
    };
    return res;
}

/**
 * The read side every `/meta` route needs to register, and nothing more. The
 * `findReferencesToMeta` slot is filled by the caller precisely because its
 * presence or ABSENCE is the whole variable under test — anything else this
 * stub gained would weaken what the cases below prove.
 */
function baseProtocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'account', item: {}, lock: 'none' }),
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
    };
}

function boot(protocol: Record<string, unknown>) {
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    // `isSystem` clears the capability gates that fire before the protocol is
    // probed, so the request reaches the branch under test.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true });
    rest.registerRoutes();

    const found = (rest as any).getRoutes().find(
        (r: any) => r.method === 'GET' && r.path === REFERENCES_PATH,
    );
    if (!found) throw new Error(`route not registered: GET ${REFERENCES_PATH}`);

    return async () => {
        const res = mockRes();
        await found.handler(
            { query: {}, headers: {}, body: {}, params: { type: 'object', name: 'account' } },
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
}

/** A protocol that CAN walk the graph and found nothing. The honest empty. */
const answersEmpty = () => boot({
    ...baseProtocol(),
    findReferencesToMeta: vi.fn().mockResolvedValue({ references: [] }),
});

/** A protocol with no such method. The capability gap. */
const hasNoCapability = () => boot(baseProtocol());

/** A protocol that CAN walk the graph and found something. */
const answersHits = () => boot({
    ...baseProtocol(),
    findReferencesToMeta: vi.fn().mockResolvedValue({
        references: [{ type: 'view', name: 'account_list', path: 'object' }],
    }),
});

describe('#9326 — a missing `findReferencesToMeta` is refused, not answered as "nothing depends on this item"', () => {
    it('an absent capability answers 501 NOT_IMPLEMENTED at the ADR-0112 nested position', async () => {
        const answer = await hasNoCapability()();

        expect(answer.status).toBe(501);
        // The pair ADR-0112 declares. `body.error.code` — NESTED, because the
        // flat-sibling position is what makes `error.code` read `undefined`
        // (#7035).
        expect(answer.body?.error?.code).toBe('NOT_IMPLEMENTED');
        expect(answer.body?.error?.message).toBe(
            'protocol.findReferencesToMeta() is not available in this kernel',
        );
        // Dialect 1 retired: `code` as a sibling of `error`.
        expect(answer.body).not.toHaveProperty('code');
        // Dialect 2 retired: `error` as a bare string.
        expect(typeof answer.body?.error).toBe('object');
    });

    it('⭐ THE PIN — the capability gap and a genuine zero are not the same answer', async () => {
        // This is the whole defect in one assertion. Both of these used to be
        // `200 { references: [] }`, so a consumer had no way to ask which one it
        // was holding. If a future edit re-merges them — by restoring the empty
        // body, or by teaching the honest-empty path to 501 — exactly one of the
        // three expectations below goes red.
        const gap = await hasNoCapability()();
        const genuineZero = await answersEmpty()();

        expect(gap.status).not.toBe(genuineZero.status);
        expect(gap.body).not.toEqual(genuineZero.body);
        // And the direction, so "different" cannot be satisfied by breaking the
        // healthy side instead of fixing the broken one.
        expect(genuineZero.status).toBe(200);
        expect(genuineZero.body).toEqual({ references: [] });
    });

    it('a protocol that CAN answer is untouched — empty and non-empty both pass through verbatim', async () => {
        // The refusal is scoped to the capability probe and nothing else: this
        // route's success path is the same one it always had. Without this case
        // the pin above could be satisfied by a route that refuses more often
        // than it should.
        const zero = await answersEmpty()();
        expect(zero.status).toBe(200);
        expect(zero.body).toEqual({ references: [] });

        const hits = await answersHits()();
        expect(hits.status).toBe(200);
        expect(hits.body).toEqual({
            references: [{ type: 'view', name: 'account_list', path: 'object' }],
        });
    });

    it('the refusal is machine-readable by the SAME read as its `/meta` 501 siblings', async () => {
        // `err.error.code` is the one position ADR-0112 declares, and #7035
        // converged the `/meta` write refusals onto it. A consumer written
        // against those reads this one with no second branch — which is the
        // property that makes the refusal usable rather than merely loud.
        const answer = await hasNoCapability()();
        expect(answer.body?.error?.code).toBe('NOT_IMPLEMENTED');
        expect(typeof answer.body?.error?.message).toBe('string');
        // Not an empty-collection body under any spelling: the shapes a client
        // might reasonably probe for a "no references" answer are all absent.
        expect(answer.body).not.toHaveProperty('references');
        expect(answer.body).not.toHaveProperty('items');
    });
});
