/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10817 — `ValueDataSource.find` refuses an object `$filter` that
 * carries an EMPTY operator map, the way the ObjectStack path already does.
 *
 * ## What was wrong
 *
 * `{ created: {} }` names a field and no operator. The object-dialect matcher
 * ran its operator loop zero times, so the field added no constraint:
 * `{ status: 'a', created: {} }` answered the same rows as `{ status: 'a' }`,
 * and `{ created: {} }` answered every row, with no console line. The same
 * filter nested in `$and` / `$or` widened the same way. `convertFiltersToAST`
 * refuses every one of these (objectui#9164, objectui#10788), because
 * `@objectstack/spec` ruled `{ field: {} }` REJECTED wherever it appears
 * (objectstack#5240, recorded on `FilterConditionSchema`).
 *
 * ## What the repair is (seat ruling 5858511329, option A2)
 *
 * `find`'s object arm walks the filter up front, over its field entries and
 * the members of `$and` / `$or`. A field whose condition is an object with no
 * own keys is handed to `toFilterNodeSafely` on its own. If the converter
 * refuses it, the whole filter answers NO rows and the converter's reason is
 * logged ONCE, in the envelope the array arm already uses for a lowering
 * refusal (objectui#10767). `find` still never rejects.
 *
 * ## What the assertions are
 *
 * - §1 — the card's two inputs are refused: no rows, `total: 0`, exactly one
 *   warning, and that warning EQUALS the converter's refusal for the same
 *   whole filter, seated in this adapter's lowering-refusal envelope. The
 *   body is read live from `toFilterNodeSafely`, never transcribed, so a second
 *   wording on this face would show here.
 * - §2 — the `$and` and `$or` forms are refused the same way, including the
 *   `$or` whose other disjunct matches row 3: the answer is EMPTY, not row 3.
 * - §3 — what the routing carries on purpose: a `RegExp`, `Map` or `Set`
 *   comparand has no own keys either, and gets the converter's exotic-
 *   comparand refusal (objectui#8567), with the converter's wording.
 * - §4 — the controls, the same on the base and the head.
 * - §5 — the envelope is the array arm's: its lowering-refusal warning has the
 *   same frame.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by removing the up-front walk from `find`: every row in §1, §2 and §3
 * goes RED (the base answers are rows 1 and 2, or every row, with no warning),
 * and §4 and §5 stay GREEN.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { QueryParams } from '@object-ui/types';
import { ValueDataSource } from '../ValueDataSource';
import { toFilterNodeSafely } from '../../utils/filter-converter';

/** The card's rows: ids 1 and 2 have status `'a'`; only id 1 has `created`. */
const ROWS = [
  { id: '1', status: 'a', created: 'x' },
  { id: '2', status: 'a' },
  { id: '3', status: 'b' },
];

async function query(filter: unknown) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const ds = new ValueDataSource({ items: ROWS });
    const result = await ds.find('rows', { $filter: filter as QueryParams['$filter'] });
    return {
      ids: result.data.map((r) => r.id),
      total: result.total,
      warns: warn.mock.calls.map((c) => String(c[0])),
    };
  } finally {
    warn.mockRestore();
  }
}

/**
 * The frame this adapter puts around a refusal the LOWERING raised:
 * `refuseFilterNode`'s sentence around `loweringRefusalReason`'s. §5 checks
 * the array arm uses the same frame, so this is the shared envelope, not a
 * second one written here.
 */
const LOWERING_FRAME_HEAD = '[ObjectUI] ValueDataSource: filter rule refused as it is lowered: ';
const LOWERING_FRAME_TAIL = '. Rows are excluded rather than passed through.';

/** The converter's own message, with its prefix and closing period taken off. */
function converterReason(filter: unknown): string {
  const lowered = toFilterNodeSafely(filter);
  if (lowered.ok) throw new Error(`the converter did not refuse ${String(filter)}`);
  return lowered.refusal.message.replace(/^\[ObjectUI\]\s*/, '').replace(/\.\s*$/, '');
}

/** The ONE warning a refused object filter must log. */
function expectedWarning(filter: unknown): string {
  return `${LOWERING_FRAME_HEAD}${converterReason(filter)}${LOWERING_FRAME_TAIL}`;
}

async function expectRefused(filter: unknown, subject: string) {
  const result = await query(filter);
  expect(result.ids).toEqual([]);
  expect(result.total).toBe(0);
  expect(result.warns).toEqual([expectedWarning(filter)]);
  // The converter names the field, so this face does too.
  expect(result.warns[0]).toContain(`'${subject}'`);
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('objectui#10817 §1 — the card’s inputs are refused', () => {
  it('{ status: a, created: {} } answers no rows, not rows 1 and 2', async () => {
    const filter = { status: 'a', created: {} };
    await expectRefused(filter, 'created');
    expect(converterReason(filter)).toContain('EMPTY operator map');
  });

  it('{ created: {} } answers no rows, not every row', async () => {
    await expectRefused({ created: {} }, 'created');
  });
});

describe('objectui#10817 §2 — nested in $and / $or, the refusal is the whole filter’s', () => {
  it('{ $and: [{ status: a, created: {} }] } is refused', async () => {
    await expectRefused({ $and: [{ status: 'a', created: {} }] }, 'created');
  });

  it('{ $and: [{ created: {} }] } is refused', async () => {
    await expectRefused({ $and: [{ created: {} }] }, 'created');
  });

  it('{ $or: [{ created: {} }] } is refused', async () => {
    await expectRefused({ $or: [{ created: {} }] }, 'created');
  });

  it('{ $or: [{ status: b }, { status: a, created: {} }] } answers EMPTY, not row 3', async () => {
    await expectRefused({ $or: [{ status: 'b' }, { status: 'a', created: {} }] }, 'created');
  });
});

describe('objectui#10817 §3 — a zero-key exotic comparand gets the converter’s refusal (objectui#8567)', () => {
  it('a RegExp comparand is refused with the converter’s wording', async () => {
    const filter = { status: 'a', created: /x/ };
    await expectRefused(filter, 'created');
    expect(converterReason(filter)).toContain('RegExp');
  });

  it('a Map comparand is refused with the converter’s wording', async () => {
    const filter = { status: 'a', created: new Map([['k', 'v']]) };
    await expectRefused(filter, 'created');
    expect(converterReason(filter)).toContain('Map');
  });

  it('a Set comparand is refused with the converter’s wording', async () => {
    const filter = { status: 'a', created: new Set(['x']) };
    await expectRefused(filter, 'created');
    expect(converterReason(filter)).toContain('Set');
  });
});

describe('objectui#10817 §4 — controls: the same answer on the base and the head', () => {
  it('{ status: a } — the card’s control — answers rows 1 and 2 with no warning', async () => {
    expect(await query({ status: 'a' })).toEqual({ ids: ['1', '2'], total: 2, warns: [] });
  });

  it('{ created: null } answers what it answered before, with no warning', async () => {
    // Strict equality to null: the rows without `created` are excluded too.
    // The converter SKIPS a null key instead (objectui#9020); that difference
    // is recorded on the card and not changed here.
    expect(await query({ created: null })).toEqual({ ids: [], total: 0, warns: [] });
  });

  it('the {} whole filter is no filter: every row, no warning', async () => {
    expect(await query({})).toEqual({ ids: ['1', '2', '3'], total: 3, warns: [] });
  });

  it('a Date comparand is not refused: the converter lowers it and this face reads it as equality', async () => {
    // Flipped by objectui#10829. Pinned AS-IS until then: the Date constraint
    // vanished on this face (rows 1 and 2, the same as { status: 'a' }).
    // objectui#10829 reads a Date condition as implicit equality, so the answer
    // is the rows that hold that instant, and neither row 1 (`'x'`) nor row 2
    // (no `created`) does. Still a control for this card's walk: the walk
    // routes the Date, the converter lowers it, and nothing is refused.
    expect(toFilterNodeSafely({ created: new Date(0) }).ok).toBe(true);
    expect(await query({ status: 'a', created: new Date(0) })).toEqual({
      ids: [],
      total: 0,
      warns: [],
    });
  });

  it('a real operator beside the key still matches per row', async () => {
    expect(await query({ status: 'a', created: { $eq: 'x' } })).toEqual({
      ids: ['1'],
      total: 1,
      warns: [],
    });
  });

  it('the $foo sibling is still excluded PER NODE, with its own sentence', async () => {
    const result = await query({ status: { $foo: 1 } });
    expect(result.ids).toEqual([]);
    expect(result.warns).toHaveLength(1);
    expect(result.warns[0]).toContain("filter operator '$foo' on field 'status' is not implemented");
    expect(result.warns[0].startsWith(LOWERING_FRAME_HEAD)).toBe(false);
  });
});

describe('objectui#10817 §5 — one envelope for both arms', () => {
  it('the array arm frames a lowering refusal the same way', async () => {
    const rule = [{ field: 'status', operator: 'equals', value: ['a', 'b'] }];
    const result = await query(rule);
    expect(result.ids).toEqual([]);
    expect(result.warns).toEqual([expectedWarning(rule)]);
  });
});
