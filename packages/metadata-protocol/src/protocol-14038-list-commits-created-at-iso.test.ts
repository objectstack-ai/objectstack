// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14038] `listCommits`'s declared return type says `createdAt?: string`,
 * but the mapping assigned the RAW driver value straight through:
 * `...(r.created_at ? { createdAt: r.created_at } : {})`. `rows` is `any[]`,
 * so tsc saw a `string` field and never checked it against what a driver
 * actually hands back.
 *
 * ## The defect
 *
 * `created_at` is an engine-injected audit column: it is not in
 * `datetimeFields`, and `SqlDriver#formatOutput` repairs it (both the
 * builtin-audit-column repair and the `datetimeFields` fold) only inside its
 * `if (this.isSqlite)` arm (`sql-driver.ts`, `formatOutput`). Postgres and
 * MySQL therefore hand this column out of the record read door as a JS
 * `Date`, while the SQLite family hands out canonical ISO-Z text — pinned
 * live in
 * `packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`.
 * So on the production default driver, `listCommits` handed every
 * in-process consumer a `Date` in a field the type says is a `string`.
 *
 * ## Why the fixture drives a hand-made `Date`
 *
 * `@objectstack/metadata-protocol` has no driver dependency and must not
 * grow one — the layering runs the other way, the same split
 * `sql-driver-13567-audit-stamp-materialisation.test.ts` documents. The
 * `Date` here is hand-made rather than read off a live driver, matching the
 * sibling `protocol.commit-timeline-instant-order.test.ts` (#13995) and the
 * #14037 family's own fixtures.
 *
 * ## Route: a narrow per-site conversion, NOT the shared `canonicalIsoInstant`
 *
 * #14037 took this exact route for its five sibling sites and deliberately
 * did NOT adopt `canonicalIsoInstant` (`sys-metadata-repository.ts` /
 * `database-loader.ts`), because #14078 measured an Invalid `Date` reachable
 * on BOTH live dialects (a MySQL zero datetime; any Postgres year in
 * 275760..294276) where that spelling's `value.toISOString()` raised
 * `RangeError`. #14078 has since ruled (option B, 2026-09-02) and that arm is
 * now total, answering `undefined` for the shape. This card's route is
 * unchanged: `isoFromValidDate` in `protocol.ts` converts the ONE measured
 * shape (a valid `Date`) and returns every other shape — including an Invalid
 * `Date` — UNCHANGED, which is what `listCommits` promises its callers. §D
 * below stays the pin on that promise: it goes red the moment anyone swaps
 * the other spelling into this site, now the separately-tracked consolidation
 * decision #16422.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Restoring the raw assignment (`createdAt: r.created_at`) turns §A red (the
 * emitted value is a `Date` instance, `typeof` is `'object'`, and
 * `JSON.stringify` — not `Date` equality — is what the old REST door hid
 * behind) while §B, §C and §D stay green: an already-canonical SQLite string
 * is unaffected by either spelling, and neither spelling converts an Invalid
 * `Date`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/** Canonical instant text — exactly what `Date.prototype.toISOString` emits. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The instant the live `Date`-materialising dialects hand back. Non-zero
 * milliseconds on purpose: `String(date)` / `date.toString()` both drop
 * them, so a truncating regression would stay observable rather than
 * coincide with the canonical text.
 */
const PG_INSTANT = new Date('2026-03-04T05:06:07.089Z');

/** What SQLite hands out for the same instant — already the declared shape. */
const SQLITE_TEXT = '2026-03-04T05:06:07.089Z';

/** A registry with nothing in it — the commit store is the only source here. */
function emptyRegistry() {
    return {
        getObject: () => undefined,
        getItem: () => undefined,
        listItems: () => [],
        applyNavContributions: (x: any) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
    };
}

/** One `sys_metadata_commit` row, in the driver's snake_case wire shape. */
function commitRow(createdAt: unknown) {
    return {
        id: 'cmt_1',
        package_id: 'pkg_crm',
        organization_id: null,
        operation: 'apply',
        message: 'commit 1',
        actor: 'alice',
        item_count: 1,
        items: JSON.stringify([{ type: 'object', name: 'acct', existedBefore: true, prevVersion: 3 }]),
        created_at: createdAt,
    };
}

/** An engine that answers the commit-store read out of `rows`. Read-only: `listCommits` never writes. */
function engineWithCommits(rows: any[]) {
    return {
        registry: emptyRegistry(),
        find: vi.fn(async () => rows),
        findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
            assertEngineFindOnePredicate(object, query);
            const id = (query as any)?.where?.id;
            return rows.find((r) => r.id === id) ?? null;
        }),
    } as any;
}

describe('[#14038] listCommits emits the ISO-8601 string createdAt is declared as', () => {
    describe('§A the `Date`-materialising dialects (Postgres, MySQL)', () => {
        it('canonicalises a JS `Date` to a canonical ISO-Z string', async () => {
            const p = new ObjectStackProtocolImplementation(engineWithCommits([commitRow(PG_INSTANT)]));

            // Non-vacuity guard: a fixture that silently degraded to a string
            // would keep this file green while measuring nothing.
            expect(PG_INSTANT).toBeInstanceOf(Date);

            const commits = await p.listCommits({ packageId: 'pkg_crm' });

            expect(commits).toHaveLength(1);
            expect(typeof commits[0]!.createdAt).toBe('string');
            expect(commits[0]!.createdAt).toMatch(ISO_Z);
            expect(commits[0]!.createdAt).toBe(PG_INSTANT.toISOString());
        });
    });

    describe('§B the ISO-text dialects (SQLite family, memory) are unaffected', () => {
        it('passes an already-canonical string through byte-identically', async () => {
            const p = new ObjectStackProtocolImplementation(engineWithCommits([commitRow(SQLITE_TEXT)]));

            const commits = await p.listCommits({ packageId: 'pkg_crm' });

            // Idempotent: the dialect that was already correct must not be reshaped.
            expect(commits[0]!.createdAt).toBe(SQLITE_TEXT);
        });
    });

    describe('§C an absent column stays absent', () => {
        it('omits `createdAt` rather than inventing a value', async () => {
            const row = commitRow(undefined);
            delete (row as any).created_at;
            const p = new ObjectStackProtocolImplementation(engineWithCommits([row]));

            const commits = await p.listCommits({ packageId: 'pkg_crm' });

            expect(commits[0]!.createdAt).toBeUndefined();
            expect('createdAt' in commits[0]!).toBe(false);
        });
    });

    describe('§D #14078 neutrality — an Invalid `Date` is NOT converted here', () => {
        /**
         * ⛔ This card does not decide #14078. An Invalid `Date` is measured
         * reachable on both live dialects (a MySQL zero datetime; any
         * Postgres year in 275760..294276), and whether the shared
         * canonical-ISO spelling (`canonicalIsoInstant`) should throw on it
         * (option A) or fall back to a rendering (option B) is a maintainer
         * call across four packages; it was ruled B on 2026-09-02 for the
         * five arms that THREW, and this site was not one of them. It hands
         * that one shape through exactly as it does today — no new throw, no
         * invented rendering. This case is what makes that a PIN rather than
         * a claim: it goes red the moment `canonicalIsoInstant` (or any
         * spelling that reaches `.toISOString()` unconditionally) is swapped
         * into `listCommits`. The consolidation is #16422.
         */
        it('hands the value through unchanged instead of raising RangeError', async () => {
            const invalid = new Date(NaN);
            expect(Number.isNaN(invalid.getTime())).toBe(true);
            // The contested spelling's `Date` arm, on this input, for contrast.
            expect(() => invalid.toISOString()).toThrow(RangeError);

            const p = new ObjectStackProtocolImplementation(engineWithCommits([commitRow(invalid)]));

            const commits = await p.listCommits({ packageId: 'pkg_crm' });

            // Unchanged — and specifically NOT converted, which would mean
            // this card had quietly chosen a rendering for the contested shape.
            expect(commits[0]!.createdAt).toBe(invalid as unknown as string);
        });
    });
});
