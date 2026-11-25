// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D3] The delete marker's own bounds, on a recording protocol: the
 * refused-key limit and the keyless row behind `unjudged, rows refused`, and
 * the size of the key list one find carries. The marking itself is pinned on
 * a real engine through both pulls (`./datasource-pull.test.ts`,
 * `./connector-pull.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { KEYS_PER_FILTER, REFUSED_KEY_LIMIT, SyncDeleteMarker } from './sync-delete-mark.js';
import type { ConnectorPullProtocol } from './connector-pull.js';

type Rec = Record<string, unknown>;

/** A protocol that records every find's `where` and answers `answer(where)`. */
function recording(answer: (where: Rec) => Rec[] = () => [], deletedField?: string) {
    const finds: Rec[] = [];
    const updates: Rec[] = [];
    const protocol = {
        async getMetaItem() { return undefined; },
        async findData({ query }: { query: { where: Rec } }) {
            finds.push(query.where);
            return { records: answer(query.where) };
        },
        async createData() { return {}; },
        async updateData(request: Rec) { updates.push(request); return {}; },
    } as unknown as ConnectorPullProtocol;
    const marker = new SyncDeleteMarker({
        protocol, mapping: 'm', targetObject: 'copy', policy: { policy: 'mark', ...(deletedField ? { deletedField } : {}) },
        readContext: { isSystem: true }, writeContext: { isSystem: true }, runStartedAt: '2026-01-01T00:00:00.000Z',
    });
    return { marker, finds, updates };
}

const keyed = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ _sync_external_id: `k${from + i}` }));

describe('[ADR-0153 D3] SyncDeleteMarker — when the absence mark can be judged', () => {
    it(`excludes up to ${REFUSED_KEY_LIMIT} refused keys by name and gives up past them`, async () => {
        const at = recording();
        const rows = keyed(REFUSED_KEY_LIMIT);
        await at.marker.afterBatch(rows, rows, rows.map(() => false));
        expect(at.marker.canMarkAbsent()).toBe(true);
        const one = keyed(1, REFUSED_KEY_LIMIT);
        await at.marker.afterBatch(one, one, [false]);
        expect(at.marker.canMarkAbsent()).toBe(false);
    });

    it('one read row with no key makes the run unjudgeable, written rows beside it or not', async () => {
        const at = recording();
        const rows = [...keyed(2), {}, { _sync_external_id: '' }];
        await at.marker.afterBatch(rows, rows, [true, true, false, false]);
        expect(at.marker.canMarkAbsent()).toBe(false);
        const clean = recording();
        await clean.marker.afterBatch(keyed(2), keyed(2), [true, true]);
        expect(clean.marker.canMarkAbsent()).toBe(true);
    });
});

describe('[ADR-0153 D3] SyncDeleteMarker — a batch\'s keys go into a find a bounded number at a time', () => {
    const inLengths = (finds: Rec[]) => finds.flatMap((w) => {
        const parts = (w.$and as Rec[] | undefined) ?? [];
        return parts.flatMap((p) => {
            const key = p._sync_external_id as Rec | undefined;
            return Array.isArray(key?.$in) ? [(key!.$in as unknown[]).length] : [];
        });
    });

    it('clears a long batch in finds of at most KEYS_PER_FILTER keys, every key asked once', async () => {
        // The first find asks whether any row carries a mark; answer yes, then nothing to clear.
        const at = recording((where) => (JSON.stringify(where).includes('"$in"') ? [] : [{ id: 'x' }]));
        const rows = keyed(KEYS_PER_FILTER * 2 + 1);
        await at.marker.afterBatch(rows, rows, rows.map(() => true));
        expect(inLengths(at.finds)).toEqual([KEYS_PER_FILTER, KEYS_PER_FILTER, 1]);
    });

    it('marks a long deletedField batch the same way', async () => {
        const at = recording(() => [], 'gone');
        const rows = keyed(KEYS_PER_FILTER + 1);
        await at.marker.afterBatch(rows.map(() => ({ gone: true })), rows, rows.map(() => true));
        expect(inLengths(at.finds)).toEqual([KEYS_PER_FILTER, 1]);
    });
});

describe('[ADR-0153 D3] SyncDeleteMarker — a mark that fails part-way keeps its count', () => {
    it('counts each row as it is written, so the run is closed with the rows it stamped', async () => {
        const at = recording((where) => (JSON.stringify(where).includes('"$lt"') ? [{ id: 'a' }, { id: 'b' }, { id: 'c' }] : []));
        let calls = 0;
        const update = at.marker['init'].protocol.updateData.bind(at.marker['init'].protocol);
        at.marker['init'].protocol.updateData = async (request: never) => {
            if (++calls === 3) throw new Error('write failed');
            return update(request);
        };
        await expect(at.marker.markAbsent()).rejects.toThrow('write failed');
        expect(at.marker.marked).toBe(2);
    });
});
