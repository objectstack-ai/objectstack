/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4664 — the count a tab badge shows is scoped by the list's OWN
 * declared filter, not just by the parent relationship.
 *
 * The page-level subject lives in
 * `app-shell/src/views/RecordDetailView.relatedListFilter-4664.test.tsx`, which
 * reads the wire on both halves of a real record page. What this file pins is
 * the store's side of that contract in isolation — the three properties that
 * make badge/row parity survive:
 *
 *   1. the probe query is the parent scope AND the declared filter, composed
 *      through the same `mergeFilterNodes` sink `RelatedList` uses for the rows;
 *   2. with nothing declared the query stays BYTE-IDENTICAL to what it always
 *      was — a plain `{ [relField]: parentId }` object, not a lowered AST that
 *      means the same thing;
 *   3. cache identity includes the scope, so a filtered and an unfiltered count
 *      over the same (object, relField, parent) triple are two entries. Without
 *      (3) the first probe to land would badge the other, which is the same
 *      wrong-number defect arriving through the cache instead of the query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RelatedCountStore } from '../hooks/related-count-store';

const OBJ = 'check_item';
const REL = 'task_version';
const PARENT = 'tv-1';
const SCOPE = { status: { $ne: 'archived' } };

/** A probe that records what it was asked and answers a fixed total. */
function recordingProbe(total: number) {
  return vi.fn(async (_object: string, _query: any) => ({ total, data: [] }));
}

beforeEach(() => {
  RelatedCountStore._reset();
});

describe('RelatedCountStore — the declared scope it counts under (objectui#4664)', () => {
  it('composes the parent scope AND the declared filter', async () => {
    const probe = recordingProbe(3);
    await RelatedCountStore.fetch(probe, OBJ, REL, PARENT, SCOPE);
    expect(probe).toHaveBeenCalledTimes(1);
    const query = probe.mock.calls[0][1];
    // The AST `mergeFilterNodes` lowers the pair to — the same value
    // `RelatedList` builds for the ROW query, which is what makes the badge and
    // the rows answer one question rather than two that happen to agree.
    expect(query.$filter).toEqual([
      'and',
      [REL, '=', PARENT],
      ['status', '!=', 'archived'],
    ]);
    // Still a count probe, not a page read.
    expect(query.$top).toBe(1);
    expect(query.$count).toBe(true);
  });

  it('AND, never replacement — the parent condition survives composition', async () => {
    const probe = recordingProbe(0);
    await RelatedCountStore.fetch(probe, OBJ, REL, PARENT, SCOPE);
    const filter = JSON.stringify(probe.mock.calls[0][1].$filter);
    // Replacement is the dangerous failure: it would count (and, on the row
    // side, show) OTHER parents' rows. Assert the parent conjunct by presence
    // rather than only by the whole-shape equality above, so a future change to
    // the composed shape cannot quietly drop it and still read as "different".
    expect(filter).toContain(`["${REL}","=","${PARENT}"]`);
    expect(filter.startsWith('["and"')).toBe(true);
  });

  it('COUNTER-PROBE — no declared scope leaves the query byte-identical', async () => {
    const probe = recordingProbe(7);
    await RelatedCountStore.fetch(probe, OBJ, REL, PARENT);
    // Not an AST that means the same thing: the untouched MongoDB-style object
    // this probe has always sent. The difference is invisible on screen and
    // visible to every caller pinning this wire.
    expect(probe.mock.calls[0][1].$filter).toEqual({ [REL]: PARENT });
  });

  it('cache identity includes the scope — a filtered and an unfiltered count coexist', async () => {
    await RelatedCountStore.fetch(recordingProbe(7), OBJ, REL, PARENT);
    await RelatedCountStore.fetch(recordingProbe(3), OBJ, REL, PARENT, SCOPE);
    expect(RelatedCountStore.get(OBJ, REL, PARENT)).toBe(7);
    expect(RelatedCountStore.get(OBJ, REL, PARENT, SCOPE)).toBe(3);
    // …and two DIFFERENT scopes are two entries too, not one.
    await RelatedCountStore.fetch(recordingProbe(5), OBJ, REL, PARENT, { status: 'open' });
    expect(RelatedCountStore.get(OBJ, REL, PARENT, { status: 'open' })).toBe(5);
    expect(RelatedCountStore.get(OBJ, REL, PARENT, SCOPE)).toBe(3);
  });

  it('a scoped entry is still reachable by the invalidation the data bus drives', async () => {
    await RelatedCountStore.fetch(recordingProbe(3), OBJ, REL, PARENT, SCOPE);
    expect(RelatedCountStore.get(OBJ, REL, PARENT, SCOPE)).toBe(3);
    // Parent-scoped invalidation reads the key's TAIL for the parent id, so a
    // scope segment appended after it would have silently orphaned the entry —
    // a badge that never refreshes after a write, with no error to notice.
    RelatedCountStore.invalidate(OBJ, PARENT);
    expect(RelatedCountStore.get(OBJ, REL, PARENT, SCOPE)).toBeUndefined();
  });

  it('a scoped entry is reachable by object-wide invalidation too', async () => {
    await RelatedCountStore.fetch(recordingProbe(3), OBJ, REL, PARENT, SCOPE);
    RelatedCountStore.invalidate(OBJ);
    expect(RelatedCountStore.get(OBJ, REL, PARENT, SCOPE)).toBeUndefined();
  });
});
