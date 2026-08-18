// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9426] `GET /meta/:type/:name/audit` — a MISSING capability is not an EMPTY
 * audit trail.
 *
 * ## The defect
 *
 * The handler feature-detects `auditMetaItem` on the resolved protocol and,
 * when it is absent, used to answer:
 *
 * ```ts
 * res.json({ events: [] })
 * ```
 *
 * That is ADR-0110 D3 collapsed — *a miss and a fault are different facts*.
 * The two conditions it merged are:
 *
 *   1. the audit trail WAS read and this item has no entries, and
 *   2. the trail could not be read at all, because this deployment's protocol
 *      has no such method.
 *
 * They arrived on the wire as the same `200 { events: [] }`, so no consumer
 * could tell them apart — and the consumer here is a COMPLIANCE surface. The
 * route's own comment says it exists so Studio's "审计日志 / Audit log" tab can
 * show "who tried what and whether a lock blocked it". An empty answer there
 * reads as *nobody touched this item*, which is exactly the claim a compliance
 * reader must not be given on false pretenses.
 *
 * ## The third state that is NOT this card, and is measured to be separate
 *
 * The route's header comment also promises "Empty array on environments where
 * the table is not yet provisioned". That is a DIFFERENT condition, and it
 * lives one layer down: `ObjectStackProtocolImplementation.auditMetaItem`
 * (`packages/metadata-protocol/src/protocol.ts`) wraps its read in a `try` and
 * returns `{ events: [] }` from the `catch` after a `console.warn`. That path
 * requires the method to EXIST and to be CALLED; this route's branch returns
 * BEFORE the call. Separate frames, separate packages, no conflation — which is
 * why the refusal below leaves the unprovisioned-table answer untouched, and
 * why `answersEmpty` (a protocol that HAS the method and returns no events —
 * exactly what an unprovisioned table produces downstream) must stay `200`.
 * That case is not decoration: it is the half a regression does not redden.
 *
 * ## Why the fix is a refusal at the route
 *
 * `auditMetaItem` is NOT a member of `RestProtocol`
 * (`= DataProtocol & MetadataProtocol`); it is not declared anywhere in
 * `packages/spec` at all. It is an ADR-0076 D9 server-only extension, which is
 * why the handler reaches it through a runtime cast rather than a typed call.
 * A host that implements the DECLARED contract exactly is therefore a
 * CONFORMING deployment that lands on this branch with no type error — which is
 * what makes the branch worth answering honestly rather than asserting away at
 * boot. Promoting an undeclared optional extension into a required one is a
 * `packages/spec` contract decision and is deliberately not taken here. Same
 * reasoning, same shape, as PR #9425 landed one route over (#9326).
 *
 * ## What these cases assert, and why not `toThrow`
 *
 * This handler *sends*, it never throws, so a `toThrow`-shaped assertion could
 * not separate "answered with the wrong body" from "did not refuse at all" —
 * and the wrong body IS the defect. Every case asserts the ADR-0112 pair,
 * `status` AND `body.error.code`, at the **nested** position (#7035).
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer } from './rest-server.js';

const AUDIT_PATH = '/api/v1/meta/:type/:name/audit';

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
        send: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any) { return this; }),
    };
    return res;
}

/**
 * The read side every `/meta` route needs to register, and nothing more. The
 * `auditMetaItem` slot is filled by the caller precisely because its presence
 * or ABSENCE is the whole variable under test — anything else this stub gained
 * would weaken what the cases below prove.
 */
function baseProtocol() {
    return {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
    };
}

function boot(protocol: Record<string, unknown>) {
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    // A RESOLVABLE execution context. Measured in #8747's pin on this same
    // route: an `undefined` context is refused by the anonymous floor
    // (`enforceAuth`) with a 401 BEFORE the handler body runs, so the branch
    // under test would never be reached.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', tenantId: 'org_alpha' });
    rest.registerRoutes();

    const found = (rest as any).getRoutes().find(
        (r: any) => r.method === 'GET' && r.path === AUDIT_PATH,
    );
    if (!found) throw new Error(`route not registered: GET ${AUDIT_PATH}`);

    return async () => {
        const res = mockRes();
        await found.handler(
            {
                method: 'GET',
                path: AUDIT_PATH,
                params: { type: 'views', name: 'shared_grid' },
                query: {},
                headers: {},
                body: {},
            },
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
}

/**
 * A protocol that CAN read the trail and found nothing. The honest empty — and
 * also, verbatim, what an unprovisioned table produces one layer down.
 */
const answersEmpty = () => boot({
    ...baseProtocol(),
    auditMetaItem: vi.fn().mockResolvedValue({ events: [] }),
});

/** A protocol with no such method. The capability gap. */
const hasNoCapability = () => boot(baseProtocol());

const A_DENIED_SAVE = {
    id: 'evt_1',
    occurredAt: '2026-08-18T00:00:00.000Z',
    actor: 'u1',
    source: 'studio',
    operation: 'save',
    outcome: 'denied',
    // adr0112-ok: D6b — persisted audit column, its own lowercase vocabulary
    code: 'item_locked',
    lockState: 'locked',
    lockOverridden: false,
    requestId: 'req_1',
    note: null,
};

/** A protocol that CAN read the trail and found an entry. */
const answersEvents = () => boot({
    ...baseProtocol(),
    auditMetaItem: vi.fn().mockResolvedValue({ events: [A_DENIED_SAVE] }),
});

describe('#9426 — a missing `auditMetaItem` is refused, not answered as "this item has no audit trail"', () => {
    it('an absent capability answers 501 NOT_IMPLEMENTED at the ADR-0112 nested position', async () => {
        const answer = await hasNoCapability()();

        expect(answer.status).toBe(501);
        // The pair ADR-0112 declares. `body.error.code` — NESTED, because the
        // flat-sibling position is what makes `error.code` read `undefined`
        // (#7035), and it is also the dialect `check:route-envelope` counts
        // shrink-only on this file.
        expect(answer.body?.error?.code).toBe('NOT_IMPLEMENTED');
        expect(answer.body?.error?.message).toBe(
            'protocol.auditMetaItem() is not available in this kernel',
        );
        // Dialect 1 retired: `code` as a sibling of `error`.
        expect(answer.body).not.toHaveProperty('code');
        // Dialect 2 retired: `error` as a bare string.
        expect(typeof answer.body?.error).toBe('object');
    });

    it('⭐ THE PIN — the capability gap and a genuine zero are not the same answer', async () => {
        // This is the whole defect in one assertion. Both of these used to be
        // `200 { events: [] }`, so a compliance reader had no way to ask which
        // one it was holding. If a future edit re-merges them — by restoring the
        // empty body, or by teaching the honest-empty path to 501 — exactly one
        // of the expectations below goes red.
        const gap = await hasNoCapability()();
        const genuineZero = await answersEmpty()();

        expect(gap.status).not.toBe(genuineZero.status);
        expect(gap.body).not.toEqual(genuineZero.body);
        // And the direction, so "different" cannot be satisfied by breaking the
        // healthy side instead of fixing the broken one.
        expect(genuineZero.status).toBe(200);
        expect(genuineZero.body).toEqual({ events: [] });
    });

    it('a protocol that CAN answer is untouched — the empty trail and a real entry both pass through verbatim', async () => {
        // The refusal is scoped to the capability probe and nothing else. Without
        // this case the pin above could be satisfied by a route that refuses more
        // often than it should — and the empty half is specifically the
        // unprovisioned-table answer the route's header comment promises, which
        // is produced one layer down and must survive this change untouched.
        const zero = await answersEmpty()();
        expect(zero.status).toBe(200);
        expect(zero.body).toEqual({ events: [] });

        const events = await answersEvents()();
        expect(events.status).toBe(200);
        expect(events.body).toEqual({ events: [A_DENIED_SAVE] });
    });

    it('the refusal is machine-readable by the SAME read as its `/meta` 501 siblings', async () => {
        // `err.error.code` is the one position ADR-0112 declares, and #7035
        // converged the `/meta` refusals onto it. A consumer written against
        // those reads this one with no second branch — which is the property
        // that makes the refusal usable rather than merely loud.
        const answer = await hasNoCapability()();
        expect(answer.body?.error?.code).toBe('NOT_IMPLEMENTED');
        expect(typeof answer.body?.error?.message).toBe('string');
        // Not an empty-collection body under any spelling: the shapes a client
        // might reasonably probe for a "no audit entries" answer are all absent,
        // so nothing downstream can render this as a clean compliance record.
        expect(answer.body).not.toHaveProperty('events');
        expect(answer.body).not.toHaveProperty('items');
    });
});
