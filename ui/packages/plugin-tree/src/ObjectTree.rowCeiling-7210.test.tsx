/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7210, half 2 — maintainer ruling a′ (2026-09-02), on the tree.
 *
 * ⭐ This is the view the ceiling's VALUE was measured on, and the only one of
 * the four whose DOM grows with the result set: gantt virtualises, the
 * calendar month grid caps events per day cell, the map auto-clusters above
 * 100 markers — the tree flattens every expanded node into the document, at a
 * measured 5.2 elements per record. So the ruling's "the DOM row count equals
 * the ceiling" is literally checkable here, against real rendered `<tr>`s,
 * and this file checks it that way rather than through a stub.
 *
 * The truncation is also the most consequential here: a hierarchy assembled
 * from the first N rows is not a subtree of the real one — every node whose
 * parent fell past the cut is silently reparented to a root. Nothing in the
 * rendering says so, which is what the footnote is for.
 *
 * REVERSE VERIFICATION — MEASURED, and corrected from what this docblock used
 * to predict (objectui#7507). Removing `...nonGridRowCeilingQuery()` from
 * `ObjectTree`'s record fetch turns the truncation case red at the **`$top`
 * assertion** and there only, 1 failed / 1 passed; the below-ceiling case
 * stays green.
 *
 * ⚠️ The row count does NOT move, and the footnote does not disappear. The old
 * prediction — "the whole store arrives, nothing is capped, `truncated` is
 * false" — got the first clause right and drew the wrong conclusion from it.
 * The whole store does arrive; `applyNonGridRowCeiling` then slices it to the
 * ceiling and reports `truncated` from the rows in hand, so the rendered
 * `<tr>` count is still exactly 2,000 and the note still names both numbers.
 * Losing the `$top` is a BANDWIDTH regression here, not a correctness one, and
 * the `$top` assertion is the only thing in this file that sees it.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NON_GRID_ROW_CEILING, nonGridRowCeilingQuery } from '@object-ui/core';
import { ObjectTree } from './ObjectTree';

// objectui#6892 slice 9 — inherit the real surface, but through `<any>` rather
// than the `typeof import('@object-ui/plugin-detail')` its twelve siblings use.
// ⚠️ Not a style drift, and ⛔ do not "fix" it to match them: `plugin-tree` does
// NOT declare `@object-ui/plugin-detail`, and it has no reason to — measured,
// `ObjectTree`'s module graph reaches ZERO plugin-detail modules, where
// `ObjectGantt`'s and `ObjectCalendar`'s each reach 50. So this factory mocks a
// module nothing under test ever loads. A type-position `import()` of it is a
// real specifier to `check-phantom-dependencies`, which then (correctly) demands
// the package declare a dependency its runtime does not have. `<any>` inherits
// the surface without asserting an edge that isn't there.
vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...((await importOriginal<any>()) as Record<string, unknown>),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

const TOTAL_ROWS = 5000;

/** A flat forest: every 10th record is a root, the rest hang off it. */
function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    name: `Node ${i + 1}`,
    parent_id: i % 10 === 0 ? null : String(i - (i % 10) + 1),
  }));
}

function makeDataSource(storeSize: number, calls: Array<Record<string, any>>) {
  const store = makeRows(storeSize);
  return {
    find: vi.fn(async (_resource: string, params: any) => {
      calls.push({ ...(params ?? {}) });
      const top = typeof params?.$top === 'number' ? params.$top : store.length;
      return { data: store.slice(0, top), total: store.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'node',
      fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text' },
        parent_id: { name: 'parent_id', type: 'text' },
      },
    })),
  } as any;
}

const schema: any = {
  type: 'object-tree',
  objectName: 'node',
  tree: { parentField: 'parent_id', labelField: 'name' },
  data: { provider: 'object', object: 'node' },
};

describe('objectui#7210 ruling a′ — the tree draws at most the platform ceiling, loudly', () => {
  it('above the ceiling: the rendered row count EQUALS the ceiling, and both numbers are named', async () => {
    const calls: Array<Record<string, any>> = [];
    const dataSource = makeDataSource(TOTAL_ROWS, calls);

    const { container } = render(<ObjectTree schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(container.querySelector('[data-testid="object-tree"]')).not.toBeNull());
    await waitFor(() =>
      expect(container.querySelectorAll('tbody tr').length).toBe(NON_GRID_ROW_CEILING),
    );

    expect(calls.length).toBeGreaterThan(0);
    for (const params of calls) {
      expect(params.$top).toBe(nonGridRowCeilingQuery().$top);
    }

    const note = screen.getByRole('note');
    expect(note.getAttribute('data-row-ceiling-note')).toBe('non-grid');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(TOTAL_ROWS));
  });

  it('below the ceiling: every row draws and there is NO footnote', async () => {
    const calls: Array<Record<string, any>> = [];
    const dataSource = makeDataSource(30, calls);

    const { container } = render(<ObjectTree schema={schema} dataSource={dataSource} />);

    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(30));
    expect(screen.queryByRole('note')).toBeNull();
  });
});
