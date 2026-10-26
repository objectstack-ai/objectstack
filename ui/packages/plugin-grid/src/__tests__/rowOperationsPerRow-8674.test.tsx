/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8674 — `rowOperations`, the per-row narrowing of the grid's generic
 * Edit / Delete entries.
 *
 * ## What the card measured
 *
 * `ObjectGrid` takes ONE grid-level `onDelete` and derives
 * `{ update: !!onEdit, delete: !!onDelete }`, so the row action was drawn for
 * every row. A host whose refusal is per RECORD had nowhere to put it and put
 * it in the callback instead: `FieldDesigner`'s delete handler returned early
 * on a system field, AFTER the button had been drawn and clicked — no dialog,
 * no toast, no console message. `readOnly` was honest in the same component
 * (the callback is withheld, so no button is drawn); `isSystem` was not.
 *
 * ## Why every assertion here is a RENDERED-AFFORDANCE assertion
 *
 * "the predicate was called" and "the prop was passed" are both green against
 * the defect: the old code called `handleDelete` too, and drew the button
 * anyway. The only thing that distinguishes the fix is what the row OFFERS, so
 * each test below opens a real kebab and reads the entries out of it.
 *
 * Each absence is paired with a presence in the SAME render — the withheld
 * entry against the surviving one on that row, and against the neighbouring
 * row that keeps both. An absence on its own is equally green when the grid
 * never rendered, the row was addressed wrongly, or the menu never opened.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import type { ObjectGridRowOperations } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

/** The row the host has no objection to — the presence half of every pair. */
const ORDINARY = { id: 'r_ordinary', name: 'Ordinary' };
/** The row the host refuses to delete — the card's system field, generically. */
const LOCKED = { id: 'r_locked', name: 'Locked' };
const ROWS = [ORDINARY, LOCKED];

interface Case {
  /** Omitted entirely when absent — the control renders no such attribute. */
  rowOperations?: (record: any) => ObjectGridRowOperations | null | undefined;
  /** An explicit grid-level `operations` block, when the case needs one. */
  operations?: Record<string, boolean>;
}

function renderGrid(c: Case = {}) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: ROWS },
    ...(c.operations ? { operations: c.operations } : {}),
  };
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={schema}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        {...(c.rowOperations ? { rowOperations: c.rowOperations } : {})}
      />
    </ActionProvider>,
  );
}

/**
 * What the kebab of the row displaying `label` surfaces.
 *
 * Located by ROW rather than by index: a row whose entries are all hidden grows
 * no "⋮" trigger at all (#3562), so indexing into `queryAllByTestId` would
 * silently address a different row as soon as the gating works.
 */
async function rowKebab(label: string): Promise<{ edit: boolean; delete: boolean; trigger: boolean }> {
  const row = screen.getByText(label).closest('tr');
  const trigger = row?.querySelector('[data-testid="row-action-trigger"]');
  if (!trigger) return { edit: false, delete: false, trigger: false };
  await userEvent.click(trigger);
  const answer = {
    edit: screen.queryAllByTestId('row-action-builtin-edit').length > 0,
    delete: screen.queryAllByTestId('row-action-builtin-delete').length > 0,
    trigger: true,
  };
  // Close the (portalled) menu so the next row's read sees only its own items.
  await userEvent.keyboard('{Escape}');
  return answer;
}

async function settle() {
  await waitFor(() => expect(screen.getByText(LOCKED.name)).toBeInTheDocument());
}

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#8674 · the row a predicate refuses does not draw the action', () => {
  it('withholds Delete on the refused row and keeps it on the row beside it', async () => {
    // BOTH ARMS, one render. Pre-fix the refused row answered `delete: true`
    // and the click did nothing — that is the whole card.
    renderGrid({ rowOperations: (record) => ({ delete: record.name !== LOCKED.name }) });
    await settle();

    expect(await rowKebab(LOCKED.name)).toEqual({ edit: true, delete: false, trigger: true });
    expect(await rowKebab(ORDINARY.name)).toEqual({ edit: true, delete: true, trigger: true });
  });

  it('gates update and delete independently, in the grid-level vocabulary', async () => {
    renderGrid({ rowOperations: (record) => (record.name === LOCKED.name ? { update: false } : null) });
    await settle();

    expect(await rowKebab(LOCKED.name)).toEqual({ edit: false, delete: true, trigger: true });
    expect(await rowKebab(ORDINARY.name)).toEqual({ edit: true, delete: true, trigger: true });
  });

  it('hides rather than disables — a row refused everything grows no "⋮" at all', async () => {
    renderGrid({
      rowOperations: (record) =>
        record.name === LOCKED.name ? { update: false, delete: false } : undefined,
    });
    await settle();

    expect(await rowKebab(LOCKED.name)).toEqual({ edit: false, delete: false, trigger: false });
    // …while the untouched row on the same screen keeps its trigger, so the
    // absence above is a verdict and not an empty grid.
    expect(await rowKebab(ORDINARY.name)).toEqual({ edit: true, delete: true, trigger: true });
  });

  it('never a union: a row-level `true` cannot re-open what the grid closed', async () => {
    // Every layer around this one is an intersection (the ADR-0103 bucket, the
    // object's `userActions`, the server's effective operations, the
    // principal's grant, the record-level verdict). A prop that could widen
    // would be the one hole in that chain, and a host could hand a user an
    // affordance the object's own policy removed.
    //
    // The two members are set in OPPOSITE directions on purpose, so this reads
    // the wiring rather than a vacuous truth: the grid opens `update` and the
    // predicate closes it (Edit must go — an assertion that dies with the
    // wiring), while the grid closes `delete` and the predicate says `true`
    // (Delete must stay gone — the union claim itself). A test that only made
    // the union claim would stay green with the whole mechanism deleted,
    // because an unconsulted predicate cannot widen anything either.
    renderGrid({
      operations: { update: true, delete: false },
      rowOperations: () => ({ update: false, delete: true }),
    });
    await settle();

    expect(await rowKebab(ORDINARY.name)).toEqual({ edit: false, delete: false, trigger: false });
  });
});

/**
 * The CONTROL for the additive claim: a caller that passes no predicate must
 * render what it rendered before the prop existed. Every other `<ObjectGrid>`
 * in this repository is such a caller.
 */
describe('objectui#8674 · CONTROL — a grid with no predicate is unchanged', () => {
  it('keeps Edit and Delete on every row when `rowOperations` is not passed', async () => {
    renderGrid();
    await settle();

    expect(await rowKebab(ORDINARY.name)).toEqual({ edit: true, delete: true, trigger: true });
    expect(await rowKebab(LOCKED.name)).toEqual({ edit: true, delete: true, trigger: true });
  });

  it('is equally unchanged when the predicate answers with nothing at all', async () => {
    // `null`, `undefined` and an empty object are the three ways a host says
    // "no opinion about this row"; none of them may remove anything.
    for (const answer of [null, undefined, {}] as const) {
      renderGrid({ rowOperations: () => answer });
      await settle();
      expect(await rowKebab(LOCKED.name)).toEqual({ edit: true, delete: true, trigger: true });
      cleanup();
    }
  });
});
