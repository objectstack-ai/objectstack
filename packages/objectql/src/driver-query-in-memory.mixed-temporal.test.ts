// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27277] A remote may answer one column in both forms — a `Date` on some rows,
 * an ISO string on others. `applyDriverQueryInMemory` sorts such a column by
 * instant: before, a `Date` (as epoch ms) against a string compared as
 * `number < string`, false both ways, so every mixed pair read as equal.
 */

import { describe, it, expect } from 'vitest';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';

const ROWS = [
  { id: 'a', at: '2026-07-28T09:00:00.000Z' },
  { id: 'b', at: new Date('2026-07-27T09:00:00.000Z') },
  { id: 'c', at: '2026-07-29T09:00:00.000Z' },
  { id: 'd', at: new Date('2026-07-28T21:00:00.000Z') },
  { id: 'e', at: null },
];

describe('[#27277] a column mixing Date and ISO-string values sorts by instant', () => {
  it('ascending, no value last', () => {
    const got = applyDriverQueryInMemory(ROWS, { orderBy: [{ field: 'at', order: 'asc' }] }).map((r) => r.id);
    expect(got).toEqual(['b', 'a', 'd', 'c', 'e']);
  });

  it('descending, no value still last', () => {
    const got = applyDriverQueryInMemory(ROWS, { orderBy: [{ field: 'at', order: 'desc' }] }).map((r) => r.id);
    expect(got).toEqual(['c', 'd', 'a', 'b', 'e']);
  });

  it('a page cuts the instant order, not the arrival order', () => {
    const got = applyDriverQueryInMemory(ROWS, { orderBy: [{ field: 'at', order: 'asc' }], limit: 2, offset: 1 }).map((r) => r.id);
    expect(got).toEqual(['a', 'd']);
  });
});
