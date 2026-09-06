// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15685 — `GET /api/v1/meta/:type/:name/references` can refuse in two ways,
// and until this file the two answers agreed on neither the envelope nor the
// message. Measured on one boot, through the REAL route:
//
//   A  the protocol cannot answer for this TARGET type (#9327, `field`)
//      501 {"error":"Internal server error","code":"NOT_IMPLEMENTED"}
//   B  the resolved kernel has no `findReferencesToMeta` at all (#9326)
//      501 {"error":{"code":"NOT_IMPLEMENTED","message":"protocol.findReferencesToMeta() is not available in this kernel"}}
//
// ── What the divergence COST, which is why this is pinned at the wire ──────
//
// This door backs the admin "Used by" panel, whose empty case renders "Nothing
// in the metadata graph points at this item. Safe to delete." to an operator
// whose next click is a delete. ADR-0110 D3 (#8896) exists so that "the
// question was never asked" is never answered as "nothing depends on it", and
// A's message is the half that steers the operator away from the first reading
// — `findReferencesToMeta` says so in as many words ("The message is
// prescriptive per ADR-0110 D3: it names the answerable question"). It names
// the question that IS answerable: ask the owning OBJECT. On the wire that
// instruction had been replaced by "Internal server error".
//
// Second, `body.error.code` read on B and `undefined` on A — and the door's own
// comment on the B branch warns against exactly that dialect ("never the
// bare-string or sibling-`code` dialects, which make `body.error.code` read
// `undefined`"). One route was violating its own written rule at its other
// exit.
//
// ── Why this file exists rather than another assertion in the org-scope pin ─
//
// `rest-server-meta-read-org-scope.test.ts` already drives this route's #9327
// refusal — and reads the code through BOTH dialects on purpose, so it is GREEN
// under either shape. That is correct for what it measures (the refusal's code
// and status survive a SCOPE repair) and useless as a red/green criterion for
// this one. The two facts below are not that file's subject, and they need a
// boot WITHOUT `findReferencesToMeta` beside a boot with it, which its harness
// does not build. So: a file of its own, and the assertions are POSITIONAL —
// `body.error.code`, `body.error.message` — because position is half the
// finding.

import { describe, it, expect } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';

/** The unanswerable target (#9327) and an answerable one, for the control. */
const UNANSWERABLE_TARGET = 'field';
const UNANSWERABLE_NAME = 'account.owner';
const ANSWERABLE_TARGET = 'object';

function mockRes() {
    const res: any = { statusCode: 200, _body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: any) => { res._body = b; return res; };
    res.send = (b: any) => { res._body = b; return res; };
    res.header = () => res;
    res.setHeader = () => res;
    res.end = () => res;
    return res;
}

/**
 * The narrowest engine this route's reads bottom out on: every metadata lookup
 * answers "no rows". Deliberately empty rather than seeded — nothing below
 * asserts on reference CONTENT, and an empty store is what makes the
 * answerable-target control's `{ references: [] }` unambiguous.
 *
 * ⛔ READ-ONLY on purpose: no `delete`, `update` or `insert` member exists,
 * because nothing this file drives writes. A door that started writing here
 * would fail on the missing member rather than silently exercise a write double
 * nobody pinned — and this fixture therefore adds no new `delete()` double for
 * `check:engine-double-contract` to police.
 *
 * The `registry` member is not optional decoration: `getMetaItems` reads
 * `registry.listItems` on every source type the reference sweep walks, and an
 * engine without it answers 500 — which would have read as "the door refuses
 * answerable targets too", i.e. it would have silently voided the control this
 * fixture exists to provide.
 */
function emptyEngine(): any {
    return {
        find: async () => [],
        findOne: async () => null,
        count: async () => 0,
        aggregate: async () => [],
        registry: {
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
        },
    };
}

/**
 * One boot on the REAL route table. `mutate` is applied to the real protocol
 * before the routes are registered, which is how the two refusals and the
 * fault control are reached: by changing what the PRODUCER does, never by
 * stubbing the door.
 */
function boot(mutate: (protocol: any) => void = () => {}) {
    const protocol: any = new ObjectStackProtocolImplementation(emptyEngine(), () => new Map());
    protocol.getDiscovery = async () => ({
        version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
    });
    mutate(protocol);

    const rest = new RestServer(
        { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} } as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({
        userId: 'u1', systemPermissions: ['manage_metadata'], tenantId: 'org_alpha',
    });
    rest.registerRoutes();

    return async (type: string, name: string) => {
        const route = (rest as any).getRoutes().find(
            (r: any) => r.method === 'GET' && r.path === `${META}/:type/:name/references`,
        );
        if (!route) throw new Error('route not registered: GET /meta/:type/:name/references');
        const res = mockRes();
        let thrown: any;
        try {
            await route.handler(
                { method: 'GET', path: '', params: { type, name }, query: {}, headers: {}, body: {} } as any,
                res,
            );
        } catch (err) { thrown = err; }
        return { status: res.statusCode, body: res._body as any, thrown };
    };
}

/** Refusal A: the real protocol, asked for a target it cannot answer for. */
const refusalA = () => boot()(UNANSWERABLE_TARGET, UNANSWERABLE_NAME);

/** Refusal B: a kernel whose resolved protocol has no such method at all. */
const refusalB = () => boot((p) => { p.findReferencesToMeta = undefined; })(
    ANSWERABLE_TARGET, 'account',
);

describe('#15685 the /references door answers its two refusals in ONE envelope', () => {
    // ── anti-vacuity ──────────────────────────────────────────────────────
    //
    // Every assertion below is about a REFUSAL, so a door that refused
    // everything would satisfy them all. It does not:
    it('control — an ANSWERABLE target on the same harness still answers 200', async () => {
        const answered = await boot()(ANSWERABLE_TARGET, 'account');
        expect(answered.thrown, `the door threw: ${answered.thrown?.message}`).toBeUndefined();
        expect({ status: answered.status, body: answered.body }).toEqual({
            status: 200, body: { references: [] },
        });
    });

    // ── ① the prescription reaches the caller ─────────────────────────────
    describe('① refusal A keeps the prescriptive ADR-0110 D3 sentence', () => {
        it('names the answerable question instead of "Internal server error"', async () => {
            const refused = await refusalA();
            expect(refused.thrown, `the door threw: ${refused.thrown?.message}`).toBeUndefined();
            expect(refused.status).toBe(501);

            const message = refused.body?.error?.message;
            // The WHOLE point of the message: what to ask INSTEAD. Anchored on
            // the URL it prescribes, derived from the composite key's owner —
            // an operator can act on this sentence and on no other.
            expect(message).toContain(
                `Ask the owning object instead: GET /api/v1/meta/object/account/references`,
            );
            // And the fact the empty answer would have misreported, spelled out
            // rather than left to be inferred from a 501.
            expect(message).toContain('cannot be computed');

            // The direct statement of the regression, not merely its absence:
            // the generic fault text is what this used to be, everywhere in the
            // body, and it is gone.
            expect(JSON.stringify(refused.body)).not.toContain(INTERNAL_ERROR_MESSAGE);
        });

        it('control — the generic text really is what a withheld fault says', () => {
            // Without this, the assertion above could be passing because
            // `INTERNAL_ERROR_MESSAGE` is some string that never appears
            // anywhere. It is the exact text refusal A used to ship.
            expect(INTERNAL_ERROR_MESSAGE).toBe('Internal server error');
        });
    });

    // ── ② the code reads the same way on BOTH refusals ────────────────────
    describe('② `body.error.code` reads the same way on both refusals', () => {
        it('both are the ADR-0112 NESTED envelope, with the code in ONE place', async () => {
            const [a, b] = await Promise.all([refusalA(), refusalB()]);

            expect([a.status, b.status]).toEqual([501, 501]);
            // The positional claim, stated as ONE comparison so a repair that
            // fixed one exit and not the other cannot read as green.
            expect([a.body?.error?.code, b.body?.error?.code])
                .toEqual(['NOT_IMPLEMENTED', 'NOT_IMPLEMENTED']);
            // …and the sibling-`code` dialect the door's own comment names is
            // absent from BOTH, which is the other half of "one place".
            expect([a.body?.code, b.body?.code]).toEqual([undefined, undefined]);
            // Neither answers the bare-string dialect either.
            expect([typeof a.body?.error, typeof b.body?.error]).toEqual(['object', 'object']);
        });

        it('and each still carries its OWN message — converged envelope, not converged prose', async () => {
            const [a, b] = await Promise.all([refusalA(), refusalB()]);
            expect(b.body?.error?.message).toBe(
                'protocol.findReferencesToMeta() is not available in this kernel',
            );
            expect(a.body?.error?.message).not.toBe(b.body?.error?.message);
        });
    });

    // ── ③ the arm is a REFUSAL relay, not "5xx prose is public now" ───────
    describe('③ controls — a genuine fault is still withheld and still flat', () => {
        it('a producer-declared 503 keeps the withheld generic answer', async () => {
            // The `sys_metadata` outage class (#8896): `getMetaItems` raises it
            // through this same call, and its message can carry driver
            // internals. #5582/#11718 withhold it, and this repair must not
            // have widened that by a byte.
            const drive = boot((p) => {
                p.findReferencesToMeta = async () => {
                    throw Object.assign(
                        new Error('pg: connection to 10.0.0.7:5432 refused (password=hunter2)'),
                        { status: 503, code: 'SERVICE_UNAVAILABLE' },
                    );
                };
            });
            const refused = await drive(ANSWERABLE_TARGET, 'account');
            expect(refused.status).toBe(503);
            expect(refused.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'SERVICE_UNAVAILABLE' });
            expect(JSON.stringify(refused.body)).not.toContain('hunter2');
        });

        it('a 501 declaring a code this door does not publish stays on the fault terminal', async () => {
            // The stated boundary of the arm, pinned so it is a DECISION rather
            // than an accident: the re-dress is keyed to the one refusal code
            // this route publishes, which is also what keeps an unregistered
            // producer spelling (#9232) off the nested exit by construction.
            const drive = boot((p) => {
                p.findReferencesToMeta = async () => {
                    throw Object.assign(new Error('some other 501'), {
                        status: 501, code: 'SOMETHING_ELSE',
                    });
                };
            });
            const refused = await drive(ANSWERABLE_TARGET, 'account');
            expect(refused.status).toBe(501);
            expect(refused.body?.error).toBe(INTERNAL_ERROR_MESSAGE);
        });
    });
});
