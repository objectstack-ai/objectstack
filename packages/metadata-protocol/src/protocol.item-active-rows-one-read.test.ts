// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24371] The by-name item read takes the item's ACTIVE rows from ONE store
// read of both spellings (`readItemActiveRows`), and each of its three
// active-row selections — the package-less binding (`packagelessAddress`),
// the served row (`findServedOverlayRow`) and the lock's scope
// (`overlayLockLayerAt`) — selects from those rows by the `where` it used to
// send the store. Before, they were five serial store reads on every `/data`
// request (the API-exposure gate reads the object by name).
//
// The served answer must not move. This file is the differential half of that
// claim: over every arrangement of up to three stored rows drawn from a pool
// (both spellings, the package-unbound row and two packages' rows, a bundled
// type's canonical and non-canonical member, three lock states), and every
// address a read can name, each selection made from the one read equals the
// selection the store answers by itself. The store double answers `where` as
// a driver does: equality, `null` as IS NULL, `$in` membership, rows in
// insertion order; anything else is refused.
//
// The count half — one read per `GET /api/v1/data/:object` — is pinned at the
// door, `packages/rest/src/rest-data-read-one-overlay-read.test.ts`.

import { describe, it, expect } from 'vitest';
import { SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { ObjectStackProtocolImplementation } from './protocol.js';

type Row = Record<string, unknown>;

const valueMatches = (actual: unknown, want: unknown): boolean => {
    if (want !== null && typeof want === 'object') {
        const set = (want as { $in?: unknown }).$in;
        if (!Array.isArray(set)) throw new Error(`store double: unsupported operator in ${JSON.stringify(want)}`);
        return set.includes(actual ?? null);
    }
    return (actual ?? null) === (want ?? null);
};
const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`store double: unsupported combinator ${k}`);
    return v === undefined || valueMatches(row[k], v);
});

function protocolOver(rows: readonly Row[]): any {
    const engine = {
        registry: undefined,
        find: async (table: string, q: { where?: Row; limit?: number } = {}) => {
            if (table !== 'sys_metadata') return [];
            const hits = rows.filter((r) => matches(r, q.where));
            return typeof q.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        findOne: async (table: string, q: { where?: Row } = {}) =>
            table === 'sys_metadata' ? rows.find((r) => matches(r, q.where)) ?? null : null,
    };
    return new ObjectStackProtocolImplementation(engine as never, () => new Map());
}

const LOCKS = [undefined, 'full', 'no-delete'] as const;

/** Every distinct row key a type's item can hold, each with a lock from {@link LOCKS} by position. */
function pool(type: string, discriminated: boolean): Row[] {
    const spellings = [type, SINGULAR_TO_PLURAL[type]].filter((t): t is string => typeof t === 'string');
    const members = discriminated ? [null, 'zh-CN'] : [null];
    const out: Row[] = [];
    for (const spelling of spellings) {
        for (const pkg of [null, 'pkg_a', 'pkg_b']) {
            for (const member of members) {
                const lock = LOCKS[out.length % LOCKS.length];
                out.push({
                    id: `r${out.length}`, type: spelling, name: 'item', state: 'active', package_id: pkg,
                    bundle_member: member,
                    metadata: JSON.stringify({ name: 'item', label: `row ${out.length}`, ...(lock ? { _lock: lock } : {}) }),
                });
            }
        }
    }
    return out;
}

function arrangements(rows: readonly Row[]): Row[][] {
    const out: Row[][] = [];
    for (let i = 0; i < rows.length; i++) {
        out.push([rows[i]!]);
        for (let j = i + 1; j < rows.length; j++) {
            out.push([rows[i]!, rows[j]!], [rows[j]!, rows[i]!]);
            for (let k = j + 1; k < rows.length; k++) out.push([rows[i]!, rows[j]!, rows[k]!], [rows[k]!, rows[j]!, rows[i]!]);
        }
    }
    return out;
}

const idOf = (served: { row: Row } | undefined): unknown => served?.row.id;

for (const { type, discriminated } of [
    { type: 'object', discriminated: false },
    { type: 'email_template', discriminated: true },
]) {
    describe(`[#24371] ${type}: each active-row selection made from the one read equals the store's own answer`, () => {
        const all = arrangements(pool(type, discriminated));
        const members = discriminated ? [undefined, 'zh-CN'] : [undefined];

        it('the matrix is the one this file claims (not silently emptied)', () => {
            expect(SINGULAR_TO_PLURAL[type]).toBeTypeOf('string');
            // 6 row keys for `object` (2 spellings x 3 bindings), 12 for the
            // bundled type (x 2 members): every 1-row arrangement, and every
            // 2- and 3-row one in two store orders.
            expect(all.length).toBe(discriminated ? 584 : 76);
        });

        it('one read serves every row the selections consult, of both spellings and nothing else', async () => {
            for (const rows of all) {
                const p = protocolOver([...rows, { ...rows[0]!, id: 'other_name', name: 'another' }]);
                const read = await p.readItemActiveRows(type, 'item');
                expect(read.map((r: Row) => r.id)).toEqual(rows.map((r) => r.id));
            }
        });

        it('the package-less binding, the served row and the lock are the store\'s answers', async () => {
            let compared = 0;
            for (const rows of all) {
                const p = protocolOver(rows);
                const read = await p.readItemActiveRows(type, 'item');
                for (const member of members) {
                    expect(await p.packagelessAddress(type, 'item', member, 'active', read))
                        .toEqual(await p.packagelessAddress(type, 'item', member, 'active'));
                    for (const packageId of [undefined, null, 'pkg_a', 'pkg_b']) {
                        const args = { type, name: 'item', state: 'active', packageId, ...(member ? { member } : {}) };
                        expect(idOf(await p.findServedOverlayRow(args, read)))
                            .toBe(idOf(await p.findServedOverlayRow(args)));
                        compared += 1;
                    }
                }
                for (const packageId of [undefined, 'pkg_a', 'pkg_b']) {
                    const address = { type, name: 'item', packageId };
                    expect(await p.overlayLockLayerAt(address, { otherSpelling: true }, read))
                        .toEqual(await p.overlayLockLayerAt(address, { otherSpelling: true }));
                }
            }
            expect(compared).toBe(all.length * members.length * 4);
        });
    });
}
