/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8993 — `bucketCardsIntoColumns` decides lane membership TWICE, and
 * before this pin the two decisions used different key types.
 *
 * ## The mechanism
 *
 * - **Injection** reads `groups[col.id]`. A property read coerces its key, so
 *   a lane `{ id: 1 }` correctly picks up the group stored under `'1'`.
 * - **The leftover sweep** (#2792) built its known-id Set from the RAW value
 *   and filtered `Object.keys(groups)` — which are ALWAYS strings. Since
 *   `new Set([1]).has('1')` is `false`, every record the injection had just
 *   placed was swept a second time into the trailing "Uncategorized" lane.
 *
 * ⇒ A numeric-id board rendered every card twice. Silent: the board draws, the
 * totals just do not reconcile, which is why the counting row below exists.
 *
 * ## What each row is for
 *
 * 1. NUMERIC — the reported reading. Was `'1:r1, 2:r2, __uncolumned__:r1+r2'`.
 * 2. STRING CONTROL — a live control, green on BOTH sides of the repair. It is
 *    what makes row 1 a statement about the id TYPE rather than about bucketing
 *    in general; if it ever reddens, the repair went the wrong way.
 * 3. THE CLASS — the defect is "the id is not a string", not "the id is a
 *    number", so every non-string id type the function can be handed is pinned,
 *    including the falsy ones (`0`, `false`) that also skip the label map.
 * 4. THE LABEL PATH — a record can reach `groups` through the label→id map,
 *    which stores the RAW id as its VALUE. That path double-bucketed too, so
 *    one row keeps it honest; keying only the direct path would leave it open.
 * 5. THE SWEEP STILL SWEEPS — the control that separates a repair from a
 *    deletion. Rows 1-4 would all pass if the sweep were simply removed, and
 *    that would resurrect #2792 (records silently dropped). An unmatched record
 *    must still surface in the trailing lane.
 * 6. NO NEW COLLISION — coercing a key can MINT a collision where there was
 *    none, so the boundary is asserted rather than argued: `String(null)` is
 *    `'null'` and `String(undefined)` is `'undefined'`, and neither may swallow
 *    the empty key that a null/absent VALUE produces; a lane declared with the
 *    `KANBAN_UNCOLUMNED_ID` spelling keeps its existing reading; and a symbol
 *    id — the one key a property read does NOT stringify — must keep behaving
 *    as it does today instead of throwing inside `String()`.
 *
 * ⛔ The repair belongs on the SWEEP side. Making the injection strict would
 * pass rows 1-2 while breaking the coercion lanes depend on, and the string
 * control could not catch it.
 */

import { describe, it, expect, vi } from 'vitest';
import { bucketCardsIntoColumns, KANBAN_UNCOLUMNED_ID } from '../index';

/** `id:card+card` per lane, in lane order — the whole board in one string. */
const summarise = (lanes: Array<any>): string =>
  lanes
    .map((l: any) => `${String(l.id)}:${(l.cards || []).map((c: any) => c.id).join('+')}`)
    .join(', ');

const bucket = (columns: Array<any>, data: Array<any>): string =>
  summarise(bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized'));

/** Every card id the board renders, across every lane, duplicates included. */
const renderedCardIds = (columns: Array<any>, data: Array<any>): string[] =>
  bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized').flatMap(
    (l: any) => (l.cards || []).map((c: any) => c.id),
  );

describe('bucketCardsIntoColumns — lane id key coercion (objectui#8993)', () => {
  it('row 1 — NUMERIC lane ids bucket each record exactly once', () => {
    expect(
      bucket(
        [
          { id: 1, title: 'One' },
          { id: 2, title: 'Two' },
        ],
        [
          { id: 'r1', status: 1 },
          { id: 'r2', status: '2' },
        ],
      ),
    ).toBe('1:r1, 2:r2');
  });

  it('row 2 — STRING control: unchanged, green on both sides of the repair', () => {
    expect(bucket([{ id: 'one', title: 'One' }], [{ id: 'r1', status: 'one' }])).toBe('one:r1');
  });

  describe('row 3 — the class is "id is not a string", not "id is a number"', () => {
    const cases: Array<{ name: string; id: unknown; value: unknown; lane: string }> = [
      { name: 'number', id: 1, value: 1, lane: '1' },
      { name: 'zero (falsy, so the label map skips it)', id: 0, value: 0, lane: '0' },
      { name: 'boolean true', id: true, value: true, lane: 'true' },
      { name: 'boolean false (falsy)', id: false, value: false, lane: 'false' },
      { name: 'null', id: null, value: 'null', lane: 'null' },
      { name: 'undefined (a lane with no id at all)', id: undefined, value: 'undefined', lane: 'undefined' },
      { name: 'NaN', id: NaN, value: NaN, lane: 'NaN' },
      { name: 'array', id: [1, 2], value: '1,2', lane: '1,2' },
      { name: 'plain object', id: { a: 1 }, value: '[object Object]', lane: '[object Object]' },
    ];

    for (const { name, id, value, lane } of cases) {
      it(`${name} — one lane, one card, no trailing "Uncategorized"`, () => {
        const columns = [{ id, title: 'Lane' }];
        const data = [{ id: 'r1', status: value }];
        expect(bucket(columns, data)).toBe(`${lane}:r1`);
        // The counting row: the visible card total must reconcile with the
        // record count. This is the user-visible symptom, stated directly.
        expect(renderedCardIds(columns, data)).toEqual(['r1']);
      });
    }
  });

  it('row 4 — the folded-id lookup is keyed the same way (it stores the RAW id)', () => {
    // The string '1' reaches the lane through `laneIdByFoldedId`, whose stored
    // VALUE is the raw numeric id. This row used to reach that lookup through
    // the lane's TITLE ('One'); objectui#10069 retired title matching, so the
    // title-valued record is now an orphan — asserted here so this row cannot
    // silently go back to exercising the retired key.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(bucket([{ id: 1, title: 'One' }], [{ id: 'r1', status: '1' }])).toBe('1:r1');
    expect(bucket([{ id: 1, title: 'One' }], [{ id: 'r1', status: 'One' }])).toBe(
      `1:, ${KANBAN_UNCOLUMNED_ID}:r1`,
    );
    warn.mockRestore();
  });

  it('row 5 — the sweep still sweeps: an unmatched record still surfaces (#2792)', () => {
    // A repair that simply deleted the sweep would pass every row above and
    // silently drop this record — the defect #2792 closed.
    expect(
      bucket(
        [
          { id: 1, title: 'One' },
          { id: 2, title: 'Two' },
        ],
        [
          { id: 'r1', status: 1 },
          { id: 'r9', status: 'retired_option' },
        ],
      ),
    ).toBe(`1:r1, 2:, ${KANBAN_UNCOLUMNED_ID}:r9`);
  });

  describe('row 6 — the coercion mints no new collision', () => {
    it("a null lane id does not swallow the empty key a null VALUE produces", () => {
      // `String(null)` is 'null', but a record whose group VALUE is null is
      // keyed '' (`String(item[groupBy] ?? '')`). The two must stay apart.
      expect(bucket([{ id: null, title: 'N' }], [{ id: 'r1', status: null }])).toBe(
        `null:, ${KANBAN_UNCOLUMNED_ID}:r1`,
      );
    });

    it("an undefined lane id does not swallow the empty key an ABSENT value produces", () => {
      expect(bucket([{ title: 'U' }], [{ id: 'r1' }])).toBe(
        `undefined:, ${KANBAN_UNCOLUMNED_ID}:r1`,
      );
    });

    it('a lane declared with the sentinel spelling keeps its own records', () => {
      const lanes = bucketCardsIntoColumns(
        [{ id: KANBAN_UNCOLUMNED_ID, title: 'Declared' }],
        [{ id: 'r1', status: KANBAN_UNCOLUMNED_ID }],
        'status',
        undefined,
        'Uncategorized',
      );
      expect(summarise(lanes)).toBe(`${KANBAN_UNCOLUMNED_ID}:r1`);
      expect(lanes).toHaveLength(1); // no second lane under the same id
    });

    it("a symbol lane id keeps today's reading instead of throwing", () => {
      // A symbol is the one key a property read does NOT stringify, so it is
      // never pushed through `String()` (which throws on symbols). `Object.keys`
      // never yields a symbol, so such a lane matches nothing — exactly as
      // before this repair.
      const columns = [{ id: Symbol('lane'), title: 'S' }];
      const data = [{ id: 'r1', status: 'x' }];
      expect(() => bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized'))
        .not.toThrow();
      expect(renderedCardIds(columns, data)).toEqual(['r1']);
      expect(bucket(columns, data)).toBe(`Symbol(lane):, ${KANBAN_UNCOLUMNED_ID}:r1`);
    });
  });
});
