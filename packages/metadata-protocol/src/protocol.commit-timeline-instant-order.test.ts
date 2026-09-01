// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#13995] The ADR-0067 package commit timeline sorted by WEEKDAY NAME on the
// production default drivers, and `rollbackToPackageCommit` planned its reverts
// off the same comparison.
//
// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------
// `created_at` is an engine-injected audit column: it is not in `datetimeFields`
// and `SqlDriver#formatOutput` repairs it only inside `if (this.isSqlite)`, so
// the live SQL dialects hand it out of the record read door as a JS `Date` while
// the SQLite family hands out canonical ISO-Z text. Pinned one layer down by
// `packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`.
//
// Both timeline consumers in `protocol.ts` compared `String(created_at)`:
//
//   listCommits              mapped.sort(… String(b.createdAt).localeCompare(…))
//   rollbackToPackageCommit  all.filter(c => String(c.createdAt) > targetCreatedAt)
//
// `String(aDate)` is `"Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)"`
// — the LEADING token is the weekday name — so lexicographic order over those
// strings is `Fri < Mon < Sat < Sun < Thu < Tue < Wed`, unrelated to chronology.
// The order is stable across the whole set, so the failure is systematic and
// identical on every run: there is never an "it worked once" to warn anyone.
//
// The two sites reinforce rather than backstop each other. `listCommits` returns
// a mis-ordered timeline while claiming newest-first, and
// `rollbackToPackageCommit` both CONSUMES that ordering and re-derives the same
// comparison itself — so it reverts `apply` commits OLDER than the target and
// skips the newer ones it exists to undo. That is a destructive operation
// planning off a wrong predicate.
//
// ---------------------------------------------------------------------------
// Why the fixture is FOUR consecutive days, and why that makes this pin
// timezone-independent
// ---------------------------------------------------------------------------
// `String(aDate)` renders the weekday in the PROCESS timezone, so which weekday
// name each instant carries depends on `TZ`. Rather than pin `TZ` (which Node
// caches per platform) the fixture is chosen so the old comparison is wrong in
// EVERY alignment: map each weekday to its rank in the lexicographic order
// (`Fri`=0, `Mon`=1, `Sat`=2, `Sun`=3, `Thu`=4, `Tue`=5, `Wed`=6) and read off
// the seven windows of four consecutive weekdays —
//
//   Sun Mon Tue Wed -> 3 1 5 6      Thu Fri Sat Sun -> 4 0 2 3
//   Mon Tue Wed Thu -> 1 5 6 4      Fri Sat Sun Mon -> 0 2 3 1
//   Tue Wed Thu Fri -> 5 6 4 0      Sat Sun Mon Tue -> 2 3 1 5
//   Wed Thu Fri Sat -> 6 4 0 2
//
// — not one of the seven is monotonic, so no timezone can make the old sort
// agree with chronology. (Three consecutive days is NOT enough: `Mon Tue Wed`
// and `Fri Sat Sun` are both increasing.) The same table settles the planner:
// with the target at the second day, the old predicate selects `{1,3,4}`,
// `{3}`, `{}`, `{1}`, `{1,3,4}`, `{3}`, `{4}` across the seven alignments and
// never the correct `{3,4}`. Every instant is 24h apart at 12:00Z, far enough
// from local midnight that no offset or DST step can collapse two onto one
// local day. `assertTheFixtureDiscriminates` below asserts the property
// mechanically rather than trusting this comment.
//
// ---------------------------------------------------------------------------
// Why the `Date` is hand-made rather than read off a driver
// ---------------------------------------------------------------------------
// `@objectstack/metadata-protocol` has no driver dependency and must not grow
// one — the layering runs the other way. This is the same split
// `sql-driver-13567-audit-stamp-materialisation.test.ts` documents for the OCC
// seam: the driver package pins WHAT the dialects materialise, and the consumer
// package pins that it is correct FOR that shape.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Ordinary red, and separated by site so the ablation says which one broke:
//
//   * Restore `String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))`
//     in `listCommits` -> the two ordering cases go red, the planner case stays
//     GREEN (a `filter` preserves order but the selected SET does not depend on
//     it), and the ISO-text cases stay green.
//   * Restore `String(c.createdAt ?? '') > String(target.created_at ?? '')` in
//     `rollbackToPackageCommit` -> the planner case goes red on the SET, and the
//     ordering cases stay green.
//
// The ISO-text half stays green in both directions on purpose: it is what shows
// the repair is the `Date` shape and not a blanket rewrite of the comparison.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/** Four consecutive days plus one more, at 12:00Z. See the header for why. */
const DAY_1 = '2026-08-30T12:00:00.000Z';
const DAY_2 = '2026-08-31T12:00:00.000Z';
const DAY_3 = '2026-09-01T12:00:00.000Z';
const DAY_4 = '2026-09-02T12:00:00.000Z';
const DAY_5 = '2026-09-03T12:00:00.000Z';

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
function commitRow(id: string, createdAt: Date | string, operation = 'apply') {
    return {
        id,
        package_id: 'pkg_crm',
        organization_id: null,
        operation,
        message: `commit ${id}`,
        actor: 'alice',
        item_count: 1,
        items: JSON.stringify([{ type: 'object', name: 'acct', existedBefore: true, prevVersion: 3 }]),
        created_at: createdAt,
    };
}

/**
 * The five commits, in the shape ONE dialect family hands them over.
 *
 * `stamp` is the whole difference between the two families: `Date` is what
 * Postgres and MySQL materialise for this column, the ISO-Z string is what the
 * SQLite family and memory return. Rows are handed over oldest-first on purpose
 * — the sort, not the driver, is what must make the timeline newest-first.
 */
function timeline(stamp: (iso: string) => Date | string) {
    return [
        commitRow('cmt_d1', stamp(DAY_1)),
        commitRow('cmt_d2', stamp(DAY_2)),
        commitRow('cmt_d3', stamp(DAY_3)),
        commitRow('cmt_d4', stamp(DAY_4)),
        commitRow('cmt_d5', stamp(DAY_5), 'revert'),
    ];
}

const asDate = (iso: string) => new Date(iso);
const asIsoText = (iso: string) => iso;

/** An engine that answers both commit-store reads out of `rows`. */
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

/**
 * A protocol whose `revertCommit` only RECORDS what it was handed.
 *
 * The defect under test is which commits `rollbackToPackageCommit` SELECTS, not
 * what reverting one does; stubbing the per-commit revert keeps the assertion on
 * the plan and off `revertCommit`'s own (separately pinned) machinery.
 */
function protocolWithPlanRecorder(rows: any[]) {
    const protocol = new ObjectStackProtocolImplementation(engineWithCommits(rows));
    (protocol as any).revertCommit = async () => ({
        success: true,
        revertedCount: 1,
        failedCount: 0,
        reverted: [{ type: 'object', name: 'acct', action: 'restored' }],
        failed: [],
    });
    return protocol;
}

describe('[#13995] the commit timeline orders by INSTANT, not by the weekday name', () => {
    it('the fixture discriminates: the old `String(...)` compare disagrees with chronology', () => {
        // The positive control for everything below. If this ever passes, the
        // `Date` cases stop being able to catch the defect and the pin is
        // vacuous — which is exactly the state the OCC seam was in.
        const stamps = [DAY_1, DAY_2, DAY_3, DAY_4].map(asDate);
        const byOldStringCompare = [...stamps]
            .sort((a, b) => String(b).localeCompare(String(a)))
            .map((d) => d.toISOString());
        const byChronology = [...stamps]
            .sort((a, b) => b.getTime() - a.getTime())
            .map((d) => d.toISOString());

        expect(byOldStringCompare).not.toEqual(byChronology);
    });

    describe('the `Date`-materialising dialects (Postgres, MySQL)', () => {
        it('listCommits returns the timeline newest-first', async () => {
            const p = new ObjectStackProtocolImplementation(engineWithCommits(timeline(asDate)));

            const commits = await p.listCommits({ packageId: 'pkg_crm' });

            expect(commits.map((c) => c.id)).toEqual([
                'cmt_d5', 'cmt_d4', 'cmt_d3', 'cmt_d2', 'cmt_d1',
            ]);
        });

        it('rollbackToPackageCommit reverts exactly the `apply` commits NEWER than the target', async () => {
            const p = protocolWithPlanRecorder(timeline(asDate));

            const result = await p.rollbackToPackageCommit({ commitId: 'cmt_d2' });

            // Asserted as a SET: membership is decided by this site's predicate
            // alone, so this case stays green if only `listCommits`' sort is
            // reverted and red if only this site's is.
            expect([...result.revertedCommits].sort()).toEqual(['cmt_d3', 'cmt_d4']);
            // The target itself and everything older than it are untouched, and
            // the `revert` commit is skipped — its effect is already captured by
            // re-reverting the apply it undid.
            expect(result.revertedCommits).not.toContain('cmt_d1');
            expect(result.revertedCommits).not.toContain('cmt_d2');
            expect(result.revertedCommits).not.toContain('cmt_d5');
            expect(result.success).toBe(true);
        });
    });

    describe('the ISO-text dialects (the SQLite family, memory) are unchanged', () => {
        it('listCommits still returns the timeline newest-first', async () => {
            const p = new ObjectStackProtocolImplementation(engineWithCommits(timeline(asIsoText)));

            const commits = await p.listCommits({ packageId: 'pkg_crm' });

            expect(commits.map((c) => c.id)).toEqual([
                'cmt_d5', 'cmt_d4', 'cmt_d3', 'cmt_d2', 'cmt_d1',
            ]);
            expect(commits[0]!.createdAt).toBe(DAY_5);
        });

        it('rollbackToPackageCommit still reverts exactly the `apply` commits newer than the target', async () => {
            const p = protocolWithPlanRecorder(timeline(asIsoText));

            const result = await p.rollbackToPackageCommit({ commitId: 'cmt_d2' });

            expect([...result.revertedCommits].sort()).toEqual(['cmt_d3', 'cmt_d4']);
            expect(result.success).toBe(true);
        });
    });
});
