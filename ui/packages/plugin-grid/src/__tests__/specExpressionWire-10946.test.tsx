/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10946 — the widened declarations are the values `object-grid`
 * already evaluates.
 *
 * `@object-ui/types` now declares a spec-shape rule's `condition` and a bulk
 * def's `visible` as the named view's own expression slots (a string, or the
 * `{ dialect, source }` envelope). That card changed no runtime code; what it
 * owes is proof that the grid honours what the type now admits. Each fixture
 * below is typed through the grid's DECLARED member (no `any`), so the same
 * file pins both halves: `tsc` accepts the value, and the real renderer reads
 * it.
 *
 * The `ast`-only envelope is typed loosely on purpose. The installed spec's
 * slot admits it and spec `main` does not, so a typed fixture would compile on
 * one line and fail the other. Its cases pin the runtime answers the
 * declarations' docblocks describe. As a rule `condition` it is evaluated as a
 * fault, so the rule does not match and the fault is warned. As a bulk def's
 * `visible` it is a declared gate that cannot be evaluated (objectui#11358):
 * the selection bar asks the action family's one "declared?" definition, which
 * since that ruling answers "declared" for an envelope with no `source`, and
 * the per-record fold fails closed on the fault — no selected record
 * qualifies, and it is warned once — as the row menu and the toolbars hide it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { BulkActionDef, ObjectGridSchema } from '@object-ui/types';

import { ObjectGrid } from '../ObjectGrid';
import { partitionBulkRows } from '../bulkEligibility';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

type GridRules = NonNullable<ObjectGridSchema['conditionalFormatting']>;

function renderGrid(rows: Record<string, unknown>[], conditionalFormatting: GridRules) {
  const schema: ObjectGridSchema = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: rows },
    conditionalFormatting,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>,
  );
}

/** The `<tr>` the browser would paint for the row whose `name` is `label`. */
function rowOf(label: string): HTMLTableRowElement {
  const tr = screen.getByText(label).closest('tr');
  if (!tr) throw new Error(`no <tr> for row ${label}`);
  return tr as HTMLTableRowElement;
}

const ROWS = [
  { id: '1', name: 'Won deal', stage: 'won' },
  { id: '2', name: 'Open deal', stage: 'open' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#10946 — `object-grid` evaluates a `{ dialect, source }` rule condition', () => {
  it('THE WIDENED FORM: an envelope condition paints the row it matches, and only that row', () => {
    renderGrid(ROWS, [
      { condition: { dialect: 'cel', source: "record.stage == 'won'" }, style: { backgroundColor: 'rgb(1, 2, 3)' } },
    ]);

    expect(rowOf('Won deal').style.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(rowOf('Open deal').style.backgroundColor).toBe('');
  });

  it('CONTROL: the string form, unchanged, reaches the same verdict', () => {
    renderGrid(ROWS, [
      { condition: "record.stage == 'won'", style: { backgroundColor: 'rgb(1, 2, 3)' } },
    ]);

    expect(rowOf('Won deal').style.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(rowOf('Open deal').style.backgroundColor).toBe('');
  });

  it('an `ast`-only envelope is a fault, not a match: no row is painted, and the fault is warned', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const astOnly = [
      { condition: { dialect: 'cel', ast: { op: 'eq' } }, style: { backgroundColor: 'rgb(4, 5, 6)' } },
    ] as unknown as GridRules;

    renderGrid(ROWS, astOnly);

    expect(rowOf('Won deal').style.backgroundColor).toBe('');
    expect(rowOf('Open deal').style.backgroundColor).toBe('');
    expect(warn).toHaveBeenCalled();
  });
});

describe('objectui#10946 — a bulk def\'s `visible` envelope that carries `ast`', () => {
  const BULK_ROWS = [
    { id: 'r1', done: false },
    { id: 'r2', done: true },
  ];

  it('THE WIDENED FORM: `ast` beside `source` is declared, and `source` decides', () => {
    const def: BulkActionDef = {
      name: 'mark_done',
      operation: 'custom',
      visible: { dialect: 'cel', source: '!record.done', ast: { op: 'not' } },
    };

    expect(partitionBulkRows(def, BULK_ROWS).eligible.map((r) => r.id)).toEqual(['r1']);
  });

  // [objectui#11322] This case pinned "no declared gate: every record
  // qualifies" after the selection bar moved onto the action family's one
  // definition, which then read an envelope with no `source` as no gate on all
  // three surfaces. [objectui#11358] triage ruled that reading a silent `true`
  // (ADR-0137 D4): the envelope is a DECLARED gate that cannot be evaluated, so
  // the definition answers "declared" and the fold's fail-closed fault path
  // admits no record — on this bar as on the row menu and the toolbars, which
  // hide it. One report, labelled with the def.
  it('an `ast`-only envelope is a declared gate that faults: no record qualifies, warned once', () => {
    const def = { name: 'mark_done_11358', operation: 'custom', visible: { dialect: 'cel', ast: { op: 'not' } } } as unknown as BulkActionDef;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { eligible, skipped } = partitionBulkRows(def, BULK_ROWS);

      expect(eligible).toEqual([]);
      expect(skipped).toBe(BULK_ROWS.length);
      const lines = warn.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines.filter((l) => l.includes('[unevaluable]'))).toHaveLength(1);
      expect(lines.filter((l) => l.includes('mark_done_11358'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
