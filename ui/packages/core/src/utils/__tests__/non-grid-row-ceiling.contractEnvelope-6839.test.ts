/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `applyNonGridRowCeiling` reads a `find()` answer as `QueryResult` DECLARES it
 * — and does NOT read `records` (objectui#6839).
 *
 * ## Why this module gets its own pin
 *
 * It is a PUBLISHED export in its own right — `@object-ui/core`'s since
 * objectui#7508 moved it beside `extractRecords`, and re-exported by
 * `@object-ui/react` (README "NON_GRID_ROW_CEILING") — so an app calls it
 * directly, without any of the nine renderers in the picture. It is also the seam through which FOUR of them
 * reach `extractRecords` — `ObjectCalendar`, `ObjectGantt`, `ObjectMap` and
 * `ObjectTree` all hand it their `find()` answer rather than unwrapping it
 * themselves. So it is one module by the pin's definition and four by the
 * card's, and it behaves DIFFERENTLY from the other sinks: the rows it
 * extracts also decide `truncated`, the probe-row verdict the loud footnote is
 * drawn from.
 *
 * That second reading is the one a rows-only pin would miss. A refused envelope
 * does not merely paint zero rows here — it also reports `truncated: false`
 * over a result set that really was cut, i.e. it would have SILENCED the
 * footnote. Both halves are asserted below.
 *
 * ⚠️ Every "0 rows" assertion here is also satisfied by an `extractRecords`
 * that returns `[]` for everything — an implementation strictly worse than the
 * bug. The `data` / bare-array / `value` cases are what refuse that, and they
 * push the SAME rows through the SAME call.
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

describe('applyNonGridRowCeiling — the find() envelope it reads (objectui#6839)', () => {
  describe('the shapes it still reads — the live arms', () => {
    it("reads the contract's `data` member", () => {
      const capped = applyNonGridRowCeiling({ data: rows(3), total: 3 });
      expect(capped.rows).toHaveLength(3);
      expect(capped.total).toBe(3);
    });

    it('reads a bare array', () => {
      expect(applyNonGridRowCeiling(rows(3)).rows).toHaveLength(3);
    });

    it('still reads `value` — LIVE at this seam', () => {
      expect(applyNonGridRowCeiling({ value: rows(3) }).rows).toHaveLength(3);
    });
  });

  describe('the shape it refuses', () => {
    it('does NOT read `records` — not a QueryResult member', () => {
      const capped = applyNonGridRowCeiling({ records: rows(3), total: 3 });
      expect(capped.rows).toHaveLength(0);
    });

    it('`data` OUTRANKS `records` when a producer emits both', () => {
      // Before the fix `records` was tried FIRST: this answered the one row
      // under the undeclared key and dropped the three the contract declared.
      const capped = applyNonGridRowCeiling({ data: rows(3), records: rows(1) });
      expect(capped.rows).toHaveLength(3);
    });
  });

  describe('the truncation verdict, which is this sink’s own behaviour', () => {
    it('a `data` envelope over the ceiling still reports truncated, with the ceiling drawn', () => {
      const capped = applyNonGridRowCeiling({
        data: rows(PROBE_TOP),
        total: 41234,
      });
      expect(capped.truncated).toBe(true);
      expect(capped.rows).toHaveLength(NON_GRID_ROW_CEILING);
      expect(capped.total).toBe(41234);
    });

    it('a refused `records` envelope reports NOT truncated — the footnote it would have silenced', () => {
      // The sharp half. `truncated` is decided from the extracted rows, so a
      // refused envelope does not just draw nothing: it also states that
      // nothing was cut, over a result set of 2001 rows. That is why this sink
      // needs its own pin rather than inheriting the helper's.
      const capped = applyNonGridRowCeiling({
        records: rows(PROBE_TOP),
        total: 41234,
      });
      expect(capped.rows).toHaveLength(0);
      expect(capped.truncated).toBe(false);
      // `total` is read off the envelope independently of the rows, so it
      // survives the refusal — stated so the zero above is not misread as
      // "the whole object was rejected".
      expect(capped.total).toBe(41234);
    });
  });
});
