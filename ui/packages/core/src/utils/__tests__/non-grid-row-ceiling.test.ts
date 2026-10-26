/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7210 (ruling a′) — the platform row ceiling for non-grid views, at
 * the one place all four of them share it; homed in `@object-ui/core` by
 * objectui#7508 (ruling A′).
 *
 * The four view-level pins (gantt, calendar, map, tree) each assert the ruling
 * END TO END on their own surface, and each compares the `$top` it saw against
 * `nonGridRowCeilingQuery()` — so all four agree on one `+ 1`. This file pins
 * the things those cannot see, because they are properties of the mechanism
 * rather than of any one view:
 *
 *   1. `nonGridRowCeilingQuery()` asks for the ceiling PLUS ONE. The probe row
 *      is what makes truncation detectable at all, and it is detectable from
 *      the rows alone — a result set of exactly the ceiling and one of 200,000
 *      are otherwise the same 2,000 rows with an optional `total` that many
 *      adapters do not send.
 *   2. The query carries `$top` and nothing else, and is a fresh object per
 *      call — it is spread into four different `find()` queries.
 *   3. `applyNonGridRowCeiling` slices the probe row back off and decides
 *      `truncated` from the rows, never from `total`.
 *
 * REVERSE VERIFICATION — direction predicted before running: drop the `+ 1`
 * from `nonGridRowCeilingQuery` and the "one past the ceiling IS truncated"
 * cases built on `PROBE_TOP` collapse to "exactly at the ceiling", so they
 * turn red — as does the `+ 1` pin itself.
 */

import { describe, it, expect } from 'vitest';
import {
  NON_GRID_ROW_CEILING,
  nonGridRowCeilingQuery,
  applyNonGridRowCeiling,
} from '../non-grid-row-ceiling';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));
/** What a caller's `find()` asks for: the ceiling plus the probe row. */
const PROBE_TOP = nonGridRowCeilingQuery().$top;

describe('objectui#7210 / #7508 — the non-grid row ceiling', () => {
  it('asks for exactly one row more than it will draw', () => {
    expect(nonGridRowCeilingQuery()).toEqual({ $top: NON_GRID_ROW_CEILING + 1 });
  });

  it('carries `$top` and nothing else — it is spread into every view query', () => {
    expect(Object.keys(nonGridRowCeilingQuery())).toEqual(['$top']);
  });

  it('is a fresh object per call, so one caller cannot move what the next sends', () => {
    const first = nonGridRowCeilingQuery();
    first.$top = 1;
    expect(nonGridRowCeilingQuery().$top).toBe(NON_GRID_ROW_CEILING + 1);
  });

  it('a result set exactly AT the ceiling is not truncated and keeps every row', () => {
    const capped = applyNonGridRowCeiling({ data: rows(NON_GRID_ROW_CEILING) });
    expect(capped.truncated).toBe(false);
    expect(capped.rows).toHaveLength(NON_GRID_ROW_CEILING);
  });

  it('one row PAST the ceiling is truncated, and the probe row is sliced back off', () => {
    const capped = applyNonGridRowCeiling({ data: rows(PROBE_TOP), total: 41234 });
    expect(capped.truncated).toBe(true);
    expect(capped.rows).toHaveLength(NON_GRID_ROW_CEILING);
    expect(capped.total).toBe(41234);
  });

  it('detects truncation from a BARE ARRAY response, which carries no total at all', () => {
    // The adapters least likely to page correctly are exactly the ones that
    // report no `total`; a `total`-based test would go quiet on them.
    const capped = applyNonGridRowCeiling(rows(PROBE_TOP));
    expect(capped.truncated).toBe(true);
    expect(capped.total).toBeUndefined();
    expect(capped.rows).toHaveLength(NON_GRID_ROW_CEILING);
  });
});
