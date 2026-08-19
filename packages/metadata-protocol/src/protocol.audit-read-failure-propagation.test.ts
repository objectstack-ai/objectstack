// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #9638 — `auditMetaItem`'s unqualified `catch` reported ANY failed audit read
// as `{ events: [] }`.
//
// The catch named two benign causes in its comment ("table not provisioned
// (legacy env) or driver doesn't expose `find`") and then took every OTHER
// cause with them: a connection drop, a permission denial, a malformed row, a
// query bug, a timeout. All of them reached the caller as the well-formed
// statement "this item has no audit entries".
//
// ADR-0110 D3 — a miss and a fault are different facts. This is the compliance
// surface: `auditMetaItem` is the read behind
// `GET /api/v1/meta/:type/:name/audit`, which exists so Studio's 审计日志 tab
// can show who tried what and whether a lock blocked it. An empty answer there
// reads as *nobody touched this item*.
//
// This file pins BOTH directions, because a method that raised unconditionally
// would satisfy the first half and destroy the documented feature:
//
//   • a NON-benign failure now propagates as 503 / SERVICE_UNAVAILABLE, which
//     the `/audit` route's existing `handleRouteError` turns into an honest
//     5xx (it reads `error.status`, `packages/rest/src/error-response.ts`);
//   • BOTH benign causes still answer `{ events: [] }`, verbatim.
//
// ⚠️ Anti-vacuity. An "it propagates" assertion is worthless if the assertions
// cannot see the difference between a populated trail and an empty one in the
// first place — this repo has been bitten by exactly that shape
// (`body.item.fields` vs `body.data.item.fields`). The POSITIVE CONTROL below
// reads a real row all the way through the mapping and asserts its fields, so
// every "empty" assertion in this file is known to be a measurement rather
// than a shape that could never have been non-empty.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** A protocol whose engine read fails with `error`. */
function protocolWhoseReadFails(error: unknown) {
    const find = vi.fn(async () => { throw error; });
    const engine = { registry: { getObject: () => undefined }, find };
    return { p: new ObjectStackProtocolImplementation(engine as any), find };
}

/** A protocol whose engine read succeeds, returning `rows`. */
function protocolReading(rows: any[]) {
    const find = vi.fn(async () => rows);
    const engine = { registry: { getObject: () => undefined }, find };
    return { p: new ObjectStackProtocolImplementation(engine as any), find };
}

const ITEM = { type: 'views', name: 'shared_grid' } as const;

/**
 * Capture the rejection, or fail loudly naming what was RESOLVED instead.
 *
 * Deliberately not a bare `.rejects.toThrow()`: that cannot separate "answered
 * with the wrong body" from "did not raise at all", and the wrong body — a
 * well-formed empty trail — *is* the defect. It also would not print the
 * `{ events: [] }` that makes a failure here self-explanatory.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<any> {
    let resolved: unknown;
    try {
        resolved = await promise;
    } catch (error) {
        return error;
    }
    throw new Error(
        `expected the read failure to propagate, but it RESOLVED with `
        + `${JSON.stringify(resolved)} — the defect: a fault disguised as an empty audit trail`,
    );
}

describe('#9638 auditMetaItem: a failed audit read is a fault, not an empty trail', () => {
    // ── The propagating half ────────────────────────────────────────────────
    //
    // Three flavours, because the old catch was unqualified and each of these
    // means "the rows may well exist and simply were not seen".
    const nonBenign: Array<[string, Error]> = [
        ['a connection drop', new Error('connect ECONNREFUSED 127.0.0.1:5432')],
        ['a permission denial', new Error('permission denied for table sys_metadata_audit')],
        ['a timeout', new Error('query timeout after 30000ms')],
    ];

    it.each(nonBenign)(
        '⭐ THE PIN — %s propagates as 503 SERVICE_UNAVAILABLE instead of `{ events: [] }`',
        async (_label, driverError) => {
            const { p } = protocolWhoseReadFails(driverError);

            const error = await rejectionOf(p.auditMetaItem({ ...ITEM }));

            // ADR-0112: `code` AND `status` together. `status` alone would pass
            // for any 5xx and `code` alone carries no HTTP verdict, and it is
            // the PAIR the REST boundary reads.
            expect(error.code).toBe('SERVICE_UNAVAILABLE');
            expect(error.status).toBe(503);
        },
    );

    it('the driver error rides as `cause`, so the operator still sees what actually broke', async () => {
        const driverError = new Error('connect ECONNREFUSED 127.0.0.1:5432');
        const { p } = protocolWhoseReadFails(driverError);

        const error = await rejectionOf(p.auditMetaItem({ ...ITEM }));

        // Not the driver error itself: unwrapped it has no `status`, so the
        // REST boundary would have to guess from message text — and
        // `mapDataError` guesses `no such table` back into a 404 miss.
        expect(error.cause).toBe(driverError);
    });

    it('503 is a status `handleRouteError` turns into a 5xx — not a 2xx and not a client error', async () => {
        const { p } = protocolWhoseReadFails(new Error('query timeout after 30000ms'));

        const error = await rejectionOf(p.auditMetaItem({ ...ITEM }));

        // The route's catch passes this straight to `handleRouteError`, which
        // reads `error.status` in the 400-599 band. Pinning the band is what
        // makes "an honest 5xx" a checkable claim at this layer.
        expect(error.status).toBeGreaterThanOrEqual(500);
        expect(error.status).toBeLessThan(600);
    });

    // ── The benign half — both causes the old comment named ─────────────────

    it.each([
        ['sqlite', 'no such table: sys_metadata_audit'],
        ['sqlite, driver-prefixed', 'SQLITE_ERROR: no such table: sys_metadata_audit'],
        ['postgres', 'relation "sys_metadata_audit" does not exist'],
        ['mysql', "Table 'db.sys_metadata_audit' doesn't exist"],
    ])(
        'BENIGN 1/2 — an unprovisioned table (%s) still answers `{ events: [] }`',
        async (_dialect, message) => {
            const { p } = protocolWhoseReadFails(new Error(message));

            // The documented promise, kept exactly as documented: a legacy
            // install prior to ADR-0010 has genuinely no rows, so the empty
            // answer IS the truth and a first boot must not explode.
            await expect(p.auditMetaItem({ ...ITEM })).resolves.toEqual({ events: [] });
        },
    );

    it('BENIGN 2/2 — a host engine exposing no `find` still answers `{ events: [] }`', async () => {
        // `MetadataHostEngine` carries `[key: string]: any`, so a metadata-only
        // store or a partial double with no `find` satisfies the type.
        const engine = { registry: { getObject: () => undefined } };
        const p = new ObjectStackProtocolImplementation(engine as any);

        await expect(p.auditMetaItem({ ...ITEM })).resolves.toEqual({ events: [] });
    });

    it('the missing-`find` answer is decided BEFORE the read, not by classifying a TypeError', async () => {
        // Why this matters: a missing method raises `TypeError: … is not a
        // function`, and the ONLY thing separating that from a genuine
        // TypeError raised INSIDE a real driver's `find` (a null deref on a
        // malformed row — an actual fault) is the V8 message text. Classifying
        // it in the catch would re-open the fail-open this card closes. So the
        // capability is asked as a precondition, and a driver that DOES have
        // `find` and throws a TypeError is a fault.
        const { p } = protocolWhoseReadFails(
            new TypeError("Cannot read properties of undefined (reading 'occurred_at')"),
        );

        const error = await rejectionOf(p.auditMetaItem({ ...ITEM }));

        expect(error.code).toBe('SERVICE_UNAVAILABLE');
        expect(error.status).toBe(503);
    });

    // ── Anti-vacuity ────────────────────────────────────────────────────────

    it('POSITIVE CONTROL — a real row maps through, so "empty" above is a measurement', async () => {
        const { p, find } = protocolReading([{
            id: 'evt_1',
            occurred_at: '2026-08-18T10:00:00.000Z',
            actor: 'alice',
            source: 'studio',
            operation: 'save',
            outcome: 'denied',
            code: 'METADATA_LOCKED',
            lock_state: 'locked',
            lock_overridden: false,
            request_id: 'req_7',
            note: 'blocked by package lock',
        }]);

        const result = await p.auditMetaItem({ ...ITEM });

        // If this file's assertions could not tell a populated trail from an
        // empty one, THIS is the case that would fail — which is exactly why
        // it is here rather than assumed.
        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({
            id: 'evt_1',
            actor: 'alice',
            operation: 'save',
            outcome: 'denied',
            code: 'METADATA_LOCKED',
            lockState: 'locked',
            lockOverridden: false,
            requestId: 'req_7',
            note: 'blocked by package lock',
        });
        expect(find).toHaveBeenCalledTimes(1);
    });

    it('⭐ a genuine zero-row read and a FAULT are no longer the same answer', async () => {
        // The equivalence the defect created, stated as one assertion. A read
        // that succeeded and found nothing is the empty trail; a read that
        // failed is not an answer at all.
        const { p: readEmpty } = protocolReading([]);
        await expect(readEmpty.auditMetaItem({ ...ITEM })).resolves.toEqual({ events: [] });

        const { p: readBroke } = protocolWhoseReadFails(
            new Error('connect ECONNREFUSED 127.0.0.1:5432'),
        );
        const error = await rejectionOf(readBroke.auditMetaItem({ ...ITEM }));
        expect(error.status).toBe(503);
    });
});
