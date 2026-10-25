/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The EMIT SEAM half of the `TableColumn.type` repair (objectui#5853,
 * maintainer ruling 2026-08-25, Option B: the 8-literal interface union is
 * canonical).
 *
 * `ObjectGrid` produces `TableColumn[]` for `data-table`, and five paths inside
 * it write `type` — the four column literals in `generateColumns()` and the
 * `fieldDef.type` enrichment after it. Every one forwarded an OBJECT SCHEMA's
 * field type verbatim, whose vocabulary is `@objectstack/spec`'s `FieldType`:
 * 49 values, only 7 of them members of the declared union. That is what made
 * the declaration a lie and forced an `as any` in the renderer.
 *
 * The ruling's repair is a fold at the seam, so the undeclared dialect
 * DISAPPEARS rather than getting declared. This file pins the fold
 * BEHAVIOURALLY — through the editor a column actually opens — because the
 * source-level pins next door cannot see whether the fold is reached.
 *
 * ⭐ Note what the first case would do WITHOUT the fold: `int` is no longer a
 * member of the data-table's `NUMERIC_EDIT_TYPES` (it never was declared), so
 * an unfolded `int` column would open a plain TEXT box. The numeric editor
 * surviving is the fold working.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const ROWS = [
  { id: '1', name: 'Ada', amount: 100 },
  { id: '2', name: 'Grace', amount: 200 },
];

/**
 * Render an inline-data grid with one typed column. No `objectName` and no
 * object schema — deliberately, because that is the path whose columns SKIP the
 * `fieldDef` enrichment map (it early-returns when the accessor has no field
 * def). The fold is a separate pass precisely so those columns are covered too.
 */
function renderTyped(type: string) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          // objectui#8348 — the DECLARED inline-rows spelling. `object-grid`'s published
          // `data` row is the `ViewData` union ("the bare-array shortcut is refused"), so
          // `getDataConfig` no longer lifts a bare array; `{ provider: 'value', items }`
          // resolves to the same config this file has always exercised.
          data: { provider: 'value', items: ROWS },
          editable: true,
          singleClickEdit: true,
          columns: [{ field: 'amount', label: 'Amount', type }],
        } as any}
      />
    </ActionProvider>,
  );
}

/** The `type` attribute of the editor the Amount cell opens, or null. */
function editorTypeFor(type: string): string | null {
  const { container, unmount } = render(<div />);
  unmount();
  const view = renderTyped(type);
  const cell = screen.getAllByText('100')[0]!.closest('td') as HTMLElement;
  fireEvent.click(cell);
  const input = view.container.querySelector('tbody input') as HTMLInputElement | null;
  const result = input ? input.getAttribute('type') : null;
  view.unmount();
  void container;
  return result;
}

describe('ObjectGrid folds an inferred column type onto the declared vocabulary', () => {
  it('a declared numeric type opens the numeric editor (the control)', () => {
    // Control probe: `number` IS declared, so this passes with or without the
    // fold. It is here so a null reading below reads as a real difference
    // rather than as "inline editing never engaged in this harness".
    expect(editorTypeFor('number')).toBe('number');
  });

  it('the undeclared alias `int` still opens the NUMERIC editor — via the fold', () => {
    // `int` reaches `TableColumn.type` from a producer, is folded to `number`
    // at the seam, and the renderer branches on the declared spelling. Remove
    // the fold and this returns 'text': the renderer no longer knows `int`.
    expect(editorTypeFor('int')).toBe('number');
  });

  it.each(['integer', 'float', 'double'])('folds the alias %s the same way', (alias) => {
    expect(editorTypeFor(alias)).toBe('number');
  });

  it('an out-of-union field type leaves the column standing', () => {
    // ⛔ T1's rule: the fold drops the undeclared ANNOTATION, never the column.
    // `select` is one of the 42 spec field types outside the union, and it is a
    // spelling authored in this repo's own grid fixtures today.
    renderTyped('select');
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getAllByText('100')[0]).toBeInTheDocument();
    expect(screen.getAllByText('200')[0]).toBeInTheDocument();
  });
});
