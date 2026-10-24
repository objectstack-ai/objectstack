/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The MEMBERS of `object-grid.columns`, pinned at what the RENDERER reads
 * (objectui#8071 slice 17).
 *
 * The registration declares an `array` arm and names TWO members in prose —
 * `[{ field: "name", label: "Full Name", width: 200 }]` — while
 * `ListColumnSchema` (`@objectstack/spec/ui`) is `strict` over FOURTEEN:
 * `field`, `label`, `width`, `align`, `hidden`, `sortable`, `resizable`,
 * `wrap`, `type`, `pinned`, `summary`, `prefix`, `link`, `action`. The eleven
 * the description elides are the ones that decide whether a column is there at
 * all, how wide it is, which way it reads and whether its text is clamped.
 *
 * PRIOR ART, stated rather than credited — none of it is a claim about this
 * block's KEY, and each covers one member or one seam:
 * `columnDeclaredSpellingOnly` pins that `field`/`label` are the only identity
 * spelling read; `column-features` covers `pinned` / `summary` / `link` /
 * `action`; `ObjectGrid.columnWrapForward` pins `wrap` across the link-cell
 * boundary; `columnWidthInbound-6457` pins `width`'s inbound hop;
 * `columnSortabilitySignal` pins the personalization side of `sortable`; and
 * `columnReadBoundary-6458` bounds `generateColumns()`'s UNDECLARED reads to
 * the empty set by source scan. What follows is the member set itself, through
 * the real grid, with the precedence between members.
 *
 * ⛔ What a declaration can never publish:
 *
 *   - **Two members make a column vanish and they are not the same event.**
 *     `hidden: true` is authored intent and is silent; a column with no usable
 *     `field` is DROPPED and reported on the console. Same empty grid, two
 *     different bugs, and nothing distinguishes them except which member you
 *     wrote.
 *   - **`align` is inferred from `type` when it is absent, and the authored
 *     member OUTRANKS the inference.** A `number` column reads right without
 *     anyone asking for it — so `align: 'left'` on one is not a no-op, it is
 *     the only way to get what the author wrote.
 *   - **`wrap` is read as a DECISION, not as truthiness.** `wrap: false` is
 *     forwarded, exactly as authored, and is not the same value as an absent
 *     `wrap` at the emit — which is what keeps a future default from silently
 *     overriding an author who asked for clamping.
 *   - **`type` OUTRANKS every inference this block does.** The heuristic reads
 *     the field NAME (`created_at` is a datetime, `active` is a boolean), so a
 *     column whose name happens to match a pattern is typed by its spelling
 *     unless the member says otherwise.
 *   - **`prefix` renders a SECOND field's value inside this column's cell**,
 *     so the member decides what a cell shows about a record it does not name.
 *
 * DIRECTION, predicted before running: every row below is RED against the
 * plausible "simplification" of the read site it covers, and green as written.
 * The per-pin ablation is recorded in the PR body.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider, ActionProvider } from '@object-ui/react';

import { ObjectGrid } from '../ObjectGrid';
// Registers `object-grid` and its `view:grid` alias, for the `SchemaRenderer`
// leg below.
import '../index';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const ROWS = [
  { id: '1', name: 'Ada', amount: 100, active: true, stage: 'won' },
  { id: '2', name: 'Grace', amount: 200, active: false, stage: 'lost' },
];

/**
 * Render a bare `object-grid` over inline rows — no `objectName`, so no object
 * metadata can supply a member the AUTHORED column did not, which is what
 * makes every reading below a reading of `columns` itself.
 */
function renderColumns(columns: unknown[], extra: Record<string, unknown> = {}) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          data: { provider: 'value', items: ROWS },
          columns,
          ...extra,
        } as any}
      />
    </ActionProvider>,
  );
}

/** Every rendered header, in order. `#` is the built-in row-number column. */
const headers = (): string[] =>
  screen.getAllByRole('columnheader').map((h) => (h.textContent ?? '').trim());

/** The header cell whose text is `label`. */
function headerCell(label: string): HTMLElement {
  const cell = screen
    .getAllByRole('columnheader')
    .find((h) => (h.textContent ?? '').trim() === label);
  expect(cell, `header \`${label}\``).toBeDefined();
  return cell as HTMLElement;
}

/** The first body cell of the column at `index` (0-based, row-number column excluded). */
function bodyCell(index: number): HTMLElement {
  const row = document.querySelectorAll('tbody tr')[0];
  expect(row, 'first body row').toBeDefined();
  const cells = row!.querySelectorAll('td');
  const cell = cells[index + 1];
  expect(cell, `body cell ${index}`).toBeDefined();
  return cell as HTMLElement;
}

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        amount: { type: 'number' },
        stage: { type: 'text' },
      },
    }),
  };
}

/** Render through a dataSource and hand back the params of the first `find`. */
async function findParamsFor(schema: Record<string, unknown>) {
  const adapter = makeAdapter();
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return (adapter.find.mock.calls[0] as [string, any])[1];
}

describe('object-grid `columns` members — identity and legibility (objectui#8071)', () => {
  it('LIT CONTROL: a bare `{ field }` renders a column and a prettified header', () => {
    // The non-vacuity row for everything below: if the grid stopped rendering
    // authored columns at all, every "member X changes the column" assertion
    // would pass for the wrong reason.
    renderColumns([{ field: 'name' }]);
    expect(headers()).toEqual(['#', 'Name']);
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('`field` is the name that reaches `$select`, not the label beside it', async () => {
    const params = await findParamsFor({
      type: 'object-grid',
      objectName: 'account',
      columns: [{ field: 'stage', label: 'Deal stage' }],
    });
    // `id` is always added so a row click can resolve the record.
    expect(params.$select).toEqual(['id', 'stage']);
    expect(JSON.stringify(params.$select)).not.toContain('Deal stage');
  });

  it('`label` OUTRANKS the machine name, and its absence is what prettifies', () => {
    renderColumns([{ field: 'name', label: 'Full Name' }]);
    expect(headers()).toEqual(['#', 'Full Name']);
    cleanup();
    renderColumns([{ field: 'first_name' }]);
    // The prettifier is the fallback, not a second labelling mechanism.
    expect(headers()).toEqual(['#', 'First name']);
  });

  it('`hidden: true` removes the column SILENTLY — authored intent, not a fault', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderColumns([
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', hidden: true },
    ]);
    const lines = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith('[ObjectUI] ObjectGrid columns:'));
    warn.mockRestore();

    expect(headers()).toEqual(['#', 'Name']);
    // The other way a column vanishes IS reported (objectui#5349), so the
    // silence here is a member disposition rather than a missing diagnostic.
    expect(lines).toEqual([]);
  });
});

describe('object-grid `columns` members — presentation (objectui#8071)', () => {
  it('`width` reaches the header cell, and its absence leaves the width unset', () => {
    renderColumns([{ field: 'name', label: 'Name', width: 240 }]);
    expect(headerCell('Name').style.width).toBe('240px');
    cleanup();
    // ⚠️ The control is NOT "no width": a column with no authored `width` is
    // AUTO-SIZED, so the header still carries one. What the member decides is
    // WHICH width, and an assertion of emptiness here would have been red for a
    // reason that has nothing to do with this key.
    renderColumns([{ field: 'name', label: 'Name' }]);
    const autoSized = headerCell('Name').style.width;
    expect(autoSized).not.toBe('');
    expect(autoSized).not.toBe('240px');
  });

  it('`align` is INFERRED from a numeric `type`, and the authored member wins', () => {
    // Inference first — this is what an author who writes neither member gets.
    renderColumns([{ field: 'amount', label: 'Amount', type: 'number' }]);
    expect(headerCell('Amount').className).toContain('text-right');
    cleanup();
    // The same column, with the member the inference would have overridden.
    renderColumns([{ field: 'amount', label: 'Amount', type: 'number', align: 'left' }]);
    expect(headerCell('Amount').className).not.toContain('text-right');
  });

  it('`sortable: false` withholds the header click affordance the default grants', () => {
    renderColumns([{ field: 'name', label: 'Name' }]);
    expect(headerCell('Name').className).toContain('cursor-pointer');
    cleanup();
    renderColumns([{ field: 'name', label: 'Name', sortable: false }]);
    expect(headerCell('Name').className).not.toContain('cursor-pointer');
  });

  it('`wrap` decides the cell clamp, and `false` is forwarded as a decision', () => {
    renderColumns([{ field: 'name', label: 'Name', wrap: true }]);
    expect(bodyCell(0).innerHTML).toContain('whitespace-normal break-words');
    cleanup();
    renderColumns([{ field: 'name', label: 'Name', wrap: false }]);
    expect(bodyCell(0).innerHTML).toContain('truncate');
    cleanup();
    renderColumns([{ field: 'name', label: 'Name' }]);
    expect(bodyCell(0).innerHTML).toContain('truncate');
  });
});

describe('object-grid `columns` members — typing and compound cells (objectui#8071)', () => {
  it('`type` OUTRANKS the name-shaped inference this block does', () => {
    // `active` is one of the names the heuristic reads as a boolean, so the
    // control is the column WITHOUT the member: it renders the boolean cell.
    renderColumns([{ field: 'active', label: 'Active' }]);
    const inferred = bodyCell(0).textContent ?? '';
    cleanup();
    renderColumns([{ field: 'active', label: 'Active', type: 'text' }]);
    const declared = bodyCell(0).textContent ?? '';
    expect(declared).not.toBe(inferred);
    expect(declared).toBe('true');
  });

  it('`prefix` renders ANOTHER field inside this column’s cell', () => {
    renderColumns([{ field: 'name', label: 'Name', prefix: { field: 'stage', type: 'badge' } }]);
    // The prefixed value belongs to `stage`, in a grid whose only column is
    // `name` — the member is what put it on screen.
    // The badge renderer humanizes the raw stored value, so `won` reads `Won`
    // — pinned as what is on SCREEN rather than as the stored value, because
    // the screen is what this member changes.
    expect(bodyCell(0).textContent).toContain('Won');
    expect(bodyCell(0).textContent).toContain('Ada');
    cleanup();
    renderColumns([{ field: 'name', label: 'Name' }]);
    expect(bodyCell(0).textContent).not.toContain('Won');
  });
});
