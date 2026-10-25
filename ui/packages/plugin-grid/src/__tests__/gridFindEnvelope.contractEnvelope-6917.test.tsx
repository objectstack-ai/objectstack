/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The shape `ObjectGrid` actually reads out of a `find()` answer — pinned so
 * this package's test doubles cannot drift away from it again
 * (objectui#6917).
 *
 * ## The hazard this file closes
 *
 * Two doubles in this package answered `{ value: [], '@odata.count': 0 }`.
 * `ObjectGrid` reads `result.data` for rows and `result.total` for the match
 * count, and NEITHER of those keys is one it reads. So the fixtures read as
 * though they supplied rows and supplied none.
 *
 * That was inert only because the arrays were EMPTY — both suites assert on
 * `$select` projection and on column identity, neither on rendered rows, so
 * zero rows was the answer they wanted anyway. The first person to put a row
 * in one would have been handed nothing, silently, with a fixture that reads
 * as if it had supplied one. Repaired to `{ data: [], total: 0 }` on this card.
 *
 * A fixture is not covered by the suites it feeds — it is the input to them —
 * so the repair needs a pin of its own, and this is it: the contract stated
 * directly, against ROWS rather than against an empty array, which is the one
 * condition under which the two spellings differ.
 *
 * ## Why `value` is refused here and KEPT in `packages/fields`
 *
 * Not a contradiction — the two are different consumers, and objectui#6917's
 * central rule is that a measurement is seam-local. `@object-ui/core`'s
 * `extractRecords` accepts `value` because eight in-repo `find()` producers
 * still emit it into that helper. `ObjectGrid` does not go through
 * `extractRecords`; it reads `result.data` directly and always has. Pinning
 * what THIS consumer reads is what keeps its fixtures honest, and it is also
 * why the repair below is to the fixtures and not to `ObjectGrid`:
 *
 * ⛔ do NOT "fix" this by teaching `ObjectGrid` to read `value`, and ⛔ do NOT
 * widen `QueryResult` to bless `value` or `@odata.count` — a published-type
 * change and the maintainer's call (the floor objectui#6726, #6840 and #6839
 * all held). `'@odata.count'` in particular is a WIRE spelling that both
 * adapters' `normalizeQueryResult` already fold into `total` below the fold.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';

const ROW = { id: 'c1', name: 'Ada Lovelace' };

const makeDataSource = (answer: unknown) => ({
  find: vi.fn().mockResolvedValue(answer),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'contacts',
    fields: { name: { type: 'text' } },
  }),
});

async function rowRenders(answer: unknown): Promise<boolean> {
  const ds = makeDataSource(answer);
  const schema: any = { type: 'object-grid', objectName: 'contacts', columns: [{ field: 'name' }] };
  render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds as never} />
    </ActionProvider>,
  );
  // Wait on the FETCH, not on the row: waiting on the row would make every
  // refusal case a timeout rather than a reading, and would take the same
  // amount of time whether the grid was empty or merely slow.
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  return screen.queryAllByText('Ada Lovelace').length > 0;
}

describe('ObjectGrid find() envelope — the shape its fixtures must speak (objectui#6917)', () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the contract's `data` member — the shape the repaired doubles use", async () => {
    expect(await rowRenders({ data: [ROW], total: 1 })).toBe(true);
  });

  it('does NOT read `value` — the shape the doubles used to answer with', async () => {
    // This is the whole defect, made visible: identical fixture, one row in it,
    // and the grid is handed nothing.
    expect(await rowRenders({ value: [ROW], '@odata.count': 1 })).toBe(false);
  });

  it('does NOT read `records` either — folded into `data` below the adapter', async () => {
    // Caricature guard: a grid that rendered the first array it found under any
    // key would show the row here, and both refusals above would be vacuous.
    expect(await rowRenders({ records: [ROW] })).toBe(false);
  });
});
