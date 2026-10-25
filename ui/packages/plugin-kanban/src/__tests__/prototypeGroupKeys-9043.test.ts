/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9043 — `bucketCardsIntoColumns` built its two lookup maps as
 * prototype-bearing object literals and then keyed them from RECORD DATA.
 *
 * ## The mechanism
 *
 * No schema guards these keys: `@objectstack/spec` narrows the lane `id`
 * (objectui#8913), not the values stored in the grouped field. Imported legacy
 * data, a free-text status field, or a picklist option whose stored value is a
 * member name of `Object.prototype` all reach the maps, and a `{}` map answers
 * such a key from the prototype instead of from what the function stored:
 *
 * - **The label map read** is `labelToColumnId[rawKey.toLowerCase()] ?? rawKey`.
 *   `??` only falls back on null/undefined, so an INHERITED member is returned
 *   as if it were a declared lane id, and the record is grouped under whatever
 *   that member stringifies to.
 * - **The label map write** is `labelToColumnId['__proto__'] = col.id`, which on
 *   a prototype-bearing object invokes the `__proto__` setter and is silently
 *   ignored for a string — a lane declared with that option value loses its
 *   mapping entirely.
 * - **The accumulator** does `if (!acc[key]) acc[key] = []; acc[key].push(...)`.
 *   `acc['toString']` is the inherited METHOD, which is truthy, so the array is
 *   never created and `.push` is called on a function. Thrown during render, so
 *   the user sees a blank board or an error boundary with nothing naming the
 *   offending record.
 * - **The injection read** `groups[col.id] || []` is the same map a third time:
 *   for a lane declared `{ id: '__proto__' }` it answers `Object.prototype`,
 *   which is truthy and then spreads as "not iterable".
 *
 * Measured on `main` before the repair (`61afb87`), lanes `[{id:'a',title:'A'}]`,
 * one record — the crash leg and the mis-bucket leg split on the `.toLowerCase()`
 * in the label-map read, since `'toString'` lowercases to `'tostring'`, which is
 * NOT an inherited member, while `'constructor'` and `'__proto__'` already are:
 *
 *     'ordinary_value' -> a:, __uncolumned__:r1            (clean — the control)
 *     'toString'       -> THREW TypeError: acc[key].push is not a function
 *     'valueOf'        -> THREW  (same)
 *     'hasOwnProperty' -> THREW  (same)
 *     'constructor'    -> a:, __uncolumned__:r1  — but grouped under the key
 *                         "function Object() { [native code] }"
 *     '__proto__'      -> a:, __uncolumned__:r1  — grouped under "[object Object]"
 *
 * ## What each row is for
 *
 * 1. CONTROLS — an ordinary value, matched by id, matched by label, and matched
 *    by nothing. Green on BOTH sides of the repair. They are what make the rows
 *    below statements about prototype member names rather than about bucketing
 *    in general, and they are what separates a repair from a bucketer that
 *    simply dropped everything: "nothing threw" is satisfied by both.
 * 2. THE CRASH LEG — `toString` / `valueOf` / `hasOwnProperty`. Each asserts
 *    WHICH LANE the record lands in, not merely that nothing threw.
 * 3. THE MIS-BUCKET LEG — `constructor` / `__proto__`. ⚠️ These two were already
 *    green at the LANE level before the repair (the table above): the label map
 *    returned an inherited member, and the nonsense group key it produced still
 *    matched no lane, so the record still fell into the trailing lane. They are
 *    pinned because they are the reported readings; rows 4-6 are what make the
 *    label map's defect observable in the return value.
 * 4. DECLARED LANES — the picklist case, where the SAME option value produces
 *    both the lane and the records. All three threw before the repair; each now
 *    asserts the record reaches its declared lane, which is the reading the two
 *    rows above cannot make.
 * 5. NOTHING IS DROPPED (#2792) — the fence this repair must not trade away. A
 *    board carrying every offending value at once renders each record exactly
 *    once. Rows 2-4 would all pass if such records were discarded instead of
 *    bucketed, and that would swap a visible crash for a silent loss.
 */

import { describe, it, expect } from 'vitest';
import { bucketCardsIntoColumns, KANBAN_UNCOLUMNED_ID } from '../index';

/** `id:card+card` per lane, in lane order — the whole board in one string. */
const summarise = (lanes: Array<any>): string =>
  lanes
    .map((l: any) => `${String(l.id)}:${(l.cards || []).map((c: any) => c.id).join('+')}`)
    .join(', ');

const bucket = (columns: Array<any>, data: Array<any>): string =>
  summarise(bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized'));

/** The card's reproduction: one lane, one record, the group value under test. */
const oneRecord = (status: unknown, columns: Array<any> = [{ id: 'a', title: 'A' }]): string =>
  bucket(columns, [{ id: 'r1', title: 'R1', status }]);

/** Every card id the board renders, across every lane, duplicates included. */
const renderedCardIds = (columns: Array<any>, data: Array<any>): string[] =>
  bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized').flatMap(
    (l: any) => (l.cards || []).map((c: any) => c.id),
  );

/** Every member name of `Object.prototype` a record could carry as its value. */
const PROTOTYPE_MEMBERS = Object.getOwnPropertyNames(Object.prototype);

describe('bucketCardsIntoColumns — prototype member names as group values (objectui#9043)', () => {
  it('row 1a — CONTROL: an ordinary unmatched value lands in the trailing lane', () => {
    expect(oneRecord('ordinary_value')).toBe(`a:, ${KANBAN_UNCOLUMNED_ID}:r1`);
  });

  it('row 1b — CONTROL: an ordinary value matching a lane id lands in that lane', () => {
    expect(oneRecord('a')).toBe('a:r1');
  });

  it('row 1c — CONTROL: an ordinary value matching a lane id in another CASE still maps to its id', () => {
    // Lane `{ id: 'a', title: 'A' }`: 'A' reaches it through the case-folded id
    // lookup. It used to be readable as a TITLE match too; objectui#10069
    // retired title matching, and this row holds because of the folding alone.
    expect(oneRecord('A')).toBe('a:r1');
  });

  it.each(['toString', 'valueOf', 'hasOwnProperty'])(
    'row 2 — CRASH LEG: %s is bucketed instead of throwing, and lands in the trailing lane',
    (status) => {
      expect(oneRecord(status)).toBe(`a:, ${KANBAN_UNCOLUMNED_ID}:r1`);
    },
  );

  it.each(['constructor', '__proto__'])(
    'row 3 — MIS-BUCKET LEG: %s matches no lane, so it lands in the trailing lane',
    (status) => {
      expect(oneRecord(status)).toBe(`a:, ${KANBAN_UNCOLUMNED_ID}:r1`);
    },
  );

  it('row 4a — DECLARED LANE `__proto__` receives its record (the label map WRITE)', () => {
    expect(oneRecord('__proto__', [{ id: '__proto__', title: 'Proto' }, { id: 'a', title: 'A' }])).toBe(
      '__proto__:r1, a:',
    );
  });

  it('row 4b — DECLARED LANE `constructor` receives its record', () => {
    expect(oneRecord('constructor', [{ id: 'constructor', title: 'Ctor' }, { id: 'a', title: 'A' }])).toBe(
      'constructor:r1, a:',
    );
  });

  it('row 4c — DECLARED LANE `toString` receives a record that reached it through the FOLDED lookup', () => {
    // The lookup's stored VALUE is the prototype member name. This row used to
    // reach it by the lane's TITLE ('Done'); objectui#10069 retired title
    // matching, so it now reaches it by a case variant of the id, and the
    // title-valued record is asserted to be an orphan beside it.
    expect(oneRecord('TOSTRING', [{ id: 'toString', title: 'Done' }, { id: 'a', title: 'A' }])).toBe(
      'toString:r1, a:',
    );
    expect(oneRecord('Done', [{ id: 'toString', title: 'Done' }, { id: 'a', title: 'A' }])).toBe(
      `toString:, a:, ${KANBAN_UNCOLUMNED_ID}:r1`,
    );
  });

  it('row 5 — every prototype member name is bucketed exactly once, never dropped', () => {
    const data = PROTOTYPE_MEMBERS.map((name, i) => ({ id: `r${i}`, title: name, status: name }));
    const ids = renderedCardIds([{ id: 'a', title: 'A' }], data);
    expect([...ids].sort()).toEqual(data.map((d) => d.id).sort());
  });
});
